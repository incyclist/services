import { Inject } from "../../../base/decorators"
import { Observer } from "../../../base/types/observer"
import { Workout } from "../../base/model"
import { WorkoutRidePageService } from "./service"

let MockRideDisplay
let MockWorkoutRide
let MockActivityRide
let MockAppState
let MockBindings
let MockUserSettings

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
        powerDown: jest.fn(),
        getLoadButtonMode: jest.fn().mockReturnValue('power')
    }
    MockActivityRide = {
        getActivity: jest.fn().mockReturnValue({ logs: [], time: 0 }),
        getCurrentValues: jest.fn().mockReturnValue({ cadence: 0 })
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
    MockUserSettings = {
        get: jest.fn((_key: string, defValue: unknown) => defValue),
        set: jest.fn()
    }

    Inject('RideDisplay', MockRideDisplay)
    Inject('WorkoutRide', MockWorkoutRide)
    Inject('ActivityRide', MockActivityRide)
    Inject('AppState', MockAppState)
    Inject('Bindings', MockBindings)
    Inject('UserSettings', MockUserSettings)
}

const resetMocks = () => {
    Inject('RideDisplay', null)
    Inject('WorkoutRide', null)
    Inject('ActivityRide', null)
    Inject('AppState', null)
    Inject('Bindings', null)
    Inject('UserSettings', null)
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

        test('registers observer handlers and starts the ride, without re-initializing RideDisplay', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)

            const result = s.openPage(true)

            // RideDisplayService is already initialized by RidePage.tsx's
            // getRidePageService().initPage() before WorkoutRidePage can ever mount - calling
            // init() again here would race with start() and tear the ride back down mid-connect
            // (closePrevRide() sees the already-set observer and calls stopRide()).
            expect(MockRideDisplay.init).not.toHaveBeenCalled()
            expect(MockRideDisplay.start).toHaveBeenCalledWith(true)
            expect(result).toBeDefined()
        })

        test('never calls init() across repeated openPage calls',()=>{
            MockRideDisplay.getObserver.mockReturnValue(new Observer())
            s.openPage()
            s.openPage()
            expect(MockRideDisplay.init).not.toHaveBeenCalled()
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

            expect(MockRideDisplay.stop).toHaveBeenCalled()

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
                time: 70, duration: 120, remaining: 50, targetPower: 150, minPower: 150, maxPower: 150,
                step: { type: 'step', duration: 120, steady: true, power: { type: 'watt', min: 150, max: 150 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 70 })

            const props = s.getPageDisplayProps()

            expect(props.title).toBe('Test Workout')
            expect(props.rideState).toBe('Active')
            expect(props.rideType).toBe('Workout')
            expect(props.startOverlayProps).toBeNull()

            expect(props.dashboard).toEqual({ text: '150W for 2min - Test Workout', mode: null })

            expect(props.steps.previous).toEqual({ label: '200W', targetPower: 200, duration: 60, remaining: null, isCurrent: false })
            expect(props.steps.current).toEqual({ label: '150W', targetPower: 150, duration: 120, remaining: 50, isCurrent: true })
            expect(props.steps.upcoming).toEqual([
                { label: '100W', targetPower: 100, duration: 90, remaining: null, isCurrent: false }
            ])
            expect(props.steps.hasMore).toBe(false)

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

        // Regression (FIXES_BACKLOG #13): WorkoutRide.getStepTitle() is now platform-aware - on
        // mobile it never includes the workout name to begin with (desktop/web still gets it
        // prefixed, see WorkoutRide.unit.test.ts), so the page service no longer needs to
        // transform `title` at all; both the `title` prop and the dashboard line just consume it
        // as-is.
        test('passes the mobile-formatted title and dashboard text through unchanged', () => {
            const current = makeCurrentWorkout()
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                workout: { name: 'VO2 Max Intervals' },
                title: 'Sprint(2/5)',
                ftp: 250, mode: null, canShowBackward: true, canShowForward: true
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 70, duration: 120, remaining: 50, targetPower: 150, minPower: 150, maxPower: 150,
                step: { type: 'step', duration: 120, steady: true, power: { type: 'watt', min: 150, max: 150 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 70 })

            const props = s.getPageDisplayProps()

            expect(props.title).toBe('Sprint(2/5)')
            expect(props.dashboard).toEqual({ text: '150W for 2min - Sprint(2/5)', mode: null })
        })

        test('passes the "free" title through unchanged', () => {
            const current = makeCurrentWorkout()
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                workout: { name: 'VO2 Max Intervals' },
                title: 'free',
                ftp: 250, mode: null, canShowBackward: true, canShowForward: true
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 70, duration: 120, remaining: 50, targetPower: 150, minPower: 150, maxPower: 150,
                step: { type: 'step', duration: 120, steady: true, power: { type: 'watt', min: 150, max: 150 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 70 })

            const props = s.getPageDisplayProps()

            expect(props.title).toBe('free')
            expect(props.dashboard).toEqual({ text: '150W for 2min - free', mode: null })
        })

        // Regression (FIXES_BACKLOG #13 follow-up, confirmed on a real ride, .zwo IntervalsT block):
        // when the current segment AND step both have no text, WorkoutRide.getStepTitle() (mobile
        // channel) returns just the bare repeat suffix, e.g. "(1/3)" - buildDashboardLine() already
        // shows "<target> for <duration>" separately, so a bare suffix like this must attach
        // directly with no " - " separator (it isn't a standalone title).
        test('attaches a bare repeat suffix directly, with no separator', () => {
            const current = makeCurrentWorkout()
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                workout: { name: 'Threshold Starter – 2x8min' },
                title: '(1/3)',
                ftp: 200, mode: null, canShowBackward: true, canShowForward: true
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 25, duration: 30, remaining: 5, targetPower: 180, minPower: 180, maxPower: 180,
                step: { type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 180, max: 180 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 25 })

            const props = s.getPageDisplayProps()

            expect(props.title).toBe('(1/3)')
            expect(props.dashboard).toEqual({ text: '180W for 30s(1/3)', mode: null })
        })

        // Regression: outside any segment, WorkoutRide.getStepTitle() (mobile channel) falls back
        // to the verbal description itself ("<target> for <duration>", no repeat context to show
        // instead) - since that's the exact same phrase buildDashboardLine() already computes, it
        // must not be appended a second time.
        test('does not duplicate the verbal description when title equals the already-computed target/duration text', () => {
            const current = makeCurrentWorkout()
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                workout: { name: 'Threshold Starter – 2x8min' },
                title: '180W for 30s',
                ftp: 200, mode: null, canShowBackward: true, canShowForward: true
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 25, duration: 30, remaining: 5, targetPower: 180, minPower: 180, maxPower: 180,
                step: { type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 180, max: 180 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 25 })

            const props = s.getPageDisplayProps()

            expect(props.title).toBe('180W for 30s')
            expect(props.dashboard).toEqual({ text: '180W for 30s', mode: null })
        })

        // Regression: a ramp step's live limits collapse min===max to the instantaneous ERG
        // target (Step.calc() interpolates a single Watt value for cycling-mode control) - the
        // current-step label and dashboard text must still describe the full ramp range from the
        // raw step definition (`limits.step`), not that flattened instantaneous value.
        test('ramp step -> current label and dashboard text show the Ramp range, not the flat instantaneous target', () => {
            const current = new Workout({
                type: 'workout', name: 'Ramp Workout',
                steps: [
                    { type: 'step', duration: 600, steady: false, cooldown: false, power: { type: 'watt', min: 100, max: 140 } }
                ]
            })
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                title: 'Ramp Workout', ftp: 250, mode: null, canShowBackward: false, canShowForward: true
            })
            // Step.calc() interpolates min===max===120 (the instantaneous ERG target) at the
            // halfway point of the ramp - only `step` still carries the original 100/140 range.
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 300, duration: 600, remaining: 300, targetPower: 120, minPower: 120, maxPower: 120,
                step: { type: 'step', duration: 600, steady: false, cooldown: false, power: { type: 'watt', min: 100, max: 140 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 300 })

            const props = s.getPageDisplayProps()

            expect(props.steps.current).toEqual({ label: 'Ramp 100-140W', targetPower: 120, duration: 600, remaining: 300, isCurrent: true })
            expect(props.dashboard).toEqual({ text: 'Ramp 100-140W for 10min - Ramp Workout', mode: null })
        })

        test('no current workout -> empty graph/steps, still returns base props', () => {
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: undefined, state: 'Active' })

            const props = s.getPageDisplayProps()

            expect(props.graph).toEqual({ bars: [], ftp: 0, ftpLine: 0, domain: { x: [0, 0], y: [0, 0] } })
            expect(props.steps).toEqual({ previous: null, current: null, upcoming: [], hasMore: false })
        })

        // Regression (Android Vitals OOM): a malformed step duration (e.g. from a bad workout
        // import) propagates NaN through Segment.duration/bar.x. graph.domain.x must stay finite -
        // a NaN domain bound reaches the mobile graph's <Path> "d" strings, which can fatally
        // OutOfMemoryError react-native-svg's native path parser on Android.
        test('malformed step duration (NaN) does not leak into graph.domain.x', () => {
            const current = new Workout({
                type: 'workout', name: 'Corrupt Workout',
                steps: [
                    { type: 'step', duration: NaN, steady: true, power: { type: 'watt', min: 200, max: 200 } }
                ]
            })
            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                title: 'Corrupt Workout', ftp: 250, mode: null, canShowBackward: true, canShowForward: true
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 0, duration: 0, remaining: 0, targetPower: 200, minPower: 200, maxPower: 200,
                step: { type: 'step', duration: NaN, steady: true, power: { type: 'watt', min: 200, max: 200 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 0 })

            const props = s.getPageDisplayProps()

            expect(Number.isFinite(props.graph.domain.x[1])).toBe(true)
        })

        test('steps are built from the FLATTENED (repeat-expanded) sequence, not one blob per segment', () => {
            // warmup (0-30, 150W) -> [40s work @200W / 20s rest @100W] x3 (30-210) -> cooldown (210-240, 120W)
            const current = new Workout({
                type: 'workout', name: 'Intervals',
                steps: [{ type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 150, max: 150 } }]
            })
            current.addSegment({
                type: 'segment', repeat: 3, steps: [
                    { type: 'step', duration: 40, steady: true, work: true, power: { type: 'watt', min: 200, max: 200 } },
                    { type: 'step', duration: 20, steady: true, work: false, power: { type: 'watt', min: 100, max: 100 } }
                ]
            })
            current.addStep({ type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 120, max: 120 } })

            MockRideDisplay.getDisplayProperties.mockReturnValue({ workout: current, state: 'Active' })
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({ title: 'Intervals', ftp: 250, mode: null })
            // elapsed time 105s -> inside the 2nd repetition's "work" step (90-130)
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 105, duration: 40, remaining: 35, targetPower: 200, minPower: 200, maxPower: 200,
                step: { type: 'step', duration: 40, steady: true, work: true, power: { type: 'watt', min: 200, max: 200 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 105 })

            const props = s.getPageDisplayProps()

            // previous = 1st repetition's "rest" step (60-100), not the whole segment
            expect(props.steps.previous).toEqual({ label: '100W', targetPower: 100, duration: 20, remaining: null, isCurrent: false })
            expect(props.steps.current).toEqual({ label: '200W', targetPower: 200, duration: 40, remaining: 35, isCurrent: true })
            // next 3 flattened entries: 2nd rep's rest, 3rd rep's work, 3rd rep's rest - individually, not the segment as a whole
            expect(props.steps.upcoming).toEqual([
                { label: '100W', targetPower: 100, duration: 20, remaining: null, isCurrent: false },
                { label: '200W', targetPower: 200, duration: 40, remaining: null, isCurrent: false },
                { label: '100W', targetPower: 100, duration: 20, remaining: null, isCurrent: false }
            ])
            // the cooldown step still follows beyond the 3 shown -> more to come
            expect(props.steps.hasMore).toBe(true)
        })
    })

    describe('getPageDisplayProps - loadIncrement', () => {

        test('reads preferences.workouts.loadIncrement via UserSettings, default 1', () => {
            MockUserSettings.get.mockImplementation((_key: string, defValue: unknown) => defValue)

            expect(s.getPageDisplayProps().loadIncrement).toBe(1)
            expect(MockUserSettings.get).toHaveBeenCalledWith('preferences.workouts.loadIncrement', 1)
        })

        test('reflects a stored value', () => {
            MockUserSettings.get.mockImplementation((key: string, defValue: unknown) => key === 'preferences.workouts.loadIncrement' ? 7 : defValue)

            expect(s.getPageDisplayProps().loadIncrement).toBe(7)
        })
    })

    describe('onSetLoadIncrement', () => {
        test('writes preferences.workouts.loadIncrement via UserSettings - same key onIncreaseLoad/onDecreaseLoad and the swipe gesture read', () => {
            s.onSetLoadIncrement(3)
            expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.workouts.loadIncrement', 3)
        })

        test('emits page-update', () => {
            const updateSpy = jest.fn()
            s.openPage()
            s.getPageObserver().on('page-update', updateSpy)

            s.onSetLoadIncrement(3)

            expect(updateSpy).toHaveBeenCalled()
        })

        test('logs and swallows errors from UserSettings', () => {
            MockUserSettings.set.mockImplementation(() => { throw new Error('boom') })

            expect(() => s.onSetLoadIncrement(3)).not.toThrow()
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('getPageDisplayProps - gestureHint', () => {

        beforeEach(() => {
            // start overlay cleared, no pedaling yet, hint flag unset - the "visible" baseline
            MockRideDisplay.getState.mockReturnValue('Active')
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 0 })
            MockActivityRide.getCurrentValues.mockReturnValue({ cadence: 0 })
            MockUserSettings.get.mockImplementation((_key: string, defValue: unknown) => defValue)
        })

        test('visible when start overlay cleared, elapsed time is 0, cadence is 0, and the flag is unset', () => {
            expect(s.getPageDisplayProps().gestureHint).toEqual({ visible: true })
        })

        test('hidden while the start overlay is still showing', () => {
            MockRideDisplay.getState.mockReturnValue('Starting')
            expect(s.getPageDisplayProps().gestureHint).toBeNull()
        })

        test('hidden once elapsed ride time is non-zero', () => {
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 5 })
            expect(s.getPageDisplayProps().gestureHint).toBeNull()
        })

        test('hidden once cadence is non-zero', () => {
            MockActivityRide.getCurrentValues.mockReturnValue({ cadence: 40 })
            expect(s.getPageDisplayProps().gestureHint).toBeNull()
        })

        test('hidden when the persisted hint flag is already set', () => {
            MockUserSettings.get.mockImplementation((key: string, defValue: unknown) => key === 'hints.workoutRideGestures' ? true : defValue)
            expect(s.getPageDisplayProps().gestureHint).toBeNull()
        })
    })

    describe('onGestureHintDismissed', () => {

        beforeEach(() => {
            MockRideDisplay.getState.mockReturnValue('Active')
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 0 })
            MockActivityRide.getCurrentValues.mockReturnValue({ cadence: 0 })
            MockUserSettings.get.mockImplementation((_key: string, defValue: unknown) => defValue)
            s.openPage()
        })

        test('without dontShowAgain: hides the overlay for this ride, does not persist the flag', () => {
            expect(s.getPageDisplayProps().gestureHint).toEqual({ visible: true })

            s.onGestureHintDismissed({ dontShowAgain: false })

            expect(MockUserSettings.set).not.toHaveBeenCalled()
            expect(s.getPageDisplayProps().gestureHint).toBeNull()
        })

        test('with dontShowAgain: hides the overlay for this ride and persists the flag', () => {
            s.onGestureHintDismissed({ dontShowAgain: true })

            expect(MockUserSettings.set).toHaveBeenCalledWith('hints.workoutRideGestures', true)
            expect(s.getPageDisplayProps().gestureHint).toBeNull()
        })

        test('emits page-update', () => {
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onGestureHintDismissed({ dontShowAgain: false })

            expect(updateSpy).toHaveBeenCalled()
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

        // Regression: the mobile swipe gesture feedback needs to know which quantity was adjusted
        // ("+5% (FTP: 220W)" vs "+5% (155W)") - adjustLoad() must forward whatever
        // WorkoutRide.powerUp()/powerDown() reports verbatim, rather than swallowing it as void.
        test('returns the {type:"ftp"} result reported by powerUp', () => {
            MockWorkoutRide.powerUp.mockReturnValue({ type: 'ftp', value: 220 })
            const result = s.adjustLoad(5)
            expect(result).toEqual({ type: 'ftp', value: 220 })
        })

        test('returns the {type:"targetPower"} result reported by powerDown', () => {
            MockWorkoutRide.powerDown.mockReturnValue({ type: 'targetPower', value: 145 })
            const result = s.adjustLoad(-5)
            expect(result).toEqual({ type: 'targetPower', value: 145 })
        })

        test('returns undefined when the underlying call throws', () => {
            MockWorkoutRide.powerUp.mockImplementation(() => { throw new Error('boom') })
            const result = s.adjustLoad(5)
            expect(result).toBeUndefined()
        })

        test('onIncreaseLoad / onDecreaseLoad fall back to the default increment when nothing is stored', () => {
            s.onIncreaseLoad()
            s.onDecreaseLoad()
            expect(MockWorkoutRide.powerUp).toHaveBeenCalledWith(1)
            expect(MockWorkoutRide.powerDown).toHaveBeenCalledWith(1)
        })

        // Regression test (6.1 integration pass): onIncreaseLoad/onDecreaseLoad previously
        // hardcoded DEFAULT_LOAD_INCREMENT instead of reading the live
        // preferences.workouts.loadIncrement setting - silently diverging from the swipe gesture
        // (useWorkoutRideGestures.ts, which already read the live value) the moment a user
        // changed the increment via WorkoutSettingsDialog (session 5.10). Per
        // workout-ride-page-service-design.md §6.5: "The menu 'Increase Load' action uses the
        // same increment" as the swipe gesture.
        test('onIncreaseLoad / onDecreaseLoad use the live, user-configured loadIncrement setting, not a hardcoded default', () => {
            MockUserSettings.get.mockImplementation((key: string, defValue: unknown) => key === 'preferences.workouts.loadIncrement' ? 7 : defValue)

            s.onIncreaseLoad()
            s.onDecreaseLoad()

            expect(MockWorkoutRide.powerUp).toHaveBeenCalledWith(7)
            expect(MockWorkoutRide.powerDown).toHaveBeenCalledWith(7)
        })
    })

    // FIXES_BACKLOG #37: useWorkoutRideGestures.ts's swipe handler needs a way to know, at swipe
    // time, whether a load-adjust gesture currently means power/FTP, gear, or nothing at all - this
    // is a thin passthrough to WorkoutRide.getLoadButtonMode() (the single source of truth), so
    // mobile only ever talks to the page service, never the domain service directly.
    describe('getLoadButtonMode', () => {
        test.each(['power', 'gear', 'hidden'] as const)('forwards WorkoutRide.getLoadButtonMode() verbatim (%s)', (mode) => {
            MockWorkoutRide.getLoadButtonMode.mockReturnValue(mode)
            expect(s.getLoadButtonMode()).toBe(mode)
        })

        test('returns "power" (fail safe) when the underlying call throws', () => {
            MockWorkoutRide.getLoadButtonMode.mockImplementation(() => { throw new Error('boom') })
            expect(s.getLoadButtonMode()).toBe('power')
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('getPageDisplayProps - loadButtonMode', () => {
        test.each(['power', 'gear', 'hidden'] as const)('surfaces WorkoutRide.getDashboardDisplayProperties().loadButtonMode verbatim (%s)', (mode) => {
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({ loadButtonMode: mode })
            const props = s.getPageDisplayProps()
            expect(props.loadButtonMode).toBe(mode)
        })

        test('defaults to "power" when the workout dashboard props do not report a mode', () => {
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({})
            const props = s.getPageDisplayProps()
            expect(props.loadButtonMode).toBe('power')
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

        // regression: the overlay must keep refreshing (devicesState, readyToStart) while devices
        // connect - 'Starting'/'Started' have no dedicated menuProps handling, but must still
        // trigger a page-update, unlike 'Finished' which intentionally navigates away instead.
        test('Starting -> page-update (start overlay must keep refreshing while devices connect)', () => {
            rideObserver.emit('state-update', 'Starting')
            expect(updateSpy).toHaveBeenCalled()
        })

        test('Started -> page-update (so the overlay can close once the ride is actually ready)', () => {
            rideObserver.emit('state-update', 'Started')
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
            expect(updateSpy).toHaveBeenCalled()
            const menuProps = s.getPageDisplayProps().menuProps
            expect(menuProps).toMatchObject({ showResume: false, finished: true })

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
