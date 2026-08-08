import { EventLogger } from "gd-eventlog";
import { IncyclistPageService } from "../../base/pages";
import { CurrentRideState, IObserver, RideType } from "../../types";
import { AnyRidePageDisplayProps, RideMenuProps, StartGateProps } from "./types";
// import type only (not `useRideDisplay`, the runtime value) - RidePageServiceBase is extended by
// WorkoutRidePageService (services/src/workouts/ride/page/service.ts), which is itself reachable
// from RideDisplayService's own module graph (RideDisplayService -> the workouts barrel ->
// workouts/ride/page). A real (value) import of ride/display here would make this base class part
// of that same cycle at class-*definition* time - `class WorkoutRidePageService extends
// RidePageServiceBase` would run while ride/display (and this file, transitively) is still mid-
// evaluation, crashing with "Class extends value undefined is not a constructor or null". Each
// concrete subclass keeps its own tiny `@Injectable getRideDisplay()` (a value import used only
// inside a method body, which the existing cycle already tolerated pre-merge) instead.
import type { RideDisplayService } from "../display";
import type { PowerAdjustmentResult } from "../../workouts/ride/types";
import type { WorkoutGraphActuals } from "../../workouts/ride/page/types";

const BACKGROUND_PAUSE_TIMEOUT_MS = 300000

/**
 * Shared base for RidePageService (Video/GPX) and WorkoutRidePageService (Workout) - the two
 * concrete ride page services (FIXES_BACKLOG #24). Absorbs the lifecycle/menu/control-callback
 * machinery that was previously duplicated verbatim (or near-verbatim) between them.
 *
 * Both concrete subclasses implement the FULL merged IRidePageService interface - methods that
 * only apply to one ride "half" get a safe no-op default here, overridden by the subclass they
 * actually apply to. This keeps getRidePageService() a single factory with no instanceof checks
 * or casts anywhere in mobile/web-ui call sites.
 */
export abstract class RidePageServiceBase extends IncyclistPageService {

    protected eventHandler: Record<string, any> = {}
    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService: boolean = false
    protected menuProps: RideMenuProps | null = null
    protected isInitialized: boolean = false
    protected startGateProps: StartGateProps | null = null

    constructor(name: string) {
        super(name)
        this.eventHandler['state-update'] = this.onDisplayStateUpdate.bind(this)
    }

    // ---- hooks a subclass must define -------------------------------------------------

    /** 'Rides' (Video/GPX) or 'WorkoutRide' - used for EventLogger's global page tag and page-shown/closed log events. */
    protected abstract getPageLogName(): string

    /**
     * Whether openPage() must run RideDisplayService's own deferred-init dance (await init(),
     * then register handlers/start). Ride: true. Workout: false - RideDisplayService is already
     * fully initialized by RidePage.tsx's top-level getRidePageService().initPage() call before a
     * Workout page can ever mount, so redoing it here would race with start() and tear the ride
     * back down mid-connect (closePrevRide() sees the already-set observer and calls stopRide()).
     */
    protected abstract requiresOwnInit(): boolean

    /** 'user' (Ride) or 'device' (Workout) - who pausePage()'s background grace-timer reports as the pause requester. */
    protected abstract getBackgroundPauseRequester(): 'user' | 'device'

    abstract getPageDisplayProps(): AnyRidePageDisplayProps
    abstract onMenuOpen(): void
    abstract onMenuClose(): void

    // ---- openPage() lifecycle hooks (all no-op by default) -----------------------------

    /** Called at the very start of openPage(), before super.openPage(). Workout resets its this-ride-only gesture-hint suppression flag here. */
    protected resetPageState(): void { /* no-op by default */ }

    /** Called right after ride-observer handlers are (re-)registered and before RideDisplay.start(). Workout subscribes to the workout observer here. */
    protected onRideHandlersRegistered(): void { /* no-op by default */ }

    /** Called right after RideDisplay.start(simulate). Ride schedules a deferred page-display refresh here. */
    protected onRideStartRequested(): void { /* no-op by default */ }

    /** Called at the top of onDisplayStateUpdate(), before the state switch. Workout (re-)subscribes to the workout observer here, since it may only become available once the ride is actually running. */
    protected onBeforeDisplayStateUpdate(_state: CurrentRideState): void { /* no-op by default */ }

    /** Called from closePage(), after handlers are unregistered. Workout unsubscribes from the workout observer here. */
    protected onClosePage(): void { /* no-op by default */ }

    // ---- menuProps builders (state-update / onPause template hooks) --------------------

    protected buildPausedMenuProps(): RideMenuProps {
        return { showResume: true }
    }

    protected buildFinishedMenuProps(): RideMenuProps {
        return { showResume: false, finished: true }
    }

    // ---- lifecycle -----------------------------------------------------------

    async initPage(): Promise<RideType | undefined> {
        try {
            const service = this.getRideDisplay()

            await service.init()
            this.isInitialized = true

            return service.getRideType()
        }
        catch (err: any) {
            this.logError(err, 'initPage')
        }
    }

    openPage(simulate?: boolean): IObserver {
        try {
            this.logEvent({ message: 'page shown', page: this.getPageLogName() })
            EventLogger.setGlobalConfig('page', this.getPageLogName())

            this.resetPageState()
            super.openPage()

            try {
                const service = this.getRideDisplay()

                const registerAndStart = () => {
                    // registerHandlers() must run after init() has resolved: init() is what
                    // (re)creates RideDisplayService's observer instance (via closePrevRide() ->
                    // new Observer()), so registering earlier would attach the handlers to a stale
                    // (or, on the very first ride, undefined) observer that start() never emits on.
                    this.registerHandlers(this.rideObserver, this.eventHandler)
                    this.onRideHandlersRegistered()
                    service.start(simulate)
                    this.onRideStartRequested()
                }

                if (this.requiresOwnInit() && !this.isInitialized) {
                    // init() is async (it awaits closePrevRide() before setting up the new
                    // observer/display service). start() depends on that state, so it must not
                    // run until init() has actually resolved - previously this was fire-and-forget,
                    // letting start() race ahead of init() and run against partially-initialized
                    // (or leftover previous-ride) state. openPage() itself stays synchronous -
                    // callers still get the IObserver immediately - only the start of the ride is
                    // deferred until init() completes.
                    service.init()
                        .then(() => {
                            this.isInitialized = true
                            registerAndStart()
                        })
                        .catch((err: any) => { this.logError(err, 'openPage') })
                }
                else {
                    registerAndStart()
                }
            }
            catch (err: any) {
                this.logError(err, 'openPage')
            }
            return this.getPageObserver()
        }
        catch (err: any) {
            this.logError(err, 'openPage')
        }
        return this.getPageObserver()
    }

    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page', null)
            this.logEvent({ message: 'page closed', page: this.getPageLogName() })

            this.getRideDisplay().stop()
            this.unregisterHandlers(this.rideObserver, this.eventHandler)
            this.onClosePage()
            this.menuProps = null
            this.isInitialized = false
            super.closePage()
        }
        catch (err: any) {
            this.logError(err, 'closePage')
        }
    }

    async pausePage(): Promise<void> {
        try {
            this.backgroundTimer = setTimeout(() => {
                this.getRideDisplay().pause(this.getBackgroundPauseRequester())
                this.backgroundPausedByService = true
            }, BACKGROUND_PAUSE_TIMEOUT_MS)

            this.isInitialized = false
            return super.pausePage()
        }
        catch (err: any) {
            this.logError(err, 'pausePage')
        }
    }

    async resumePage(): Promise<void> {
        try {
            if (this.backgroundTimer) {
                clearTimeout(this.backgroundTimer)
            }
            return super.resumePage()
        }
        catch (err: any) {
            this.logError(err, 'resumePage')
        }
    }

    getRideObserver(): IObserver | null {
        return this.rideObserver ?? null
    }

    getRideType(): RideType {
        return this.getRideDisplay().getRideType()
    }

    // ---- shared control callbacks ----------------------------------------------------

    onPause(): void {
        try {
            this.getRideDisplay().pause('user')
            this.menuProps = this.buildPausedMenuProps()
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onPause')
        }
    }

    onResume(): void {
        try {
            this.getRideDisplay().resume()
            this.menuProps = null
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onResume')
        }
    }

    onRetryStart(): void {
        try {
            this.getRideDisplay().retryStart()
        }
        catch (err: any) {
            this.logError(err, 'onRetryStart')
        }
    }

    onIgnoreStart(): void {
        try {
            this.getRideDisplay().startWithMissingSensors()
        }
        catch (err: any) {
            this.logError(err, 'onIgnoreStart')
        }
    }

    onCancelStart(): void {
        try {
            this.rideObserver?.stop()
            this.getRideDisplay().cancelStart()
                .then(() => {
                    this.moveToPreviousPage()
                    this.closePage()
                })
                .catch((err: any) => { this.logError(err, 'onCancelStart') })
        }
        catch (err: any) {
            this.logError(err, 'onCancelStart')
        }
    }

    // ---- cross-type methods: safe no-op defaults ---------------------------------------
    // Ride-only (overridden by RidePageService); no-ops here so a Workout ride can call them
    // without an instanceof check or cast.

    onEndRide(): void { /* no-op: Ride-only, see RidePageService */ }
    onRefreshSecrets(): void { /* no-op: Ride-only, see RidePageService */ }
    onContinueAnyway(): void { /* no-op: Ride-only, see RidePageService */ }

    // Workout-only (overridden by WorkoutRidePageService); no-ops here so a Video/GPX ride can
    // call them without an instanceof check or cast.

    getGraphActuals(): WorkoutGraphActuals {
        return { power: [], heartrate: [], position: 0 }
    }
    adjustLoad(_deltaPct: number): PowerAdjustmentResult | undefined { return undefined }
    onStop(): void { /* no-op: Workout-only, see WorkoutRidePageService */ }
    onStepBack(): void { /* no-op: Workout-only, see WorkoutRidePageService */ }
    onStepForward(): void { /* no-op: Workout-only, see WorkoutRidePageService */ }
    onIncreaseLoad(): void { /* no-op: Workout-only, see WorkoutRidePageService */ }
    onDecreaseLoad(): void { /* no-op: Workout-only, see WorkoutRidePageService */ }
    onSetLoadIncrement(_value: number): void { /* no-op: Workout-only, see WorkoutRidePageService */ }
    onGestureHintDismissed(_props: { dontShowAgain: boolean }): void { /* no-op: Workout-only, see WorkoutRidePageService */ }

    // ---- shared display-props scaffolding ------------------------------------------------

    protected buildBaseDisplayProps() {
        const state = this.getRideDisplay().getState()
        const isStarting = state === 'Idle' || state === 'Starting' || state === 'Error'

        return {
            rideState: state,
            rideType: this.getRideDisplay().getRideType(),
            startOverlayProps: isStarting ? this.getRideDisplay().getStartOverlayProps() : null,
            menuProps: this.menuProps,
            startGateProps: this.startGateProps
        }
    }

    protected onDisplayStateUpdate(state: CurrentRideState) {
        this.onBeforeDisplayStateUpdate(state)

        switch (state) {
            case 'Paused':
                this.menuProps = this.buildPausedMenuProps()
                break
            case 'Finished':
                this.onRideFinishedState()
                return
            case 'Active':
                this.menuProps = null
                break
        }
        this.updatePageDisplay()
    }

    /**
     * Reaction to the ride observer's 'state-update' reaching 'Finished'. Base default (Ride):
     * surface the finished state via menuProps.finished and refresh the page - RideMenu already
     * renders the Activity Summary overlay off menuProps.finished.
     */
    protected onRideFinishedState(): void {
        this.menuProps = this.buildFinishedMenuProps()
        this.updatePageDisplay()
    }

    protected updatePageDisplay() {
        this.getPageObserver()?.emit('page-update')
    }

    protected registerHandlers(observer: IObserver | null | undefined, map: Record<string, any>) {
        if (!observer)
            return
        Object.keys(map).forEach(event => { observer.on(event, map[event]) })
    }

    protected unregisterHandlers(observer: IObserver | null | undefined, map: Record<string, any>) {
        if (!observer)
            return
        Object.keys(map).forEach(event => { observer.off(event, map[event]) })
    }

    protected moveToPreviousPage() {
        this.moveTo('$contentPage')
    }

    protected get rideObserver(): IObserver | null {
        try {
            return this.getRideDisplay()?.getObserver()
        }
        catch (err: any) {
            this.logError(err, 'get rideObserver')
        }
        return null
    }

    // Not shared here - see the import-cycle note above. Each subclass implements this as
    // `@Injectable getRideDisplay() { return useRideDisplay() }`.
    protected abstract getRideDisplay(): RideDisplayService

}
