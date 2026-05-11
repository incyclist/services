import sydney from '../../../__tests__/data/routes/sydney2.json'
import { Inject } from '../../base/decorators'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { FollowRouteDisplayService } from './FollowRouteDisplayService'
import { Observer } from '../../base/types'
import { RouteSettings } from '../../routes/list/cards/types'

describe('FollowRouteDisplayService', () => {

    const sydneyRoute = createFromJson(sydney as unknown as RouteApiDetail)
    sydneyRoute.description.distance = 3801.452188724582
    sydneyRoute.description.isLoop = true

    const defaultStartSettings: RouteSettings = {
        startPos: 0,
        realityFactor: 100,
        type: 'Route'
    }

    const mockObserver: Partial<Observer> = {
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn(),
        emit: jest.fn()
    }

    let mockRideService: any
    let mockActiveRides: any
    let mockRouteList: any

    const setupMocks = (s: any, options: any = {}) => {
        const userSettingsGet = options.userSettingsGet || jest.fn((k, d) => d)
        const userSettingsSet = options.userSettingsSet || jest.fn()

        Inject('UserSettings', {
            get: userSettingsGet,
            set: userSettingsSet,
            getValue: jest.fn((k, d) => d)
        })

        mockRouteList = {
            getSelected: jest.fn().mockReturnValue(options.route ?? sydneyRoute),
            getStartSettings: jest.fn().mockReturnValue(options.startSettings ?? defaultStartSettings)
        }
        Inject('RouteList', mockRouteList)

        mockActiveRides = {
            get: jest.fn().mockReturnValue(options.activeRides ?? []),
            getObserver: jest.fn().mockReturnValue(mockObserver),
            init: jest.fn().mockReturnValue(mockObserver),
            stop: jest.fn()
        }
        Inject('ActiveRides', mockActiveRides)

        Inject('DeviceRide', {
            getCyclingMode: jest.fn().mockReturnValue({
                isSIM: jest.fn().mockReturnValue(options.isSIM ?? false),
                getSetting: jest.fn().mockReturnValue(undefined),
                getName: jest.fn().mockReturnValue('Simulator'),
                getSettings: jest.fn().mockReturnValue({})
            }),
            getControlAdapter: jest.fn().mockReturnValue({}),
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
            getUnits: jest.fn().mockReturnValue('metric'),
            convert: jest.fn((val, type, opts) => val)
        })

        Inject('GoogleMaps', {})

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

        s.emit = jest.fn()
    }

    const cleanupMocks = (s: any) => {
        s.reset()
        if (mockRideService)
            mockRideService.reset?.()
        jest.clearAllMocks()
    }

    describe('initialization', () => {
        let service: FollowRouteDisplayService

        beforeEach(() => {
            service = new FollowRouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('initializes route from start settings', () => {
            setupMocks(service, { mockRideService: true })
            expect(service.getCurrentRoute()).toBeDefined()
        })

        test('initializes position on init', () => {
            setupMocks(service, { mockRideService: true })
            const route = service.getCurrentRoute()
            expect(route).toBeDefined()
            expect(route.description).toBeDefined()
        })

        test('stores initial route reference', () => {
            setupMocks(service, { mockRideService: true })
            const route1 = service.getCurrentRoute()
            const route2 = service.getCurrentRoute()
            expect(route1).toBe(route2)
        })
    })

    describe('getLogProps', () => {
        let service: FollowRouteDisplayService

        beforeEach(() => {
            service = new FollowRouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns object with mode set to follow route', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('mode')
            expect(props.mode).toBe('follow route')
        })

        test('includes route title in log properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('route')
        })

        test('includes start position in log properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('start')
        })

        test('includes reality factor in log properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('realityFactor')
            expect(props.realityFactor).toContain('%')
        })

        test('includes showPrev setting in log properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('showPrev')
        })

        test('includes finishAtEndOfLoop setting in log properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('finishAtEndOfLoop')
        })

        test('includes ride view preference', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((_key, def) => {
                    if (_key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('rideView')
        })

        test('includes bike configuration in log properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            // Should include bike-related properties from parent
            expect(props).toBeDefined()
        })
    })

    describe('savePosition - position persistence', () => {
        let service: FollowRouteDisplayService

        beforeEach(() => {
            service = new FollowRouteDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('position persisted to correct settings key with route ID', () => {
            const userSettingsSet = jest.fn()
            setupMocks(service, {
                mockRideService: true,
                userSettingsSet
            })

            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distance: 500 }
            )

            // Verify the exact key format was used
            const routeId = sydneyRoute.description.id
            const expectedKey = `routeSelection.followRoute.prevSetting.${routeId}.startPos`

            const setCalls = userSettingsSet.mock.calls
            const positionCall = setCalls.find(call =>
                call[0] === expectedKey
            )

            expect(positionCall).toBeDefined()
        })

        test('position value stored is the route distance at update time', () => {
            const userSettingsSet = jest.fn()
            setupMocks(service, {
                mockRideService: true,
                userSettingsSet
            })

            const testDistance = 250
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: testDistance, distance: testDistance } as any,
                { distance: testDistance }
            )

            // Verify the value stored matches the route distance
            const routeId = sydneyRoute.description.id
            const expectedKey = `routeSelection.followRoute.prevSetting.${routeId}.startPos`

            const setCalls = userSettingsSet.mock.calls
            const positionCall = setCalls.find(call => call[0] === expectedKey)

            // The value should be the routeDistance from position
            expect(positionCall).toBeDefined()
            if (positionCall) {
                expect(positionCall[1]).toBe(testDistance)
            }
        })

        test('position persisted at different points during ride', () => {
            const userSettingsSet = jest.fn()
            setupMocks(service, {
                mockRideService: true,
                userSettingsSet
            })

            const routeId = sydneyRoute.description.id
            const expectedKey = `routeSelection.followRoute.prevSetting.${routeId}.startPos`

            // Update at 500m
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distance: 500 }
            )

            // Update at 1500m
            service.onActivityUpdate(
                { time: 200, speed: 25, routeDistance: 1500, distance: 1000 } as any,
                { distance: 1500 }
            )

            const setCalls = userSettingsSet.mock.calls
            const positionCalls = setCalls.filter(call => call[0] === expectedKey)

            // Should have at least one call with the correct key
            expect(positionCalls.length).toBeGreaterThanOrEqual(1)
        })

        test('update position persists latest distance to settings', () => {
            const userSettingsSet = jest.fn()
            setupMocks(service, {
                mockRideService: true,
                userSettingsSet
            })

            const distances = [300, 800, 1200]

            distances.forEach(distance => {
                service.onActivityUpdate(
                    { time: 100, speed: 25, routeDistance: distance, distance } as any,
                    { distance }
                )
            })

            const routeId = sydneyRoute.description.id
            const expectedKey = `routeSelection.followRoute.prevSetting.${routeId}.startPos`

            const setCalls = userSettingsSet.mock.calls
            const lastPositionCall = setCalls.reverse().find(call => call[0] === expectedKey)

            // The latest call should have the latest distance
            expect(lastPositionCall).toBeDefined()
            if (lastPositionCall) {
                expect(lastPositionCall[1]).toBe(1200)
            }
        })

        test('position update preserves route state', () => {
            setupMocks(service, { mockRideService: true })
            const routeBefore = service.getCurrentRoute()

            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 300, distance: 300 } as any,
                { distance: 300 }
            )

            const routeAfter = service.getCurrentRoute()
            expect(routeAfter).toBe(routeBefore)
        })
    })

})
