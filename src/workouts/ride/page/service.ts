import { Injectable } from "../../../base/decorators"
import { Singleton } from "../../../base/types"
import { RidePageServiceBase } from "../../../ride/page/base"
import type { IRidePageService } from "../../../ride/page/types"
import type { CurrentRideState, RideType } from "../../../types"
import { useActivityRide } from "../../../activities"
import { useRideDisplay } from "../../../ride/display"
import { useUserSettings } from "../../../settings"
import { useWorkoutRide } from "../service"
import type { PowerAdjustmentResult, WorkoutDisplayProperties } from "../types"
import { getFlattenedSteps, getStepDuration, getStepTargetText, getWorkoutGraphSeries } from "../../base/graph"
import type { Workout } from "../../base/model"
import type { StepDefinition } from "../../base/model/types"
import type {
    WorkoutDashboardLine,
    WorkoutGestureHint,
    WorkoutGraphActuals,
    WorkoutGraphPlan,
    WorkoutGraphPoint,
    WorkoutRideMenuProps,
    WorkoutRidePageDisplayProps,
    WorkoutStepDisplay,
    WorkoutUpcomingSteps
} from "./types"

const UPCOMING_STEPS_COUNT = 3
const DEFAULT_LOAD_INCREMENT = 1
const HINTS_WORKOUT_GESTURES_KEY = 'hints.workoutRideGestures'
// Same key mobile's useWorkoutRideGestures.ts (session 5.4) already reads - do not introduce a
// second key for the same setting.
const LOAD_INCREMENT_SETTING_KEY = 'preferences.workouts.loadIncrement'

@Singleton
export class WorkoutRidePageService extends RidePageServiceBase implements IRidePageService {

    protected workoutEventHandler: Record<string, any> = {}
    protected workoutObserverSubscribed = false

    // this-ride-only suppression of the gesture-hint overlay (reset on every openPage()) -
    // distinct from the persisted hints.workoutRideGestures flag, which suppresses it forever.
    protected gestureHintDismissed = false

    constructor() {
        super('WorkoutRidePage')

        this.workoutEventHandler['step-changed'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['update'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['forward'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['backward'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['completed'] = this.onFinished.bind(this)
        this.workoutEventHandler['stopped'] = this.onFinished.bind(this)
    }

    protected getPageLogName(): string {
        return 'WorkoutRide'
    }

    protected requiresOwnInit(): boolean {
        // RideDisplayService is already fully initialized by RidePage.tsx's
        // getRidePageService().initPage() before WorkoutRidePage can ever mount - calling
        // init() again here would race with the start() below and tear the ride back down
        // mid-connect via closePrevRide()'s stopRide() (see the bug this comment replaces:
        // device-start listeners got silently unregistered).
        return false
    }

    protected getBackgroundPauseRequester(): 'user' | 'device' {
        return 'device'
    }

    protected resetPageState(): void {
        this.gestureHintDismissed = false
    }

    protected onRideHandlersRegistered(): void {
        this.subscribeToWorkoutObserver()
    }

    protected onBeforeDisplayStateUpdate(_state: CurrentRideState): void {
        this.subscribeToWorkoutObserver()
    }

    // TODO(FIXES_BACKLOG #24, bug 2/2): still bypasses the Activity Summary via the legacy
    // 'navigate-back' page-observer event, unlike onFinished() (the workout-observer
    // 'completed'/'stopped' path) which already converges onto menuProps.finished. Kept exactly
    // as-is for this structural-extraction commit; converged onto buildFinishedMenuProps() in the
    // next (behavioral) commit, which also deletes emitNavigateBack()/'navigate-back' entirely.
    protected onRideFinishedState(): void {
        this.emitNavigateBack()
    }

    protected onClosePage(): void {
        this.unsubscribeFromWorkoutObserver()
    }

    protected buildPausedMenuProps(): WorkoutRideMenuProps {
        return { showResume: true, ...this.getStepFlags() }
    }

    protected buildFinishedMenuProps(): WorkoutRideMenuProps {
        return { showResume: false, finished: true, canStepBack: false, canStepForward: false }
    }

    // ---- display props ---------------------------------------------------------

    getPageDisplayProps(): WorkoutRidePageDisplayProps {
        try {
            const rideType = this.getRideDisplay().getRideType()
            if (rideType !== 'Workout') {
                this.logError(new Error(`unexpected ride type '${rideType}' for WorkoutRidePage`), 'getPageDisplayProps')
                return this.getEmptyDisplayProps()
            }

            const base = this.buildBaseDisplayProps()
            const wo = this.getWorkoutRide().getDashboardDisplayProperties()
            const current = this.getRideDisplay().getDisplayProperties().workout

            return {
                ...base,
                // base.menuProps is only ever populated here via this class's own
                // buildPausedMenuProps()/buildFinishedMenuProps()/onMenuOpen()/onMenuClose()
                // overrides, which always shape it as WorkoutRideMenuProps - RidePageServiceBase's
                // field itself is typed to the wider (Video/GPX-compatible) RideMenuProps.
                menuProps: base.menuProps as WorkoutRideMenuProps | null,
                title: wo.title ?? '',
                graph: this.buildGraphPlan(current, wo.ftp),
                steps: this.buildUpcomingSteps(current, wo.ftp),
                dashboard: this.buildDashboardLine(wo),
                gestureHint: this.buildGestureHint(base.startOverlayProps === null),
                loadIncrement: this.getLoadIncrement()
            }
        }
        catch (err: any) {
            this.logError(err, 'getPageDisplayProps')
            return this.getEmptyDisplayProps()
        }
    }

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

    // ---- callbacks -------------------------------------------------------------

    onMenuOpen(): void {
        try {
            const state = this.getRideDisplay().getState()
            this.menuProps = { showResume: state === 'Paused', ...this.getStepFlags() }
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onMenuOpen')
        }
    }

    onMenuClose(): void {
        try {
            this.menuProps = null
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onMenuClose')
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
    // Previously hardcoded DEFAULT_LOAD_INCREMENT here, silently diverging from the swipe
    // gesture (which already read the live setting via useWorkoutRideGestures.ts) as soon as a
    // user changed the increment via WorkoutSettingsDialog (5.10) - found during the 6.1
    // integration pass.
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

    // ---- workout observer handling -----------------------------------------

    protected onWorkoutUpdate(): void {
        this.updatePageDisplay()
    }

    protected onFinished(): void {
        try {
            this.menuProps = this.buildFinishedMenuProps()
            this.updatePageDisplay()
        }
        catch(err:any) {
            this.logError(err,'onFinished')
        }
    }

    // Shared by onStop() (manual "End Ride") and onFinished() (auto-completion once
    // WorkoutRideService.checkIfDone() fires 'completed'/'stopped') - both must finalize the
    // activity via RideDisplay.stop(true) before navigating back, so a workout that completes on
    // its own also lands on a populated Ride Summary instead of requiring a manual "End Ride" tap.
    //
    // TODO(FIXES_BACKLOG #24, bug 2/2): kept exactly as-is (still calling emitNavigateBack(), the
    // legacy 'navigate-back' page-observer event) for this structural-extraction commit; converged
    // onto onFinished()/menuProps.finished in the next (behavioral) commit, which also deletes
    // emitNavigateBack()/'navigate-back' entirely.
    protected finishRide(): void {
        this.getRideDisplay().stop(true)
        this.emitNavigateBack()
    }

    protected emitNavigateBack(): void {
        this.getPageObserver()?.emit('navigate-back')
    }

    protected subscribeToWorkoutObserver(): void {
        if (this.workoutObserverSubscribed)
            return

        const observer = this.getWorkoutRide().getObserver()
        if (!observer)
            return

        Object.keys(this.workoutEventHandler).forEach(event => observer.on(event, this.workoutEventHandler[event]))
        this.workoutObserverSubscribed = true
    }

    protected unsubscribeFromWorkoutObserver(): void {
        if (!this.workoutObserverSubscribed)
            return

        const observer = this.getWorkoutRide().getObserver()
        Object.keys(this.workoutEventHandler).forEach(event => observer?.off(event, this.workoutEventHandler[event]))
        this.workoutObserverSubscribed = false
    }

    // ---- display-props builders (§6.6-§6.8) --------------------------------------

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
        if (title && title!==base)
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

    protected getEmptyDisplayProps(): WorkoutRidePageDisplayProps {
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
            loadIncrement: DEFAULT_LOAD_INCREMENT
        }
    }

    // Kept per-subclass rather than shared on RidePageServiceBase - see the import-cycle note on
    // RidePageServiceBase.getRideDisplay().
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
}

// TODO(FIXES_BACKLOG #24): dropped once getRidePageService() becomes the single factory that
// resolves the correct concrete subclass itself - kept for this structural-extraction commit so
// mobile's existing getWorkoutRidePageService() call sites keep compiling unchanged until then.
export const getWorkoutRidePageService = () => new WorkoutRidePageService()
