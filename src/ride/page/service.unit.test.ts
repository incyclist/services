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
        ensureFinalized: jest.fn(),
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

    // Regression: a route/video reaching its natural end (RideDisplayService.onRouteCompleted()
    // setting state to 'Finished') previously just flipped the ride menu to a "finished" state
    // and waited for the user to manually tap "End Ride" - unlike onEndRide() (manual tap), which
    // finalizes and navigates away immediately. Auto-completion must now behave exactly like the
    // user pressing Menu -> End Ride.
    describe('onDisplayStateUpdate - Finished', () => {

        beforeEach(() => {
            (s as any).isInitialized = true
            s.openPage()
        })

        it('auto-invokes the same finalize-and-navigate-away sequence as manual "End Ride"', () => {
            (s as any).onDisplayStateUpdate('Finished')

            expect(MockRideDisplay.ensureFinalized).toHaveBeenCalled()
            expect(MockBindings.ui.openPage).toHaveBeenCalled()
        })

        it('does not leave the ride menu open waiting for a manual tap', () => {
            (s as any).onDisplayStateUpdate('Finished')

            expect(s.getPageDisplayProps().menuProps).toBeNull()
        })

        it('does not re-finalize if triggered more than once for the same ride', () => {
            (s as any).onDisplayStateUpdate('Finished');
            (s as any).onDisplayStateUpdate('Finished')

            expect(MockRideDisplay.ensureFinalized).toHaveBeenCalledTimes(1)
        })
    })

    describe('onMenuClose - Finished', () => {

        beforeEach(() => {
            (s as any).isInitialized = true
            s.openPage()
        })

        it('finalizes the ride (not just navigates away) when closing the menu on a finished ride', () => {
            MockRideDisplay.getState.mockReturnValue('Finished')

            s.onMenuClose()

            expect(MockRideDisplay.ensureFinalized).toHaveBeenCalled()
            expect(MockBindings.ui.openPage).toHaveBeenCalled()
        })
    })
})
