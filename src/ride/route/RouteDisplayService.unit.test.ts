
import sydney from '../../../__tests__/data/routes/sydney2.json'
import { Inject } from '../../base/decorators'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { RouteDisplayService } from './RouteDisplayService'
import { Observer } from '../../base/types'
import { RouteSettings } from '../../routes/list/cards/types'

const CT = expect.closeTo

describe( 'RouteDisplayService', () => {

    const sydneyRoute  = createFromJson(sydney as unknown as RouteApiDetail)
    sydneyRoute.description.distance = 3801.452188724582
    sydneyRoute.description.isLoop   = true

    const nonLoopRoute = createFromJson(sydney as unknown as RouteApiDetail)
    nonLoopRoute.description.distance = 3801.452188724582
    nonLoopRoute.description.isLoop = false

    const defaultStartSettings:RouteSettings = {
        startPos:0,
        realityFactor:100,
        type:'Route'
    }

    const mockObserver: Partial<Observer> = {
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn(),
        emit: jest.fn()
    }

    let mockRideService:any
    let mockActiveRides:any
    let mockRouteList:any


    const setupMocks = (s:any, options:any) => {
        const userSettingsGet = options.userSettingsGet || jest.fn( (_k,d)=> d)
        Inject('UserSettings',{
            get: userSettingsGet
        })
        mockRouteList = {
            getSelected: jest.fn().mockReturnValue(options.route??sydneyRoute),
            getStartSettings: jest.fn().mockReturnValue(options.startSettings??defaultStartSettings)
        }
        Inject('RouteList', mockRouteList)

        mockActiveRides = {
            get: jest.fn().mockReturnValue(options.activeRides??[]),
            getObserver: jest.fn().mockReturnValue(mockObserver),
            init: jest.fn().mockReturnValue(mockObserver),
            stop: jest.fn()
        }
        Inject('ActiveRides', mockActiveRides)

        Inject('DeviceRide', {
            getCyclingMode: jest.fn().mockReturnValue({
                isSIM: jest.fn().mockReturnValue(options.isSIM ?? false),
                getSetting: jest.fn().mockReturnValue(undefined)
            }),
            sendUpdate: jest.fn()
        })

        Inject('AppInfo', {
            session: options.session ?? { id: 'test-session' }
        })

        Inject('UnitConverter', {
            // placeholder for unit converter
        })

        mockRideService = {
            getObserver: jest.fn().mockReturnValue(mockObserver),
            displayService: s,
            isVirtualShiftingEnabled: jest.fn().mockReturnValue(options.virtualShifting ?? false),
            getDisplayProperties: jest.fn(() => ({ dbColumns: [], position: {} })),
            reset: jest.fn()
        }

        if (options.mockRideService) {
            s.observer = mockObserver
            s.service = mockRideService
            s.init(mockRideService)
        }

        s.emit= jest.fn()
    }

    const getPosition = (s:any) => {
        return s.position
    }

    const cleanupMocks = (s:any)=>{
        s.reset()
        if (mockRideService)
            mockRideService.reset()
        jest.clearAllMocks()
    }

    describe('init', () => {
        let service: RouteDisplayService

        beforeEach( () => {
            service = new RouteDisplayService()
        })

        afterEach( () => {
            cleanupMocks(service)
        })

        test('initializes route and position on init', () => {
            setupMocks(service, {mockRideService: true})
            expect(service.getCurrentRoute()).toBeDefined()
            expect(getPosition(service)).toBeDefined()
        })

        test('initializes with custom route', () => {
            const customRoute = createFromJson(sydney as unknown as RouteApiDetail)
            setupMocks(service, {mockRideService: true, route: customRoute})
            const currentRoute = service.getCurrentRoute()
            expect(currentRoute?.description?.distance).toBe(customRoute.description.distance)
            expect(currentRoute?.description?.id).toBe(customRoute.description.id)
        })
    })

    describe('onActivityUpdate',()=>{
        let service: RouteDisplayService

        beforeEach( async ()=>{
            service = new RouteDisplayService()
        })

        afterEach( async ()=>{
            cleanupMocks(service)
        })

        test('at start of route',async ()=>{
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:10,distance:10},{distance:10})
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:10})

        })

        test('with startPos set',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 1826}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:1836,distance:10},{distance:10})
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:1836})

        })

        test('reaching end of lap',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 3800}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:3810,distance:10},{distance:10})
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
            expect(getPosition(service)).toMatchObject({lap:2,routeDistance:3810})
            expect(service.emit).toHaveBeenCalledWith('lap-completed',1,2)
        })

        test('user wants to stop at end - reaching end of lap',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 3800, loopOverwrite: true}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:3810,distance:10},{distance:10})
            expect(service.emit).toHaveBeenCalledWith('route-completed')
        })

        test('multiple updates',async ()=>{
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            for (let i=0; i<10; i++) {
                service.onActivityUpdate({time:i+1, speed:36, routeDistance:(i+1)*10,distance:10},{distance:10})
            }
            expect(mockObserver.emit).toHaveBeenCalledTimes(10)
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:CT(100,1)})
        })

        test('strange values',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 3785, loopOverwrite: true}
            setupMocks(service,{mockRideService:true,startSettings})

            service['position'] = {
                "lat": -33.85925,
                "lng": 151.22181,
                "elevation": 0.4841195529418787,
                "distance": 17.962621015984496,
                "slope": -6.352085248824286,
                "routeDistance": 3790,
                "cnt": 192,
                "lap": 1,
                "lapDistance": 3790
            }
            service.onActivityUpdate({time:1, speed:36, routeDistance:3796,distance:6},{distance:10})
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:CT(3796,0)})
        })

        test('ignores update when power is zero and speed is zero', async () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:0, routeDistance:10,distance:10},{power:0, speed:0})
            expect(mockObserver.emit).not.toHaveBeenCalled()
        })

        test('ignores update during inactivity with low speed', async () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            service['prevPowerTs'] = Date.now() - 6000
            service.onActivityUpdate({time:1, speed:3, routeDistance:10,distance:10},{power:0, speed:3})
            expect(mockObserver.emit).not.toHaveBeenCalled()
        })

        test('records power timestamp on activity with power', async () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:0, routeDistance:10,distance:10},{power:100})
            expect(service['prevPowerTs']).toBeDefined()
        })

        test('finishes route on non-loop route at end distance', async () => {
            const startSettings = { ...defaultStartSettings, startPos: 3800}
            setupMocks(service,{mockRideService:true, route: nonLoopRoute, startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:3810,distance:10},{distance:10})
            expect(service.emit).toHaveBeenCalledWith('route-completed')
        })

        test('finishes route when endPos is reached', async () => {
            const startSettings = { ...defaultStartSettings, startPos: 0, endPos: 100, loopOverwrite: true}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:150,distance:10},{distance:10})
            expect(service.emit).toHaveBeenCalledWith('route-completed')
        })
    })

    describe('onRideSettingsChanged', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('updates reality factor from settings', () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service, {mockRideService: true, startSettings})
            service.onRideSettingsChanged({reality: 75})
            expect(service['startSettings'].realityFactor).toBe(75)
        })

        test('handles missing reality setting', () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service, {mockRideService: true, startSettings})
            service.onRideSettingsChanged({})
            expect(service['startSettings'].realityFactor).toBe(100)
        })
    })

    describe('onStarted', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('prepares active rides', () => {
            setupMocks(service, {mockRideService: true})
            service.onStarted()
            expect(mockActiveRides.init).toHaveBeenCalled()
        })
    })

    describe('onStopped', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('cleans up active rides and deletes start settings', () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service, {mockRideService: true, startSettings})
            service['_startSettings'] = startSettings
            service.onStopped()
            expect(mockActiveRides.stop).toHaveBeenCalled()
            expect(service['_startSettings']).toBeUndefined()
        })
    })

    describe('getDeviceStartSettings', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns route settings with reality factor and start position', () => {
            const startSettings = { ...defaultStartSettings, startPos: 100, realityFactor: 80}
            setupMocks(service, {mockRideService: true, startSettings})
            const result = service.getDeviceStartSettings()
            expect(result).toMatchObject({
                realityFactor: 80,
                startPos: 100,
                route: expect.any(Object)
            })
        })

        test('uses default reality factor when not set', () => {
            const startSettings = { ...defaultStartSettings, startPos: 50, realityFactor: undefined}
            setupMocks(service, {mockRideService: true, startSettings})
            const result = service.getDeviceStartSettings()
            expect(result.realityFactor).toBe(100)
        })

        test('uses default start position when not set', () => {
            const startSettings = { ...defaultStartSettings, startPos: undefined}
            setupMocks(service, {mockRideService: true, startSettings})
            const result = service.getDeviceStartSettings()
            expect(result.startPos).toBe(0)
        })
    })

    describe('getMarkers', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns nearby riders as markers', () => {
            const activeRides = [
                { lat: -33.85, lng: 151.22, lapDistance: 100, avatar: 'avatar1', isUser: false, name: 'Rider1'},
                { lat: -33.86, lng: 151.23, lapDistance: 200, avatar: 'avatar2', isUser: false, name: 'Rider2'}
            ]
            setupMocks(service, {mockRideService: true, activeRides})
            service['nearbyRiders'] = activeRides as any
            const markers = service.getMarkers({} as any)
            expect(markers).toHaveLength(2)
            expect(markers[0]).toMatchObject({lat: -33.85, lng: 151.22, routeDistance: 100})
        })

        test('returns previous ride markers', () => {
            setupMocks(service, {mockRideService: true})
            const prevRides = {
                list: [
                    { lat: -33.80, lng: 151.20, routeDistance: 300, avatar: 'avatar3'},
                    { lat: -33.81, lng: 151.21, routeDistance: 400, avatar: 'avatar4'}
                ]
            }
            const markers = service.getMarkers({prevRides} as any)
            expect(markers).toHaveLength(2)
            expect(markers[0]).toMatchObject({lat: -33.80, lng: 151.20, routeDistance: 300})
        })

        test('combines nearby and previous ride markers', () => {
            const activeRides = [
                { lat: -33.85, lng: 151.22, lapDistance: 100, avatar: 'avatar1', isUser: false, name: 'Rider1'}
            ]
            setupMocks(service, {mockRideService: true, activeRides})
            service['nearbyRiders'] = activeRides as any
            const prevRides = {
                list: [
                    { lat: -33.80, lng: 151.20, routeDistance: 300, avatar: 'avatar3'}
                ]
            }
            const markers = service.getMarkers({prevRides} as any)
            expect(markers).toHaveLength(2)
        })

        test('handles empty nearby and previous rides', () => {
            setupMocks(service, {mockRideService: true})
            const markers = service.getMarkers({prevRides: {list: []}} as any)
            expect(markers).toHaveLength(0)
        })
    })

    describe('getOverlayProps', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns overlay props with show true when not hidden', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getOverlayProps('map', {hideAll: false} as any)
            expect(props.show).toBe(true)
        })

        test('returns overlay props with show false when hideAll is true', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getOverlayProps('map', {hideAll: true} as any)
            expect(props.show).toBe(false)
        })

        test('sets minimized based on user settings', () => {
            // Pass a UserSettings that returns false (minimized = true when get returns false)
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn().mockReturnValue(false)
            })
            const props = service.getOverlayProps('map', {hideAll: false} as any)
            expect(props.minimized).toBe(true)
        })
    })

    describe('getNearbyRidesProps', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns nearby rides props when active rides exist', () => {
            const activeRides = [
                { lat: -33.85, lng: 151.22, lapDistance: 100, avatar: 'avatar1', isUser: false}
            ]
            setupMocks(service, {mockRideService: true, activeRides})
            const props = service.getNearbyRidesProps({hideAll: false} as any)
            expect(props.show).toBe(true)
            expect(props.observer).toBe(mockObserver)
        })

        test('returns nearby rides props with show false when no active rides', () => {
            setupMocks(service, {mockRideService: true, activeRides: []})
            const props = service.getNearbyRidesProps({hideAll: false} as any)
            expect(props.show).toBe(false)
        })

        test('returns nearby rides props with show false when hideAll is true', () => {
            const activeRides = [
                { lat: -33.85, lng: 151.22, lapDistance: 100, avatar: 'avatar1', isUser: false}
            ]
            setupMocks(service, {mockRideService: true, activeRides})
            const props = service.getNearbyRidesProps({hideAll: true} as any)
            expect(props.show).toBe(false)
        })

        test('emits overlay-update event when nearby rides status changes', () => {
            const activeRides = [
                { lat: -33.85, lng: 151.22, lapDistance: 100, avatar: 'avatar1', isUser: false}
            ]
            setupMocks(service, {mockRideService: true, activeRides})
            service.getNearbyRidesProps({hideAll: false} as any)
            expect(mockObserver.emit).toHaveBeenCalledWith('overlay-update', expect.any(Object))
        })
    })

    describe('getScreenshotInfo', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns screenshot info with position when position is defined', () => {
            setupMocks(service, {mockRideService: true})
            service['position'] = {
                lat: -33.85,
                lng: 151.22,
                routeDistance: 100,
                elevation: 50,
                distance: 100,
                slope: 2,
                cnt: 10,
                lap: 1,
                lapDistance: 100
            }
            const info = service.getScreenshotInfo('screenshot.png', 123456)
            expect(info).toMatchObject({
                fileName: 'screenshot.png',
                time: 123456,
                position: expect.objectContaining({
                    lat: -33.85,
                    lng: 151.22,
                    routeDistance: 100,
                    elevation: 50
                })
            })
        })

        test('returns screenshot info without position when position is undefined', () => {
            setupMocks(service, {mockRideService: true})
            service['position'] = undefined
            const info = service.getScreenshotInfo('screenshot.png', 123456)
            expect(info).toMatchObject({
                fileName: 'screenshot.png',
                time: 123456,
                position: undefined
            })
        })
    })

    describe('getRoutePosition', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns position for valid distance', () => {
            setupMocks(service, {mockRideService: true})
            const position = service.getRoutePosition(100)
            expect(position).toBeDefined()
            expect(position?.distance).toBe(100)
            expect(position?.heading).toBeDefined()
        })

        test('returns undefined when distance is undefined', () => {
            setupMocks(service, {mockRideService: true})
            const position = service.getRoutePosition(undefined as any)
            expect(position).toBeUndefined()
        })

        test('returns position at start when distance is 0', () => {
            setupMocks(service, {mockRideService: true})
            const position = service.getRoutePosition(0)
            expect(position).toBeDefined()
            expect(position?.distance).toBe(0)
        })

        test('calculates lap distance correctly', () => {
            setupMocks(service, {mockRideService: true})
            const position = service.getRoutePosition(3900)
            expect(position).toBeDefined()
            expect(position?.lapDistance).toBeLessThan(sydneyRoute.description.distance)
        })
    })

    describe('getOriginalRoute', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns the selected route from route list', () => {
            setupMocks(service, {mockRideService: true})
            const route = service.getOriginalRoute()
            expect(route).toBe(sydneyRoute)
        })
    })

    describe('getCurrentRoute', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns the current route set during init', () => {
            setupMocks(service, {mockRideService: true})
            const route = service.getCurrentRoute()
            expect(route).toBeDefined()
            expect(route?.description?.distance).toBe(sydneyRoute.description.distance)
        })

        test('returns cloned route to avoid modifications', () => {
            setupMocks(service, {mockRideService: true})
            const route = service.getCurrentRoute()
            const selected = mockRouteList.getSelected()
            expect(route).not.toBe(selected)
        })
    })

    describe('getDisplayProperties', () => {
        let service: RouteDisplayService

        beforeEach(() => {
            service = new RouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns complete display properties with position', () => {
            const startSettings = { ...defaultStartSettings, startPos: 100, endPos: 3000}
            setupMocks(service, {mockRideService: true, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props).toMatchObject({
                position: expect.any(Object),
                markers: expect.any(Array),
                route: expect.any(Object),
                realityFactor: 100,
                startPos: expect.any(Number),
                endPos: 3000
            })
        })

        test('includes route in display properties', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.route).toBeDefined()
            expect(props.route?.description).toBeDefined()
        })

        test('includes markers in display properties', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.markers).toBeDefined()
            expect(Array.isArray(props.markers)).toBe(true)
        })

        test('includes realityFactor from start settings', () => {
            const startSettings = { ...defaultStartSettings, realityFactor: 75}
            setupMocks(service, {mockRideService: true, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.realityFactor).toBe(75)
        })

        test('includes endPos from start settings', () => {
            const startSettings = { ...defaultStartSettings, endPos: 2500}
            setupMocks(service, {mockRideService: true, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.endPos).toBe(2500)
        })

        test('defaults startPos to 0 for loop routes without loopOverwrite', () => {
            const startSettings = { ...defaultStartSettings, startPos: 100, loopOverwrite: false}
            setupMocks(service, {mockRideService: true, startSettings, route: sydneyRoute})
            service.init(mockRideService)
            // Verify the route is detected as a loop
            expect(service.getCurrentRoute()?.description?.isLoop).toBe(true)
            const props = service.getDisplayProperties({hideAll: false} as any)
            // For loop routes without loopOverwrite, startPos defaults to 0 (beginning of loop)
            expect(props.startPos).toBe(0)
        })

        test('shows map start position for loop routes with loopOverwrite', () => {
            const startSettings = { ...defaultStartSettings, startPos: 100, loopOverwrite: true}
            setupMocks(service, {mockRideService: true, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.startPos).toBe(100)
        })

        test('shows map start position for non-loop routes', () => {
            const startSettings = { ...defaultStartSettings, startPos: 100}
            setupMocks(service, {mockRideService: true, route: nonLoopRoute, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.startPos).toBe(100)
        })

        test('defaults startPos to 0 when undefined', () => {
            const startSettings = { ...defaultStartSettings, startPos: undefined}
            setupMocks(service, {mockRideService: true, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.startPos).toBe(0)
        })

        test('includes scale information for display', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.xScale).toBeDefined()
            expect(props.xScale?.value).toBeDefined()
            expect(props.yScale).toBeDefined()
            expect(props.yScale?.value).toBeDefined()
        })

        test('includes nearby rides props in display properties', () => {
            const activeRides = [
                { lat: -33.85, lng: 151.22, lapDistance: 100, avatar: 'avatar1', isUser: false, name: 'Rider1'}
            ]
            setupMocks(service, {mockRideService: true, activeRides})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.nearbyRides).toBeDefined()
            expect(props.nearbyRides?.show).toBe(true)
        })

        test('includes overlay props for map', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.map).toBeDefined()
            expect(props.map?.show).toBeDefined()
            expect(props.map?.minimized).toBeDefined()
        })

        test('includes overlay props for upcoming elevation', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.upcomingElevation).toBeDefined()
            expect(props.upcomingElevation?.show).toBeDefined()
            expect(props.upcomingElevation?.minimized).toBeDefined()
        })

        test('includes overlay props for total elevation', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.totalElevation).toBeDefined()
            expect(props.totalElevation?.show).toBeDefined()
            expect(props.totalElevation?.minimized).toBeDefined()
        })

        test('includes side views when available', () => {
            setupMocks(service, {mockRideService: true})
            service['sideViews'] = {map: true, slope: true, previous: false, elevation: false, 'sv-right': false, 'sv-left': false, 'prev-rides': false}
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.sideViews).toEqual({map: true, slope: true, previous: false, elevation: false, 'sv-right': false, 'sv-left': false, 'prev-rides': false})
        })

        test('handles hideAll flag to hide overlays', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: true} as any)
            expect(props.map?.show).toBe(false)
            expect(props.upcomingElevation?.show).toBe(false)
            expect(props.totalElevation?.show).toBe(false)
            expect(props.nearbyRides?.show).toBe(false)
        })

        test('includes parent display properties', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.dbColumns).toBeDefined()
            expect(Array.isArray(props.dbColumns) || typeof props.dbColumns === 'number').toBe(true)
        })

        test('returns position with updated route distance', () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service, {mockRideService: true, startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:500,distance:10},{distance:10})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.position?.routeDistance).toBe(500)
        })

        test('correctly calculates scale values for metric distances', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.xScale?.value).toBeGreaterThan(0)
            expect(props.yScale?.value).toBeGreaterThan(0)
        })

        test('uses default realityFactor when not set', () => {
            const startSettings = { ...defaultStartSettings, realityFactor: undefined}
            setupMocks(service, {mockRideService: true, startSettings})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.realityFactor).toBe(100)
        })
    })

})
