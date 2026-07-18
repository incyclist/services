import { Inject } from "../../../base/decorators"
import { Observer } from "../../../base/types/observer"
import { Workout } from "../../base/model"
import { WorkoutRidePageService } from "./service"

let MockRideDisplay
let MockWorkoutRide
let MockActivityRide
let MockAppState
let MockBindings

const makeCurrentWorkout = () => new Workout({
    type: 'workout', name: 'Test Workout',
    steps: [
        { type: 'step', duration: 60, steady: true, power: { type: 'watt', min: 200, max: 200 } },
        { type: 'step', duration: 120, steady: true, power: { type: 'watt', min: 150, max: 150 } },
        { type: 'step', duration: 90, steady: true, power: { type: 'watt', min: 100, max: 100 } }
    ]
})

const setupMocks = () => {
    MockRideDisplay = {
        init: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        backward: jest.fn(),
        forward: jest.fn(),
        retryStart: jest.fn(),
        startWithMissingSensors: jest.fn(),
        cancelStart: jest.fn().mockResolvedValue(undefined),
        getObserver: jest.fn(),
        getRideType: jest.fn().mockReturnValue('Workout'),
        getState: jest.fn().mockReturnValue('Active'),
        getStartOverlayProps: jest.fn().mockReturnValue({ mode: 'Workout', rideState: 'Starting', devices: [], readyToStart: false }),
        getDisplayProperties: jest.fn().mockReturnValue({ workout: undefined, state: 'Active' })
    }
    MockWorkoutRide = {
        getObserver: jest.fn(),
        getDashboardDisplayProperties: jest.fn().mockReturnValue({}),
        getCurrentLimits: jest.fn(),
        powerUp: jest.fn(),
        powerDown: jest.fn()
    }
    MockActivityRide = {
        getActivity: jest.fn().mockReturnValue({ logs: [], time: 0 })
    }
    MockAppState = {
        hasFeature: jest.fn().mockReturnValue(true),
        getState: jest.fn(),
        setState: jest.fn(),
        getPersistedState: jest.fn(),
        setPersistedState: jest.fn()
    }
    MockBindings = {
        ui: { openPage: jest.fn() }
    }

    Inject('RideDisplay', MockRideDisplay)
    Inject('WorkoutRide', MockWorkoutRide)
    Inject('ActivityRide', MockActivityRide)
    Inject('AppState', MockAppState)
    Inject('Bindings', MockBindings)
}

const resetMocks = () => {
    Inject('RideDisplay', null)
    Inject('WorkoutRide', null)
    Inject('ActivityRide', null)
    Inject('AppState', null)
    Inject('Bindings', null)
}

describe('WorkoutRidePageService', () => {

    let s: WorkoutRidePageService

    beforeEach(() => {
        setupMocks()
        s = new WorkoutRidePageService()
        s.logError = jest.fn()
    })

    afterEach(() => {
        resetMocks()
        s.reset()
        jest.useRealTimers()
    })

    describe('openPage', () => {

        test('initializes the ride, registers observer handlers, starts the ride', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)

            const result = s.openPage(true)

            expect(MockRideDisplay.init).toHaveBeenCalled()
            expect(MockRideDisplay.start).toHaveBeenCalledWith(true)
            expect(result).toBeDefined()
        })

        test('does not call init() again on a second openPage', () => {
            MockRideDisplay.getObserver.mockReturnValue(new Observer())
            s.openPage()
            s.openPage()
            expect(MockRideDisplay.init).toHaveBeenCalledTimes(1)
        })

        test('subscribes to the workout observer immediately if already available', () => {
            const workoutObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(new Observer())
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)

            s.openPage()

            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
            workoutObserver.emit('update')
            expect(updateSpy).toHaveBeenCalled()
        })

        test('defers workout-observer subscription until it becomes available on a ride state-update', () => {
            const rideObserver = new Observer()
            const workoutObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            MockWorkoutRide.getObserver.mockReturnValue(undefined)

            s.openPage()

            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            // workout observer becomes available only once the ride has started
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)
            rideObserver.emit('state-update', 'Active')
            updateSpy.mockClear()

            workoutObserver.emit('step-changed')
            expect(updateSpy).toHaveBeenCalled()
        })
    })

    describe('closePage', () => {
        test('stops the ride and unregisters observer handlers', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            s.openPage()

            s.closePage()

            expect(MockRideDisplay.stop).toHaveBeenCalledWith(true)

            // handlers detached -> no page-update on a subsequent state-update
            const updateSpy = jest.fn()
            s.getPageObserver()?.on('page-update', updateSpy)
            rideObserver.emit('state-update', 'Active')
            expect(updateSpy).not.toHaveBeenCalled()
        })
    })

    describe('pausePage / resumePage', () => {
        beforeEach(() => { jest.useFakeTimers() })

        test('pausePage() starts a background grace timer that auto-pauses the ride', () => {
            s.pausePage()
            jest.advanceTimersByTime(300000)
            expect(MockRideDisplay.pause).toHaveBeenCalledWith('device')
        })

        test('resumePage() cancels the grace timer before it fires', () => {
            s.pausePage()
            s.resumePage()
            jest.advanceTimersByTime(300000)
            expect(MockRideDisplay.pause).not.toHaveBeenCalled()
        })
    })

    describe('getPageDisplayProps', () => {

        test('wrong ride type -> falls back to error props and logs', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')

            const props = s.getPageDisplayProps()

            expect(props.rideState).toBe('Error')
            expect(s.logError).toHaveBeenCalled()
        })

        test('composes base + workout + graph + steps + dashboard from the live services', () => {
            const current = makeCurrentWorkout()
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                title: 'Test Workout', ftp: 250, mode: null, canShowBackward: true, canShowForward: true
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 70, duration: 120, remaining: 50, targetPower: 150, minPower: 150, maxPower: 150
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 70 })

            const props = s.getPageDisplayProps()

            expect(props.title).toBe('Test Workout')
            expect(props.rideState).toBe('Active')
            expect(props.rideType).toBe('Workout')
            expect(props.startOverlayProps).toBeNull()

            expect(props.dashboard).toEqual({ targetPower: 150, targetDuration: 120, remaining: 50, text: 'Test Workout', mode: null })

            expect(props.steps.current).toEqual({ label: '150W', targetPower: 150, duration: 120, remaining: 50, isCurrent: true })
            expect(props.steps.upcoming).toEqual([
                { label: '100W (40%)', targetPower: 100, duration: 90, remaining: null, isCurrent: false }
            ])

            expect(props.graph.ftp).toBe(250)
            expect(props.graph.ftpLine).toBe(250)
            expect(props.graph.domain.x).toEqual([0, 270])
            expect(props.graph.domain.y[0]).toBe(0)
            expect(props.graph.domain.y[1]).toBeCloseTo(220)
            expect(props.graph.bars).toEqual([
                { x0: 0, x: 60, y: 200, y0: 0, zone: 3 },
                { x0: 60, x: 180, y: 150, y0: 0, zone: 2 },
                { x0: 180, x: 270, y: 100, y0: 0, zone: 1 }
            ])
        })

        test('no current workout -> empty graph/steps, still returns base props', () => {
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: undefined, state: 'Active' })

            const props = s.getPageDisplayProps()

            expect(props.graph).toEqual({ bars: [], ftp: 0, ftpLine: 0, domain: { x: [0, 0], y: [0, 0] } })
            expect(props.steps).toEqual({ current: null, upcoming: [] })
        })
    })

    describe('getGraphActuals', () => {

        test('before the ride is active -> empty series', () => {
            MockRideDisplay.getState.mockReturnValue('Starting')
            expect(s.getGraphActuals()).toEqual({ power: [], heartrate: [], position: 0 })
        })

        test('maps logs to power/heartrate points, skipping undefined values, and reports elapsed time as position', () => {
            MockRideDisplay.getState.mockReturnValue('Active')
            MockActivityRide.getActivity.mockReturnValue({
                time: 12,
                logs: [
                    { time: 0, power: 100, heartrate: 120 },
                    { time: 1, power: 110 },                  // no heartrate
                    { time: 2, heartrate: 125 }                // no power
                ]
            })

            expect(s.getGraphActuals()).toEqual({
                power: [{ x: 0, y: 100 }, { x: 1, y: 110 }],
                heartrate: [{ x: 0, y: 120 }, { x: 2, y: 125 }],
                position: 12
            })
        })
    })

    describe('menu callbacks', () => {
        test('onMenuOpen sets menuProps from ride state and step flags, emits page-update', () => {
            MockRideDisplay.getState.mockReturnValue('Paused')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({ canShowBackward: true, canShowForward: true })

            s.openPage()
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onMenuOpen()

            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true, canStepBack: true, canStepForward: true })
            expect(updateSpy).toHaveBeenCalled()
        })

        test('onMenuClose clears menuProps', () => {
            s.openPage()
            s.onMenuOpen()
            s.onMenuClose()
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })
    })

    describe('ride control callbacks', () => {
        test('onPause pauses the ride and opens the menu on Resume', () => {
            s.openPage()
            s.onPause()
            expect(MockRideDisplay.pause).toHaveBeenCalledWith('user')
            expect(s.getPageDisplayProps().menuProps?.showResume).toBe(true)
        })

        test('onResume resumes the ride and closes the menu', () => {
            s.openPage()
            s.onPause()
            s.onResume()
            expect(MockRideDisplay.resume).toHaveBeenCalled()
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        test('onStop stops the ride and emits navigate-back', () => {
            s.openPage()
            const navSpy = jest.fn()
            s.getPageObserver().on('navigate-back', navSpy)

            s.onStop()

            expect(MockRideDisplay.stop).toHaveBeenCalledWith(true)
            expect(navSpy).toHaveBeenCalled()
        })

        test('onStepBack / onStepForward delegate to RideDisplay', () => {
            s.onStepBack()
            s.onStepForward()
            expect(MockRideDisplay.backward).toHaveBeenCalled()
            expect(MockRideDisplay.forward).toHaveBeenCalled()
        })

        test('onRetryStart / onIgnoreStart delegate to RideDisplay', () => {
            s.onRetryStart()
            s.onIgnoreStart()
            expect(MockRideDisplay.retryStart).toHaveBeenCalled()
            expect(MockRideDisplay.startWithMissingSensors).toHaveBeenCalled()
        })

        test('onCancelStart stops the ride observer, cancels the start, and navigates back', async () => {
            const rideObserver = new Observer()
            const stopSpy = jest.spyOn(rideObserver, 'stop')
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            s.openPage()

            s.onCancelStart()
            await Promise.resolve()
            await Promise.resolve()

            expect(stopSpy).toHaveBeenCalled()
            expect(MockRideDisplay.cancelStart).toHaveBeenCalled()
            expect(MockBindings.ui.openPage).toHaveBeenCalled()
        })
    })

    describe('adjustLoad', () => {
        test('positive delta -> powerUp', () => {
            s.adjustLoad(5)
            expect(MockWorkoutRide.powerUp).toHaveBeenCalledWith(5)
            expect(MockWorkoutRide.powerDown).not.toHaveBeenCalled()
        })

        test('negative delta -> powerDown with the absolute value', () => {
            s.adjustLoad(-5)
            expect(MockWorkoutRide.powerDown).toHaveBeenCalledWith(5)
            expect(MockWorkoutRide.powerUp).not.toHaveBeenCalled()
        })

        test('onIncreaseLoad / onDecreaseLoad use the default increment', () => {
            s.onIncreaseLoad()
            s.onDecreaseLoad()
            expect(MockWorkoutRide.powerUp).toHaveBeenCalledWith(1)
            expect(MockWorkoutRide.powerDown).toHaveBeenCalledWith(1)
        })
    })

    describe('ride observer state-update handling', () => {
        let rideObserver: Observer
        let updateSpy: jest.Mock
        let navSpy: jest.Mock

        beforeEach(() => {
            rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            s.openPage()
            updateSpy = jest.fn()
            navSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
            s.getPageObserver().on('navigate-back', navSpy)
        })

        test('Paused -> menuProps opens with showResume, page-update', () => {
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({ canShowBackward: true, canShowForward: true })
            rideObserver.emit('state-update', 'Paused')

            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true, canStepBack: true, canStepForward: true })
            expect(updateSpy).toHaveBeenCalled()
        })

        test('Active -> menuProps cleared, page-update', () => {
            rideObserver.emit('state-update', 'Active')
            expect(s.getPageDisplayProps().menuProps).toBeNull()
            expect(updateSpy).toHaveBeenCalled()
        })

        test('Finished -> navigate-back only', () => {
            updateSpy.mockClear()
            rideObserver.emit('state-update', 'Finished')
            expect(navSpy).toHaveBeenCalled()
        })

        test('Error -> page-update', () => {
            rideObserver.emit('state-update', 'Error')
            expect(updateSpy).toHaveBeenCalled()
        })
    })

    describe('workout observer event handling', () => {
        let workoutObserver: Observer
        let updateSpy: jest.Mock
        let navSpy: jest.Mock

        beforeEach(() => {
            MockRideDisplay.getObserver.mockReturnValue(new Observer())
            workoutObserver = new Observer()
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)
            s.openPage()
            updateSpy = jest.fn()
            navSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
            s.getPageObserver().on('navigate-back', navSpy)
        })

        test.each(['step-changed', 'update', 'forward', 'backward'])('%s -> page-update', (event) => {
            workoutObserver.emit(event)
            expect(updateSpy).toHaveBeenCalled()
        })

        test.each(['completed', 'stopped'])('%s -> navigate-back', (event) => {
            workoutObserver.emit(event)
            expect(navSpy).toHaveBeenCalled()
        })
    })

    describe('getRideObserver', () => {
        test('returns null before openPage', () => {
            MockRideDisplay.getObserver.mockReturnValue(undefined)
            expect(s.getRideObserver()).toBeNull()
        })

        test('returns the ride observer once available', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            expect(s.getRideObserver()).toBe(rideObserver)
        })
    })
})
