import { Route } from "../base/model/route"
import { RouteApiDetail } from "../base/api/types"
import { RouteInfo, RoutePoint } from "../base/types"
import { RouteStartSettings } from "./types"
import { RouteListService } from "./service"
import { Inject } from "../../base/decorators"

/**
 * Tests for the ride copy of a route (RouteListService.getRideRoute()).
 *
 * The elevation smoothing itself is covered by the tests of the transform - what is verified here
 * is that the ride gets exactly one copy, that the level is the one the ride was started with, and
 * that nothing about smoothing can keep a ride from starting.
 */
describe('RouteListService.getRideRoute',()=>{

    const buildPoints = (count:number, elevation:(i:number)=>number):Array<RoutePoint> =>
        Array.from({length:count}, (_,i)=> ({
            lat: -33.8 + i/5000,
            lng: 151.2 + i/5000,
            routeDistance: i*20,
            distance: i===0 ? 0 : 20,
            elevation: elevation(i),
            cnt: i
        })) as Array<RoutePoint>

    /** a track that alternates up and down every point on top of a steady climb, i.e. noisy */
    const noisy = (i:number) => 100 + i*0.6 + (i%2 ? 4 : 0)

    const buildRoute = (id:string, points:Array<RoutePoint>, props:Partial<RouteInfo> = {},
                        detailProps:Partial<RouteApiDetail> = {}):Route => {
        const details = {
            id, title:id, points, distance: points.at(-1).routeDistance, ...detailProps
        } as RouteApiDetail

        const description = {
            id, title:id, hasGpx:true, routeHash:`hash-${id}`, distance: details.distance, ...props
        } as RouteInfo

        return new Route(description,details)
    }

    const elevations = (route:Route) => route.points.map( p=>p.elevation)

    const startSettings = (level?:number):RouteStartSettings =>
        ({ type:'Route', startPos:0, realityFactor:100, smoothingLevel:level }) as unknown as RouteStartSettings

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let service: any
    let route: Route
    let original: Array<number>
    let userSettings: { get:jest.Mock, getValue:jest.Mock, set:jest.Mock }

    beforeEach( ()=>{
        userSettings = {
            get: jest.fn( (_key,defValue)=>defValue),
            getValue: jest.fn( (_key,defValue)=>defValue),
            set: jest.fn()
        }
        Inject('UserSettings', userSettings)

        service = new RouteListService()

        route = buildRoute('route-1', buildPoints(40,noisy))
        original = elevations(route)

        service.routes = [route]
        service.select(route)
    })

    afterEach( ()=>{
        service.reset()
        Inject('UserSettings', null)
        jest.restoreAllMocks()
    })

    describe('the selected route',()=>{

        test('smooths the selected route and leaves the route itself alone',()=>{
            service.setStartSettings(startSettings(3))

            const ride = service.getRideRoute()

            expect(ride).not.toBe(route)
            expect(elevations(ride)).not.toEqual(original)
            expect(elevations(ride)).toHaveLength(original.length)
            expect(elevations(route)).toEqual(original)
        })

        test('is transformed only once, no matter how often it is asked for',()=>{
            const transform = jest.spyOn(service,'smoothRoute')
            service.setStartSettings(startSettings(3))

            const first = service.getRideRoute()
            const second = service.getRideRoute()

            expect(second).toBe(first)
            expect(transform).toHaveBeenCalledTimes(1)
        })

        test('is built again for the next ride',()=>{
            const transform = jest.spyOn(service,'smoothRoute')

            service.setStartSettings(startSettings(3))
            const first = service.getRideRoute()

            service.setStartSettings(startSettings(3))
            const second = service.getRideRoute()

            expect(second).not.toBe(first)
            expect(transform).toHaveBeenCalledTimes(2)
        })

        test('follows a change of the selected route even without a restart',()=>{
            service.setStartSettings(startSettings(3))
            const first = service.getRideRoute()

            const other = buildRoute('route-2', buildPoints(40,noisy))
            service.select(other)

            expect(service.getRideRoute().description.id).toBe('route-2')
            expect(service.getRideRoute()).not.toBe(first)
        })

        test('is a plain copy when no level was chosen',()=>{
            service.setStartSettings(startSettings())

            const ride = service.getRideRoute()

            expect(ride).not.toBe(route)
            expect(elevations(ride)).toEqual(original)
        })

        test('is a plain copy for level 0',()=>{
            service.setStartSettings(startSettings(0))

            expect(elevations(service.getRideRoute())).toEqual(original)
        })

        test('is a plain copy for a route that must not be smoothed',()=>{
            // an uploaded elevation program is what the ride is resisted against, so the points
            // are not what is being ridden
            route = buildRoute('route-epp', buildPoints(40,noisy), {}, { epp: {} as never })
            original = elevations(route)
            service.routes = [route]
            service.select(route)
            service.setStartSettings(startSettings(4))

            expect(elevations(service.getRideRoute())).toEqual(original)
        })

        test('is nothing when nothing is selected',()=>{
            service.unselect()

            // same answer as getSelected() - no route to build a copy of, and no throw
            expect(service.getRideRoute()).toBeFalsy()
        })
    })

    describe('getAppliedSmoothingLevel',()=>{

        test('reports the level that was actually applied',()=>{
            service.setStartSettings(startSettings(3))

            expect(service.getAppliedSmoothingLevel()).toBe(3)
        })

        test('is 0 when no level was chosen, even though a route is selected',()=>{
            service.setStartSettings(startSettings())

            expect(service.getAppliedSmoothingLevel()).toBe(0)
        })

        // the requested level and the applied level must never be conflated - see buildRideRoute():
        // a request that could not be honoured rode the original terrain and must be recorded as such
        test('is 0, not the requested level, when the route may not be smoothed', () => {
            route = buildRoute('route-epp', buildPoints(40,noisy), {}, { epp: {} as never })
            service.routes = [route]
            service.select(route)
            service.setStartSettings(startSettings(4))

            expect(service.getAppliedSmoothingLevel()).toBe(0)
        })

        test('builds the ride copy itself if nothing has asked for it yet',()=>{
            const transform = jest.spyOn(service,'smoothRoute')
            service.setStartSettings(startSettings(2))

            expect(service.getAppliedSmoothingLevel()).toBe(2)
            expect(transform).toHaveBeenCalledTimes(1)
        })

        test('is 0 when nothing is selected',()=>{
            service.unselect()

            expect(service.getAppliedSmoothingLevel()).toBe(0)
        })
    })

    describe('chained routes',()=>{

        let next: Route
        let nextOriginal: Array<number>

        beforeEach(()=>{
            next = buildRoute('route-next', buildPoints(40,noisy))
            nextOriginal = elevations(next)
            service.routes = [route,next]
        })

        test('are smoothed with the level the ride was started with',()=>{
            const transform = jest.spyOn(service,'smoothRoute')
            service.setStartSettings(startSettings(4))

            const ride = service.getRideRoute('route-next')

            expect(ride.description.id).toBe('route-next')
            expect(elevations(ride)).not.toEqual(nextOriginal)
            expect(transform).toHaveBeenCalledWith(next,4)
        })

        test('keep their own stored level untouched',()=>{
            // the chained route was last ridden with a different level of its own
            userSettings.get.mockImplementation( (key,defValue)=>
                key==='routeSelection.video.prevSetting.route-next' ? {smoothingLevel:1} : defValue)

            const transform = jest.spyOn(service,'smoothRoute')
            service.setStartSettings(startSettings(4))
            userSettings.set.mockClear()

            service.getRideRoute('route-next')

            // the level is taken from the running ride, and the stored one is neither read as an
            // input nor written back
            expect(transform).toHaveBeenCalledWith(next,4)
            expect(userSettings.set).not.toHaveBeenCalled()
            expect(elevations(next)).toEqual(nextOriginal)
        })

        test('fall back to a plain copy on their own if they may not be smoothed',()=>{
            next = buildRoute('route-next', buildPoints(40, ()=>100))
            nextOriginal = elevations(next)
            service.routes = [route,next]
            service.setStartSettings(startSettings(4))

            expect(elevations(service.getRideRoute('route-next'))).toEqual(nextOriginal)
            // ... while the route the ride was started with is still smoothed
            expect(elevations(service.getRideRoute())).not.toEqual(original)
        })

        test('are undefined for an unknown id',()=>{
            service.setStartSettings(startSettings(4))

            expect(service.getRideRoute('does-not-exist')).toBeUndefined()
        })
    })

    describe('failures never stop a ride',()=>{

        test('a throwing transform is answered with the unsmoothed copy',()=>{
            const log = jest.spyOn(service,'logEvent')
            service.smoothRoute = jest.fn( ()=>{ throw new Error('transform failed') })
            service.setStartSettings(startSettings(3))

            const ride = service.getRideRoute()

            expect(ride).toBeDefined()
            expect(ride).not.toBe(route)
            expect(elevations(ride)).toEqual(original)
            expect(log).toHaveBeenCalledWith( expect.objectContaining({
                fn:'getRideRoute', routeHash:'hash-route-1', level:3
            }))
        })

        test('a result that lost points is rejected',()=>{
            const broken = route.clone()
            broken.details.points = broken.details.points.slice(0,10)
            service.smoothRoute = jest.fn().mockReturnValue(broken)
            service.setStartSettings(startSettings(3))

            expect(elevations(service.getRideRoute())).toEqual(original)
        })

        test('a result with an unusable elevation is rejected',()=>{
            const broken = route.clone()
            broken.details.points[7].elevation = Number.NaN
            service.smoothRoute = jest.fn().mockReturnValue(broken)
            service.setStartSettings(startSettings(3))

            expect(elevations(service.getRideRoute())).toEqual(original)
        })

        test('a result whose distances no longer only grow is rejected',()=>{
            const log = jest.spyOn(service,'logEvent')
            const broken = route.clone()
            broken.details.points[7].routeDistance = 0
            service.smoothRoute = jest.fn().mockReturnValue(broken)
            service.setStartSettings(startSettings(3))

            expect(elevations(service.getRideRoute())).toEqual(original)
            expect(log).toHaveBeenCalledWith( expect.objectContaining({
                message:'elevation smoothing skipped', routeHash:'hash-route-1', level:3
            }))
        })
    })

    describe('noise statistics',()=>{

        const noiseLog = (log:jest.SpyInstance) =>
            log.mock.calls.map( c=>c[0]).filter( e=> e?.message==='route elevation noise')

        test('are recorded once when the ride starts',()=>{
            const log = jest.spyOn(service,'logEvent')
            service.setStartSettings(startSettings(3))

            service.getRideRoute()
            service.getRideRoute()
            service.getRideRoute()

            const recorded = noiseLog(log)
            expect(recorded).toHaveLength(1)
            expect(recorded[0]).toEqual( expect.objectContaining({
                message:'route elevation noise',
                routeHash:'hash-route-1',
                gainRatio: expect.any(Number),
                reversalDensity: expect.any(Number),
                pointCount: 40,
                medianSpacing: 20
            }))
            // nothing beyond the geometry and the hash - 'ts' is added by the logger itself
            expect(Object.keys(recorded[0]).filter(k=>k!=='ts').sort()).toEqual(
                ['gainRatio','medianSpacing','message','pointCount','reversalDensity','routeHash'])
            // a noisy track carries gain that a road does not have
            expect(recorded[0].gainRatio).toBeGreaterThan(1.5)
            expect(recorded[0].reversalDensity).toBeGreaterThan(0)
        })

        test('are recorded again for the next ride',()=>{
            const log = jest.spyOn(service,'logEvent')

            service.setStartSettings(startSettings(3))
            service.getRideRoute()
            service.setStartSettings(startSettings(3))
            service.getRideRoute()

            expect(noiseLog(log)).toHaveLength(2)
        })

        test('are recorded for a route that may not be smoothed',()=>{
            const log = jest.spyOn(service,'logEvent')
            route = buildRoute('route-epp', buildPoints(40,noisy), {}, { epp: {} as never })
            service.routes = [route]
            service.select(route)
            service.setStartSettings(startSettings(4))

            service.getRideRoute()

            expect(noiseLog(log)).toHaveLength(1)
        })

        test('are not recorded for chained segments',()=>{
            const log = jest.spyOn(service,'logEvent')
            const next = buildRoute('route-next', buildPoints(40,noisy))
            service.routes = [route,next]
            service.setStartSettings(startSettings(3))

            service.getRideRoute('route-next')

            expect(noiseLog(log)).toHaveLength(0)
        })

        test('are skipped, without a throw, when there is nothing to measure',()=>{
            const log = jest.spyOn(service,'logEvent')
            service.unselect()

            expect( ()=>service.getRideRoute()).not.toThrow()
            expect(noiseLog(log)).toHaveLength(0)
        })

        test('do not let a malformed route stop the ride',()=>{
            const log = jest.spyOn(service,'logEvent')
            const points = buildPoints(40,noisy)
            points[5].elevation = undefined
            points[9].routeDistance = undefined
            delete points[12].elevation

            route = buildRoute('route-broken', points)
            service.routes = [route]
            service.select(route)
            service.setStartSettings(startSettings(3))

            let ride
            expect( ()=> { ride = service.getRideRoute() }).not.toThrow()
            expect(ride).toBeDefined()
            expect(noiseLog(log)).toHaveLength(1)
        })

        test('survive a route that cannot even be read',()=>{
            const log = jest.spyOn(service,'logEvent')
            const broken = {
                get points() { throw new Error('no points') },
                get description() { return {routeHash:'hash-broken'} },
                clone() { return this }
            }
            service.setStartSettings(startSettings(3))

            expect( ()=> service.logNoiseStats(broken)).not.toThrow()
            expect(noiseLog(log)).toHaveLength(0)
        })
    })

    describe('end of ride',()=>{

        test('unselect drops the copy and the level of the finished ride',()=>{
            service.setStartSettings(startSettings(3))
            service.getRideRoute()

            service.unselect()

            expect(service.sessionSmoothingLevel).toBeUndefined()
            expect(service.rideRoute).toBeUndefined()
        })
    })
})
