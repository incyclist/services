import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { CurrentRideDisplayProps, CurrentRideState, GpxDisplayProps, IObserver, RideType, RLVDisplayProps } from "../../types";
import {
    AnyRidePageDisplayProps,
    GPXRidePageDisplayProps,
    IRidePageService,
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
import { useActivityRide } from "../../activities";
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
    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService: boolean = false
    protected menuProps: RideMenuProps | null = null
    protected isInitialized: boolean = false
    protected startGateProps: StartGateProps | null = null

    // this-ride-only suppression of the gesture-hint overlay (reset on every openPage()) -
    // distinct from the persisted hints.workoutRideGestures flag, which suppresses it forever.
    protected gestureHintDismissed = false

    constructor() {
        super('RidePage')

        this.eventHandler['state-update'] = this.onDisplayStateUpdate.bind(this)
        this.eventHandler['route-update'] = this.onRouteUpdate.bind(this)

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
            this.menuProps = this.isRideType('Workout')
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
        const props: RLVDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & RLVDisplayProps

        const displayProps: VideoRidePageDisplayProps = {
            ...this.buildBaseDisplayProps(),
            video: props.video,
            videos: props.videos,
            route: props.route
        }
        return displayProps
    }

    protected getGPXRideDisplayProps(): GPXRidePageDisplayProps {
        const props: GpxDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & GpxDisplayProps

        const displayProps: GPXRidePageDisplayProps = {
            ...this.buildBaseDisplayProps(),
            rideView: props.rideView,
            route: props.route,
            displayObserver: props.displayObserver
        }
        return displayProps
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

    protected get rideDisplayProps() {
        return this.getRideDisplay().getDisplayProperties()
    }

    protected getSecretBinding(): ISecretBinding | undefined {
        return this.getBindings().secret
    }

    // ---- Workout ride methods --------------------------------------------------------

    getGraphActuals(): WorkoutGraphActuals {
        try {
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

    onStepBack(): void {
        try {
            this.getRideDisplay().backward()
        }
        catch (err: any) {
            this.logError(err, 'onStepBack')
        }
    }

    onStepForward(): void {
        try {
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
     * Adjusts the workout load (intensity) by the given percentage.
     *
     * @param deltaPct positive to increase, negative to decrease the load
     * @returns which quantity was adjusted and its resulting value (in Watt) - see
     *          `WorkoutRideService.powerUp()`/`powerDown()`; `undefined` if it could not be
     *          determined (e.g. no FTP configured and the current step isn't a power range).
     */
    adjustLoad(deltaPct: number): PowerAdjustmentResult | undefined {
        try {
            if (deltaPct >= 0)
                return this.getWorkoutRide().powerUp(deltaPct)
            else
                return this.getWorkoutRide().powerDown(-deltaPct)
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
                title: wo.title ?? '',
                graph: this.buildGraphPlan(current, wo.ftp),
                steps: this.buildUpcomingSteps(current, wo.ftp),
                dashboard: this.buildDashboardLine(wo),
                gestureHint: this.buildGestureHint(base.startOverlayProps === null),
                loadIncrement: this.getLoadIncrement(),
                loadButtonMode: wo.loadButtonMode ?? 'power'
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

    protected onWorkoutFinished(): void {
        try {
            this.menuProps = this.buildFinishedMenuProps()
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onWorkoutFinished')
        }
    }

    // Shared by onStop() (manual "End Ride") and onWorkoutFinished() (auto-completion once
    // WorkoutRideService.checkIfDone() fires 'completed'/'stopped') - both must finalize the
    // activity via RideDisplay.stop(true) before converging onto onWorkoutFinished()/
    // menuProps.finished, so a workout that completes on its own lands on the Activity Summary
    // the same way a manual "End Ride" tap does (FIXES_BACKLOG #24, bug 2/2).
    protected finishRide(): void {
        this.getRideDisplay().stop(true)
        this.onWorkoutFinished()
    }

    protected subscribeToWorkoutObserver(): void {
        if (!this.isRideType('Workout') || this.workoutObserverSubscribed)
            return

        const observer = this.getWorkoutRide().getObserver()
        if (!observer)
            return

        this.registerHandlers(observer, this.workoutEventHandler)
        this.workoutObserverSubscribed = true
    }

    protected unsubscribeFromWorkoutObserver(): void {
        if (!this.workoutObserverSubscribed)
            return

        this.unregisterHandlers(this.getWorkoutRide().getObserver(), this.workoutEventHandler)
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

    protected buildPausedMenuProps(): RideMenuProps | WorkoutRideMenuProps {
        return this.isRideType('Workout')
            ? { showResume: true, ...this.getStepFlags() }
            : { showResume: true }
    }

    protected buildFinishedMenuProps(): RideMenuProps | WorkoutRideMenuProps {
        return this.isRideType('Workout')
            ? { showResume: false, finished: true, canStepBack: false, canStepForward: false }
            : { showResume: false, finished: true }
    }

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
