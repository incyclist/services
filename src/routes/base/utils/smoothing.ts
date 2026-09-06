import { Route } from "../model/route";
import { RoutePoint } from "../types";
import { updateCnt, updateElevationGain, updateSlopes } from "./route";

/**
 * Elevation smoothing for routes.
 *
 * Pure module: no I/O, no bindings, no service lifecycle, no singletons.
 *
 * The transform runs in three stages, in this order:
 *   1. despike   - median-3 outlier rejection, removes single-sample GPS/barometric spikes.
 *                  Must run first: a linear filter would smear a single spike across the
 *                  whole window instead of removing it.
 *   2. box filter - centred moving average in the *distance* domain (not the sample-index
 *                  domain), so a given level always means the same physical smoothing
 *                  length regardless of point spacing.
 *   3. derived fields - slope and elevationGain are recomputed from the new elevations.
 *
 * CAUTION: calling `validateRoute()` with `reset=true` recomputes all slopes from scratch and
 * would destroy the smoothing applied here. Today only FreeRideDisplayService calls it that
 * way, and free ride is never smoothed, so there is no conflict - but any new caller passing
 * `reset=true` on a smoothed route would silently undo the smoothing.
 * `validateRoute(route, false)` is safe: it keeps slopes that are already defined.
 */

export type SmoothingOptions = {
    /** length of the averaging window, in metres */
    windowLength: number
    /** number of box-filter passes; 2 passes == triangular (Bartlett) kernel */
    passes: 1 | 2
    /** elevation deviation (m) above which a point is treated as a spike */
    spikeThreshold: number
}

export type NoiseStats = {
    /** raw elevation gain divided by the elevation gain after reference smoothing (L=120m) */
    gainRatio: number
    /** number of slope sign changes per km */
    reversalDensity: number
    pointCount: number
    /** median distance between consecutive points, in metres */
    medianSpacing: number
}

/** level used as the reference when measuring how much spurious micro-gain a track carries */
const NOISE_REFERENCE_LEVEL = 3

const PROFILES: Record<number, SmoothingOptions> = {
    1: { windowLength: 30, passes: 1, spikeThreshold: 5 },
    2: { windowLength: 60, passes: 1, spikeThreshold: 4 },
    3: { windowLength: 120, passes: 2, spikeThreshold: 3 },
    4: { windowLength: 250, passes: 2, spikeThreshold: 3 },
    5: { windowLength: 500, passes: 2, spikeThreshold: 2 },
}

export const MAX_SMOOTHING_LEVEL = 5

/** a profile that provably changes nothing: no window to average over, no reachable spike threshold */
const NO_OP_PROFILE: SmoothingOptions = {
    windowLength: 0,
    passes: 1,
    spikeThreshold: Number.POSITIVE_INFINITY,
}

/**
 * Maps the 1..5 aggressiveness level onto filter parameters.
 *
 * Level 0 (and anything below, or a non-numeric level) means "off" and yields a profile that
 * leaves the elevations untouched. Levels above the maximum are clamped.
 */
export const getSmoothingProfile = (level: number): SmoothingOptions => {
    if (!Number.isFinite(level)) return { ...NO_OP_PROFILE }

    const rounded = Math.round(level)
    if (rounded < 1) return { ...NO_OP_PROFILE }

    const clamped = Math.min(rounded, MAX_SMOOTHING_LEVEL)
    return { ...PROFILES[clamped] }
}

const median3 = (a: number, b: number, c: number): number => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))

/**
 * Splits the points into runs that may be filtered independently.
 *
 * `isCut` marks a deliberate positional/elevation discontinuity (a video cut): the point
 * carrying the flag is the first point *after* the jump. Smoothing across such a boundary
 * would drag elevation over a teleport and invent a gradient there, so every run between
 * cuts is filtered on its own.
 *
 * Returns [start,end) index pairs.
 */
const getSegmentRanges = (points: Array<RoutePoint>): Array<[number, number]> => {
    const ranges: Array<[number, number]> = []
    let start = 0

    for (let i = 1; i < points.length; i++) {
        if (points[i]?.isCut === true) {
            ranges.push([start, i])
            start = i
        }
    }
    ranges.push([start, points.length])

    return ranges
}

const isUsable = (points: Array<RoutePoint>, start: number, end: number): boolean => {
    for (let i = start; i < end; i++) {
        const p = points[i]
        if (!Number.isFinite(p?.elevation) || !Number.isFinite(p?.routeDistance)) return false
    }
    return true
}

/** stage 1: median-3 outlier rejection over the interior of one run */
const despikeRange = (points: Array<RoutePoint>, start: number, end: number, threshold: number): void => {
    if (end - start < 3 || !Number.isFinite(threshold)) return

    const original = new Array<number>(end - start)
    for (let i = start; i < end; i++) original[i - start] = points[i].elevation

    for (let i = start + 1; i < end - 1; i++) {
        const m = median3(original[i - 1 - start], original[i - start], original[i + 1 - start])
        if (Math.abs(original[i - start] - m) > threshold) points[i].elevation = m
    }
}

/**
 * Stage 2, one pass: centred moving average over one run, in the distance domain.
 *
 *     e'(d_i) = 1/W * integral over [d_i - W/2, d_i + W/2] of e(d) dd
 *
 * with e(d) linearly interpolated between points. The integral is evaluated from trapezoidal
 * prefix sums, so the whole pass is O(n) rather than O(n * window).
 *
 * The window shrinks symmetrically at both ends - W = min(L, 2*d_i, 2*(D - d_i)) - which keeps
 * the first and last elevation of the run exactly unchanged.
 */
const boxFilterRange = (points: Array<RoutePoint>, start: number, end: number, windowLength: number): void => {
    const n = end - start
    if (n < 3 || !(windowLength > 0)) return

    const d = new Array<number>(n)
    const e = new Array<number>(n)
    for (let i = 0; i < n; i++) {
        d[i] = points[start + i].routeDistance - points[start].routeDistance
        e[i] = points[start + i].elevation
    }

    const total = d[n - 1]
    if (!(total > 0)) return

    // trapezoidal prefix sums: cum[i] = integral of e(d) from d[0] to d[i]
    const cum = new Array<number>(n)
    cum[0] = 0
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + ((e[i - 1] + e[i]) / 2) * (d[i] - d[i - 1])

    // both window bounds are non-decreasing in i, so a single forward cursor per bound suffices
    const cursor = { lower: 0, upper: 0 }

    const integralAt = (x: number, which: 'lower' | 'upper'): number => {
        let j = cursor[which]
        while (j < n - 2 && d[j + 1] < x) j++
        cursor[which] = j

        if (x <= d[j]) return cum[j]
        if (x >= d[j + 1]) return cum[j + 1]

        const span = d[j + 1] - d[j]
        const t = span > 0 ? (x - d[j]) / span : 0
        const ex = e[j] + (e[j + 1] - e[j]) * t
        return cum[j] + ((e[j] + ex) / 2) * (x - d[j])
    }

    const smoothed = new Array<number>(n)
    for (let i = 0; i < n; i++) {
        const w = Math.min(windowLength, 2 * d[i], 2 * (total - d[i]))
        if (!(w > 0)) {
            // endpoints (and any point sharing their distance) are anchored exactly
            smoothed[i] = e[i]
            continue
        }
        const value = (integralAt(d[i] + w / 2, 'upper') - integralAt(d[i] - w / 2, 'lower')) / w
        smoothed[i] = Number.isFinite(value) ? value : e[i]
    }

    for (let i = 0; i < n; i++) points[start + i].elevation = smoothed[i]
}

/**
 * Smooths the elevation profile of a point array.
 *
 * Returns a NEW array of NEW point objects - the input is never modified. Point count is
 * preserved exactly, and every field other than `elevation` (lat, lng, routeDistance,
 * videoSpeed, videoTime, isCut, cnt, time, ...) is carried over untouched, so `routeDistance`
 * stays monotonic by construction.
 *
 * Derived fields (`slope`, `elevationGain`) are NOT recomputed here - that is the caller's
 * job, see applySmoothing().
 */
export const smoothElevation = (points: Array<RoutePoint>, opts: SmoothingOptions): Array<RoutePoint> => {
    if (!points?.length) return []

    const result = points.map((p) => ({ ...p }))
    if (!opts) return result

    const passes = opts.passes === 2 ? 2 : 1

    getSegmentRanges(result).forEach(([start, end]) => {
        if (!isUsable(result, start, end)) return

        despikeRange(result, start, end, opts.spikeThreshold)
        for (let pass = 0; pass < passes; pass++) boxFilterRange(result, start, end, opts.windowLength)
    })

    return result
}

/**
 * Returns a smoothed clone of the route. The source route is never modified.
 *
 * Level 0 (off) yields a plain, unmodified clone.
 */
export const applySmoothing = (route: Route, level: number): Route => {
    const smoothed = route?.clone()
    if (!smoothed) return smoothed

    if (!Number.isFinite(level) || level < 1) return smoothed

    const source = smoothed.details?.points ?? smoothed.description?.points
    if (!source?.length) return smoothed

    const points = smoothElevation(source, getSmoothingProfile(level))

    if (smoothed.details?.points) smoothed.details.points = points
    if (smoothed.description?.points) smoothed.description.points = points

    // slopes are recomputed from the new elevations; `updateSlopes` keys off `cnt`, so make
    // sure it is present before asking for a recompute
    points.forEach((p) => {
        delete p.slope
        delete p.elevationGain
    })
    if (points.some((p) => !Number.isFinite(p.cnt))) updateCnt(points)

    // validateOnly=true is deliberate: with every slope deleted it still recomputes them all,
    // but skips the loop-elevation shift, which may already have been applied to this route
    // and must never be applied twice
    updateSlopes(points, true)
    updateElevationGain(points)

    const elevation = points.at(-1)?.elevationGain
    if (Number.isFinite(elevation)) {
        if (smoothed.description) smoothed.description.elevation = elevation
        if (smoothed.details) smoothed.details.elevation = elevation
    }

    return smoothed
}

/** below this, there is not enough of a track to filter meaningfully */
const MIN_ELIGIBLE_POINTS = 8

/** the point array the route actually rides on */
const getRoutePoints = (route: Route): Array<RoutePoint> => {
    const points = route?.points ?? route?.details?.points ?? route?.description?.points
    return Array.isArray(points) ? points : []
}

/**
 * True if the route carries a video, i.e. its points may not have come from a GPX track.
 *
 * Both the flag and the underlying object are checked: unlike `hasGpx`, every producer of
 * `hasVideo` means the same thing by it ("a video descriptor exists"), so this is cheap
 * belt-and-braces rather than a workaround.
 */
const isVideoRoute = (route: Route): boolean =>
    route?.description?.hasVideo === true || route?.details?.video !== undefined

/**
 * For video routes only: positive evidence that the points came from the GPX pipeline.
 *
 * Newly imported routes say so directly via `pointsSource`. For routes imported before that
 * field existed, two structural fingerprints stand in, both of which only the Incyclist-XML
 * import can produce: `isCut` (set nowhere else) and `point.time` (set only by the GPX parser
 * that this import always runs; other video formats use `videoTime`, a different field).
 *
 * The default is "not eligible", so an unrecognised route is under-offered rather than
 * offered a control that would corrupt its profile.
 */
const isInScopeVideoRoute = (route: Route): boolean => {
    if (route?.description?.pointsSource === 'gpx') return true

    const points = route?.details?.points
    if (!Array.isArray(points)) return false

    return points.some((p) => p?.isCut === true) || points.some((p) => Number.isFinite(p?.time))
}

/**
 * Decides whether smoothing may be offered for a route.
 *
 * Total and non-throwing: any malformed or partial route (including `undefined`) yields false.
 *
 * The rule takes positive evidence of a real, smoothable elevation track from the point data
 * itself, and reads stored flags only where they are *negative*, so it can never be more
 * permissive than the route detail screens already are.
 *
 * Note the lat/lng check is recomputed from the points rather than read from
 * `description.hasGpx`. That flag has several producers in this codebase which compute it from
 * different questions (some only check that a point array is non-empty), so its positive value
 * cannot be trusted; only its explicit `false` can.
 */
export const isSmoothingEligible = (route: Route): boolean => {
    try {
        const points = getRoutePoints(route)

        // 1. positive evidence of a real, smoothable elevation track
        if (points.length < MIN_ELIGIBLE_POINTS) return false
        if (!points.every((p) => Number.isFinite(p?.elevation))) return false
        // a uniformly flat track (free ride synthesises elevation 0) would pass every other
        // clause while offering a control that provably cannot change anything
        if (new Set(points.map((p) => Math.round(p.elevation))).size < 2) return false
        if (!points.some((p) => p?.lat && p?.lng)) return false

        // 2. respect explicit negatives
        if (route?.description?.hasGpx === false) return false
        if (route?.details?.gpxDisabled) return false

        // 3. resistance must actually derive from the points, not from an uploaded program
        if (route?.details?.epp) return false

        // 4. provenance - only consulted for video routes; a route with no video can only have
        //    got its points from the GPX pipeline, since every other format is video-bearing
        return !isVideoRoute(route) || isInScopeVideoRoute(route)
    } catch {
        return false
    }
}

const getElevationGain = (points: Array<RoutePoint>): number => {
    let gain = 0
    for (let i = 1; i < points.length; i++) {
        const delta = points[i].elevation - points[i - 1].elevation
        if (delta > 0) gain += delta
    }
    return gain
}

const getMedian = (values: Array<number>): number => {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Measures how much of a track's elevation gain exists only at scales no road actually has.
 *
 * Computation only - nothing in the app depends on these numbers yet, and this function does
 * not log anything itself.
 */
export const analyseElevationNoise = (points: Array<RoutePoint>): NoiseStats => {
    const empty: NoiseStats = { gainRatio: 1, reversalDensity: 0, pointCount: 0, medianSpacing: 0 }

    if (!points?.length) return empty

    const usable = points.filter((p) => Number.isFinite(p?.elevation) && Number.isFinite(p?.routeDistance))
    if (usable.length < 2) return { ...empty, pointCount: points.length }

    const spacings: Array<number> = []
    let reversals = 0
    let prevSign = 0

    for (let i = 1; i < usable.length; i++) {
        const dd = usable[i].routeDistance - usable[i - 1].routeDistance
        if (dd > 0) spacings.push(dd)

        const de = usable[i].elevation - usable[i - 1].elevation
        const sign = Math.sign(de)
        if (sign !== 0) {
            if (prevSign !== 0 && sign !== prevSign) reversals++
            prevSign = sign
        }
    }

    const distanceKm = (usable.at(-1).routeDistance - usable[0].routeDistance) / 1000

    const rawGain = getElevationGain(usable)
    const smoothedGain = getElevationGain(smoothElevation(usable, getSmoothingProfile(NOISE_REFERENCE_LEVEL)))

    // with no gain left after reference smoothing there is no meaningful ratio; 1 is the
    // neutral value, i.e. "no evidence of noise" - under-reporting rather than over-reporting
    const gainRatio = smoothedGain > 0 ? rawGain / smoothedGain : 1

    return {
        gainRatio,
        reversalDensity: distanceKm > 0 ? reversals / distanceKm : 0,
        pointCount: points.length,
        medianSpacing: getMedian(spacings),
    }
}
