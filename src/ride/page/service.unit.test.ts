import { Inject } from "../../base/decorators"
import { Observer } from "../../base/types/observer"
import { Workout } from "../../workouts/base/model"
import { RidePageService, getRidePageService } from "./service"

let MockRideDisplay
let MockWorkoutRide
let MockActivityRide
let MockAppState
let MockBindings
let MockOnlineStatusMonitoring
let MockUserSettings

const makeCurrentWorkout = () => new Workout({
    type: 'workout', name: 'Test Workout',
    steps: [
        { type: 'step', duration: 60, steady: true, power: { type: 'watt', min: 200, max: 200 } },
        { type: 'step', duration: 120, steady: true, power: { type: 'watt', min: 150, max: 150 } },
        { type: 'step', duration: 90, steady: true, power: { type: 'watt', min: 100, max: 100 } }
    ]
})

const setupMocks = (rideType: string = 'GPX') => {
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
        getRideType: jest.fn().mockReturnValue(rideType),
        getState: jest.fn().mockReturnValue('Idle'),
        getStartOverlayProps: jest.fn().mockReturnValue({ mode: rideType, rideState: 'Idle', devices: [], readyToStart: false }),
        getDisplayProperties: jest.fn().mockReturnValue({ state: 'Idle' })
    }
    MockWorkoutRide = {
        getObserver: jest.fn(),
        getDashboardDisplayProperties: jest.fn().mockReturnValue({}),
        getCurrentLimits: jest.fn(),
        powerUp: jest.fn(),
        powerDown: jest.fn(),
        getLoadButtonMode: jest.fn().mockReturnValue('power'),
        inUse: jest.fn().mockReturnValue(false)
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
        ui: { openPage: jest.fn() },
        appInfo: { getChannel: jest.fn().mockReturnValue('desktop') },
        secret: undefined
    }
    MockOnlineStatusMonitoring = {
        onlineStatus: true
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
    Inject('OnlineStatusMonitoring', MockOnlineStatusMonitoring)
    Inject('UserSettings', MockUserSettings)
}

const resetMocks = () => {
    Inject('RideDisplay', null)
    Inject('WorkoutRide', null)
    Inject('ActivityRide', null)
    Inject('AppState', null)
    Inject('Bindings', null)
    Inject('OnlineStatusMonitoring', null)
    Inject('UserSettings', null)
}

// flush the microtask queue so that already-settled promises' .then() handlers get to run
const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))

describe('RidePageService', () => {

    let s: RidePageService

    beforeEach(() => {
        setupMocks()
        s = new RidePageService()
        s.logError = jest.fn()
    })

    afterEach(() => {
        resetMocks()
        s.reset()
        jest.useRealTimers()
    })

    describe('getRidePageService', () => {
        test('returns the same singleton instance across repeated calls', () => {
            const a = getRidePageService()
            const b = getRidePageService()
            expect(a).toBe(b)
        })
    })

    describe('openPage (Video/GPX)', () => {

        it('does not start the ride before init() has resolved (race condition regression)', async () => {

            let resolveInit: () => void
            const initPromise = new Promise<Observer>(resolve => {
                resolveInit = () => resolve(new Observer())
            })
            MockRideDisplay.init.mockReturnValue(initPromise)

            s.openPage()

            // init() was triggered, but start() must not have run yet - it depends on state
            // that init() (via closePrevRide()) is still in the process of setting up
            expect(MockRideDisplay.init).toHaveBeenCalled()
            expect(MockRideDisplay.start).not.toHaveBeenCalled()

            // let a few microtask turns pass while init() is still pending - start() must
            // continue to not have been called
            await flushPromises()
            await flushPromises()
            expect(MockRideDisplay.start).not.toHaveBeenCalled()

            // now resolve init() (simulating closePrevRide() finishing) and confirm start() runs
            resolveInit()
            await flushPromises()

            expect(MockRideDisplay.start).toHaveBeenCalledTimes(1)
        })

        it('registers ride event handlers against the observer created by init(), not a stale one', async () => {

            const staleObserver = new Observer()
            const staleHandler = jest.fn()
            staleObserver.on('state-update', staleHandler)
            MockRideDisplay.getObserver.mockReturnValue(staleObserver)

            let resolveInit: () => void
            const freshObserver = new Observer()
            const initPromise = new Promise<Observer>(resolve => {
                resolveInit = () => resolve(freshObserver)
            })
            MockRideDisplay.init.mockReturnValue(initPromise)

            s.openPage()

            // simulate init() swapping in the freshly created observer, the way
            // RideDisplayService.init() replaces this.observer after closePrevRide() resolves
            MockRideDisplay.getObserver.mockReturnValue(freshObserver)
            resolveInit()
            await flushPromises()

            // the handler bound as part of openPage() must fire on the fresh observer
            freshObserver.emit('state-update', 'Paused')
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true })

            // and must NOT have been (mistakenly) bound to the stale/previous observer
            expect(staleHandler).not.toHaveBeenCalled()
        })

        it('starts the ride synchronously (no init race) once the page has already been initialized via initPage()', () => {

            (s as any).isInitialized = true

            s.openPage()

            expect(MockRideDisplay.init).not.toHaveBeenCalled()
            expect(MockRideDisplay.start).toHaveBeenCalledTimes(1)
        })

        it('still returns the page observer synchronously even while init() is pending', () => {
            MockRideDisplay.init.mockReturnValue(new Promise(() => { /* never resolves in this test */ }))

            const observer = s.openPage()

            expect(observer).toBeTruthy()
            expect(MockRideDisplay.start).not.toHaveBeenCalled()
        })

        it('logs an error and does not throw if init() rejects', async () => {
            let rejectInit: (err: Error) => void
            const initPromise = new Promise<Observer>((_resolve, reject) => {
                rejectInit = reject
            })
            MockRideDisplay.init.mockReturnValue(initPromise)

            s.openPage()
            rejectInit(new Error('closePrevRide failed'))
            await flushPromises()

            expect(MockRideDisplay.start).not.toHaveBeenCalled()
            expect(s.logError).toHaveBeenCalled()
        })

    })

    describe('openPage (Workout)', () => {

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

        test('registers observer handlers and starts the ride, without re-initializing RideDisplay', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)

            const result = s.openPage(true)

            // RideDisplayService is already initialized by RidePage.tsx's
            // getRidePageService().initPage() call before a Workout page can ever mount - calling
            // init() again here would race with start() and tear the ride back down mid-connect
            // (closePrevRide() sees the already-set observer and calls stopRide()).
            expect(MockRideDisplay.init).not.toHaveBeenCalled()
            expect(MockRideDisplay.start).toHaveBeenCalledWith(true)
            expect(result).toBeDefined()
        })

        test('never calls init() across repeated openPage calls', () => {
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

    // Characterization tests, extended to cover both Ride and Workout against the single merged
    // class (FIXES_BACKLOG #24).
    //
    // NOTE: 'closePage does NOT unregister event handlers' below documents a known bug (closePage()
    // now always unregisters) - that one assertion is expected to have flipped, not remain a
    // permanent regression guard.
    describe('closePage', () => {
        test('stops the ride, clears menuProps, and resets init/observer state', () => {
            s.openPage()
            s.onPause()
            expect(s.getPageDisplayProps().menuProps).not.toBeNull()

            s.closePage()

            expect(MockRideDisplay.stop).toHaveBeenCalled()
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        // FIXES_BACKLOG #24, bug 1/2 (fixed): closePage() always unregisters handlers now, unlike
        // the pre-fix RidePageService.closePage() - was previously left registered, so a stale
        // RideDisplayService-observer listener from a closed page could still mutate state on the
        // next ride.
        test('unregisters event handlers, so a stale ride observer can no longer mutate state after close', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver);
            (s as any).isInitialized = true // skip the async init dance so handlers register synchronously
            s.openPage()

            s.closePage()

            rideObserver.emit('state-update', 'Paused')
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        test('logs and swallows errors', () => {
            MockRideDisplay.stop.mockImplementation(() => { throw new Error('boom') })
            expect(() => s.closePage()).not.toThrow()
            expect(s.logError).toHaveBeenCalled()
        })

        test('Workout: stops the ride and unregisters both ride and workout observer handlers', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
            const rideObserver = new Observer()
            const workoutObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)
            s.openPage()

            s.closePage()

            expect(MockRideDisplay.stop).toHaveBeenCalled()

            const updateSpy = jest.fn()
            s.getPageObserver()?.on('page-update', updateSpy)
            rideObserver.emit('state-update', 'Active')
            workoutObserver.emit('update')
            expect(updateSpy).not.toHaveBeenCalled()
        })
    })

    describe('pausePage / resumePage', () => {
        beforeEach(() => { jest.useFakeTimers() })

        test('pausePage() starts a background grace timer that auto-pauses a Video/GPX ride as "user"', () => {
            s.pausePage()
            jest.advanceTimersByTime(300000)
            expect(MockRideDisplay.pause).toHaveBeenCalledWith('user')
        })

        test('pausePage() starts a background grace timer that auto-pauses a Workout ride as "device"', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
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

        test('pausePage() resets isInitialized, forcing the next openPage() through the init dance again', async () => {
            (s as any).isInitialized = true

            await s.pausePage()

            expect((s as any).isInitialized).toBe(false)
        })
    })

    describe('getRideObserver', () => {
        test('returns null before any ride observer exists', () => {
            MockRideDisplay.getObserver.mockReturnValue(undefined)
            expect(s.getRideObserver()).toBeNull()
        })

        test('returns the ride observer once available', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            expect(s.getRideObserver()).toBe(rideObserver)
        })
    })

    describe('getRideType', () => {
        test('delegates to RideDisplay.getRideType()', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')
            expect(s.getRideType()).toBe('Video')
        })
    })

    describe('getPageDisplayProps - Video/GPX', () => {
        test('Video ride type -> video-specific props', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')
            MockRideDisplay.getState.mockReturnValue('Active')
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Active', video: { id: 'v1' }, route: { id: 'r1' } })

            const props: any = s.getPageDisplayProps()

            expect(props.rideType).toBe('Video')
            expect(props.rideState).toBe('Active')
            expect(props.video).toEqual({ id: 'v1' })
            expect(props.startOverlayProps).toBeNull() // not starting/idle/error
        })

        test('GPX ride type -> gpx-specific props', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockRideDisplay.getState.mockReturnValue('Idle')
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Idle', rideView: 'map' })

            const props: any = s.getPageDisplayProps()

            expect(props.rideType).toBe('GPX')
            expect(props.rideView).toBe('map')
            expect(props.startOverlayProps).toEqual({ mode: 'GPX', rideState: 'Idle', devices: [], readyToStart: false })
        })

        test('unknown/unsupported ride type -> error fallback props', () => {
            MockRideDisplay.getRideType.mockReturnValue('Free-Ride')

            const props = s.getPageDisplayProps()

            expect(props.rideState).toBe('Error')
            expect(props.rideType).toBeNull()
        })

        test('getRideDisplay() throwing -> error fallback props, no throw', () => {
            MockRideDisplay.getRideType.mockImplementation(() => { throw new Error('boom') })
            expect(() => s.getPageDisplayProps()).not.toThrow()
            expect(s.getPageDisplayProps().rideState).toBe('Error')
        })
    })

    describe('getPageDisplayProps - Workout', () => {

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

        // getPageDisplayProps() only ever reaches getWorkoutRideDisplayProps() when
        // getRideDisplay().getRideType() is already 'Workout' (see the switch there) - this
        // guard is defensive protection against a direct call (or a rideType race) rather than
        // something reachable through the public getPageDisplayProps() switch, so it's exercised
        // directly here rather than via getPageDisplayProps().
        test('wrong ride type -> falls back to error props and logs', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')

            const props = (s as any).getWorkoutRideDisplayProps()

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

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

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

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

        test.each(['power', 'gear', 'hidden'] as const)('surfaces WorkoutRide.getDashboardDisplayProperties().loadButtonMode verbatim (%s)', (mode) => {
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({ loadButtonMode: mode })
            const props = s.getPageDisplayProps()
            expect((props as any).loadButtonMode).toBe(mode)
        })

        test('defaults to "power" when the workout dashboard props do not report a mode', () => {
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({})
            const props = s.getPageDisplayProps()
            expect((props as any).loadButtonMode).toBe('power')
        })
    })

    describe('getPageDisplayProps - gestureHint', () => {

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
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
            MockRideDisplay.getRideType.mockReturnValue('Workout')
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

    describe('getGraphActuals', () => {

        test('before the ride is active -> empty series', () => {
            MockRideDisplay.getState.mockReturnValue('Starting')
            MockWorkoutRide.inUse.mockReturnValue(true)
            expect(s.getGraphActuals()).toEqual({ power: [], heartrate: [], position: 0 })
        })

        test('maps logs to power/heartrate points, skipping undefined values, and reports elapsed time as position', () => {
            MockRideDisplay.getState.mockReturnValue('Active')
            MockWorkoutRide.inUse.mockReturnValue(true)
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

    // onMenuOpen()/onMenuClose() genuinely diverge between Video/GPX and Workout (FIXES_BACKLOG
    // #24 review) - Video/GPX's onMenuClose() has a Finished-state special case (navigate away +
    // close the page) that Workout's doesn't have; Workout's menuProps additionally carry
    // canStepBack/canStepForward. Both behaviors are covered separately below.
    describe('menu callbacks (Video/GPX)', () => {
        test('onMenuOpen sets menuProps.showResume from the current ride state, emits page-update', () => {
            MockRideDisplay.getState.mockReturnValue('Paused')
            s.openPage()
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onMenuOpen()

            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true })
            expect(updateSpy).toHaveBeenCalled()
        })

        test('onMenuOpen with an Active ride -> showResume false', () => {
            MockRideDisplay.getState.mockReturnValue('Active')
            s.onMenuOpen()
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: false })
        })

        test('onMenuClose clears menuProps on a normal (non-finished) ride', () => {
            MockRideDisplay.getState.mockReturnValue('Active')
            s.onMenuOpen()
            s.onMenuClose()
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        test('onMenuClose on a Finished ride navigates back to the previous page and closes the page', () => {
            MockRideDisplay.getState.mockReturnValue('Finished')
            s.openPage()

            s.onMenuClose()

            expect(MockBindings.ui.openPage).toHaveBeenCalled()
            expect(MockRideDisplay.stop).toHaveBeenCalled()
        })

        test('onMenuClose with menuProps.finished already set navigates back even if ride state is not Finished', () => {
            MockRideDisplay.getState.mockReturnValue('Active')
            s.openPage();
            (s as any).menuProps = { showResume: false, finished: true }

            s.onMenuClose()

            expect(MockBindings.ui.openPage).toHaveBeenCalled()
        })
    })

    describe('menu callbacks (Workout)', () => {
        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

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

        // Unlike Video/GPX, closing the menu on a Workout ride never navigates away - even when
        // Finished, mobile's RideMenu renders the Activity Summary overlay in place off
        // menuProps.finished; closing the menu just clears menuProps.
        test('onMenuClose clears menuProps, even when finished (no navigation)', () => {
            MockRideDisplay.getState.mockReturnValue('Finished')
            s.openPage()
            s.onMenuOpen();
            (s as any).menuProps = { showResume: false, finished: true, canStepBack: false, canStepForward: false }

            s.onMenuClose()

            expect(s.getPageDisplayProps().menuProps).toBeNull()
            expect(MockBindings.ui.openPage).not.toHaveBeenCalled()
        })
    })

    describe('ride control callbacks (Video/GPX)', () => {
        test('onPause pauses the ride as "user" and opens the menu on Resume', () => {
            s.openPage()
            s.onPause()
            expect(MockRideDisplay.pause).toHaveBeenCalledWith('user')
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true })
        })

        test('onResume resumes the ride and closes the menu', () => {
            s.openPage()
            s.onPause()
            s.onResume()
            expect(MockRideDisplay.resume).toHaveBeenCalled()
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        test('onEndRide stops the ride, navigates back, and closes the page', () => {
            s.openPage()
            s.onEndRide()
            expect(MockRideDisplay.stop).toHaveBeenCalled()
            expect(MockBindings.ui.openPage).toHaveBeenCalled()
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

    describe('ride control callbacks (Workout)', () => {
        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

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

        // FIXES_BACKLOG #24, bug 2/2 (fixed): onStop() -> finishRide() converges onto
        // menuProps.finished (same as the workout-observer 'completed'/'stopped' path) instead of
        // the removed emitNavigateBack()/'navigate-back' event, so a manually-ended workout lands
        // on the Activity Summary too.
        test('onStop stops the ride and sets menuProps to the finished state', () => {
            s.openPage()
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onStop()

            expect(MockRideDisplay.stop).toHaveBeenCalledWith(true)
            expect(s.getPageDisplayProps().menuProps).toMatchObject({ showResume: false, finished: true })
            expect(updateSpy).toHaveBeenCalled()
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
        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
        })

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

    describe('ride observer state-update handling (Video/GPX)', () => {
        let rideObserver: Observer
        let updateSpy: jest.Mock

        beforeEach(() => {
            rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver);
            (s as any).isInitialized = true // skip the async init dance so handlers register synchronously
            s.openPage()
            updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
        })

        test('Paused -> menuProps opens with showResume, page-update', () => {
            rideObserver.emit('state-update', 'Paused')
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true })
            expect(updateSpy).toHaveBeenCalled()
        })

        test('Finished -> menuProps set to finished, page-update (no navigation)', () => {
            rideObserver.emit('state-update', 'Finished')
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: false, finished: true })
            expect(updateSpy).toHaveBeenCalled()
            expect(MockBindings.ui.openPage).not.toHaveBeenCalled()
        })

        test('Active -> menuProps cleared, page-update', () => {
            rideObserver.emit('state-update', 'Active')
            expect(s.getPageDisplayProps().menuProps).toBeNull()
            expect(updateSpy).toHaveBeenCalled()
        })

        test('route-update -> page-update', () => {
            updateSpy.mockClear()
            rideObserver.emit('route-update')
            expect(updateSpy).toHaveBeenCalled()
        })
    })

    describe('ride observer state-update handling (Workout)', () => {
        let rideObserver: Observer
        let updateSpy: jest.Mock

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
            rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            s.openPage()
            updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
        })

        test('Paused -> menuProps opens with showResume + step flags, page-update', () => {
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

        // FIXES_BACKLOG #24, bug 2/2 (fixed): this path used to call emitNavigateBack() directly,
        // bypassing the Activity Summary - it now converges onto menuProps.finished, same as the
        // workout-observer completion path tested below, and no longer navigates away directly.
        test('Finished -> menuProps set to finished (with step flags cleared), page-update, no navigation', () => {
            updateSpy.mockClear()
            rideObserver.emit('state-update', 'Finished')
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: false, finished: true, canStepBack: false, canStepForward: false })
            expect(updateSpy).toHaveBeenCalled()
            expect(MockBindings.ui.openPage).not.toHaveBeenCalled()
        })

        test('Error -> page-update', () => {
            rideObserver.emit('state-update', 'Error')
            expect(updateSpy).toHaveBeenCalled()
        })

        // regression: the overlay must keep refreshing (devicesState, readyToStart) while devices
        // connect - 'Starting'/'Started' have no dedicated menuProps handling, but must still
        // trigger a page-update, unlike 'Finished' which intentionally does not navigate away.
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

        beforeEach(() => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
            MockRideDisplay.getObserver.mockReturnValue(new Observer())
            workoutObserver = new Observer()
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)
            s.openPage()
            updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
        })

        test.each(['step-changed', 'update', 'forward', 'backward'])('%s -> page-update', (event) => {
            workoutObserver.emit(event)
            expect(updateSpy).toHaveBeenCalled()
        })

        test.each(['completed', 'stopped'])('%s -> menuProps set to finished, page-update', (event) => {
            workoutObserver.emit(event)
            expect(updateSpy).toHaveBeenCalled()
            const menuProps = s.getPageDisplayProps().menuProps
            expect(menuProps).toMatchObject({ showResume: false, finished: true })
        })
    })

    describe('onRefreshSecrets / onContinueAnyway', () => {
        test('onRefreshSecrets hides the start gate and triggers a page-update', () => {
            s.openPage()
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onRefreshSecrets()

            expect(s.getPageDisplayProps().startGateProps).toBeNull()
            expect(updateSpy).toHaveBeenCalled()
        })

        test('onContinueAnyway hides the start gate and triggers a page-update', () => {
            s.openPage()
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onContinueAnyway()

            expect(s.getPageDisplayProps().startGateProps).toBeNull()
            expect(updateSpy).toHaveBeenCalled()
        })
    })

    describe('initPage', () => {
        test('awaits RideDisplay.init(), marks the page as initialized, and returns the resolved ride type', async () => {
            MockRideDisplay.init.mockResolvedValue(new Observer())
            MockRideDisplay.getRideType.mockReturnValue('GPX')

            const result = await s.initPage()

            expect(result).toBe('GPX')
            expect((s as any).isInitialized).toBe(true)
        })

        test('logs and swallows errors from RideDisplay.init()', async () => {
            MockRideDisplay.init.mockRejectedValue(new Error('boom'))

            const result = await s.initPage()

            expect(result).toBeUndefined()
            expect(s.logError).toHaveBeenCalled()
        })
    })

    // ==========================================================================================
    // Phase 2 (session 2.1, workout-combo-service-design.md §4): attachment-based workout
    // behaviour. Fixtures per §6 "Session 2.1":
    //   (a)  Workout ride, both toggles off - already covered throughout the suite above (every
    //        existing test in this file still passes unmodified); toggle-independence itself is
    //        asserted explicitly below.
    //   (b)  Video/GPX + workout attached, both toggles on (state 3 - combo live)
    //   (c)  Video/GPX + workout attached, MOBILE_WORKOUTS on / COMBO off (state 2 - shipped)
    //   (c') Video/GPX + workout attached, COMBO on / MOBILE_WORKOUTS off (state 1 - behaves as c)
    //   (d)  Video/GPX, no workout attached
    // ==========================================================================================

    const setFeatureToggles = (mobileWorkouts: boolean, combo: boolean) => {
        MockAppState.hasFeature.mockImplementation((toggle: string) => {
            if (toggle === 'MOBILE_WORKOUTS') return mobileWorkouts
            if (toggle === 'MOBILE_WORKOUT_ROUTE_COMBO') return combo
            return true
        })
    }

    describe('isWorkoutAttached', () => {
        test('Workout ride -> always true, regardless of either toggle (Phase 1 must not depend on either)', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
            setFeatureToggles(false, false)
            expect((s as any).isWorkoutAttached()).toBe(true)
        })

        test('(b) Video/GPX ride, workout in use, both toggles on -> true', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockWorkoutRide.inUse.mockReturnValue(true)
            setFeatureToggles(true, true)
            expect((s as any).isWorkoutAttached()).toBe(true)
        })

        test('(c) Video/GPX ride, workout in use, MOBILE_WORKOUTS on / COMBO off -> false', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')
            MockWorkoutRide.inUse.mockReturnValue(true)
            setFeatureToggles(true, false)
            expect((s as any).isWorkoutAttached()).toBe(false)
        })

        test("(c') Video/GPX ride, workout in use, COMBO on / MOBILE_WORKOUTS off -> false (behaves as (c) - COMBO alone is never honoured)", () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')
            MockWorkoutRide.inUse.mockReturnValue(true)
            setFeatureToggles(false, true)
            expect((s as any).isWorkoutAttached()).toBe(false)
        })

        test('(d) Video/GPX ride, no workout in use, both toggles on -> false', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockWorkoutRide.inUse.mockReturnValue(false)
            setFeatureToggles(true, true)
            expect((s as any).isWorkoutAttached()).toBe(false)
        })

        test('other/unknown ride type -> false', () => {
            MockRideDisplay.getRideType.mockReturnValue('Free-Ride')
            setFeatureToggles(true, true)
            expect((s as any).isWorkoutAttached()).toBe(false)
        })

        test('logs and returns false if the underlying call throws', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockImplementation(() => { throw new Error('boom') })
            expect((s as any).isWorkoutAttached()).toBe(false)
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('getPageDisplayProps - Video/GPX combo, fixture (b): both toggles on, workout attached', () => {
        beforeEach(() => {
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(true)
            MockWorkoutRide.getDashboardDisplayProperties.mockReturnValue({
                title: 'Test Workout', ftp: 250, mode: null, canShowBackward: true, canShowForward: true, loadButtonMode: 'gear'
            })
            MockWorkoutRide.getCurrentLimits.mockReturnValue({
                time: 70, duration: 120, remaining: 50, targetPower: 150, minPower: 150, maxPower: 150,
                step: { type: 'step', duration: 120, steady: true, power: { type: 'watt', min: 150, max: 150 } }
            })
            MockActivityRide.getActivity.mockReturnValue({ logs: [], time: 70 })
        })

        test('Video ride, showWorkout true: carries all seven workout fields plus its own video fields', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')
            MockRideDisplay.getState.mockReturnValue('Active')
            MockRideDisplay.getDisplayProperties.mockReturnValue({
                state: 'Active', video: { id: 'v1' }, route: { id: 'r1' }, workout: makeCurrentWorkout(), showWorkout: true
            })

            const props: any = s.getPageDisplayProps()

            expect(props.workoutAttached).toBe(true)
            expect(props.video).toEqual({ id: 'v1' })
            expect(props.title).toBe('Test Workout')
            expect(props.graph.ftp).toBe(250)
            expect(props.steps.current).toBeTruthy()
            expect(props.dashboard.text).toContain('150W')
            expect(props.gestureHint).toBeDefined()
            expect(props.loadIncrement).toBe(1)
            expect(props.loadButtonMode).toBe('gear')
        })

        test('GPX ride, showWorkout true: carries all seven workout fields plus its own GPX fields', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockRideDisplay.getState.mockReturnValue('Active')
            MockRideDisplay.getDisplayProperties.mockReturnValue({
                state: 'Active', rideView: 'map', route: { id: 'r1' }, workout: makeCurrentWorkout(), showWorkout: true
            })

            const props: any = s.getPageDisplayProps()

            expect(props.workoutAttached).toBe(true)
            expect(props.rideView).toBe('map')
            expect(props.title).toBe('Test Workout')
            expect(props.graph.ftp).toBe(250)
        })

        test('workoutAttached true but RideDisplayService.showWorkout false (still starting) -> overlay suppressed, no workout fields', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockRideDisplay.getState.mockReturnValue('Idle')
            MockRideDisplay.getDisplayProperties.mockReturnValue({
                state: 'Idle', rideView: 'map', route: { id: 'r1' }, workout: makeCurrentWorkout(), showWorkout: false
            })

            const props: any = s.getPageDisplayProps()

            expect(props.workoutAttached).toBe(false)
            expect(props.title).toBeUndefined()
            expect(props.graph).toBeUndefined()
        })

        test('workout observer is subscribed after openPage() (unblocked - was type-gated to Workout only before Phase 2)', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX');
            (s as any).isInitialized = true
            const rideObserver = new Observer()
            const workoutObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)

            s.openPage()

            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)
            workoutObserver.emit('update')
            expect(updateSpy).toHaveBeenCalled()
        })

        test('RideMenu props carry the step flags on a combo ride', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockRideDisplay.getState.mockReturnValue('Paused')

            s.onMenuOpen()

            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true, canStepBack: true, canStepForward: true })
        })

        test('onStepBack / onStepForward delegate to RideDisplay when a workout is attached to a route ride', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')

            s.onStepBack()
            s.onStepForward()

            expect(MockRideDisplay.backward).toHaveBeenCalled()
            expect(MockRideDisplay.forward).toHaveBeenCalled()
        })
    })

    describe('getPageDisplayProps - Video/GPX combo, gated off (states 1/2/d - must be identical to today)', () => {
        const scenarios: [string, boolean, boolean, boolean][] = [
            ['(c) MOBILE_WORKOUTS on / COMBO off, workout attached', true, false, true],
            ["(c') COMBO on / MOBILE_WORKOUTS off, workout attached", false, true, true],
            ['(d) both toggles on, no workout attached', true, true, false]
        ]

        scenarios.forEach(([name, mobileWorkouts, combo, workoutInUse]) => {
            test(`${name} -> no workout fields, no observer subscription, step callbacks are no-ops`, () => {
                setFeatureToggles(mobileWorkouts, combo)
                MockWorkoutRide.inUse.mockReturnValue(workoutInUse)
                MockRideDisplay.getRideType.mockReturnValue('GPX')
                MockRideDisplay.getState.mockReturnValue('Active')
                MockRideDisplay.getDisplayProperties.mockReturnValue({
                    state: 'Active', rideView: 'map', route: { id: 'r1' }, workout: makeCurrentWorkout(), showWorkout: true
                });
                (s as any).isInitialized = true
                const rideObserver = new Observer()
                const workoutObserver = new Observer()
                MockRideDisplay.getObserver.mockReturnValue(rideObserver)
                MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)

                const props: any = s.getPageDisplayProps()
                expect(props.workoutAttached).toBeFalsy()
                expect(props.graph).toBeUndefined()
                expect(props.cornerWidget).toBeUndefined()

                s.openPage()
                const updateSpy = jest.fn()
                s.getPageObserver().on('page-update', updateSpy)
                workoutObserver.emit('update')
                expect(updateSpy).not.toHaveBeenCalled()

                s.onStepBack()
                s.onStepForward()
                expect(MockRideDisplay.backward).not.toHaveBeenCalled()
                expect(MockRideDisplay.forward).not.toHaveBeenCalled()

                // menu carries no step flags either - identical to today's plain route-ride menu
                s.onMenuOpen()
                expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: false })
            })
        })
    })

    // §4.4.5: getLoadButtonMode()/adjustLoad() are cycling-mode-driven and must stay
    // workout-independent - guarding them on isWorkoutAttached() would break gear shifting on a
    // plain SIM-mode route ride (FIXES_BACKLOG #37). Assert explicitly on fixture (d).
    describe('getLoadButtonMode / adjustLoad - NOT workout-gated (§4.4.5)', () => {
        test('(d) gear mode and gear shift still work on a plain GPX ride with no workout attached', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(false)
            MockWorkoutRide.getLoadButtonMode.mockReturnValue('gear')

            expect(s.getLoadButtonMode()).toBe('gear')

            s.adjustLoad(5)
            expect(MockWorkoutRide.powerUp).toHaveBeenCalledWith(5)

            s.adjustLoad(-5)
            expect(MockWorkoutRide.powerDown).toHaveBeenCalledWith(5)
        })
    })

    // §4.5: bidirectional completion - fixture (b), workout-ends-first direction. The domain layer
    // (RideDisplayService.onWorkoutCompleted()) already keeps the ride running; this is the
    // page-layer half (§4.4.7), the headline fix of this session.
    describe('onWorkoutFinished (§4.4.7) - the correctness fix', () => {
        test('fixture (b): a completing workout does NOT finish a route ride - no finished menu, no navigation', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(true)
            s.openPage()

            ;(s as any).onWorkoutFinished()

            expect((s as any).menuProps?.finished).toBeFalsy()
            expect(MockBindings.ui.openPage).not.toHaveBeenCalled()
        })

        test('fixture (b): re-entrant - a second onWorkoutFinished() call changes nothing', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(true)
            s.openPage()

            ;(s as any).onWorkoutFinished()
            ;(s as any).onWorkoutFinished()

            expect((s as any).menuProps?.finished).toBeFalsy()
            expect(MockBindings.ui.openPage).not.toHaveBeenCalled()
        })

        test('via the workout observer: "completed"/"stopped" keep a combo ride running (fixture b)', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(true);
            (s as any).isInitialized = true
            const rideObserver = new Observer()
            const workoutObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)
            s.openPage()

            workoutObserver.emit('completed')

            expect(MockRideDisplay.stop).not.toHaveBeenCalled()
            expect((s as any).menuProps?.finished).toBeFalsy()

            // the workout is no longer in use -> the overlay collapses on the next read
            MockWorkoutRide.inUse.mockReturnValue(false)
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Active', rideView: 'map', showWorkout: false })
            expect((s.getPageDisplayProps() as any).workoutAttached).toBe(false)
        })

        test('fixture (a) Workout ride: unchanged - a completing workout DOES finish the ride', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')

            ;(s as any).onWorkoutFinished()

            expect((s as any).menuProps).toMatchObject({ finished: true })
        })
    })

    describe('finishRide (§4.4.7) - fixture (a): manual End Ride on a Workout-only ride, unchanged', () => {
        test('stops the ride once and sets the finished menu directly (not via onWorkoutFinished)', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')

            ;(s as any).finishRide()

            expect(MockRideDisplay.stop).toHaveBeenCalledWith(true)
            expect(MockRideDisplay.stop).toHaveBeenCalledTimes(1)
            expect((s as any).menuProps).toMatchObject({ showResume: false, finished: true })
        })
    })

    describe('unsubscribeFromWorkoutObserver - unregisters from the cached instance (§4.4.3)', () => {
        test('still removes handlers and clears the flag even if getWorkoutRide().getObserver() has since reset to undefined', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
            const rideObserver = new Observer()
            const workoutObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver)
            MockWorkoutRide.getObserver.mockReturnValue(workoutObserver)
            s.openPage()
            expect((s as any).workoutObserverSubscribed).toBe(true)

            // simulate WorkoutRideService having reset back to 'idle' before the page closes -
            // getObserver() would now return undefined if re-read live
            MockWorkoutRide.getObserver.mockReturnValue(undefined)

            s.closePage()

            expect((s as any).workoutObserverSubscribed).toBe(false)
            const updateSpy = jest.fn()
            s.getPageObserver()?.on('page-update', updateSpy)
            workoutObserver.emit('update')
            expect(updateSpy).not.toHaveBeenCalled()
        })
    })

    // "Also in scope" (ride-overlay-layout-design.md §6.4 / §11 item A) - phone-fallback
    // corner-widget toggle. Additive and inert until session 5.1 wires up the RideMenu row and the
    // corner-slot tap handler; covered with the same set/read/gate test pattern as the existing
    // load-increment setting.
    describe('cornerWidget', () => {
        test('populated ("elevation" default) when isWorkoutAttached() AND isWorkoutComboEnabled() are both true', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            MockRideDisplay.getState.mockReturnValue('Active')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(true)
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Active', rideView: 'map', workout: makeCurrentWorkout(), showWorkout: true })

            expect((s.getPageDisplayProps() as any).cornerWidget).toBe('elevation')
        })

        test('undefined when no workout is attached', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(false)
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Active', rideView: 'map' })

            expect((s.getPageDisplayProps() as any).cornerWidget).toBeUndefined()
        })

        test('undefined when the combo toggle is off, even with a workout attached (state 2)', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, false)
            MockWorkoutRide.inUse.mockReturnValue(true)
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Active', rideView: 'map', workout: makeCurrentWorkout(), showWorkout: true })

            expect((s.getPageDisplayProps() as any).cornerWidget).toBeUndefined()
        })

        test('undefined on a Workout-only ride - no elevation graph competes for the corner slot there', () => {
            MockRideDisplay.getRideType.mockReturnValue('Workout')
            setFeatureToggles(false, false)

            expect((s.getPageDisplayProps() as any).cornerWidget).toBeUndefined()
        })

        test('reads the persisted preferences.workouts.rideCornerWidget setting', () => {
            MockRideDisplay.getRideType.mockReturnValue('GPX')
            setFeatureToggles(true, true)
            MockWorkoutRide.inUse.mockReturnValue(true)
            MockRideDisplay.getDisplayProperties.mockReturnValue({ state: 'Active', rideView: 'map', workout: makeCurrentWorkout(), showWorkout: true })
            MockUserSettings.get.mockImplementation((key: string, defValue: unknown) => key === 'preferences.workouts.rideCornerWidget' ? 'workout' : defValue)

            expect((s.getPageDisplayProps() as any).cornerWidget).toBe('workout')
        })

        describe('onToggleCornerWidget', () => {
            test('flips "elevation" -> "workout" and emits page-update', () => {
                s.openPage()
                const updateSpy = jest.fn()
                s.getPageObserver().on('page-update', updateSpy)
                MockUserSettings.get.mockImplementation((_key: string, defValue: unknown) => defValue)

                s.onToggleCornerWidget()

                expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.workouts.rideCornerWidget', 'workout')
                expect(updateSpy).toHaveBeenCalled()
            })

            test('flips "workout" -> "elevation"', () => {
                MockUserSettings.get.mockImplementation((key: string, defValue: unknown) => key === 'preferences.workouts.rideCornerWidget' ? 'workout' : defValue)

                s.onToggleCornerWidget()

                expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.workouts.rideCornerWidget', 'elevation')
            })

            test('logs and swallows errors', () => {
                MockUserSettings.set.mockImplementation(() => { throw new Error('boom') })
                expect(() => s.onToggleCornerWidget()).not.toThrow()
                expect(s.logError).toHaveBeenCalled()
            })
        })
    })
})
