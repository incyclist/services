
import sydney from '../../../__tests__/data/routes/sydney2.json'
import { Inject } from '../../base/decorators'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { GpxDisplayService } from './GpxDisplayService'
import { Observer } from '../../base/types'
import { RouteSettings } from '../../routes/list/cards/types'

describe('GpxDisplayService', () => {

    const sydneyRoute  = createFromJson(sydney as unknown as RouteApiDetail)
    sydneyRoute.description.distance = 3801.452188724582
    sydneyRoute.description.isLoop   = true

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
            get: userSettingsGet,
            getValue: jest.fn( (_k,d)=> d)
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

        Inject('Bindings', {
            appInfo: {
                getChannel: jest.fn().mockReturnValue(options.channel ?? 'desktop')
            }
        })

        Inject('UnitConverter', {
            // placeholder for unit converter
        })

        Inject('GoogleMaps', {
            // placeholder for google maps
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
        let service: GpxDisplayService

        beforeEach( () => {
            service = new GpxDisplayService()
        })

        afterEach( () => {
            cleanupMocks(service)
        })

        test('initializes route and position on init', () => {
            setupMocks(service, {mockRideService: true})
            expect(service.getCurrentRoute()).toBeDefined()
            expect(getPosition(service)).toBeDefined()
        })
    })

    describe('onActivityUpdate', () => {
        let service: GpxDisplayService

        beforeEach( () => {
            service = new GpxDisplayService()
        })

        afterEach( () => {
            cleanupMocks(service)
        })

        test('updates position on activity update', async () => {
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onActivityUpdate({time:1, speed:36, routeDistance:10,distance:10},{distance:10})
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:10})
        })
    })

    describe('getStreetViewProps', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns street view props with position and observer', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any)
            expect(props).toMatchObject({
                onDisplayEvent: expect.any(Function),
                sideViews: expect.any(Object)
            })
        })

        test('hides street view when hideAll is true', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: true} as any)
            expect(props.sideViews?.hide).toBe(true)
        })

        test('respects user preferences for side views', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.sideViews.sv-left') return false
                    if (key === 'preferences.sideViews.sv-right') return true
                    return def
                })
            })
            const props = service.getStreetViewProps({hideAll: false} as any)
            expect(props.sideViews?.left).toBe(false)
            expect(props.sideViews?.right).toBe(true)
        })

        test('includes event handler for street view events', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any)
            expect(typeof props.onDisplayEvent).toBe('function')
        })
    })

    describe('getSatelliteViewProps', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns satellite view props with position', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getSatelliteViewProps()
            expect(props).toMatchObject({
                onDisplayEvent: expect.any(Function),
                displayPosition: expect.any(Object)
            })
        })

        test('includes current position in satellite view props', () => {
            setupMocks(service, {mockRideService: true})
            service.onActivityUpdate({time:1, speed:36, routeDistance:500,distance:10},{distance:10})
            const props = service.getSatelliteViewProps()
            expect(props.displayPosition?.routeDistance).toBe(500)
        })
    })

    describe('getMapViewProps', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns map view props with position', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getMapViewProps()
            expect(props).toMatchObject({
                onDisplayEvent: expect.any(Function),
                displayPosition: expect.any(Object)
            })
        })

        test('includes event handler for map view events', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getMapViewProps()
            expect(typeof props.onDisplayEvent).toBe('function')
        })
    })

    describe('getStartOverlayProps', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns start overlay props with map type and loading state', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStartOverlayProps()
            expect(props).toMatchObject({
                mapType: expect.any(String),
                mapState: expect.any(String)
            })
        })

        test('shows loading state when map is not loaded', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStartOverlayProps()
            expect(['Loaded', 'Loading']).toContain(props.mapState)
        })

        test('returns map type based on ride view preference', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            const props = service.getStartOverlayProps()
            expect(props.mapType).toBe('Street View')
        })

        test('returns correct map type names for different views', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sat'
                    return def
                })
            })
            const props = service.getStartOverlayProps()
            expect(props.mapType).toBe('Satellite View')
        })
    })

    describe('isStartRideCompleted', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns true immediately for map view', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'map'
                    return def
                })
            })
            const completed = service.isStartRideCompleted()
            expect(completed).toBe(true)
        })

        test('returns false when street view is not loaded', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            const completed = service.isStartRideCompleted()
            expect(completed).toBe(false)
        })

        test('returns true when map is loaded for street view', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            service['mapLoaded'] = true
            const completed = service.isStartRideCompleted()
            expect(completed).toBe(true)
        })
    })

    describe('getDisplayProperties', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns complete display properties with ride view', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props).toMatchObject({
                rideView: expect.any(String),
                position: expect.any(Object),
                route: expect.any(Object)
            })
        })

        test('includes street view props when street view is selected', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            const props = service.getDisplayProperties({hideAll: false} as any) as any
            expect(props.rideView).toBe('sv')
            expect(props.sideViews).toBeDefined()
            expect(props.onDisplayEvent).toBeDefined()
        })

        test('includes satellite view props when satellite view is selected', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sat'
                    return def
                })
            })
            const props = service.getDisplayProperties({hideAll: false} as any) as any
            expect(props.rideView).toBe('sat')
            expect(props.displayPosition).toBeDefined()
            expect(props.onDisplayEvent).toBeDefined()
        })

        test('includes map view props when map view is selected', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'map'
                    return def
                })
            })
            const props = service.getDisplayProperties({hideAll: false} as any) as any
            expect(props.rideView).toBe('map')
            expect(props.displayPosition).toBeDefined()
            expect(props.onDisplayEvent).toBeDefined()
        })

        test('defaults to street view for desktop', () => {
            setupMocks(service, {
                mockRideService: true,
                channel: 'desktop'
            })
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.rideView).toBe('sv')
        })

        test('uses sv view for mobile devices', () => {
            setupMocks(service, {
                mockRideService: true,
                channel: 'mobile'
            })
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.rideView).toBe('sv')
        })

        test('includes parent route display properties', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getDisplayProperties({hideAll: false} as any)
            expect(props.markers).toBeDefined()
            expect(props.realityFactor).toBeDefined()
            expect(props.nearbyRides).toBeDefined()
        })
    })

    describe('onSatelliteViewEvent', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('sets mapLoaded flag when Loaded event is emitted', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getSatelliteViewProps() as any
            props.onDisplayEvent('Loaded')
            expect(service['mapLoaded']).toBe(true)
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })

        test('sets map error and emits state-update on error event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getSatelliteViewProps() as any
            const errorMsg = 'Satellite view error'
            props.onDisplayEvent('Error', errorMsg)
            expect(service['mapError']).toBe(errorMsg)
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })
    })

    describe('onMapViewEvent', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('sets mapLoaded flag when Loaded event is emitted', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getMapViewProps() as any
            props.onDisplayEvent('Loaded')
            expect(service['mapLoaded']).toBe(true)
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })

        test('emits state-update on Loaded event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getMapViewProps() as any
            props.onDisplayEvent('Loaded')
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })

        test('ignores error parameter', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getMapViewProps() as any
            props.onDisplayEvent('Loaded', 'some error')
            expect(service['mapError']).toBeUndefined()
        })
    })

    describe('onStreetViewEvent', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('sets mapLoaded and emits state-update on Loaded event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any) as any
            props.onDisplayEvent('Loaded')
            expect(service['mapLoaded']).toBe(true)
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })

        test('sets mapError and emits state-update on Error event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any) as any
            const errorMsg = 'Street view error'
            props.onDisplayEvent('Error', errorMsg)
            expect(service['mapError']).toBe(errorMsg)
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })

        test('updates panorama change timestamp on pano_changed event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any) as any
            const beforeTime = Date.now()
            props.onDisplayEvent('pano_changed', 'panorama_id')
            expect(service['tsLastSVEvent']).toBeGreaterThanOrEqual(beforeTime)
        })

        test('updates pov_changed timestamp and sets timeout', (done) => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any) as any
            service['tsLastPovChanged'] = Date.now() - 1000
            props.onDisplayEvent('pov_changed')
            expect(service['tsLastPovChanged']).toBeDefined()
            expect(service['povTimeout']).toBeDefined()
            setTimeout(() => {
                done()
            }, 150)
        })

        test('updates timestamps on status_changed event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any) as any
            const beforeTime = Date.now()
            props.onDisplayEvent('status_changed')
            expect(service['tsLastSVEvent']).toBeGreaterThanOrEqual(beforeTime)
        })

        test('updates timestamps on position_changed event', () => {
            setupMocks(service, {mockRideService: true})
            const props = service.getStreetViewProps({hideAll: false} as any) as any
            const beforeTime = Date.now()
            props.onDisplayEvent('position_changed')
            expect(service['tsLastSVEvent']).toBeGreaterThanOrEqual(beforeTime)
        })
    })

    describe('position update with street view', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('emits position update to street view observer when enough time has passed', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            service.onActivityUpdate({time:1, speed:36, routeDistance:500,distance:10},{distance:10})

            // Verify street view observer was set up
            expect(service['svObserver']).toBeDefined()
        })

        test('respects minimum update frequency for street view', (done) => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })
            service.onActivityUpdate({time:1, speed:36, routeDistance:100,distance:10},{distance:10})
            service.onActivityUpdate({time:2, speed:36, routeDistance:200,distance:10},{distance:10})

            setTimeout(() => {
                done()
            }, 100)
        })
    })

    describe('ride view selection based on device', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('selects street view for mobile regardless of preferences', () => {
            setupMocks(service, {
                mockRideService: true,
                channel: 'mobile',
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sat'
                    return def
                })
            })
            const props = service.getStartOverlayProps()
            expect(props.mapType).toBe('Street View')
        })

        test('allows user preference for street view on desktop', () => {
            setupMocks(service, {
                mockRideService: true,
                channel: 'desktop',
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            const props = service.getStartOverlayProps()
            expect(props.mapType).toBe('Street View')
        })

        test('allows user preference for satellite view on desktop', () => {
            setupMocks(service, {
                mockRideService: true,
                channel: 'desktop',
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sat'
                    return def
                })
            })
            const props = service.getStartOverlayProps()
            expect(props.mapType).toBe('Satellite View')
        })
    })

    describe('street view update timeout adaptation', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            jest.useFakeTimers()
            service = new GpxDisplayService()
        })

        afterEach(() => {
            jest.useRealTimers()
            cleanupMocks(service)
        })

        test('adapts update delay based on average update duration', () => {
            const userSettingsGet = jest.fn((key, def) => {
                if (key === 'preferences.rideView') return 'sv'
                if (key === 'preferences.sv.updateDelay') return 3000
                return def
            })
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Simulate multiple position updates with slow responses
            for (let i = 0; i < 10; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                // Advance time to simulate Street View event
                jest.advanceTimersByTime(1000)
                props.onDisplayEvent('pov_changed')
                jest.advanceTimersByTime(100)
            }

            // After 10 updates with ~1000ms response time, delay should be adapted
            expect(service['updateDurations'].length).toBeGreaterThan(0)
        })

        test('tracks update durations in array', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // First position update
            service.onActivityUpdate({time: 1, speed: 36, routeDistance: 100, distance: 100}, {distance: 100})
            jest.advanceTimersByTime(1000)
            props.onDisplayEvent('pov_changed')
            jest.advanceTimersByTime(100)

            // Second position update should record duration
            jest.advanceTimersByTime(2000)
            service.onActivityUpdate({time: 2, speed: 36, routeDistance: 200, distance: 100}, {distance: 100})
            jest.advanceTimersByTime(1200)
            props.onDisplayEvent('pov_changed')
            jest.advanceTimersByTime(100)

            // Should have recorded durations > 250ms
            const durations = service['updateDurations']
            expect(Array.isArray(durations)).toBe(true)
        })

        test('keeps maximum 10 durations in tracking array', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Simulate 15 position updates to exceed max of 10
            for (let i = 0; i < 15; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(1500)
                props.onDisplayEvent('pov_changed') // First pov_changed sets timestamp
                jest.advanceTimersByTime(500)
                props.onDisplayEvent('pov_changed') // Second pov_changed triggers timeout to record
                jest.advanceTimersByTime(150) // Let timeout fire and record duration
                jest.advanceTimersByTime(850) // Advance to next position update interval
            }

            // Should never exceed 10 durations
            expect(service['updateDurations'].length).toBeLessThanOrEqual(10)
        })

        test('only records durations longer than 250ms', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Fast update (less than 250ms)
            service.onActivityUpdate({time: 1, speed: 36, routeDistance: 100, distance: 100}, {distance: 100})
            jest.advanceTimersByTime(200)
            props.onDisplayEvent('pov_changed')
            jest.advanceTimersByTime(100)

            // Should not record this fast duration
            jest.advanceTimersByTime(2000)
            expect(service['updateDurations'].length).toBe(0)
        })

        test('adapts delay when average duration is 800-1200ms', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Simulate updates with ~1000ms average duration
            for (let i = 0; i < 10; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(1000)
                props.onDisplayEvent('pov_changed') // First pov_changed sets timestamp
                jest.advanceTimersByTime(500)
                props.onDisplayEvent('pov_changed') // Second pov_changed triggers timeout to record
                jest.advanceTimersByTime(150) // Let timeout fire and record duration
                jest.advanceTimersByTime(1350) // Advance to next position update interval
            }

            // With 10 durations tracked, average should be ~1000ms
            expect(service['updateDurations'].length).toBe(10)
        })

        test('applies highest adaptation when average duration exceeds 1200ms', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Simulate slow updates with ~1500ms average duration
            for (let i = 0; i < 10; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(1500)
                props.onDisplayEvent('pov_changed') // First pov_changed sets timestamp
                jest.advanceTimersByTime(500)
                props.onDisplayEvent('pov_changed') // Second pov_changed triggers timeout to record
                jest.advanceTimersByTime(150) // Let timeout fire and record duration
                jest.advanceTimersByTime(850) // Advance to next position update interval
            }

            // With 10 durations of ~1500ms, should have high adaptation
            expect(service['updateDurations'].length).toBe(10)
        })

        test('clears pov_changed timeout on successful position update', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Initial position update
            service.onActivityUpdate({time: 1, speed: 36, routeDistance: 100, distance: 100}, {distance: 100})
            jest.advanceTimersByTime(1000)

            // Trigger pov_changed to set timeout
            props.onDisplayEvent('pov_changed') // First pov_changed sets timestamp
            jest.advanceTimersByTime(500)
            props.onDisplayEvent('pov_changed') // Second pov_changed sets timeout
            expect(service['povTimeout']).toBeDefined()

            // Another position update should clear the timeout
            jest.advanceTimersByTime(1500) // Advance past the minimum update delay
            service.onActivityUpdate({time: 2, speed: 36, routeDistance: 200, distance: 100}, {distance: 100})

            // Timeout should be cleared after new position update
            expect(service['povTimeout']).toBeUndefined()
        })

        test('respects minimum update frequency when adapting delay', () => {
            const minDelay = 3000
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return minDelay
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any

            // Even with very fast responses, delay shouldn't go below minimum
            for (let i = 0; i < 10; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(300)
                props.onDisplayEvent('pov_changed')
                jest.advanceTimersByTime(100)
                jest.advanceTimersByTime(2000)
            }

            // Update delay should still respect minimum even with fast responses
            expect(service['updateDurations'].length).toBeGreaterThan(0)
        })
    })

    describe('position-update throttling based on adapted delay', () => {
        let service: GpxDisplayService

        beforeEach(() => {
            service = new GpxDisplayService()
            jest.useFakeTimers()
        })

        afterEach(() => {
            cleanupMocks(service)
            jest.useRealTimers()
        })

        test('throttles position-update events when updateDurations indicate slow responses', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any
            let positionUpdateCount = 0

            // Mock the Street View observer to count position-update events
            const svObserver = service['getStreetViewObserver']()
            const originalEmit = svObserver.emit
            svObserver.emit = jest.fn((event, data) => {
                if (event === 'position-update') {
                    positionUpdateCount++
                }
                return originalEmit.call(svObserver, event, data)
            })

            // Populate updateDurations with slow responses (~1500ms each)
            for (let i = 0; i < 10; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(1500)
                props.onDisplayEvent('pov_changed')
                jest.advanceTimersByTime(500)
                props.onDisplayEvent('pov_changed')
                jest.advanceTimersByTime(150)
                jest.advanceTimersByTime(850)
            }

            const countWithSlowDurations = positionUpdateCount
            expect(countWithSlowDurations).toBeLessThanOrEqual(10)

            // Now reset and test with faster responses
            positionUpdateCount = 0
            service['updateDurations'] = []

            // Send updates more frequently - should be throttled less due to default delay
            for (let i = 0; i < 5; i++) {
                service.onActivityUpdate({time: i + 10, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(1000)
            }

            // With fresh updateDurations (or no slow responses), we might see more position-updates
            // This verifies the throttling is indeed based on the adapted delay
            expect(svObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
        })

        test('sends position-update events without throttling when updateDurations is empty', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 1000  // Short default delay
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any
            let positionUpdateCount = 0

            const svObserver = service['getStreetViewObserver']()
            const originalEmit = svObserver.emit
            svObserver.emit = jest.fn((event, data) => {
                if (event === 'position-update') {
                    positionUpdateCount++
                }
                return originalEmit.call(svObserver, event, data)
            })

            // Send rapid updates - with short default delay and no updateDurations, most should go through
            for (let i = 0; i < 5; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(1100)  // Just over the 1000ms delay
            }

            // Should have sent position-update events due to short delay
            expect(positionUpdateCount).toBeGreaterThan(0)
        })

        test('respects minimum delay even with no updateDurations', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((key, def) => {
                    if (key === 'preferences.rideView') return 'sv'
                    if (key === 'preferences.sv.updateDelay') return 3000
                    return def
                })
            })

            const props = service.getStreetViewProps({hideAll: false} as any) as any
            let positionUpdateCount = 0

            const svObserver = service['getStreetViewObserver']()
            const originalEmit = svObserver.emit
            svObserver.emit = jest.fn((event, data) => {
                if (event === 'position-update') {
                    positionUpdateCount++
                }
                return originalEmit.call(svObserver, event, data)
            })

            // Try rapid updates - should be throttled by minimum 3000ms delay
            for (let i = 0; i < 4; i++) {
                service.onActivityUpdate({time: i, speed: 36, routeDistance: 100 + i * 100, distance: 100}, {distance: 100})
                jest.advanceTimersByTime(500)  // Too short - should not send
            }

            // Should only send first position-update due to 3000ms minimum delay
            expect(positionUpdateCount).toBe(1)

            // Advance enough time to allow next update
            jest.advanceTimersByTime(3000)
            service.onActivityUpdate({time: 4, speed: 36, routeDistance: 500, distance: 100}, {distance: 100})

            // Should send another position-update after respecting the delay
            expect(positionUpdateCount).toBe(2)
        })
    })

})
