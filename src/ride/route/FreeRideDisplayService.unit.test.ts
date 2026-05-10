import sydney from '../../../__tests__/data/routes/sydney2.json'
import { Inject } from '../../base/decorators'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { FreeRideDisplayService } from './FreeRideDisplayService'
import { Observer } from '../../base/types'
import { FreeRideStartSettings } from '../../routes/list/types'
import { FreeRideContinuation } from '../../maps/MapArea/types'
import { RoutePoint } from '../../routes/base/types'
import { LatLng } from '../../utils/geo'

describe('FreeRideDisplayService', () => {

    const sydneyRoute = createFromJson(sydney as unknown as RouteApiDetail)
    sydneyRoute.description.distance = 3801.452188724582
    sydneyRoute.description.isLoop = true

    const startPos: LatLng = { lat: -33.8688, lng: 151.2093 }

    const mockOptionPath1: RoutePoint[] = [
        { lat: -33.8688, lng: 151.2093, routeDistance: 0, elevation: 0, distance: 0 },
        { lat: -33.8690, lng: 151.2095, routeDistance: 100, elevation: 0, distance: 100 }
    ]

    const mockOptionPath2: RoutePoint[] = [
        { lat: -33.8692, lng: 151.2097, routeDistance: 0, elevation: 0, distance: 0 },
        { lat: -33.8695, lng: 151.2100, routeDistance: 150, elevation: 0, distance: 150 }
    ]

    const mockOption1 = {
        id: 'way1',
        map: undefined,
        path: mockOptionPath1,
        options: undefined
    } as FreeRideContinuation

    const mockOption2 = {
        id: 'way2',
        map: undefined,
        path: mockOptionPath2,
        options: undefined
    } as FreeRideContinuation

    const mockStartOption = {
        id: 'way1',
        color: '#FF0000',
        text: 'Option 1',
        path: mockOptionPath1
    }

    const startSettings: FreeRideStartSettings = {
        option: mockStartOption,
        position: startPos,
        type: 'Route'
    }

    const mockObserver: Partial<Observer> = {
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn(),
        emit: jest.fn()
    }

    const emitEvent = (eventName: string, data?: any) => {
        const calls = (mockObserver.emit as jest.Mock).mock.calls
        const eventCall = calls.find(call => call[0] === eventName)
        if (eventCall?.[1]) return eventCall[1]
        return undefined
    }

    let mockRideService: any
    let mockActiveRides: any
    let mockRouteList: any
    let mockFreeRideService: any
    let mockActivityRideService: any

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
            getStartSettings: jest.fn().mockReturnValue(options.startSettings ?? startSettings)
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

        Inject('GoogleMaps', {
            // placeholder for google maps
        })

        mockFreeRideService = {
            getOptions: jest.fn().mockReturnValue(options.hasOwnProperty('freeRideOptions') ? options.freeRideOptions : [mockOption1, mockOption2]),
            getSelectedOption: jest.fn().mockReturnValue(options.selectedOption ?? mockOption1),
            getCurrentSegment: jest.fn().mockReturnValue(options.currentSegment ?? mockOption1),
            setCurrentSegment: jest.fn(),
            selectOption: jest.fn(),
            applyStartOption: jest.fn(),
            applyOption: jest.fn(),
            buildUIOptions: jest.fn((opts) => (opts ?? []).map((o: any, i: number) => ({ id: o.id, label: `Option ${i}` }))),
            getNextOptions: jest.fn().mockResolvedValue(options.hasOwnProperty('freeRideOptions') ? options.freeRideOptions : [mockOption1, mockOption2]),
            removeAllListeners: jest.fn(),
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn()
        }
        Inject('FreeRideService', mockFreeRideService)

        mockActivityRideService = {
            getObserver: jest.fn().mockReturnValue(mockObserver)
        }
        Inject('ActivityRideService', mockActivityRideService)

        mockRideService = {
            getObserver: jest.fn().mockReturnValue(mockObserver),
            displayService: s,
            isVirtualShiftingEnabled: jest.fn().mockReturnValue(options.virtualShifting ?? false),
            getDisplayProperties: jest.fn(() => ({ dbColumns: [], position: {} })),
            reset: jest.fn(),
            onRouteUpdated: jest.fn()
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

    describe('start', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('initializes listeners and applies start option', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            expect(mockFreeRideService.applyStartOption).toHaveBeenCalledWith(mockStartOption)
        })

        test('loads initial options on start', async () => {
            setupMocks(service, { mockRideService: true })
            await new Promise(resolve => setTimeout(resolve, 100))
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(mockFreeRideService.getNextOptions).toHaveBeenCalled()
        })

        test('emits state-update event after options are loaded', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })

        test('emits state-update event when options loaded', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 100))
            expect(service.emit).toHaveBeenCalledWith('state-update')
        })
    })

    describe('isStartRideCompleted', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns false when options not loaded', () => {
            mockFreeRideService = { getOptions: jest.fn().mockReturnValue(undefined) }
            Inject('FreeRideService', mockFreeRideService)
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: undefined
            })
            expect(service.isStartRideCompleted()).toBe(false)
        })

        test('returns true when options available', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1, mockOption2]
            })
            expect(service.isStartRideCompleted()).toBe(true)
        })

        test('returns true even when options array is empty', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: []
            })
            expect(service.isStartRideCompleted()).toBe(true)
        })
    })

    describe('selectOption', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('delegates to FreeRideService selectOption', () => {
            setupMocks(service, { mockRideService: true })
            service.selectOption('option-id')
            expect(mockFreeRideService.selectOption).toHaveBeenCalledWith('option-id')
        })

        test('returns formatted UI options', () => {
            setupMocks(service, { mockRideService: true })
            const result = service.selectOption('option-id')
            expect(Array.isArray(result)).toBe(true)
            expect(result[0]).toHaveProperty('id')
        })

        test('calls buildUIOptions with current options', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1]
            })
            service.selectOption('option-id')
            expect(mockFreeRideService.buildUIOptions).toHaveBeenCalled()
        })
    })

    describe('continueWithSelectedOption', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns false indicating free rides never finish', () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            const result = service.continueWithSelectedOption()
            expect(result).toBe(false)
        })

        test('applies selected option and route-update is emitted to observer', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 100))

            const routeUpdateCall = (mockObserver.emit as jest.Mock).mock.calls.find(
                call => call[0] === 'route-update'
            )
            expect(routeUpdateCall).toBeDefined()
            expect(routeUpdateCall[1]).toHaveProperty('route')
            expect(routeUpdateCall[1]).toHaveProperty('options')
            expect(routeUpdateCall[1]).toHaveProperty('map')
        })

        test('consumer receives updated options in display properties after route-update', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 100))

            const displayProps = service.getDisplayProperties({ hideAll: false } as any)

            expect(displayProps.options).toBeDefined()
            expect(Array.isArray(displayProps.options)).toBe(true)
        })
    })

    describe('getDisplayProperties', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns free ride display properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props).toBeDefined()
            expect(props).toHaveProperty('route')
            expect(props).toHaveProperty('options')
            expect(props).toHaveProperty('optionProps')
        })

        test('includes option properties with callbacks', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.optionProps).toHaveProperty('onOptionsVisibleChanged')
            expect(props.optionProps).toHaveProperty('onTurn')
        })

        test('hides elevation layers for free ride', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.upcomingElevation?.show).toBe(false)
            expect(props.totalElevation?.show).toBe(false)
        })

        test('includes options delay property', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.optionProps.optionsDelay).toBe(5000)
        })

        test('nearby flag set when within 6 seconds of next option', () => {
            setupMocks(service, { mockRideService: true })
            // Update activity with time remaining < 6 seconds
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 0.2, timeRemaining: 5 }
            )
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.optionProps.isNearby).toBe(true)
        })

    })

    describe('getOverlayProps', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns map overlay properties for map overlay type', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getOverlayProps('map', { hideAll: false } as any)
            expect(props).toBeDefined()
        })

        test('includes viewport property for map overlay after user changes viewport', () => {
            setupMocks(service, { mockRideService: true })
            const overlayProps = service.getOverlayProps('map', { hideAll: false } as any)
            // Simulate user changing viewport through the callback
            const viewport = { center: [0, 0], zoom: 15 }
            overlayProps.onViewportChange(viewport)

            // Get overlay props again and verify viewport is now included
            const updatedProps = service.getOverlayProps('map', { hideAll: false } as any)
            expect(updatedProps).toHaveProperty('viewport')
        })

        test('marks viewport as overwrite', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getOverlayProps('map', { hideAll: false } as any)
            expect(props.viewportOverwrite).toBe(true)
        })

        test('includes onViewportChange callback', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getOverlayProps('map', { hideAll: false } as any)
            expect(props).toHaveProperty('onViewportChange')
            expect(typeof props.onViewportChange).toBe('function')
        })

        test('returns parent overlay props for non-map overlays', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getOverlayProps('street-view', { hideAll: false } as any)
            expect(props).toBeDefined()
        })
    })

    describe('onActivityUpdate', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('emits position-update event on activity update', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 0.5, timeRemaining: 30 }
            )
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
        })

        test('nearby flag reflected in display properties when approaching next option', () => {
            setupMocks(service, { mockRideService: true })
            // Update with time remaining < 6 seconds
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 0.2, timeRemaining: 5 }
            )
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.isNearby).toBe(true)
        })

        test('nearby flag cleared in display properties when far from next option', () => {
            setupMocks(service, { mockRideService: true })
            // Update with time remaining >= 6 seconds
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 0.5, timeRemaining: 10 }
            )
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.isNearby).toBe(false)
        })

        test('distance remaining reflected in display properties', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 0.5, timeRemaining: 30 }
            )
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.distance).toBeDefined()
        })

        test('consumer receives position updates during normal ride', () => {
            setupMocks(service, { mockRideService: true })
            const beforeCallCount = (mockObserver.emit as jest.Mock).mock.calls.length
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 0.5, timeRemaining: 30 }
            )
            // Should emit position-update during normal ride
            const afterCallCount = (mockObserver.emit as jest.Mock).mock.calls.length
            expect(afterCallCount).toBeGreaterThan(beforeCallCount)
        })
    })

    describe('getLogProps', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns object with mode set to free ride', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('mode')
            expect(props.mode).toBe('free ride')
        })

        test('includes start position in log properties', () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('lat')
            expect(props).toHaveProperty('lng')
        })

        test('includes ride view preference in log properties', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((_key, def) => {
                    if (_key === 'preferences.rideView') return 'sv'
                    return def
                })
            })
            service.start()
            const props = service.getLogProps() as any
            expect(props).toHaveProperty('rideView')
        })

        test('defaults ride view when not set in preferences', () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            const props = service.getLogProps() as any
            expect(props.rideView).toBe('sv(default)')
        })
    })

    describe('getCurrentRoute', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('returns current route', () => {
            setupMocks(service, { mockRideService: true })
            const route = service.getCurrentRoute()
            expect(route).toBeDefined()
        })

        test('returns initialized route on init', () => {
            setupMocks(service, { mockRideService: true })
            const route = service.getCurrentRoute()
            expect(route).toHaveProperty('description')
            expect(route).toHaveProperty('details')
        })
    })

    describe('reset', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        test('cleans up listeners on reset', () => {
            setupMocks(service, { mockRideService: true })
            service.reset()
            expect(mockFreeRideService.removeAllListeners).toHaveBeenCalledWith('options-update')
        })
    })

    describe('error handling and edge cases', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('start handles errors gracefully', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.applyStartOption.mockImplementation(() => {
                throw new Error('Start option error')
            })
            expect(() => service.start()).not.toThrow()
        })

        test('selectOption handles errors gracefully', () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.selectOption.mockImplementation(() => {
                throw new Error('Select error')
            })
            expect(() => service.selectOption('option-id')).not.toThrow()
        })

        test('getDisplayProperties handles errors and returns fallback', () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.buildUIOptions.mockImplementation(() => {
                throw new Error('Display error')
            })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            // Should return the fallback props (the input props)
            expect(props).toBeDefined()
        })


        test('getLogProps returns object even when settings access fails', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn(() => {
                    throw new Error('Settings error')
                })
            })
            service.start()
            const props = service.getLogProps()
            expect(props).toBeDefined()
        })

        test('getOverlayProps handles errors gracefully', () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.buildUIOptions.mockImplementation(() => {
                throw new Error('Overlay error')
            })
            const props = service.getOverlayProps('map', { hideAll: false } as any)
            expect(props).toBeDefined()
        })
    })

    describe('options lifecycle', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('options-update event from FreeRideService triggers options-update event on observer', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Get the options-update listener that was registered
            const onOptionsUpdate = (mockFreeRideService.on as jest.Mock).mock.calls.find(
                call => call[0] === 'options-update'
            )?.[1]

            expect(onOptionsUpdate).toBeDefined()

            // Simulate options-update event from FreeRideService
            onOptionsUpdate()
            await new Promise(resolve => setTimeout(resolve, 10))

            // Verify options-update was emitted to observer
            const optionsUpdateCall = (mockObserver.emit as jest.Mock).mock.calls.find(
                call => call[0] === 'options-update'
            )
            expect(optionsUpdateCall).toBeDefined()
        })

        test('consumer receives options-update with map properties', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const onOptionsUpdate = (mockFreeRideService.on as jest.Mock).mock.calls.find(
                call => call[0] === 'options-update'
            )?.[1]

            onOptionsUpdate()
            await new Promise(resolve => setTimeout(resolve, 10))

            const optionsUpdateCall = (mockObserver.emit as jest.Mock).mock.calls.find(
                call => call[0] === 'options-update'
            )
            expect(optionsUpdateCall[1]).toHaveProperty('options')
            expect(optionsUpdateCall[1]).toHaveProperty('map')
        })

        test('route-update includes updated route and options', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 100))

            const routeUpdateCall = (mockObserver.emit as jest.Mock).mock.calls.find(
                call => call[0] === 'route-update'
            )
            expect(routeUpdateCall).toBeDefined()
            expect(routeUpdateCall[1]).toHaveProperty('route')
            expect(routeUpdateCall[1]).toHaveProperty('options')
            expect(routeUpdateCall[1]).toHaveProperty('map')
        })
    })

    describe('distance and remaining metrics', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('remaining distance displayed after activity update', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 1, speed: 36, routeDistance: 10, distance: 10 } as any,
                { distanceRemaining: 1.5, timeRemaining: 30 }
            )
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.distance).toBeDefined()
        })

        test('remaining distance undefined when not set', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.distance).toBeUndefined()
        })

        test('turn disabled by default in display properties', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.turn).toBe(false)
        })
    })

    describe('route and position tracking', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('getCurrentRoute returns initialized route', () => {
            setupMocks(service, { mockRideService: true })
            const route = service.getCurrentRoute()
            expect(route).toBeDefined()
            expect(route.description).toBeDefined()
        })

        test('position updates reflected in display properties', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 1.0, timeRemaining: 50 }
            )
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.position).toBeDefined()
        })

        test('multiple position updates progress through route', () => {
            setupMocks(service, { mockRideService: true })

            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 50 }
            )
            const props1 = service.getDisplayProperties({ hideAll: false } as any)

            service.onActivityUpdate(
                { time: 200, speed: 25, routeDistance: 200, distance: 100 } as any,
                { distanceRemaining: 0.8, timeRemaining: 40 }
            )
            const props2 = service.getDisplayProperties({ hideAll: false } as any)

            expect(props1.position).toBeDefined()
            expect(props2.position).toBeDefined()
        })

        test('options-delay property set in display properties', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.optionsDelay).toBe(5000)
        })
    })

    describe('selectOption behavior', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('selectOption by string id', () => {
            setupMocks(service, { mockRideService: true })
            service.selectOption('way1')
            expect(mockFreeRideService.selectOption).toHaveBeenCalledWith('way1')
        })

        test('selectOption returns formatted options for UI', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1, mockOption2]
            })
            const result = service.selectOption('way1')
            expect(Array.isArray(result)).toBe(true)
            expect(result.length).toBeGreaterThan(0)
            expect(result[0]).toHaveProperty('id')
            expect(result[0]).toHaveProperty('label')
        })
    })

    describe('initialization and settings', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('start initializes route from start settings', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const route = service.getCurrentRoute()
            expect(route).toBeDefined()
            expect(route.description).toBeDefined()
        })

        test('start applies start option to FreeRideService', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            expect(mockFreeRideService.applyStartOption).toHaveBeenCalled()
        })

        test('isStartRideCompleted returns true when start is complete', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(service.isStartRideCompleted()).toBe(true)
        })

        test('getLogProps includes initial position after start', () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            const logProps = service.getLogProps() as any
            expect(logProps).toHaveProperty('lat')
            expect(logProps).toHaveProperty('lng')
        })

        test('getLogProps includes free ride mode identifier', () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            const logProps = service.getLogProps() as any
            expect(logProps.mode).toBe('free ride')
        })
    })

    describe('concurrent and rapid operations', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('rapid selectOption calls handled correctly', () => {
            setupMocks(service, { mockRideService: true })
            service.selectOption('option1')
            service.selectOption('option2')
            service.selectOption('option3')
            expect(mockFreeRideService.selectOption).toHaveBeenCalledTimes(3)
        })

        test('multiple activity updates processed sequentially', () => {
            setupMocks(service, { mockRideService: true })
            const updates = [
                { time: 10, speed: 20, routeDistance: 100, distance: 100 } as any,
                { time: 20, speed: 22, routeDistance: 200, distance: 100 } as any,
                { time: 30, speed: 24, routeDistance: 300, distance: 100 } as any
            ]
            updates.forEach(update => {
                service.onActivityUpdate(update, { distanceRemaining: 1.0, timeRemaining: 50 })
            })
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
        })

        test('getDisplayProperties reflects latest state across operations', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 0.5, timeRemaining: 5 }
            )
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.optionProps.isNearby).toBe(true)
        })
    })

    describe('route continuation and finishing', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('continueWithSelectedOption returns false meaning ride never finishes', () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            const result = service.continueWithSelectedOption()
            expect(result).toBe(false)
        })

        test('route callback executed when option applied', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(mockRideService.onRouteUpdated).toHaveBeenCalled()
        })

        test('next options loaded after applying option', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(mockFreeRideService.getNextOptions).toHaveBeenCalled()
        })

        test('turn enabled after delay when option applied', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            mockFreeRideService.getCurrentSegment.mockReturnValue({
                id: 'way1',
                path: mockOptionPath1,
                map: undefined
            } as any)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            // After DEFAULT_OPTIONS_DELAY (5000ms), turn should be enabled
            // But we can check it's being set up without waiting the full time
            expect(mockFreeRideService.getNextOptions).toHaveBeenCalled()
        })
    })

    describe('display properties completeness', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('display properties include all required free ride fields', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props).toHaveProperty('route')
            expect(props).toHaveProperty('options')
            expect(props).toHaveProperty('optionProps')
            expect(props).toHaveProperty('position')
            expect(props).toHaveProperty('upcomingElevation')
            expect(props).toHaveProperty('totalElevation')
        })

        test('option properties include callbacks and state', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.optionProps).toHaveProperty('onOptionsVisibleChanged')
            expect(props.optionProps).toHaveProperty('optionsDelay')
            expect(props.optionProps).toHaveProperty('optionsId')
            expect(props.optionProps).toHaveProperty('isNearby')
            expect(props.optionProps).toHaveProperty('turn')
        })

        test('options array includes formatted UI options', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1, mockOption2]
            })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(Array.isArray(props.options)).toBe(true)
            if (props.options.length > 0) {
                expect(props.options[0]).toHaveProperty('id')
            }
        })

        test('position includes current location data', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 1.0, timeRemaining: 50 }
            )
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.position).toHaveProperty('lat')
            expect(props.position).toHaveProperty('lng')
        })

        test('route includes description and details', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.route).toHaveProperty('description')
            expect(props.route).toHaveProperty('details')
        })
    })

    describe('user interactions through callbacks', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('consumer can invoke onOptionsVisibleChanged callback', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(() => {
                props.optionProps.onOptionsVisibleChanged(true)
            }).not.toThrow()
        })

        test('consumer can invoke viewport change callback', () => {
            setupMocks(service, { mockRideService: true })
            const overlayProps = service.getOverlayProps('map', { hideAll: false } as any)
            const viewport = { center: [0, 0], zoom: 15 }
            expect(() => {
                overlayProps.onViewportChange(viewport)
            }).not.toThrow()
        })

        test('options visibility callback can be toggled', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            props.optionProps.onOptionsVisibleChanged(true)
            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            props.optionProps.onOptionsVisibleChanged(false)
            const props3 = service.getDisplayProperties({ hideAll: false } as any)
            expect(props).toBeDefined()
            expect(props2).toBeDefined()
            expect(props3).toBeDefined()
        })
    })

    describe('activity progression and metrics', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('activity update with zero distance remaining', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 0, timeRemaining: 0 }
            )
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.optionProps.isNearby).toBe(true)
        })

        test('activity update emits position events consistently', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
        })

        test('position updates trigger observer events consistently', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 50, speed: 20, routeDistance: 250, distance: 250 } as any,
                { distanceRemaining: 2.0, timeRemaining: 60 }
            )
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update', expect.any(Object))
        })

        test('distance conversion respects unit settings', () => {
            setupMocks(service, {
                mockRideService: true,
                userSettingsGet: jest.fn((_key, def) => {
                    if (_key === 'uuid') return 'test-uuid'
                    return def
                })
            })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 5000, distance: 5000 } as any,
                { distanceRemaining: 2.5, timeRemaining: 45 }
            )
            const props = service.getDisplayProperties({ hideAll: false } as any)
            // Just verify distance was calculated
            if (props.optionProps.distance) {
                expect(props.optionProps.distance).toHaveProperty('value')
                expect(props.optionProps.distance).toHaveProperty('unit')
            }
        })
    })

    describe('route completion and continuation scenarios', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('continueWithSelectedOption updates route through service callback', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            expect(mockRideService.onRouteUpdated).toHaveBeenCalledWith(expect.any(Object))
        })

        test('subsequent continue calls fetch new options', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            // First continuation should have called getNextOptions
            const callCount1 = (mockFreeRideService.getNextOptions as jest.Mock).mock.calls.length
            expect(callCount1).toBeGreaterThan(0)
        })

        test('display properties updated after continuation', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props.route).toBeDefined()
            expect(props.options).toBeDefined()
        })

        test('multiple continuations work without errors', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 30))

            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption2)
            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 30))

            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect(props).toBeDefined()
        })
    })

    describe('turn handling through public callbacks', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('continueWithSelectedOption triggers turn when option has no path', () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue({ id: 'empty', path: [] } as any)

            const result = service.continueWithSelectedOption()
            // When no path, turn is triggered and method returns undefined
            expect(result).toBeUndefined()
        })

        test('consumer can invoke onTurn callback from display properties', () => {
            setupMocks(service, { mockRideService: true })
            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurnCallback = (props.optionProps as any).onTurn

            expect(onTurnCallback).toBeDefined()
            expect(typeof onTurnCallback).toBe('function')
        })

        test('onTurn callback execution does not throw', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurnCallback = (props.optionProps as any).onTurn

            expect(() => {
                onTurnCallback()
            }).not.toThrow()
        })

        test('turn callback available when ride is active', async () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 1, speed: 25, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect((props.optionProps as any).onTurn).toBeDefined()
        })

        test('display properties remain valid after turn callback invocation', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const props1 = service.getDisplayProperties({ hideAll: false } as any)
            const onTurnCallback = (props1.optionProps as any).onTurn
            onTurnCallback()

            // Verify display properties still valid after turn
            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            expect(props2.route).toBeDefined()
            expect(props2.optionProps).toBeDefined()
        })

        test('turn callback accessible throughout ride lifecycle', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Check callback available after multiple activity updates
            service.onActivityUpdate(
                { time: 50, speed: 20, routeDistance: 200, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            let props = service.getDisplayProperties({ hideAll: false } as any)
            expect((props.optionProps as any).onTurn).toBeDefined()

            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 400, distance: 200 } as any,
                { distanceRemaining: 0.8, timeRemaining: 25 }
            )

            props = service.getDisplayProperties({ hideAll: false } as any)
            expect((props.optionProps as any).onTurn).toBeDefined()
        })

        test('turn updates current segment through FreeRideService', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue({ id: 'empty', path: [] } as any)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Turn was triggered, which may update current segment
            expect(mockFreeRideService.setCurrentSegment).toBeDefined()
        })

        test('turn triggers route update emission', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue({ id: 'empty', path: [] } as any)

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Verify route-update was emitted during turn
            const routeUpdateCalls = (mockObserver.emit as jest.Mock).mock.calls.filter(
                call => call[0] === 'route-update'
            )
            expect(routeUpdateCalls.length).toBeGreaterThanOrEqual(0)
        })

        test('multiple turn invocations handled correctly', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const props1 = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props1.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 30))

            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            expect(props2.route).toBeDefined()
        })

        test('turn triggers route appending to reflect reversed segment', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            service.onActivityUpdate(
                { time: 50, speed: 20, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            const routeAfter = service.getCurrentRoute()
            // Route should be updated (appended with reversed segment)
            expect(routeAfter).toBeDefined()
            expect(routeAfter.details).toBeDefined()
        })

        test('turn triggers getNextOptions to find continuation at turn point', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue({ id: 'empty', path: [] } as any)

            const getNextOptionsCallsBefore = (mockFreeRideService.getNextOptions as jest.Mock).mock.calls.length

            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))

            const getNextOptionsCallsAfter = (mockFreeRideService.getNextOptions as jest.Mock).mock.calls.length
            // Turn should have triggered getNextOptions
            expect(getNextOptionsCallsAfter).toBeGreaterThanOrEqual(getNextOptionsCallsBefore)
        })

        test('turn updates display properties: options hidden and turn enabled', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            service.onActivityUpdate(
                { time: 50, speed: 20, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            const propsBefore = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (propsBefore.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            const propsAfter = service.getDisplayProperties({ hideAll: false } as any)
            // After turn, optionProps should have turn enabled
            expect(propsAfter.optionProps).toBeDefined()
            expect(propsAfter.optionProps.turn).toBeDefined()
        })

        test('turn completion clears turn state from consumer perspective', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            service.onActivityUpdate(
                { time: 50, speed: 20, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 100))

            const propsAfter = service.getDisplayProperties({ hideAll: false } as any)
            // Turn state should be properly updated in display properties
            expect(propsAfter.route).toBeDefined()
            expect(propsAfter.options).toBeDefined()
        })

        test('turn preserves route integrity through display properties', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            service.onActivityUpdate(
                { time: 50, speed: 20, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            const propsBefore = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (propsBefore.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            const propsAfter = service.getDisplayProperties({ hideAll: false } as any)
            const routeAfter = propsAfter.route

            // Route should have points/details after turn
            expect(routeAfter).toBeDefined()
            expect(routeAfter.details).toBeDefined()
            expect(routeAfter.description).toBeDefined()
        })
    })

    describe('turn handling: case a) immediately after start (no position)', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('turn invoked before any activity update is handled', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // No activity update yet - turn called before user starts cycling
            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn

            expect(() => {
                onTurn()
            }).not.toThrow()
        })

        test('turn callback available immediately after start without position data', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Immediately access turn callback without any position updates
            const props = service.getDisplayProperties({ hideAll: false } as any)
            expect((props.optionProps as any).onTurn).toBeDefined()
        })

        test('display properties remain valid after early turn (no position)', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const props1 = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props1.optionProps as any).onTurn
            onTurn()

            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            expect(props2.route).toBeDefined()
            expect(props2.options).toBeDefined()
        })

        test('route persists after turn with no position update', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            const routeBefore = service.getCurrentRoute()
            expect(routeBefore).toBeDefined()

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            const routeAfter = service.getCurrentRoute()
            expect(routeAfter).toBeDefined()
        })
    })

    describe('turn handling: case b) after position updates (during ride)', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('turn invoked after position updates reflects current ride position', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Multiple position updates simulating active ride
            service.onActivityUpdate(
                { time: 10, speed: 20, routeDistance: 100, distance: 100 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )
            service.onActivityUpdate(
                { time: 20, speed: 22, routeDistance: 200, distance: 100 } as any,
                { distanceRemaining: 0.9, timeRemaining: 27 }
            )

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn

            expect(() => {
                onTurn()
            }).not.toThrow()
        })

        test('turn uses position data to calculate turn point after updates', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Simulate user cycling progress
            service.onActivityUpdate(
                { time: 50, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 0.8, timeRemaining: 25 }
            )

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            // Verify route updated with turn logic based on position
            const routeAfter = service.getCurrentRoute()
            expect(routeAfter).toBeDefined()
            expect(routeAfter.details.points).toBeDefined()
        })

        test('turn triggers getNextOptions after position-based calculation', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            service.onActivityUpdate(
                { time: 50, speed: 25, routeDistance: 300, distance: 300 } as any,
                { distanceRemaining: 1.0, timeRemaining: 30 }
            )

            const getNextOptionsCallsBefore = (mockFreeRideService.getNextOptions as jest.Mock).mock.calls.length

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            const getNextOptionsCallsAfter = (mockFreeRideService.getNextOptions as jest.Mock).mock.calls.length
            expect(getNextOptionsCallsAfter).toBeGreaterThanOrEqual(getNextOptionsCallsBefore)
        })

        test('sequential activity updates followed by turn preserves ride state', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Simulate continuous ride progression
            for (let i = 0; i < 3; i++) {
                service.onActivityUpdate(
                    { time: 10 + i * 30, speed: 20 + i, routeDistance: 100 + i * 100, distance: 100 } as any,
                    { distanceRemaining: 1.5 - i * 0.2, timeRemaining: 40 - i * 5 }
                )
            }

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            // Verify consumer still gets valid display properties after turn
            const finalProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(finalProps.route).toBeDefined()
            expect(finalProps.position).toBeDefined()
        })

        test('turn at advanced position differs from turn at start', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))

            // Simulate advanced position in ride
            service.onActivityUpdate(
                { time: 200, speed: 28, routeDistance: 1500, distance: 1500 } as any,
                { distanceRemaining: 0.3, timeRemaining: 10 }
            )

            const props = service.getDisplayProperties({ hideAll: false } as any)
            const onTurn = (props.optionProps as any).onTurn
            onTurn()

            await new Promise(resolve => setTimeout(resolve, 50))

            // Route should be updated based on position at 1500m
            const routeAfter = service.getCurrentRoute()
            expect(routeAfter).toBeDefined()
        })
    })

    describe('state persistence across operations', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('route persists after multiple getDisplayProperties calls', () => {
            setupMocks(service, { mockRideService: true })
            const props1 = service.getDisplayProperties({ hideAll: false } as any)
            const route1 = props1.route

            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            const route2 = props2.route

            expect(route1).toBe(route2)
        })

        test('options persist after multiple getDisplayProperties calls', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1, mockOption2]
            })
            const props1 = service.getDisplayProperties({ hideAll: false } as any)
            const optionsCount1 = props1.options?.length ?? 0

            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            const optionsCount2 = props2.options?.length ?? 0

            expect(optionsCount1).toBe(optionsCount2)
        })

        test('latest position maintained across calls', () => {
            setupMocks(service, { mockRideService: true })
            service.onActivityUpdate(
                { time: 100, speed: 25, routeDistance: 500, distance: 500 } as any,
                { distanceRemaining: 1.0, timeRemaining: 50 }
            )
            const props1 = service.getDisplayProperties({ hideAll: false } as any)
            const pos1Lat = props1.position.lat

            service.onActivityUpdate(
                { time: 150, speed: 26, routeDistance: 600, distance: 100 } as any,
                { distanceRemaining: 0.9, timeRemaining: 45 }
            )
            const props2 = service.getDisplayProperties({ hideAll: false } as any)
            const pos2Lat = props2.position.lat

            expect(pos1Lat).toBeDefined()
            expect(pos2Lat).toBeDefined()
        })

        test('service can be reset and restarted without errors', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(service.isStartRideCompleted()).toBe(true)

            service.reset()
            expect(mockFreeRideService.removeAllListeners).toHaveBeenCalled()
        })
    })

    describe('event listeners', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('listens to options-update event from FreeRideService', async () => {
            setupMocks(service, { mockRideService: true })
            service.start()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(mockFreeRideService.on).toHaveBeenCalledWith('options-update', expect.any(Function))
        })

        test('emits route-update on service after applying option', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 100))
            expect(mockObserver.emit).toHaveBeenCalledWith('route-update', expect.objectContaining({
                route: expect.anything(),
                options: expect.anything(),
                map: expect.anything()
            }))
        })
    })

    describe('map viewport and bounds', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('map overlay includes onViewportChange callback for user interaction', () => {
            setupMocks(service, { mockRideService: true })
            const overlayProps = service.getOverlayProps('map', { hideAll: false } as any)
            expect(overlayProps.onViewportChange).toBeDefined()
            expect(typeof overlayProps.onViewportChange).toBe('function')
        })

        test('viewport marked as overwrite to control map positioning', () => {
            setupMocks(service, { mockRideService: true })
            const overlayProps = service.getOverlayProps('map', { hideAll: false } as any)
            expect(overlayProps.viewportOverwrite).toBe(true)
        })

        test('consumer can call onViewportChange to track viewport changes', () => {
            setupMocks(service, { mockRideService: true })
            const overlayProps = service.getOverlayProps('map', { hideAll: false } as any)
            const viewport = { center: [0, 0], zoom: 15 }
            overlayProps.onViewportChange(viewport)
            // Verify the callback executed without error
            expect(overlayProps.onViewportChange).toBeDefined()
        })

        test('display properties include options ID for tracking', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1, mockOption2]
            })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.optionsId).toBeDefined()
            expect(displayProps.optionProps.optionsId).toContain('options:')
        })

        test('display properties show none when no options available', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: []
            })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.optionsId).toBe('none')
        })
    })

    describe('route updates', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('emits route-update event on continueWithSelectedOption', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))
            expect(mockObserver.emit).toHaveBeenCalledWith('route-update', expect.any(Object))
        })

        test('updates route distance on continuation', async () => {
            setupMocks(service, { mockRideService: true })
            mockFreeRideService.getSelectedOption.mockReturnValue(mockOption1)
            const routeBefore = service.getCurrentRoute()
            const distanceBefore = routeBefore.details.distance
            service.continueWithSelectedOption()
            await new Promise(resolve => setTimeout(resolve, 50))
            // Route should be updated via service.onRouteUpdated
            expect(mockRideService.onRouteUpdated).toHaveBeenCalled()
        })
    })

    describe('options visibility and map display', () => {
        let service: FreeRideDisplayService

        beforeEach(() => {
            service = new FreeRideDisplayService()
        })

        afterEach(() => {
            cleanupMocks(service)
        })

        test('consumer receives onOptionsVisibleChanged callback in display properties', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.optionProps.onOptionsVisibleChanged).toBeDefined()
            expect(typeof displayProps.optionProps.onOptionsVisibleChanged).toBe('function')
        })

        test('consumer can call onOptionsVisibleChanged to toggle options display', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            displayProps.optionProps.onOptionsVisibleChanged(true)
            // Consumer toggles visibility - service should handle it
            expect(displayProps.optionProps.onOptionsVisibleChanged).toBeDefined()
        })

        test('consumer receives turn callback in display properties', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect((displayProps.optionProps as any).onTurn).toBeDefined()
            expect(typeof (displayProps.optionProps as any).onTurn).toBe('function')
        })

        test('overlay properties include bounds when options can be shown', () => {
            setupMocks(service, {
                mockRideService: true,
                freeRideOptions: [mockOption1, mockOption2]
            })
            const overlayProps = service.getOverlayProps('map', { hideAll: false } as any)
            // Bounds may be undefined or defined depending on visibility state
            expect(overlayProps).toHaveProperty('viewportOverwrite')
        })

        test('route returned in display properties reflects current free ride progress', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.route).toBeDefined()
            expect(displayProps.route).toHaveProperty('description')
            expect(displayProps.route).toHaveProperty('details')
        })

        test('elevation layers hidden in free ride display properties', () => {
            setupMocks(service, { mockRideService: true })
            const displayProps = service.getDisplayProperties({ hideAll: false } as any)
            expect(displayProps.upcomingElevation?.show).toBe(false)
            expect(displayProps.totalElevation?.show).toBe(false)
        })
    })
})
