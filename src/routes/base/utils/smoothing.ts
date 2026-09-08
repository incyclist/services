import { Route } from "../model/route";
import { RoutePoint } from "../types";
import { checkIsLoop, updateCnt, updateElevationGain, updateSlopes } from "./route";

/**
 * Elevation smoothing for routes.
 *
 * Pure module: no I/O, no bindings, no service lifecycle, no singletons.
 *
 * The transform runs in four stages, in this order:
 *   1. despike   - median-3 outlier rejection, removes single-sample GPS/barometric spikes.
 *                  Must run first: a linear filter would smear a single spike across the
 *                  whole window instead of removing it.
 *   2. box filter - centred moving average in the *distance* domain (not the sample-index
 *                  domain), so a given level always means the same physical smoothing
 *                  length regardless of point spacing.
 *   3. lag correction - a centred single pass is zero-phase (a peak's apex doesn't move), but a
 *                  *second* pass measurably delays where a slope change reads as felt on a
 *                  trainer - confirmed against real recorded climbs, not just derived from
 *                  theory (see getLagShiftDistance). Only levels with two box-filter passes get
 *                  a correction; a single pass needs none.
 *   4. derived fields - slope and elevationGain are recomputed from the new elevations.
 *
 * `smoothElevation` itself is route-agnostic and has no notion of a loop - that awareness lives
 * one level up, in `applySmoothing`, which pads a loop's points with its own wrap-around context
 * (see padForLoop) before calling it, so stages 2-3 see the route's real continuation at both
 * boundaries instead of a hard array edge, then trims the padding back off and re-closes the
 * elevation seam as a second pass (see the `updateSlopes` call there).
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
 * Fraction of a (two-pass) box-filter window that the second pass delays a slope transition by.
 * Measured against two real recorded climbs (not derived from theory - a single centred pass is
 * provably zero-phase, but empirically the second pass isn't): the actual ratio varied 3x between
 * them (~0.07 and ~0.20 of window length) depending on the terrain's own shape around the peak, so
 * no constant is exact everywhere. 0.15 splits that range. A single pass measured at noise-floor
 * (no correction needed) on both climbs, hence the passes===2 gate in getLagShiftDistance.
 */
const LAG_SHIFT_RATIO = 0.15

/** metres to correct the lag by for a given profile - 0 for a single pass, see LAG_SHIFT_RATIO */
const getLagShiftDistance = (opts: SmoothingOptions): number =>
    opts.passes === 2 ? opts.windowLength * LAG_SHIFT_RATIO : 0

/**
 * Value the (already box-filtered) run's elevation curve would show at distance x - including
 * beyond either end of the run, extrapolated linearly from that end's own boundary slope, so a
 * lag-shifted lookup past the run's extent still gets a sensible answer.
 *
 * Callers must only query non-decreasing x (matches applyLagShift's own access pattern), which
 * lets this keep a single forward cursor rather than rescanning from the start each call.
 */
const buildElevationLookup = (d: Array<number>, e: Array<number>): ((x: number) => number) => {
    const n = d.length
    let cursor = 0

    return (x: number): number => {
        if (x >= d[n - 1]) {
            const span = d[n - 1] - d[n - 2]
            const slope = span > 0 ? (e[n - 1] - e[n - 2]) / span : 0
            return e[n - 1] + slope * (x - d[n - 1])
        }
        while (cursor < n - 2 && d[cursor + 1] < x) cursor++
        if (x <= d[cursor]) return e[cursor]
        const span = d[cursor + 1] - d[cursor]
        const t = span > 0 ? (x - d[cursor]) / span : 0
        return e[cursor] + (e[cursor + 1] - e[cursor]) * t
    }
}

/**
 * Stage 3, one run: corrects the delay the second box-filter pass introduces at slope
 * transitions, by re-reading each point's elevation from `shiftDistance` metres further along the
 * (already box-filtered) curve.
 *
 * Anchored so a run with no curvature at all is returned completely unchanged: shifting a
 * *constant-gradient* run's elevation naively would add a spurious `slope * shiftDistance` offset
 * to every point (there is nothing to correct on a straight grade - the lag only exists at
 * transitions), so every point is re-based against `elevationAt(shiftDistance)` - the same
 * reference the run's own first point is implicitly measured against. For a straight run this
 * reference exactly cancels the shift's would-be offset; for a curved one, it doesn't, which is
 * the correction actually taking effect. This also means the run's last point - unlike the box
 * filter's own output - is generally NOT left exactly where it was: if the lag being corrected
 * reaches the run's end, the end is exactly where it should move.
 */
const applyLagShift = (points: Array<RoutePoint>, start: number, end: number, shiftDistance: number): void => {
    const n = end - start
    if (n < 2 || !(shiftDistance > 0)) return

    const d = new Array<number>(n)
    const e = new Array<number>(n)
    for (let i = 0; i < n; i++) {
        d[i] = points[start + i].routeDistance - points[start].routeDistance
        e[i] = points[start + i].elevation
    }
    if (!(d[n - 1] > 0)) return

    const elevationAt = buildElevationLookup(d, e)
    const reference = elevationAt(shiftDistance)

    for (let i = 0; i < n; i++) {
        points[start + i].elevation = e[0] + elevationAt(d[i] + shiftDistance) - reference
    }
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
/**
 * Generous padding for a loop's wrap-around smoothing context - deliberately much larger than any
 * profile's own window/lag-shift needs (at most ~325m combined, at level 5). Computing more than
 * strictly necessary costs a few milliseconds; a comfortable margin measurably improves quality at
 * the seam, so this is not tuned tighter than that.
 */
const LOOP_PADDING_DISTANCE = 800

/**
 * Wraps a loop's own end onto its start and its own start onto its end, so a run's boundary-
 * clamped box-filter window and the lag correction's extrapolation both see the route's real
 * continuation (itself) at both boundaries, instead of guessing at either one.
 *
 * `isCut` is stripped from the padding copies - they are a continuation, not a real cut - and
 * `routeDistance` is offset so the whole padded array stays monotonic; every other field is
 * carried over as a plain shallow copy (smoothElevation never reads it).
 *
 * Returns `padded` together with `headCount` (how much was prepended), so the caller can trim the
 * padding back off after smoothing: `padded.slice(headCount, headCount + points.length)` recovers
 * exactly the original points, in order, with only their `elevation` changed.
 */
const padForLoop = (
    points: Array<RoutePoint>,
    padDistance: number
): { padded: Array<RoutePoint>; headCount: number } => {
    const total = points.at(-1)?.routeDistance ?? 0
    if (!(total > 0)) return { padded: points, headCount: 0 }

    const tail = points.filter((p) => total - p.routeDistance <= padDistance)
    const head = points.filter((p) => p.routeDistance <= padDistance)

    const before = tail.map((p) => ({ ...p, routeDistance: p.routeDistance - total, isCut: false }))
    const after = head.map((p) => ({ ...p, routeDistance: p.routeDistance + total, isCut: false }))

    return { padded: [...before, ...points, ...after], headCount: before.length }
}

export const smoothElevation = (points: Array<RoutePoint>, opts: SmoothingOptions): Array<RoutePoint> => {
    if (!points?.length) return []

    const result = points.map((p) => ({ ...p }))
    if (!opts) return result

    const passes = opts.passes === 2 ? 2 : 1
    const lagShiftDistance = getLagShiftDistance(opts)

    getSegmentRanges(result).forEach(([start, end]) => {
        if (!isUsable(result, start, end)) return

        despikeRange(result, start, end, opts.spikeThreshold)
        for (let pass = 0; pass < passes; pass++) boxFilterRange(result, start, end, opts.windowLength)
        applyLagShift(result, start, end, lagShiftDistance)
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

    const profile = getSmoothingProfile(level)

    // a loop's own end/start pad each other's smoothing context - see padForLoop - so the box
    // filter and lag correction have real data to work with at both boundaries instead of the
    // hard array edge every other route has there
    let points: Array<RoutePoint>
    if (checkIsLoop(source)) {
        const { padded, headCount } = padForLoop(source, LOOP_PADDING_DISTANCE)
        points = smoothElevation(padded, profile).slice(headCount, headCount + source.length)
    } else {
        points = smoothElevation(source, profile)
    }

    if (smoothed.details?.points) smoothed.details.points = points
    if (smoothed.description?.points) smoothed.description.points = points

    // slopes are recomputed from the new elevations; `updateSlopes` keys off `cnt`, so make
    // sure it is present before asking for a recompute
    points.forEach((p) => {
        delete p.slope
        delete p.elevationGain
    })
    if (points.some((p) => !Number.isFinite(p.cnt))) updateCnt(points)

    // validateOnly=false, unlike the pre-smoothing pass: the lag correction no longer pins a
    // run's last point exactly (see applyLagShift), so smoothing can reopen the very seam the
    // pre-smoothing ramp had closed - this re-closes it as a second pass. updateSlopes runs its
    // own checkIsLoop internally and no-ops the ramp for a non-loop route either way, and every
    // slope was just deleted above regardless, so validateOnly's other effect (skip slopes that
    // are already defined) never applied here in the first place
    updateSlopes(points, false)
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
        // this route's elevation timing was already hand-corrected by its author for a different
        // problem (video/GPS misalignment, see IncyclistXMLParser.processElevationShift) - our own
        // smoothing has no awareness of that correction and could interact with it unpredictably
        if (route?.details?.elevationShifted) return false

        // 3. resistance must actually derive from the points, not from an uploaded program
        if (route?.details?.epp) return false

        // 4. provenance - only consulted for video routes; a route with no video can only have
        //    got its points from the GPX pipeline, since every other format is video-bearing
        return !isVideoRoute(route) || isInScopeVideoRoute(route)
    } catch {
        return false
    }
}

/**
 * Steepest gradient carried by a point array, in percent.
 *
 * The sign is dropped: a 20% descent is exactly as steep as a 20% climb, and the trainer
 * reproduces the magnitude either way.
 *
 * Reads the slopes the points already carry rather than deriving new ones, so the figure is the
 * one the profile chart draws and the one the trainer will be driven with.
 *
 * Total and non-throwing: points without a finite slope are skipped, and an empty or entirely
 * unusable array yields 0.
 */
export const getSteepestGradient = (points: Array<RoutePoint>): number => {
    if (!Array.isArray(points)) return 0

    let steepest = 0
    for (const p of points) {
        const slope = p?.slope
        if (!Number.isFinite(slope)) continue

        const magnitude = Math.abs(slope)
        if (magnitude > steepest) steepest = magnitude
    }

    return steepest
}

/**
 * What a smoothing level does to the gradient - the axis the rider actually feels through the
 * trainer, and the one that carries the signal: the same transform that moves a real track's
 * elevation curve by a fraction of a pixel moves its steepest gradient by a factor.
 */
export interface SmoothingGradient {
    /** steepest gradient of the route's own points, in percent */
    routeSteepest: number
    /** steepest gradient after smoothing, in percent */
    smoothedSteepest: number
    /** false when this level barely changes this route, so the UI can say so instead of
     *  reading as a broken control */
    hasVisibleEffect: boolean
}

/** below this steepest-gradient move (percentage points), a level is a candidate for "barely
 *  changes this route" - but only if the gain move is also small, see getSmoothingGradient() */
const MIN_VISIBLE_GRADIENT_DELTA = 0.5

/** below this elevation-gain move (as a fraction of the route's own gain), same caveat */
const MIN_VISIBLE_GAIN_RATIO = 0.02

/**
 * Compares a route's own gradient/gain to a smoothed level's, and decides whether the change is
 * worth showing as "this ride records less elevation gain" or as "this level barely changes this
 * route - try a higher one" (ux.md's third copy state).
 *
 * `hasVisibleEffect` is false only when BOTH moves are small - a level that visibly changes
 * either axis has an effect worth reporting, even if the other axis barely moves. A track sampled
 * coarsely (~100 m spacing) genuinely carries no sub-120m detail for a mid-range level to remove,
 * so "almost nothing happened" is a legitimate outcome here, not a defect to hide.
 *
 * Total and non-throwing: absent/non-finite gains are treated as "no evidence of a gain move".
 */
export const getSmoothingGradient = (
    routePoints: Array<RoutePoint>,
    smoothedPoints: Array<RoutePoint>,
    routeGain?: number,
    smoothedGain?: number
): SmoothingGradient => {
    const routeSteepest = getSteepestGradient(routePoints)
    const smoothedSteepest = getSteepestGradient(smoothedPoints)
    const gradientDelta = Math.abs(routeSteepest - smoothedSteepest)

    const gainRatio =
        Number.isFinite(routeGain) && routeGain > 0 && Number.isFinite(smoothedGain)
            ? Math.abs(routeGain - smoothedGain) / routeGain
            : 0

    const hasVisibleEffect = gradientDelta >= MIN_VISIBLE_GRADIENT_DELTA || gainRatio >= MIN_VISIBLE_GAIN_RATIO

    return { routeSteepest, smoothedSteepest, hasVisibleEffect }
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
