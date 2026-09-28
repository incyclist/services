import type { RoutePoint } from '../base/types'
import { buildRouteShape, roundShapeValue, ROUTE_SHAPE_POINTS, selectLttbIndices, selectShapeIndices } from './utils'

/** a deterministic, wiggly GPS track with a single summit at 70% of its length */
const createTrack = (n:number, over:(p:RoutePoint,i:number)=>RoutePoint = p=>p):Array<RoutePoint> =>
    Array.from({length:n}, (_,i) => {
        const t = i/(n-1)
        const p:RoutePoint = {
            lat: 46.123456789 + t*0.05 + Math.sin(t*40)*0.001,
            lng: 7.987654321 + Math.cos(t*40)*0.001,
            routeDistance: i*10.123456789,
            elevation: 500 + 300*Math.exp(-(((t-0.7)*20)**2)) + 0.123456789
        }
        return over(p,i)
    })

const decimals = (v:number) => (String(v).split('.')[1] ?? '').length

describe('shapes utils', () => {

    describe('roundShapeValue', () => {
        test('rounds to 5 decimals', () => {
            expect(roundShapeValue(46.123456789)).toBe(46.12346)
            expect(roundShapeValue(-7.000004)).toBe(-7)
        })

        test('returns undefined for values that are not finite numbers', () => {
            expect(roundShapeValue(undefined)).toBeUndefined()
            expect(roundShapeValue(Number.NaN)).toBeUndefined()
            expect(roundShapeValue(Infinity)).toBeUndefined()
        })
    })

    describe('selectLttbIndices', () => {
        test('returns every index when the threshold is not below the point count', () => {
            expect(selectLttbIndices([0,1,2],[0,1,2],5)).toEqual([0,1,2])
        })

        test('selects exactly threshold indices, ascending, keeping first and last', () => {
            const xs = Array.from({length:1000},(_,i)=>i)
            const ys = xs.map( x => Math.sin(x/10))

            const res = selectLttbIndices(xs, ys, 50)

            expect(res).toHaveLength(50)
            expect(res[0]).toBe(0)
            expect(res.at(-1)).toBe(999)
            expect([...res].sort((a,b)=>a-b)).toEqual(res)
        })

        test('keeps a single spike that an even stride would miss', () => {
            const xs = Array.from({length:1000},(_,i)=>i)
            const ys = xs.map( x => x===503 ? 100 : 0)

            expect(selectLttbIndices(xs, ys, 20)).toContain(503)
        })
    })

    describe('selectShapeIndices', () => {
        test('merges a map and an elevation selection when both are available', () => {
            const points = createTrack(5000)

            const res = selectShapeIndices(points, true, true)

            expect(res.length).toBeGreaterThan(ROUTE_SHAPE_POINTS*0.9)
            expect(res.length).toBeLessThanOrEqual(ROUTE_SHAPE_POINTS)
            expect(new Set(res).size).toBe(res.length)
        })

        test('keeps the shape of a broad summit close to its true peak', () => {
            // a gentle, ~1000-point-wide bump: LTTB (like any bucketed decimation) samples the
            // steep shoulders around a broad peak rather than guaranteeing the single highest
            // sample survives, so this checks visual fidelity (how close the kept elevation gets
            // to the true summit) rather than requiring the exact argmax index.
            const points = createTrack(5000)
            const summitElevation = Math.max(...points.map(p=>p.elevation))

            const res = selectShapeIndices(points, true, true)
            const keptMaxElevation = Math.max(...res.map(i=>points[i].elevation))

            expect(summitElevation - keptMaxElevation).toBeLessThan(1)
        })
    })

    describe('buildRouteShape', () => {
        test('decimates a long route to ~100 points', () => {
            const shape = buildRouteShape(createTrack(20000))

            expect(shape.length).toBeGreaterThan(ROUTE_SHAPE_POINTS*0.9)
            expect(shape.length).toBeLessThanOrEqual(ROUTE_SHAPE_POINTS)
        })

        test('keeps first and last point and stays ordered by routeDistance', () => {
            const points = createTrack(3000)
            const shape = buildRouteShape(points)

            expect(shape[0].routeDistance).toBe(0)
            expect(shape.at(-1).routeDistance).toBe(roundShapeValue(points.at(-1).routeDistance))
            shape.forEach( (p,i) => {
                if (i>0) expect(p.routeDistance).toBeGreaterThan(shape[i-1].routeDistance)
            })
        })

        test('stores lat, lng, elevation and routeDistance - all rounded to 5 decimals', () => {
            const shape = buildRouteShape(createTrack(3000))

            shape.forEach( p => {
                expect(Object.keys(p).sort()).toEqual(['elevation','lat','lng','routeDistance'])
                Object.values(p).forEach( v => expect(decimals(v)).toBeLessThanOrEqual(5))
            })
            expect(shape[0]).toEqual({ lat:46.12346, lng:7.98865, routeDistance:0, elevation:500.12346 })
        })

        test('keeps a short route as it is', () => {
            const points = createTrack(40)

            expect(buildRouteShape(points)).toHaveLength(40)
        })

        test('omits lat/lng for a route without geo coordinates', () => {
            const points = createTrack(500, p => ({ routeDistance:p.routeDistance, elevation:p.elevation }) as RoutePoint)

            const shape = buildRouteShape(points)

            expect(shape).toHaveLength(ROUTE_SHAPE_POINTS)
            expect(shape[0].lat).toBeUndefined()
            expect(shape[0].lng).toBeUndefined()
            expect(shape[0].elevation).toBeDefined()
        })

        test('omits elevation for a route without elevation data', () => {
            const points = createTrack(500, p => ({ ...p, elevation:undefined }))

            const shape = buildRouteShape(points)

            expect(shape).toHaveLength(ROUTE_SHAPE_POINTS)
            expect(shape[0].elevation).toBeUndefined()
            expect(shape[0].lat).toBeDefined()
        })

        test('ignores points without a routeDistance', () => {
            const points = createTrack(10, (p,i) => i===5 ? {...p, routeDistance:undefined} : p)

            expect(buildRouteShape(points)).toHaveLength(9)
        })

        test('returns undefined when there is nothing to draw', () => {
            expect(buildRouteShape(undefined)).toBeUndefined()
            expect(buildRouteShape([])).toBeUndefined()
            expect(buildRouteShape('invalid' as unknown as Array<RoutePoint>)).toBeUndefined()
        })
    })
})
