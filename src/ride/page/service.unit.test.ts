import { Inject } from "../../base/decorators"
import { Observer } from "../../base/types/observer"
import { RidePageService } from "./service"

let MockRideDisplay
let MockAppState
let MockBindings
let MockOnlineStatusMonitoring

const setupMocks = () => {
    MockRideDisplay = {
        init: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        retryStart: jest.fn(),
        startWithMissingSensors: jest.fn(),
        cancelStart: jest.fn().mockResolvedValue(undefined),
        getObserver: jest.fn(),
        getRideType: jest.fn().mockReturnValue('GPX'),
        getState: jest.fn().mockReturnValue('Idle'),
        getStartOverlayProps: jest.fn().mockReturnValue({ mode: 'GPX', rideState: 'Idle', devices: [], readyToStart: false }),
        getDisplayProperties: jest.fn().mockReturnValue({ state: 'Idle' })
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

    Inject('RideDisplay', MockRideDisplay)
    Inject('AppState', MockAppState)
    Inject('Bindings', MockBindings)
    Inject('OnlineStatusMonitoring', MockOnlineStatusMonitoring)
}

const resetMocks = () => {
    Inject('RideDisplay', null)
    Inject('AppState', null)
    Inject('Bindings', null)
    Inject('OnlineStatusMonitoring', null)
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

    describe('openPage', () => {

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

    // Characterization tests (written before extracting a shared RidePageServiceBase, FIXES_BACKLOG
    // #24) - capture RidePageService's current behavior as a regression net for the extraction.
    //
    // NOTE: 'closePage does NOT unregister event handlers' below documents a known bug (the base
    // class's closePage() will always unregister once extracted) - that one assertion is expected
    // to flip as part of the extraction commit, not remain a permanent regression guard.
    describe('closePage', () => {
        test('stops the ride, clears menuProps, and resets init/observer state', () => {
            s.openPage()
            s.onPause()
            expect(s.getPageDisplayProps().menuProps).not.toBeNull()

            s.closePage()

            expect(MockRideDisplay.stop).toHaveBeenCalled()
            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        test('does NOT unregister event handlers (known bug - fixed when the shared base always unregisters)', () => {
            const rideObserver = new Observer()
            MockRideDisplay.getObserver.mockReturnValue(rideObserver);
            (s as any).isInitialized = true // skip the async init dance so handlers register synchronously
            s.openPage()

            s.closePage()

            const updateSpy = jest.fn()
            // page observer was stopped by closePage() -> re-open a listener surface via a fresh openPage()
            // is not needed here: we only care whether the OLD rideObserver still drives updates.
            const pageObserverBeforeReopen = (s as any).pageObserver
            void pageObserverBeforeReopen
            rideObserver.emit('state-update', 'Paused')
            // menuProps still gets mutated because the stale handler is still attached - this is
            // the bug: unregisterEventHandlers() is never called by RidePageService.closePage()
            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: true })
            expect(updateSpy).not.toHaveBeenCalled() // no listener was attached to observe page-update on this run
        })

        test('logs and swallows errors', () => {
            MockRideDisplay.stop.mockImplementation(() => { throw new Error('boom') })
            expect(() => s.closePage()).not.toThrow()
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('pausePage / resumePage', () => {
        beforeEach(() => { jest.useFakeTimers() })

        test('pausePage() starts a background grace timer that auto-pauses the ride as "user"', () => {
            s.pausePage()
            jest.advanceTimersByTime(300000)
            expect(MockRideDisplay.pause).toHaveBeenCalledWith('user')
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

    describe('getPageDisplayProps', () => {
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

    describe('menu callbacks', () => {
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

    describe('ride control callbacks', () => {
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

        test('onFinished sets menuProps to the finished state and emits page-update', () => {
            s.openPage()
            const updateSpy = jest.fn()
            s.getPageObserver().on('page-update', updateSpy)

            s.onFinished()

            expect(s.getPageDisplayProps().menuProps).toEqual({ showResume: false, finished: true })
            expect(updateSpy).toHaveBeenCalled()
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

    describe('getRideType', () => {
        test('delegates to RideDisplay.getRideType()', () => {
            MockRideDisplay.getRideType.mockReturnValue('Video')
            expect(s.getRideType()).toBe('Video')
        })
    })

    describe('ride observer state-update handling', () => {
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
})
