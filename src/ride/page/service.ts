import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { CurrentRideDisplayProps, CurrentRideState, GpxDisplayProps, IObserver, RideType, RLVDisplayProps } from "../../types";
import {
    AnyRidePageDisplayProps,
    GPXRidePageDisplayProps,
    IRidePageService,
    PrevRidesRowProps,
    RideMenuProps,
    RidePageDisplayProps,
    StartGateProps,
    VideoRidePageDisplayProps,
    WorkoutDashboardLine,
    WorkoutGestureHint,
    WorkoutGraphActuals,
    WorkoutGraphPlan,
    WorkoutGraphPoint,
    WorkoutRideMenuProps,
    WorkoutRidePageDisplayProps,
    WorkoutStepDisplay,
    WorkoutUpcomingSteps
} from "./types";
import { useRideDisplay } from "../display";
import { sleep } from "../../utils/sleep";
import { ISecretBinding } from "../../api/secret";
import { useOnlineStatusMonitoring } from "../../monitoring";
import { PrevRidesListDisplayProps, useActivityRide } from "../../activities";
import { useUserSettings } from "../../settings";
import { useWorkoutRide } from "../../workouts/ride/service";
import type { LoadButtonMode, PowerAdjustmentResult, WorkoutDisplayProperties } from "../../workouts/ride/types";
import { getFlattenedSteps, getStepDuration, getStepTargetText, getWorkoutGraphSeries } from "../../workouts/base/graph";
import type { Workout } from "../../workouts/base/model";
import type { StepDefinition } from "../../workouts/base/model/types";

const BACKGROUND_PAUSE_TIMEOUT_MS = 300000
const UPCOMING_STEPS_COUNT = 3
const DEFAULT_LOAD_INCREMENT = 1
const HINTS_WORKOUT_GESTURES_KEY = 'hints.workoutRideGestures'
// Same key mobile's useWorkoutRideGestures.ts (session 5.4) already reads - do not introduce a
// second key for the same setting.
const LOAD_INCREMENT_SETTING_KEY = 'preferences.workouts.loadIncrement'
// Phone-fallback corner-widget toggle (ride-overlay-layout-design.md §6.4) - which of the
// competing corner widgets (elevation graph, workout info, previous rides) a ride currently shows.
const CORNER_WIDGET_SETTING_KEY = 'preferences.workouts.rideCornerWidget'
// race-against-yourself-mobile-design.md §5 - visibleRows before the view has ever reported a
// value via setPrevRidesVisibleRows() (screen geometry the service has no visibility into).
const DEFAULT_PREV_RIDES_VISIBLE_ROWS = 1

/**
 * Single page service for all ride types (Video/GPX/Workout) - FIXES_BACKLOG #24. Previously
 * split into RidePageService (Video/GPX) and WorkoutRidePageService (Workout) behind a shared
 * RidePageServiceBase; collapsed into one concrete class per explicit repo-owner review feedback
 * (see the FIXES_BACKLOG #24 status note). Ride-type-specific methods are just plain methods
 * here - they're only ever invoked by UI that's already specific to that ride type, so there's
 * no need for instanceof checks, casts, or no-op overrides.
 */
@Singleton
export class RidePageService extends IncyclistPageService implements IRidePageService {

    protected eventHandler: Record<string, any> = {}
    protected workoutEventHandler: Record<string, any> = {}
    protected workoutObserverSubscribed = false
    protected workoutObserver: IObserver | undefined
    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService: boolean = false
    protected menuProps: RideMenuProps | null = null
    protected isInitialized: boolean = false
    protected startGateProps: StartGateProps | null = null

    // race-against-yourself-mobile-design.md §5/§6.3 - reported by the mobile view
    // (setPrevRidesVisibleRows()), and the phone-only condensed/expanded toggle
    // (onExpandPrevRides()/onCollapsePrevRides(), or the view's own setPrevRidesMode() override).
    // Defaults to 'list' - phone-vs-tablet/expanded-vs-not is a view-layer concern (§5); the view
    // overrides this for the phone-collapsed default via setPrevRidesMode().
    protected prevRidesVisibleRows: number = DEFAULT_PREV_RIDES_VISIBLE_ROWS
    protected prevRidesMode: 'condensed' | 'list' = 'list'

    // this-ride-only suppression of the gesture-hint overlay (reset on every openPage()) -
    // distinct from the persisted hints.workoutRideGestures flag, which suppresses it forever.
    protected gestureHintDismissed = false

    // Set by onViewChanged() (route-ends-first mid-ride type flip, §4.5.1), consumed by the
    // closePage()/openPage() pair that the resulting page-component swap triggers. Guards the
    // outgoing page's teardown from stopping a still-running ride, and the incoming page's mount
    // from re-running init()/start() against it.
    protected viewTransition = false

    constructor() {
        super('RidePage')

        this.eventHandler['state-update'] = this.onDisplayStateUpdate.bind(this)
        this.eventHandler['route-update'] = this.onRouteUpdate.bind(this)
        this.eventHandler['view-changed'] = this.onViewChanged.bind(this)

        this.workoutEventHandler['step-changed'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['update'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['forward'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['backward'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['completed'] = this.onWorkoutFinished.bind(this)
        this.workoutEventHandler['stopped'] = this.onWorkoutFinished.bind(this)
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
        // Second half of a mid-ride view transition (onViewChanged(), §4.5.1): the ride is
        // already running and the ride/workout observer handlers are still attached (closePage()
        // below was suppressed for the same flag). Re-emit so the incoming page paints itself
        // from current state, and return without touching init()/start() - see registerAndStart().
        if (this.viewTransition) {
            this.viewTransition = false
            this.logEvent({ message: 'page shown', page: this.getPageLogName(), viewTransition: true })
            EventLogger.setGlobalConfig('page', this.getPageLogName())
            this.subscribeToWorkoutObserver()
            this.updatePageDisplay()
            return this.getPageObserver()
        }

        try {
            const pageLogName = this.getPageLogName()
            this.logEvent({ message: 'page shown', page: pageLogName })
            EventLogger.setGlobalConfig('page', pageLogName)

            this.gestureHintDismissed = false
            super.openPage()

            try {
                const service = this.getRideDisplay()

                const registerAndStart = () => {
                    // registerHandlers() must run after init() has resolved: init() is what
                    // (re)creates RideDisplayService's observer instance (via closePrevRide() ->
                    // new Observer()), so registering earlier would attach the handlers to a stale
                    // (or, on the very first ride, undefined) observer that start() never emits on.
                    this.registerHandlers(this.rideObserver, this.eventHandler)
                    this.subscribeToWorkoutObserver()

                    // Should be unreachable: openPage() returns early on a view transition (above),
                    // and every other openPage() path runs against an Idle/Finished ride. If this
                    // ever fires, a page mounted over an already-live ride without going through
                    // onViewChanged() - log it rather than restarting the ride underneath the rider.
                    const state = service.getState()
                    if (state === 'Started' || state === 'Active' || state === 'Paused') {
                        this.logError(
                            new Error(`start() requested while ride is ${state}`),
                            'openPage'
                        )
                        this.updatePageDisplay()
                        return
                    }

                    service.start(simulate)
                    if (this.isRideType('Video', 'GPX')) {
                        sleep(5).then(() => {
                            this.updatePageDisplay()
                        })
                    }
                }

                // RideDisplayService's own deferred-init dance is only needed for Video/GPX
                // rides: for a Workout ride, RideDisplayService is already fully initialized by
                // RidePage.tsx's top-level getRidePageService().initPage() call before a Workout
                // page can ever mount - redoing it here would race with start() and tear the ride
                // back down mid-connect (closePrevRide() sees the already-set observer and calls
                // stopRide()).
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
        // A mid-ride view transition (onViewChanged(), §4.5.1) unmounts the outgoing ride page,
        // whose unmount effect calls closePage() - but the *ride* is still running and must not be
        // stopped or torn down. Swallow exactly that one close and leave the flag set for the
        // matching openPage() above. Any other closePage() (End Ride, navigate away, unmount for
        // real) behaves as before.
        if (this.viewTransition)
            return

        try {
            EventLogger.setGlobalConfig('page', null)
            this.logEvent({ message: 'page closed', page: this.getPageLogName() })

            this.getRideDisplay().stop()
            this.unregisterHandlers(this.rideObserver, this.eventHandler)
            this.unsubscribeFromWorkoutObserver()
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

    // ---- menu callbacks ----------------------------------------------------------------
    //
    // onMenuOpen()/onMenuClose() genuinely diverge between Ride (Video/GPX) and Workout - this is
    // real, not accidental duplication (FIXES_BACKLOG #24 review). Ride's onMenuClose() has a
    // Finished-state special case (navigate away + close the page) that Workout's doesn't have -
    // both behaviors are preserved below, branched on ride type.

    onMenuOpen(): void {
        try {
            const state = this.getRideDisplay().getState()
            this.menuProps = this.isWorkoutAttached()
                ? { showResume: state === 'Paused', ...this.getStepFlags() }
                : { showResume: state === 'Paused' }
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onMenuOpen')
        }
    }

    onMenuClose(): void {
        try {
            if (this.isRideType('Workout')) {
                this.menuProps = null
                this.updatePageDisplay()
                return
            }

            // Video/GPX only: a Finished ride navigates away and closes the page instead of just
            // clearing the menu - see FIXES_BACKLOG #24.
            const state = this.getRideDisplay().getState()
            if (state === 'Finished' || this.menuProps?.finished) {
                this.moveToPreviousPage()
                this.closePage()
                return
            }

            this.menuProps = null
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onMenuClose')
        }
    }

    // ---- ride-type dispatch ----------------------------------------------------------

    getPageDisplayProps(): AnyRidePageDisplayProps {
        const startOverlayProps = this.getRideDisplay().getStartOverlayProps()

        const noRideProps: RidePageDisplayProps = {
            rideState: 'Error',
            startOverlayProps,
            rideType: null as unknown as RideType,
            menuProps: null,
            startGateProps: null
        }

        try {
            const rideType = this.getRideDisplay().getRideType()

            switch (rideType) {
                case 'Video':   return this.getVideoRideDisplayProps()
                case 'GPX':     return this.getGPXRideDisplayProps()
                case 'Workout': return this.getWorkoutRideDisplayProps()
                // case 'Free-Ride': return this.getFreeRideDisplayProps()
                default:
                    return noRideProps
            }
        }
        catch {
            return noRideProps
        }
    }

    // ---- Video/GPX ride methods --------------------------------------------------------

    onRefreshSecrets(): void {
        // Mobile will call initSecrets and then call this method when done.
        // Dismiss the gate and proceed.
        this.hideStartgate()
    }

    onContinueAnyway(): void {
        this.hideStartgate()
    }

    onEndRide(): void {
        try {
            this.getRideDisplay().stop()
            this.moveToPreviousPage()
            this.closePage()
        }
        catch (err: any) {
            this.logError(err, 'onEndRide')
        }
    }

    protected getVideoRideDisplayProps(): VideoRidePageDisplayProps {
        const props = this.rideDisplayProps as CurrentRideDisplayProps & RLVDisplayProps & { showWorkout?: boolean }
        const base = this.buildBaseDisplayProps()

        const displayProps: VideoRidePageDisplayProps = {
            ...base,
            ...this.buildWorkoutOverlayProps(props, base.prevRides),
            video: props.video,
            videos: props.videos,
            route: props.route
        }
        return displayProps
    }

    protected getGPXRideDisplayProps(): GPXRidePageDisplayProps {
        const props = this.rideDisplayProps as CurrentRideDisplayProps & GpxDisplayProps & { showWorkout?: boolean }
        const base = this.buildBaseDisplayProps()

        const displayProps: GPXRidePageDisplayProps = {
            ...base,
            ...this.buildWorkoutOverlayProps(props, base.prevRides),
            rideView: props.rideView,
            route: props.route,
            displayObserver: props.displayObserver,
            displayPosition: props.displayPosition,
            onDisplayEvent: props.onDisplayEvent
        }
        return displayProps
    }

    /**
     * The workout half of a combo ride's display props (Video/GPX ride with an attached workout).
     * Mirrors getWorkoutRideDisplayProps()'s builders exactly (same graph/steps/dashboard sources)
     * so the two ride shapes can never drift apart - a combo ride's WorkoutDashboard must show what
     * a workout-only ride shows. gestureHint/loadIncrement/loadButtonMode are NOT computed here
     * (moved to buildBaseDisplayProps() - they apply to every ride type, not just a workout-attached
     * one) - see that method's comment.
     *
     * Also honours RideDisplayService's own `showWorkout` (already computed for every ride type,
     * and what desktop renders off): it adds the "not while the ride is still starting" and "not
     * while overlays are hidden" suppression that isWorkoutAttached() alone doesn't carry.
     *
     * `cornerWidget` (ride-overlay-layout-design.md §6.4) is computed independently of
     * `showWorkout` - it only needs isWorkoutAttached() - and is therefore included in every
     * branch below, not just the "workout visible" one.
     */
    protected buildWorkoutOverlayProps(
        props: CurrentRideDisplayProps & { showWorkout?: boolean },
        prevRides: RidePageDisplayProps['prevRides']
    ): Partial<RidePageDisplayProps> {
        const cornerWidget = this.getCornerWidget(prevRides)

        if (!this.isWorkoutAttached() || !props?.showWorkout)
            return { workoutAttached: false, cornerWidget }

        try {
            const wo = this.getWorkoutRide().getDashboardDisplayProperties()

            return {
                workoutAttached: true,
                cornerWidget,
                title:           wo.title ?? '',
                graph:           this.buildGraphPlan(props.workout, wo.ftp),
                steps:           this.buildUpcomingSteps(props.workout, wo.ftp),
                dashboard:       this.buildDashboardLine(wo)
            }
        }
        catch (err: any) {
            this.logError(err, 'buildWorkoutOverlayProps')
            return { workoutAttached: false, cornerWidget }
        }
    }

    /**
     * Phone-fallback corner-widget preference (ride-overlay-layout-design.md §6.4,
     * race-against-yourself-mobile-design.md §6.3) - which of the competing corner widgets
     * (elevation graph, workout info, previous rides) a ride currently shows. 'elevation' is
     * always eligible when this method is reached at all; 'workout' only when a workout is
     * attached; 'prevRides' only when prevRides is actually shown (mode !== 'hidden'). Undefined
     * only when there's nothing else to toggle to (no workout AND no prevRides) - a plain route
     * ride with prevRides off has nothing here, same as today's plain-ride case. Only
     * buildWorkoutOverlayProps() (Video/GPX) calls this; a Workout-only ride goes through
     * getWorkoutRideDisplayProps() instead and never reaches it.
     */
    protected getCornerWidget(prevRides: RidePageDisplayProps['prevRides']): 'elevation' | 'workout' | 'prevRides' | undefined {
        try {
            const available = this.getCornerWidgetStates(prevRides)
            if (available.length <= 1)
                return undefined

            const current = this.getUserSettings().get(CORNER_WIDGET_SETTING_KEY, 'elevation')
            return available.includes(current) ? current : available[0]
        }
        catch (err: any) {
            this.logError(err, 'getCornerWidget')
            return undefined
        }
    }

    /**
     * The corner-widget states eligible for the current ride, in cycle order. 'elevation' is
     * always included - callers decide "nothing to toggle" by checking the list length, not by
     * elevation's presence/absence.
     */
    protected getCornerWidgetStates(prevRides: RidePageDisplayProps['prevRides']): Array<'elevation' | 'workout' | 'prevRides'> {
        const states: Array<'elevation' | 'workout' | 'prevRides'> = ['elevation']
        if (this.isWorkoutAttached())
            states.push('workout')
        if (!!prevRides && prevRides.mode !== 'hidden')
            states.push('prevRides')
        return states
    }

    /**
     * '[x]'-style toggle for the phone-fallback corner widget (ride-overlay-layout-design.md §6.4,
     * race-against-yourself-mobile-design.md §6.3) - advances through whichever states are
     * currently eligible (getCornerWidgetStates()), wrapping back to the start. Mirrors
     * onSetLoadIncrement(): write the setting via getUserSettings(), then updatePageDisplay().
     */
    onToggleCornerWidget(): void {
        try {
            const available = this.getCornerWidgetStates(this.buildPrevRides())
            const current = this.getUserSettings().get(CORNER_WIDGET_SETTING_KEY, 'elevation')
            const next = available[(available.indexOf(current) + 1) % available.length]
            this.getUserSettings().set(CORNER_WIDGET_SETTING_KEY, next)
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onToggleCornerWidget')
        }
    }

    /**
     * Phone-only (race-against-yourself-mobile-design.md §6.3) - the corner-slot chevron's
     * expand/collapse. No-op on tablet callers (prevRides.mode is always 'list' there via the
     * view's own setPrevRidesMode() - see that setter).
     */
    onExpandPrevRides(): void {
        this.setPrevRidesMode('list')
    }

    onCollapsePrevRides(): void {
        this.setPrevRidesMode('condensed')
    }

    /**
     * race-against-yourself-mobile-design.md §5 - how many rows of prevRides actually fit
     * (screen geometry the service has no visibility into). Reported by the mobile view whenever
     * the relevant geometry changes (ear resize, rotation, panel open/close).
     */
    setPrevRidesVisibleRows(n: number): void {
        try {
            this.prevRidesVisibleRows = n
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'setPrevRidesVisibleRows')
        }
    }

    /**
     * race-against-yourself-mobile-design.md §5 - companion setter to setPrevRidesVisibleRows(),
     * kept separate rather than folded into it: this is a phone-vs-tablet/expanded-vs-not view
     * decision (an interaction/layout-tier concern), while setPrevRidesVisibleRows() is a pure
     * geometry report - mixing the two into one call would make either call ambiguous about which
     * concern it's actually reporting. onExpandPrevRides()/onCollapsePrevRides() already cover the
     * phone chevron's own toggle; this exists for the view to set the tier-appropriate mode
     * directly (e.g. phone defaulting to 'condensed' on mount, tablet always 'list').
     */
    setPrevRidesMode(mode: 'condensed' | 'list'): void {
        try {
            this.prevRidesMode = mode
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'setPrevRidesMode')
        }
    }

    protected async checkSecretValidity() {
        if (this.getBindings().appInfo?.getChannel() === 'mobile') {
            const secretsStatus = this.getSecretBinding()?.getSecretsStatus?.()

            if (secretsStatus === 'stale' || secretsStatus === 'missing' || secretsStatus === undefined) {

                if (!this.getOnlineStatusMonitoring().onlineStatus)
                    this.showStartGate()
            }
        }
    }

    protected showStartGate(): void {
        this.startGateProps = {
            title: 'Session refresh needed',
            body: 'Please connect to the internet before starting your ride',
        }
        this.updatePageDisplay()
    }

    protected hideStartgate() {
        this.startGateProps = null;
        this.updatePageDisplay()
    }

    // protected getFreeRideDisplayProps() {
    //     // TODO
    // }

    protected onRouteUpdate() {
        this.updatePageDisplay()
    }

    /**
     * RideDisplayService switched the ride's own type mid-ride - today only ever Video/GPX ->
     * Workout, when the route completed while the workout was still running
     * (RideDisplayService.onRouteCompleted()). The route is already unselected and the display
     * service already replaced by the time this fires; the page layer's job is purely to move the
     * UI to the matching ride screen (§4.5.1).
     *
     * Emits 'ride-type-update' on the page observer - the event all three mobile ride pages
     * already subscribe to (and which, before this, nothing in services ever emitted).
     */
    protected onViewChanged(): void {
        try {
            const rideType = this.getRideDisplay().getRideType()
            this.logEvent({ message: 'ride type changed', rideType })

            // The workout observer subscription survives - it is the same WorkoutRideService
            // instance and the same observer; only the route half went away.
            this.viewTransition = true
            this.getPageObserver()?.emit('ride-type-update', rideType)
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onViewChanged')
        }
    }

    protected get rideDisplayProps() {
        return this.getRideDisplay().getDisplayProperties()
    }

    protected getSecretBinding(): ISecretBinding | undefined {
        return this.getBindings().secret
    }

    // ---- Workout ride methods --------------------------------------------------------

    getGraphActuals(): WorkoutGraphActuals {
        try {
            if (!this.isWorkoutAttached())
                return { power: [], heartrate: [], position: 0 }

            const state = this.getRideDisplay().getState()
            if (state === 'Idle' || state === 'Starting' || state === 'Started') {
                return { power: [], heartrate: [], position: 0 }
            }

            const logs = this.getActivityRide().getActivity()?.logs ?? []
            const power: WorkoutGraphPoint[] = []
            const heartrate: WorkoutGraphPoint[] = []

            logs.forEach(log => {
                if (log.power !== undefined)
                    power.push({ x: log.time, y: log.power })
                if (log.heartrate !== undefined)
                    heartrate.push({ x: log.time, y: log.heartrate })
            })

            return { power, heartrate, position: this.getElapsedActivityTime() }
        }
        catch (err: any) {
            this.logError(err, 'getGraphActuals')
            return { power: [], heartrate: [], position: 0 }
        }
    }

    onStop(): void {
        try {
            this.finishRide()
        }
        catch (err: any) {
            this.logError(err, 'onStop')
        }
    }

    // "Stop Workout, keep riding" (workout-mobile-hld-phase2.md §6.3/§8.3, mobile Phase 2 session
    // 5.3) - distinct from onStop() above, which ends the whole ride. This only detaches the
    // workout; the ride continues as a plain Video/GPX ride. isWorkoutAttached() flips false on
    // the next page-update as a side effect of RideDisplayService.stopWorkout() (WorkoutRide.stop()
    // clears WorkoutRide.inUse()), which is what actually drops the overlay - updatePageDisplay()
    // here just makes that visible immediately rather than waiting for the next unrelated tick.
    onStopWorkout(): void {
        try {
            if (!this.isWorkoutAttached())
                return
            this.getRideDisplay().stopWorkout()
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onStopWorkout')
        }
    }

    onStepBack(): void {
        try {
            if (!this.isWorkoutAttached())
                return
            this.getRideDisplay().backward()
        }
        catch (err: any) {
            this.logError(err, 'onStepBack')
        }
    }

    onStepForward(): void {
        try {
            if (!this.isWorkoutAttached())
                return
            this.getRideDisplay().forward()
        }
        catch (err: any) {
            this.logError(err, 'onStepForward')
        }
    }

    // Per workout-ride-page-service-design.md §6.5: "The menu 'Increase Load' action uses the
    // same increment" as the swipe gesture - both must read the live, user-configurable
    // preferences.workouts.loadIncrement setting (session 5.4/5.10), not a hardcoded default.
    onIncreaseLoad(): void {
        this.adjustLoad(this.getLoadIncrement())
    }

    onDecreaseLoad(): void {
        this.adjustLoad(-this.getLoadIncrement())
    }

    // WorkoutSettingsDialog (session 5.10) - writes the same preferences.workouts.loadIncrement
    // key onIncreaseLoad/onDecreaseLoad and the swipe gesture already read from.
    onSetLoadIncrement(value: number): void {
        try {
            this.getUserSettings().set(LOAD_INCREMENT_SETTING_KEY, value)
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onSetLoadIncrement')
        }
    }

    onGestureHintDismissed({ dontShowAgain }: { dontShowAgain: boolean }): void {
        try {
            this.gestureHintDismissed = true
            if (dontShowAgain) {
                this.getUserSettings().set(HINTS_WORKOUT_GESTURES_KEY, true)
            }
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onGestureHintDismissed')
        }
    }

    /**
     * Adjusts the ride's load (intensity) by the given magnitude.
     *
     * §4.4.5 kept this workout-independent for gear (and hidden) mode on purpose - gating it on
     * `isWorkoutAttached()`/`inUse()` would have broken gear shifting on a plain SIM-mode ride,
     * since `WorkoutRideService.powerUp()`/`powerDown()`'s gear branch (and its `'hidden'` no-op)
     * already touch no workout state at all and work correctly with no workout in use. Only a plain
     * (no-workout) **ERG-mode** adjustment was actually broken: with no workout, `WorkoutRideService.settings`
     * is `undefined`, so its FTP/targetPower branch throws internally, gets swallowed by its own
     * try/catch, and silently no-ops - nothing reaches the trainer. That specific case (and only
     * that one) is rerouted to `RideDisplayService.adjustDevicePower()`, mirroring the ERG branch of
     * `RideDisplayService.adjustPower()` (the existing web-ui/keyboard-shortcut equivalent for a
     * plain ride), just with a return value.
     *
     * @param deltaPct positive to increase, negative to decrease the load; while routed through the
     *        Workout this is the raw magnitude `powerUp()`/`powerDown()` expect (e.g. `1`/`5`,
     *        matching the configured `loadIncrement`); for the plain-ERG reroute it's resolved to a
     *        nominal 5W/50W step via the same `magnitude===1 ? 5 : 50` convention
     *        `getPowerRangeDeltaVal()` uses
     * @returns which quantity was adjusted and its resulting value (in Watt) - see
     *          `WorkoutRideService.powerUp()`/`powerDown()` and `RideDisplayService.adjustDevicePower()`;
     *          `undefined` if it could not be determined
     */
    adjustLoad(deltaPct: number): PowerAdjustmentResult | undefined {
        try {
            const plainErgAdjustment = !this.getWorkoutRide().inUse() && this.getLoadButtonMode()==='power'

            if (plainErgAdjustment) {
                const sign = deltaPct >= 0 ? 1 : -1
                const nominal = Math.abs(deltaPct) === 1 ? 5 : 50
                return this.getRideDisplay().adjustDevicePower(sign * nominal)
            }

            return deltaPct >= 0
                ? this.getWorkoutRide().powerUp(deltaPct)
                : this.getWorkoutRide().powerDown(-deltaPct)
        }
        catch (err: any) {
            this.logError(err, 'adjustLoad')
            return undefined
        }
    }

    /**
     * What a load-adjust action (swipe gesture, menu "Increase/Decrease Load") currently does
     * (FIXES_BACKLOG #37) - `'power'` (nudges targetPower/FTP, ERG mode), `'gear'` (performs a
     * gear shift, SIM/Resistance mode with virtual shifting enabled) or `'hidden'` (meaningless,
     * SIM/Resistance mode with virtual shifting disabled - callers should not surface a load-adjust
     * control at all in this mode). Callers must re-check this at the moment of the gesture/tap
     * (cycling mode can change mid-ride), not cache it - see `useWorkoutRideGestures.ts`.
     *
     * Single source of truth lives in `WorkoutRide.getLoadButtonMode()` (built on the same
     * SIM+virtshift-setting check `RideDisplayService.isVirtualShiftingEnabled()` uses) - this is a
     * thin passthrough so mobile only ever talks to the page service, never the domain service
     * directly.
     */
    getLoadButtonMode(): LoadButtonMode {
        try {
            return this.getWorkoutRide().getLoadButtonMode()
        }
        catch (err: any) {
            this.logError(err, 'getLoadButtonMode')
            return 'power'
        }
    }

    protected getWorkoutRideDisplayProps(): WorkoutRidePageDisplayProps {
        try {
            const rideType = this.getRideDisplay().getRideType()
            if (rideType !== 'Workout') {
                this.logError(new Error(`unexpected ride type '${rideType}' for WorkoutRidePage`), 'getWorkoutRideDisplayProps')
                return this.getEmptyWorkoutDisplayProps()
            }

            const base = this.buildBaseDisplayProps()
            const wo = this.getWorkoutRide().getDashboardDisplayProperties()
            const current = this.getRideDisplay().getDisplayProperties().workout

            return {
                ...base,
                // base.menuProps is only ever populated here via this class's own
                // buildPausedMenuProps()/buildFinishedMenuProps()/onMenuOpen()/onMenuClose()
                // handling for a Workout ride, which always shapes it as WorkoutRideMenuProps -
                // buildBaseDisplayProps()'s field itself is typed to the wider (Video/GPX-
                // compatible) RideMenuProps.
                menuProps: base.menuProps as WorkoutRideMenuProps | null,
                workoutAttached: true,
                title: wo.title ?? '',
                graph: this.buildGraphPlan(current, wo.ftp),
                steps: this.buildUpcomingSteps(current, wo.ftp),
                dashboard: this.buildDashboardLine(wo)
            }
        }
        catch (err: any) {
            this.logError(err, 'getWorkoutRideDisplayProps')
            return this.getEmptyWorkoutDisplayProps()
        }
    }

    // ---- workout observer handling -----------------------------------------

    protected onWorkoutUpdate(): void {
        this.updatePageDisplay()
    }

    /**
     * The workout ended (completed on its own, or stopped by the rider) - NOT necessarily the ride.
     *
     * A workout-only ride ends with its workout: it has no route to fall back to, so the menu flips
     * to its terminal 'finished' shape and the rider lands on the Activity Summary (FIXES_BACKLOG
     * #24, bug 2/2 - the finalisation itself is RideDisplayService.onWorkoutCompleted()'s
     * stopRide(), not this method's).
     *
     * A route ride does not: the workout dropping away just returns it to a plain GPX/Video ride,
     * still running. RideDisplayService.onWorkoutCompleted() already makes exactly this distinction
     * on the domain side (it only calls stopRide() when getRideType()==='Workout'); the page layer
     * has to mirror that branch here or a completing workout would navigate the rider off a
     * still-running route ride.
     *
     * Re-entrant by design: RideDisplayService.stop() re-emits the workout's own completed/stopped
     * event, so this can fire more than once per ride. Every branch is idempotent.
     */
    protected onWorkoutFinished(): void {
        try {
            if (this.isRideType('Workout'))
                this.menuProps = this.buildFinishedMenuProps()

            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onWorkoutFinished')
        }
    }

    /**
     * The *ride* ended - manual "End Ride" from a workout ride's menu (onStop()). Sets the finished
     * menu directly rather than routing through onWorkoutFinished(), which since Phase 2 only
     * speaks for the workout (above) and would no longer do it for a combo ride.
     */
    protected finishRide(): void {
        this.getRideDisplay().stop(true)
        this.menuProps = this.buildFinishedMenuProps()
        this.updatePageDisplay()
    }

    protected subscribeToWorkoutObserver(): void {
        if (this.workoutObserverSubscribed || !this.isWorkoutAttached())
            return

        const observer = this.getWorkoutRide().getObserver()
        if (!observer)
            return

        this.registerHandlers(observer, this.workoutEventHandler)
        this.workoutObserver = observer
        this.workoutObserverSubscribed = true
    }

    protected unsubscribeFromWorkoutObserver(): void {
        if (!this.workoutObserverSubscribed)
            return

        // Unregister from the instance we actually subscribed to. WorkoutRideService.getObserver()
        // returns undefined once its state is back to 'idle' (resetWorkout()), which happens a tick
        // after a workout ends - far more reachable on a combo ride, where the workout can finish
        // long before the page closes. Reading it fresh at close time would silently leave the
        // handlers attached and the flag stuck true.
        this.unregisterHandlers(this.workoutObserver, this.workoutEventHandler)
        this.workoutObserver = undefined
        this.workoutObserverSubscribed = false
    }

    // ---- workout display-props builders (§6.6-§6.8) --------------------------------------

    // Non-null only when the start overlay has fully cleared AND elapsed ride time is 0 AND
    // cadence is 0 (genuinely no pedaling yet - these two are checked separately from
    // "start overlay cleared" since they can diverge) AND the persisted hint flag isn't set.
    // Explicit-dismissal (onGestureHintDismissed) also suppresses it for the rest of this ride.
    protected buildGestureHint(startOverlayCleared: boolean): WorkoutGestureHint | null {
        if (this.gestureHintDismissed || !startOverlayCleared)
            return null

        if (this.getElapsedActivityTime() !== 0 || this.getCurrentCadence() !== 0)
            return null

        if (this.getUserSettings().get(HINTS_WORKOUT_GESTURES_KEY, false))
            return null

        return { visible: true }
    }

    protected getCurrentCadence(): number {
        return this.getActivityRide().getCurrentValues?.()?.cadence ?? 0
    }

    protected getLoadIncrement(): number {
        return this.getUserSettings().get(LOAD_INCREMENT_SETTING_KEY, DEFAULT_LOAD_INCREMENT)
    }

    protected buildGraphPlan(current: Workout | undefined, ftp: number): WorkoutGraphPlan {
        if (!current) {
            return { bars: [], ftp: ftp ?? 0, ftpLine: ftp ?? 0, domain: { x: [0, 0], y: [0, 0] } }
        }

        const bars = getWorkoutGraphSeries(current, { ftp, absValues: true })
        const lastBarX = bars.length ? bars.at(-1).x : 0
        // A malformed step (e.g. an imported workout with an unparseable duration) can leave
        // lastBarX/current.duration NaN, and Math.max propagates NaN from any argument - filter
        // non-finite candidates out rather than trusting each source individually, so a NaN
        // domain bound never reaches the mobile graph's <Path> "d" strings (fatal Android OOM).
        const maxXCandidates = [this.getLastLogTime(), lastBarX, current.duration ?? 0].filter(Number.isFinite)
        const maxX = maxXCandidates.length ? Math.max(...maxXCandidates) : 0
        const maxBarPower = bars.length ? Math.max(...bars.map(b => b.y)) : 0

        return {
            bars,
            ftp,
            ftpLine: ftp,
            domain: { x: [0, maxX], y: [0, maxBarPower * 1.1] }
        }
    }

    protected buildUpcomingSteps(current: Workout | undefined, ftp: number): WorkoutUpcomingSteps {
        const empty: WorkoutUpcomingSteps = { previous: null, current: null, upcoming: [], hasMore: false }
        if (!current)
            return empty

        const limits = this.getWorkoutRide().getCurrentLimits()
        if (!limits)
            return empty

        const currentStep: WorkoutStepDisplay = {
            label: getStepTargetText(limits.step ?? {}, ftp),
            targetPower: limits.targetPower ?? null,
            duration: limits.duration,
            remaining: limits.remaining,
            isCurrent: true
        }

        // Flattened (repeat-expanded) - a repeated segment contributes one entry per repetition
        // here, not one blob for the whole segment (§ getFlattenedSteps).
        const elapsedTime = this.getElapsedActivityTime()
        const flattened = getFlattenedSteps(current)
        const currentIndex = flattened.findIndex(s => s.start <= elapsedTime && s.end > elapsedTime)

        const toDisplay = (entry: { step: StepDefinition, duration: number }): WorkoutStepDisplay => ({
            label: getStepTargetText(entry.step, ftp),
            targetPower: this.getStepAbsolutePower(entry.step, ftp),
            duration: entry.duration,
            remaining: null,
            isCurrent: false
        })

        if (currentIndex === -1)
            return { previous: null, current: currentStep, upcoming: [], hasMore: false }

        const previous = currentIndex > 0 ? toDisplay(flattened[currentIndex - 1]) : null
        const upcomingEntries = flattened.slice(currentIndex + 1, currentIndex + 1 + UPCOMING_STEPS_COUNT)
        const upcoming = upcomingEntries.map(toDisplay)
        const hasMore = currentIndex + 1 + UPCOMING_STEPS_COUNT < flattened.length

        return { previous, current: currentStep, upcoming, hasMore }
    }

    // "260W at 100-120HR for 5min - VO2 max (3/5)" (getStepTargetText + getStepDuration + the step
    // title/rep count) - one composed phrase, Zwift-style, deliberately not split into separate
    // power/duration/remaining fields (those are already live on WorkoutStepsList's current-step
    // row - repeating them here was the pre-1.0 design and is now considered wrong, session 3.3).
    //
    // WorkoutRide.getStepTitle() (feeding wo.title) is platform-aware (FIXES_BACKLOG #13): on
    // mobile it never repeats the workout name (shown elsewhere on screen), and when neither the
    // segment nor the current step has its own text, it avoids duplicating the "<target> for
    // <duration>" text already built below:
    // - inside a (possibly nameless) repeating segment, it returns just the bare repeat suffix
    //   (e.g. "(1/3)"), which attaches directly here with no separator, not a standalone title
    // - outside any segment, it falls back to the same verbal description computed here too (no
    //   repeat context to show instead) - since it's identical, skip re-appending it
    protected buildDashboardLine(wo: WorkoutDisplayProperties): WorkoutDashboardLine {
        const limits = this.getWorkoutRide().getCurrentLimits()
        const title = wo.title ?? ''

        if (!limits)
            return { text: title, mode: wo.mode ?? null }

        const target = getStepTargetText(limits.step ?? {}, wo.ftp)
        const duration = getStepDuration({ duration: limits.duration })
        const base = `${target} for ${duration}`

        let text = base
        if (title && title !== base)
            text = title.startsWith('(') ? `${base}${title}` : `${base} - ${title}`

        return { text, mode: wo.mode ?? null }
    }

    protected getStepAbsolutePower(step: StepDefinition, ftp?: number): number | null {
        const p = step.power
        if (!p)
            return null

        const val = p.max ?? p.min
        if (val === undefined)
            return null

        if (p.type === 'watt')
            return Math.round(val)

        if (ftp === undefined)
            return null

        return Math.round(val / 100 * ftp)
    }

    protected getStepFlags(): { canStepBack: boolean, canStepForward: boolean } {
        const wo = this.getWorkoutRide().getDashboardDisplayProperties()
        return { canStepBack: !!wo.canShowBackward, canStepForward: !!wo.canShowForward }
    }

    protected getLastLogTime(): number {
        const logs = this.getActivityRide().getActivity()?.logs
        if (!logs || logs.length === 0)
            return 0
        return logs.at(-1).time ?? 0
    }

    protected getElapsedActivityTime(): number {
        return this.getActivityRide().getActivity()?.time ?? 0
    }

    protected getEmptyWorkoutDisplayProps(): WorkoutRidePageDisplayProps {
        return {
            rideState: 'Error',
            rideType: null as unknown as RideType,
            startOverlayProps: null,
            menuProps: null,
            startGateProps: null,
            title: '',
            graph: { bars: [], ftp: 0, ftpLine: 0, domain: { x: [0, 0], y: [0, 0] } },
            steps: { previous: null, current: null, upcoming: [], hasMore: false },
            dashboard: { text: '', mode: null },
            gestureHint: null,
            loadIncrement: DEFAULT_LOAD_INCREMENT,
            loadButtonMode: 'power'
        }
    }

    // ---- shared internals ----------------------------------------------------------

    protected getPageLogName(): string {
        return this.isRideType('Workout') ? 'WorkoutRide' : 'Rides'
    }

    protected requiresOwnInit(): boolean {
        // RideDisplayService is already fully initialized by RidePage.tsx's
        // getRidePageService().initPage() call before a Workout page can ever mount - redoing it
        // here would race with start() (see openPage()). Video/GPX rides do need it.
        return !this.isRideType('Workout')
    }

    protected getBackgroundPauseRequester(): 'user' | 'device' {
        return this.isRideType('Workout') ? 'device' : 'user'
    }

    protected isRideType(...types: RideType[]): boolean {
        try {
            return types.includes(this.getRideDisplay().getRideType())
        }
        catch {
            return false
        }
    }

    /**
     * Whether this ride's workout surface (dashboard, graph, step/load controls, gesture hints) is
     * live. Distinct from getRideType(): a 'Workout' ride always has one; a 'Video'/'GPX' ride has
     * one only when the rider attached it.
     *
     * Uses WorkoutRideService.inUse() - the same predicate RideDisplayService.forward()/backward()
     * already guard on - rather than a selection read, so it goes false the moment the workout
     * completes or is stopped mid-ride and the ride reverts to a plain route ride.
     *
     * A 'Workout' ride short-circuits to true unconditionally - a workout-only ride is Phase 1,
     * already shipped, and doesn't go through WorkoutRideService.inUse() at all.
     *
     * Public (not protected) - part of IRidePageService, called live by useRideGestures.ts's
     * left/right swipe handler (see that interface method's comment).
     */
    isWorkoutAttached(): boolean {
        try {
            if (this.isRideType('Workout'))
                return true
            if (!this.isRideType('Video', 'GPX'))
                return false
            return this.getWorkoutRide().inUse()
        }
        catch (err: any) {
            this.logError(err, 'isWorkoutAttached')
            return false
        }
    }

    protected buildPausedMenuProps(): RideMenuProps | WorkoutRideMenuProps {
        return this.isWorkoutAttached()
            ? { showResume: true, ...this.getStepFlags() }
            : { showResume: true }
    }

    protected buildFinishedMenuProps(): RideMenuProps | WorkoutRideMenuProps {
        return this.isWorkoutAttached()
            ? { showResume: false, finished: true, canStepBack: false, canStepForward: false }
            : { showResume: false, finished: true }
    }

    // gestureHint/loadIncrement/loadButtonMode live here (not in buildWorkoutOverlayProps()'s
    // workout-attached branch, where they used to be computed) because the swipe gesture itself
    // (RidePageService.adjustLoad()/onStepBack()/onStepForward(), §4.4.5) already works correctly
    // on a plain, no-workout Video/GPX ride - mobile's gesture-hint overlay and its content
    // (getGestureHintContent(), incyclist-mobile) need these unconditionally too, or a plain ride
    // never gets a hint at all, even though the gesture underneath it is fully functional.
    protected buildBaseDisplayProps() {
        const state = this.getRideDisplay().getState()
        const isStarting = state === 'Idle' || state === 'Starting' || state === 'Error'
        const startOverlayProps = isStarting ? this.getRideDisplay().getStartOverlayProps() : null

        return {
            rideState: state,
            rideType: this.getRideDisplay().getRideType(),
            startOverlayProps,
            menuProps: this.menuProps,
            startGateProps: this.startGateProps,
            gestureHint: this.buildGestureHint(startOverlayProps === null),
            loadIncrement: this.getLoadIncrement(),
            loadButtonMode: this.getLoadButtonMode(),
            prevRides: this.buildPrevRides()
        }
    }

    /**
     * race-against-yourself-mobile-design.md §5 - built here (not buildWorkoutOverlayProps()) so
     * it's present for every ride type, exactly like gestureHint/loadIncrement/loadButtonMode
     * above. For a route-less Workout ride this naturally resolves to 'hidden': ActivityRideService
     * never populates prevRidesLogs for one (initPrevActivities() is gated on settings.type ===
     * 'Route'), so getPrevRidesListDisplay() always returns an empty array there - no separate
     * route-less-workout guard needed (design doc §3/§5).
     */
    protected buildPrevRides(): RidePageDisplayProps['prevRides'] {
        try {
            const rows = this.getActivityRide().getPrevRidesListDisplay(this.prevRidesVisibleRows) ?? []
            if (rows.length === 0)
                return { mode: 'hidden', rows: [], hasMore: false }

            // Every row's `position` is assigned over the FULL sorted field before trimming
            // (ActivityRideService.getPrevRidesListDisplay()) - so the last (highest-position) row
            // exceeding the returned row count is exactly the "field was trimmed" signal, with no
            // second call (and no second 'PrevRides' log line) needed to learn the untrimmed size.
            const hasMore = (rows.at(-1)?.position ?? rows.length) > rows.length

            return {
                mode: this.prevRidesMode,
                rows: rows.map(row => this.mapPrevRidesRow(row)),
                hasMore
            }
        }
        catch (err: any) {
            this.logError(err, 'buildPrevRides')
            return { mode: 'hidden', rows: [], hasMore: false }
        }
    }

    protected mapPrevRidesRow(row: PrevRidesListDisplayProps): PrevRidesRowProps {
        const isCurrent = row.title === 'current'
        const speed = typeof row.speed === 'object' ? row.speed?.value : row.speed
        const distanceGap = typeof row.distanceGap === 'object'
            ? `${row.distanceGap.value}${row.distanceGap.unit}`
            : row.distanceGap

        return {
            position: row.position ?? 0,
            label: isCurrent ? 'You' : row.title,
            timeGap: row.timeGap,
            distanceGap,
            isCurrent,
            avatar: row.avatar,
            speed,
            power: row.power,
            heartrate: row.heartrate
        }
    }

    protected onDisplayStateUpdate(state: CurrentRideState) {
        // The workout observer may only become available once the ride is actually running -
        // (re-)subscribe here in addition to onRideHandlersRegistered's initial attempt.
        this.subscribeToWorkoutObserver()

        switch (state) {
            case 'Paused':
                this.menuProps = this.buildPausedMenuProps()
                break
            case 'Finished':
                this.menuProps = this.buildFinishedMenuProps()
                this.updatePageDisplay()
                return
            case 'Active':
                this.menuProps = null
                break
        }
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

    @Injectable
    protected getRideDisplay() {
        return useRideDisplay()
    }

    @Injectable
    protected getWorkoutRide() {
        return useWorkoutRide()
    }

    @Injectable
    protected getActivityRide() {
        return useActivityRide()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getOnlineStatusMonitoring() {
        return useOnlineStatusMonitoring()
    }

}


/**
 * Single factory for the ride page service (FIXES_BACKLOG #24) - RidePageService handles
 * Video/GPX/Workout ride types internally, so this is just the @Singleton-backed accessor, with
 * no ride-type branching or instanceof checks needed at any call site.
 */
export const getRidePageService = (): IRidePageService => {
    return new RidePageService()
}
