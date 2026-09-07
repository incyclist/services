import { RouteApiDetail } from '../api/types'
import { Route } from '../model/route'
import { RouteInfo, RoutePoint, VideoDescription } from '../types'
import {
    analyseElevationNoise,
    applySmoothing,
    getSmoothingGradient,
    getSmoothingProfile,
    getSteepestGradient,
    isSmoothingEligible,
    smoothElevation,
    MAX_SMOOTHING_LEVEL,
} from './smoothing'

const buildPoints = (elevations: Array<number>, spacing = 10): Array<RoutePoint> =>
    elevations.map((elevation, i) => ({
        lat: 50 + i * 0.0001,
        lng: 8.5,
        cnt: i,
        routeDistance: i * spacing,
        distance: i === 0 ? 0 : spacing,
        elevation,
        videoSpeed: 30,
        videoTime: i * 1.2,
        time: i,
    }))

const ramp = (count: number, gradient = 0.05, start = 100, spacing = 10): Array<RoutePoint> =>
    buildPoints(
        Array.from({ length: count }, (_, i) => start + i * spacing * gradient),
        spacing
    )

const buildRoute = (points: Array<RoutePoint>): Route =>
    new Route({ id: 'r1', title: 'Test Route', hasGpx: true }, { id: 'r1', title: 'Test Route', points })

describe('smoothing', () => {
    describe('getSmoothingProfile', () => {
        test('returns the documented level table', () => {
            expect(getSmoothingProfile(1)).toEqual({ windowLength: 30, passes: 1, spikeThreshold: 5 })
            expect(getSmoothingProfile(2)).toEqual({ windowLength: 60, passes: 1, spikeThreshold: 4 })
            expect(getSmoothingProfile(3)).toEqual({ windowLength: 120, passes: 2, spikeThreshold: 3 })
            expect(getSmoothingProfile(4)).toEqual({ windowLength: 250, passes: 2, spikeThreshold: 3 })
            expect(getSmoothingProfile(5)).toEqual({ windowLength: 500, passes: 2, spikeThreshold: 2 })
            expect(MAX_SMOOTHING_LEVEL).toBe(5)
        })

        test('level 0 and below yield a profile that changes nothing', () => {
            const off = getSmoothingProfile(0)
            expect(off.windowLength).toBe(0)
            expect(off.spikeThreshold).toBe(Number.POSITIVE_INFINITY)
            expect(getSmoothingProfile(-3)).toEqual(off)
            expect(getSmoothingProfile(undefined as unknown as number)).toEqual(off)

            const points = buildPoints([100, 130, 101, 102, 103, 104, 130, 106])
            const smoothed = smoothElevation(points, off)
            expect(smoothed.map((p) => p.elevation)).toEqual(points.map((p) => p.elevation))
        })

        test('levels above the maximum are clamped', () => {
            expect(getSmoothingProfile(9)).toEqual(getSmoothingProfile(5))
        })

        test('returns a copy, so callers cannot corrupt the table', () => {
            const profile = getSmoothingProfile(3)
            profile.windowLength = 1
            expect(getSmoothingProfile(3).windowLength).toBe(120)
        })
    })

    describe('smoothElevation', () => {
        test('passes a constant-gradient ramp through unchanged', () => {
            const points = ramp(60, 0.05)
            const smoothed = smoothElevation(points, getSmoothingProfile(3))

            smoothed.forEach((p, i) => {
                expect(p.elevation).toBeCloseTo(points[i].elevation, 6)
            })
        })

        test('passes a constant-gradient ramp through unchanged at every level', () => {
            const points = ramp(80, -0.03, 500)

            for (let level = 1; level <= MAX_SMOOTHING_LEVEL; level++) {
                const smoothed = smoothElevation(points, getSmoothingProfile(level))
                smoothed.forEach((p, i) => {
                    expect(p.elevation).toBeCloseTo(points[i].elevation, 5)
                })
            }
        })

        test('removes a single spike', () => {
            const elevations = Array.from({ length: 40 }, () => 100)
            elevations[20] = 130
            const points = buildPoints(elevations)

            const smoothed = smoothElevation(points, getSmoothingProfile(1))

            expect(Math.abs(smoothed[20].elevation - 100)).toBeLessThan(1)
            smoothed.forEach((p) => {
                expect(Math.abs(p.elevation - 100)).toBeLessThan(1)
            })
        })

        test('leaves the endpoints exactly where they were', () => {
            const elevations = [100, 108, 96, 121, 104, 99, 130, 102, 111, 95, 118, 103]
            const points = buildPoints(elevations)

            const smoothed = smoothElevation(points, getSmoothingProfile(5))

            expect(smoothed[0].elevation).toBe(elevations[0])
            expect(smoothed.at(-1).elevation).toBe(elevations.at(-1))
        })

        test('preserves the point count and every non-elevation field', () => {
            const points = buildPoints([100, 112, 98, 123, 101, 97, 128, 104, 115, 96])
            points[4].isCut = true
            points[4].segment = 'seg-2'
            points[7].heading = 42

            const smoothed = smoothElevation(points, getSmoothingProfile(2))

            expect(smoothed).toHaveLength(points.length)
            smoothed.forEach((p, i) => {
                const src = points[i]
                expect(p.lat).toBe(src.lat)
                expect(p.lng).toBe(src.lng)
                expect(p.cnt).toBe(src.cnt)
                expect(p.routeDistance).toBe(src.routeDistance)
                expect(p.distance).toBe(src.distance)
                expect(p.videoSpeed).toBe(src.videoSpeed)
                expect(p.videoTime).toBe(src.videoTime)
                expect(p.time).toBe(src.time)
                expect(p.isCut).toBe(src.isCut)
                expect(p.segment).toBe(src.segment)
                expect(p.heading).toBe(src.heading)
            })
        })

        test('keeps routeDistance monotonic', () => {
            const points = buildPoints([100, 112, 98, 123, 101, 97, 128, 104, 115, 96])
            const smoothed = smoothElevation(points, getSmoothingProfile(4))

            for (let i = 1; i < smoothed.length; i++) {
                expect(smoothed[i].routeDistance).toBeGreaterThanOrEqual(smoothed[i - 1].routeDistance)
            }
        })

        test('does not mutate the input array or its points', () => {
            const points = buildPoints([100, 145, 98, 123, 101, 97, 128, 104, 115, 96])
            const before = JSON.stringify(points)

            const smoothed = smoothElevation(points, getSmoothingProfile(3))

            expect(JSON.stringify(points)).toBe(before)
            expect(smoothed).not.toBe(points)
            smoothed.forEach((p, i) => expect(p).not.toBe(points[i]))
        })

        test('does not smooth across a cut', () => {
            const elevations = [
                ...Array.from({ length: 10 }, () => 100),
                ...Array.from({ length: 10 }, () => 200),
            ]
            const points = buildPoints(elevations)
            points[10].isCut = true

            // window far larger than either plateau - without cut handling the values around
            // the boundary would be dragged towards each other
            const smoothed = smoothElevation(points, getSmoothingProfile(5))

            smoothed.slice(0, 10).forEach((p) => expect(p.elevation).toBeCloseTo(100, 6))
            smoothed.slice(10).forEach((p) => expect(p.elevation).toBeCloseTo(200, 6))
        })

        test('smooths each run between cuts independently', () => {
            const elevations = [100, 100, 130, 100, 100, 200, 200, 230, 200, 200]
            const points = buildPoints(elevations)
            points[5].isCut = true

            const smoothed = smoothElevation(points, getSmoothingProfile(1))

            expect(Math.abs(smoothed[2].elevation - 100)).toBeLessThan(1)
            expect(Math.abs(smoothed[7].elevation - 200)).toBeLessThan(1)
            // run boundaries stay anchored
            expect(smoothed[4].elevation).toBe(100)
            expect(smoothed[5].elevation).toBe(200)
        })

        test('handles short and degenerate inputs without throwing', () => {
            expect(smoothElevation(undefined as unknown as Array<RoutePoint>, getSmoothingProfile(3))).toEqual([])
            expect(smoothElevation([], getSmoothingProfile(3))).toEqual([])

            const one = buildPoints([100])
            expect(smoothElevation(one, getSmoothingProfile(3)).map((p) => p.elevation)).toEqual([100])

            const two = buildPoints([100, 140])
            expect(smoothElevation(two, getSmoothingProfile(3)).map((p) => p.elevation)).toEqual([100, 140])

            const flat = buildPoints(Array.from({ length: 20 }, () => 75))
            smoothElevation(flat, getSmoothingProfile(5)).forEach((p) => expect(p.elevation).toBeCloseTo(75, 9))
        })

        test('leaves a run untouched when it carries non-finite values', () => {
            const points = buildPoints([100, 110, 105, 120, 108, 112, 104, 115])
            points[3].elevation = Number.NaN

            const smoothed = smoothElevation(points, getSmoothingProfile(3))

            expect(smoothed.map((p) => p.elevation)).toEqual(points.map((p) => p.elevation))
        })

        test('handles points that share a routeDistance', () => {
            const points = buildPoints([100, 120, 100, 130, 100, 110, 100, 105])
            points[3].routeDistance = points[2].routeDistance

            const smoothed = smoothElevation(points, getSmoothingProfile(2))

            smoothed.forEach((p) => expect(Number.isFinite(p.elevation)).toBe(true))
            expect(smoothed).toHaveLength(points.length)
        })

        test('reduces the elevation gain of a noisy track', () => {
            const points = buildPoints(
                Array.from({ length: 100 }, (_, i) => 100 + i * 0.3 + (i % 2 === 0 ? 2 : -2))
            )
            const gain = (pts: Array<RoutePoint>) =>
                pts.reduce((sum, p, i) => (i > 0 && p.elevation > pts[i - 1].elevation ? sum + p.elevation - pts[i - 1].elevation : sum), 0)

            const raw = gain(points)
            const smoothed = gain(smoothElevation(points, getSmoothingProfile(3)))

            expect(smoothed).toBeLessThan(raw)
            expect(smoothed).toBeGreaterThan(0)
        })
    })

    describe('applySmoothing', () => {
        test('returns a smoothed clone and leaves the source route untouched', () => {
            const points = buildPoints([100, 145, 98, 123, 101, 97, 128, 104, 115, 96])
            const route = buildRoute(points)
            const before = JSON.stringify(route.details)

            const smoothed = applySmoothing(route, 3)

            expect(smoothed).not.toBe(route)
            expect(JSON.stringify(route.details)).toBe(before)
            expect(smoothed.points).toHaveLength(points.length)
        })

        test('recomputes slope and elevation gain from the smoothed elevations', () => {
            const points = buildPoints([100, 145, 98, 123, 101, 97, 128, 104, 115, 96])
            const smoothed = applySmoothing(buildRoute(points), 3)

            smoothed.points.forEach((p) => {
                expect(Number.isFinite(p.slope)).toBe(true)
                expect(Number.isFinite(p.elevationGain)).toBe(true)
            })

            const last = smoothed.points.at(-1).elevationGain
            expect(smoothed.description.elevation).toBe(last)
            expect(smoothed.details.elevation).toBe(last)
            expect(smoothed.description.elevation).toBeLessThan(200)
        })

        test('level 0 returns an unmodified clone', () => {
            const points = buildPoints([100, 145, 98, 123, 101, 97, 128, 104, 115, 96])
            const route = buildRoute(points)

            const result = applySmoothing(route, 0)

            expect(result).not.toBe(route)
            expect(result.points.map((p) => p.elevation)).toEqual(points.map((p) => p.elevation))
        })

        test('handles a route without points', () => {
            const route = new Route({ id: 'r2', title: 'no points' }, { id: 'r2', title: 'no points' })
            expect(() => applySmoothing(route, 3)).not.toThrow()
        })
    })

    describe('analyseElevationNoise', () => {
        test('reports ~1 gain ratio and no reversals for a clean ramp', () => {
            const stats = analyseElevationNoise(ramp(60, 0.04))

            expect(stats.gainRatio).toBeCloseTo(1, 3)
            expect(stats.reversalDensity).toBe(0)
            expect(stats.pointCount).toBe(60)
            expect(stats.medianSpacing).toBe(10)
        })

        test('reports a high gain ratio and reversal density for a noisy track', () => {
            const noisy = buildPoints(
                Array.from({ length: 100 }, (_, i) => 100 + i * 0.2 + (i % 2 === 0 ? 1.5 : -1.5))
            )
            const stats = analyseElevationNoise(noisy)

            expect(stats.gainRatio).toBeGreaterThan(1.35)
            expect(stats.reversalDensity).toBeGreaterThan(40)
            expect(stats.pointCount).toBe(100)
        })

        test('handles empty, tiny and flat inputs without throwing', () => {
            expect(analyseElevationNoise(undefined as unknown as Array<RoutePoint>)).toEqual({
                gainRatio: 1,
                reversalDensity: 0,
                pointCount: 0,
                medianSpacing: 0,
            })
            expect(analyseElevationNoise([]).pointCount).toBe(0)
            expect(analyseElevationNoise(buildPoints([100])).pointCount).toBe(1)

            const flat = analyseElevationNoise(buildPoints(Array.from({ length: 20 }, () => 100)))
            expect(flat.gainRatio).toBe(1)
            expect(flat.reversalDensity).toBe(0)
        })

        test('does not mutate the input', () => {
            const points = buildPoints([100, 145, 98, 123, 101, 97, 128, 104, 115, 96])
            const before = JSON.stringify(points)
            analyseElevationNoise(points)
            expect(JSON.stringify(points)).toBe(before)
        })
    })

    describe('getSteepestGradient', () => {
        const withSlopes = (slopes: Array<number | undefined>): Array<RoutePoint> =>
            buildPoints(slopes.map((_, i) => i * 10)).map((p, i) => ({ ...p, slope: slopes[i] }))

        test('returns the largest magnitude, ignoring sign', () => {
            expect(getSteepestGradient(withSlopes([1, -20.4, 3, 8.5]))).toBe(20.4)
        })

        test('skips points without a finite slope', () => {
            expect(getSteepestGradient(withSlopes([undefined, Number.NaN, 5, 2]))).toBe(5)
        })

        test('handles empty and malformed input without throwing', () => {
            expect(getSteepestGradient([])).toBe(0)
            expect(getSteepestGradient(undefined as unknown as Array<RoutePoint>)).toBe(0)
            expect(getSteepestGradient([null, undefined] as unknown as Array<RoutePoint>)).toBe(0)
        })
    })

    describe('getSmoothingGradient', () => {
        const withSlope = (slope: number): RoutePoint => ({ slope } as RoutePoint)
        const routePoints = [withSlope(2), withSlope(20.4), withSlope(-5)]
        const smoothedPoints = [withSlope(1.5), withSlope(8.5), withSlope(-4)]

        test('reports the steepest gradient before and after', () => {
            const gradient = getSmoothingGradient(routePoints, smoothedPoints, 1240, 1180)

            expect(gradient.routeSteepest).toBe(20.4)
            expect(gradient.smoothedSteepest).toBe(8.5)
        })

        test('has a visible effect when the steepest gradient moves enough', () => {
            expect(getSmoothingGradient(routePoints, smoothedPoints, 1240, 1240).hasVisibleEffect).toBe(true)
        })

        test('has a visible effect when only the elevation gain moves enough, gradient barely moving', () => {
            const flat = getSmoothingGradient([withSlope(5)], [withSlope(4.9)], 1000, 950)
            expect(flat.hasVisibleEffect).toBe(true)
        })

        test('has no visible effect when both the gradient and the gain barely move', () => {
            const barely = getSmoothingGradient([withSlope(5)], [withSlope(4.9)], 1000, 995)
            expect(barely.hasVisibleEffect).toBe(false)
        })

        test('treats missing or non-finite gains as no gain move', () => {
            const gradient = getSmoothingGradient([withSlope(5)], [withSlope(4.9)], undefined, undefined)
            expect(gradient.hasVisibleEffect).toBe(false)
        })

        test('does not throw on empty point arrays', () => {
            expect(() => getSmoothingGradient([], [], 100, 90)).not.toThrow()
        })
    })

    describe('isSmoothingEligible', () => {
        // buildPoints() sets `time` on every point, which is one of the video fingerprints -
        // strip it wherever a test needs a video route that must NOT be recognised
        const withoutTime = (points: Array<RoutePoint>): Array<RoutePoint> =>
            points.map(({ time, ...rest }) => rest as RoutePoint)

        const withoutPosition = (points: Array<RoutePoint>): Array<RoutePoint> =>
            points.map(({ lat, lng, ...rest }) => rest as RoutePoint)

        const buildEligibilityRoute = (
            description: Partial<RouteInfo> = {},
            details: Partial<RouteApiDetail> = {}
        ): Route =>
            new Route({ id: 'e1', title: 'Eligibility Route', ...description } as RouteInfo, {
                id: 'e1',
                title: 'Eligibility Route',
                points: ramp(12),
                ...details,
            } as RouteApiDetail)

        const video = { file: 'route.avi', framerate: 30, mappings: [] } as unknown as VideoDescription

        test('a plain GPX route is eligible', () => {
            const route = buildEligibilityRoute({ hasGpx: true, hasVideo: false })
            expect(isSmoothingEligible(route)).toBe(true)
        })

        test('a mapping-only route with no usable track is not eligible', () => {
            const route = buildEligibilityRoute(
                { hasVideo: true },
                { points: withoutPosition(withoutTime(ramp(12))), video }
            )
            expect(isSmoothingEligible(route)).toBe(false)
        })

        test('a Daum EPP route is not eligible', () => {
            const route = buildEligibilityRoute({ hasGpx: true, hasVideo: false }, {
                epp: { programData: [] },
            } as unknown as Partial<RouteApiDetail>)
            expect(isSmoothingEligible(route)).toBe(false)
        })

        test('a Kettler-style video route with lat/lng but no fingerprint is not eligible', () => {
            const route = buildEligibilityRoute(
                { hasGpx: true, hasVideo: true },
                { points: withoutTime(ramp(12)), video }
            )
            expect(isSmoothingEligible(route)).toBe(false)
        })

        test('a gpx-import video route with isCut points is eligible', () => {
            const points = withoutTime(ramp(12))
            points[6].isCut = true

            const route = buildEligibilityRoute({ hasGpx: true, hasVideo: true }, { points, video })
            expect(isSmoothingEligible(route)).toBe(true)
        })

        test('a gpx-import video route with point.time is eligible', () => {
            const route = buildEligibilityRoute({ hasGpx: true, hasVideo: true }, { points: ramp(12), video })
            expect(isSmoothingEligible(route)).toBe(true)
        })

        test('a persisted pointsSource of gpx makes a video route eligible', () => {
            const route = buildEligibilityRoute(
                { hasGpx: true, hasVideo: true, pointsSource: 'gpx' },
                { points: withoutTime(ramp(12)), video }
            )
            expect(isSmoothingEligible(route)).toBe(true)
        })

        test('a flat all-zero track is not eligible', () => {
            const points = buildPoints(Array.from({ length: 12 }, () => 0))
            const route = buildEligibilityRoute({ hasGpx: true, hasVideo: false }, { points })
            expect(isSmoothingEligible(route)).toBe(false)
        })

        test('hasGpx===false blocks, but an absent hasGpx does not', () => {
            expect(isSmoothingEligible(buildEligibilityRoute({ hasGpx: false }))).toBe(false)
            expect(isSmoothingEligible(buildEligibilityRoute({}))).toBe(true)
        })

        test('gpxDisabled blocks', () => {
            expect(isSmoothingEligible(buildEligibilityRoute({ hasGpx: true }, { gpxDisabled: true }))).toBe(false)
        })

        test('fewer than 8 points blocks', () => {
            expect(isSmoothingEligible(buildEligibilityRoute({ hasGpx: true }, { points: ramp(7) }))).toBe(false)
            expect(isSmoothingEligible(buildEligibilityRoute({ hasGpx: true }, { points: ramp(8) }))).toBe(true)
        })

        test('a non-finite elevation anywhere blocks', () => {
            const points = ramp(12)
            points[5].elevation = undefined

            expect(isSmoothingEligible(buildEligibilityRoute({ hasGpx: true }, { points }))).toBe(false)
        })

        test('undefined and malformed routes return false without throwing', () => {
            expect(isSmoothingEligible(undefined)).toBe(false)
            expect(isSmoothingEligible({} as Route)).toBe(false)
            expect(isSmoothingEligible({ description: null, details: null } as unknown as Route)).toBe(false)
            expect(isSmoothingEligible({ details: { points: 'nope' } } as unknown as Route)).toBe(false)
            expect(
                isSmoothingEligible({ details: { points: [null, undefined, 1] } } as unknown as Route)
            ).toBe(false)
        })
    })
})
