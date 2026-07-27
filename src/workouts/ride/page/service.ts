import { EventLogger } from "gd-eventlog"
import { Injectable } from "../../../base/decorators"
import { Singleton } from "../../../base/types"
import { IncyclistPageService } from "../../../base/pages"
import type { IObserver } from "../../../base/typedefs"
import type { CurrentRideState, RideType } from "../../../types"
import { useRideDisplay } from "../../../ride/display"
import { useActivityRide } from "../../../activities"
import { useUserSettings } from "../../../settings"
import { useWorkoutRide } from "../service"
import type { PowerAdjustmentResult, WorkoutDisplayProperties } from "../types"
import { getFlattenedSteps, getStepDuration, getStepTargetText, getWorkoutGraphSeries } from "../../base/graph"
import type { Workout } from "../../base/model"
import type { StepDefinition } from "../../base/model/types"
import type {
    IWorkoutRidePageService,
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

const BACKGROUND_PAUSE_TIMEOUT_MS = 300000
const UPCOMING_STEPS_COUNT = 3
const DEFAULT_LOAD_INCREMENT = 1
const HINTS_WORKOUT_GESTURES_KEY = 'hints.workoutRideGestures'
// Same key mobile's useWorkoutRideGestures.ts (session 5.4) already reads - do not introduce a
// second key for the same setting.
const LOAD_INCREMENT_SETTING_KEY = 'preferences.workouts.loadIncrement'

@Singleton
export class WorkoutRidePageService extends IncyclistPageService implements IWorkoutRidePageService {

    protected rideEventHandler: Record<string, any> = {}
    protected workoutEventHandler: Record<string, any> = {}
    protected workoutObserverSubscribed = false

    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService = false
    protected menuProps: WorkoutRideMenuProps | null = null
    // this-ride-only suppression of the gesture-hint overlay (reset on every openPage()) -
    // distinct from the persisted hints.workoutRideGestures flag, which suppresses it forever.
    protected gestureHintDismissed = false

    constructor() {
        super('WorkoutRidePage')

        this.rideEventHandler['state-update'] = this.onRideStateUpdate.bind(this)

        this.workoutEventHandler['step-changed'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['update'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['forward'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['backward'] = this.onWorkoutUpdate.bind(this)
        this.workoutEventHandler['completed'] = this.onWorkoutFinished.bind(this)
        this.workoutEventHandler['stopped'] = this.onWorkoutFinished.bind(this)
    }

    // ---- lifecycle -----------------------------------------------------------

    openPage(simulate?: boolean): IObserver {
        try {
            this.logEvent({ message: 'page shown', page: 'WorkoutRide' })
            EventLogger.setGlobalConfig('page', 'WorkoutRide')

            this.gestureHintDismissed = false
            super.openPage()

            try {
                const service = this.getRideDisplay()

                // RideDisplayService is already fully initialized by RidePage.tsx's
                // getRidePageService().initPage() before WorkoutRidePage can ever mount -
                // calling init() again here would race with the start() below and tear the
                // ride back down mid-connect via closePrevRide()'s stopRide() (see the bug
                // this comment replaces: device-start listeners got silently unregistered).
                this.registerRideEventHandlers()
                this.subscribeToWorkoutObserver()
                service.start(simulate)
            }
            catch (err: any) {
                this.logError(err, 'openPage')
            }
        }
        catch (err: any) {
            this.logError(err, 'openPage')
        }
        return this.getPageObserver()
    }

    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page', null)
            this.logEvent({ message: 'page closed', page: 'WorkoutRide' })

            this.getRideDisplay().stop(true)
            this.unregisterRideEventHandlers()
            this.unsubscribeFromWorkoutObserver()
            this.menuProps = null
            super.closePage()
        }
        catch (err: any) {
            this.logError(err, 'closePage')
        }
    }

    async pausePage(): Promise<void> {
        try {
            this.backgroundTimer = setTimeout(() => {
                this.getRideDisplay().pause('device')
                this.backgroundPausedByService = true
            }, BACKGROUND_PAUSE_TIMEOUT_MS)

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

    // ---- display props ---------------------------------------------------------

    getPageDisplayProps(): WorkoutRidePageDisplayProps {
        try {
            const rideType = this.getRideDisplay().getRideType()
            if (rideType !== 'Workout') {
                this.logError(new Error(`unexpected ride type '${rideType}' for WorkoutRidePage`), 'getPageDisplayProps')
                return this.getEmptyDisplayProps()
            }

            const base = this.buildBaseProps()
            const wo = this.getWorkoutRide().getDashboardDisplayProperties()
            const current = this.getRideDisplay().getDisplayProperties().workout

            return {
                ...base,
                title: this.getMobileStepTitle(wo),
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

    onPause(): void {
        try {
            this.getRideDisplay().pause('user')
            this.menuProps = { showResume: true, ...this.getStepFlags() }
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

    onStop(): void {
        try {
            this.getRideDisplay().stop(true)
            this.emitNavigateBack()
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
    // key onIncreaseLoad/onDecreaseLoad and the swipe gesture (session 5.4) already read from.
    onSetLoadIncrement(value: number): void {
        try {
            this.getUserSettings().set(LOAD_INCREMENT_SETTING_KEY, value)
            this.updatePageDisplay()
        }
        catch (err: any) {
            this.logError(err, 'onSetLoadIncrement')
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

    // ---- ride/workout observer handling -----------------------------------------

    protected onRideStateUpdate(state: CurrentRideState): void {
        this.subscribeToWorkoutObserver()

        switch (state) {
            case 'Paused':
                this.menuProps = { showResume: true, ...this.getStepFlags() }
                break
            case 'Active':
                this.menuProps = null
                break
            case 'Finished':
                this.emitNavigateBack()
                return
        }
        this.updatePageDisplay()
    }

    protected onWorkoutUpdate(): void {
        this.updatePageDisplay()
    }

    protected onWorkoutFinished(): void {
        this.emitNavigateBack()
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

    protected registerRideEventHandlers(): void {
        Object.keys(this.rideEventHandler).forEach(event => this.rideObserver?.on(event, this.rideEventHandler[event]))
    }

    protected unregisterRideEventHandlers(): void {
        Object.keys(this.rideEventHandler).forEach(event => this.rideObserver?.off(event, this.rideEventHandler[event]))
    }

    // ---- display-props builders (§6.6-§6.8) --------------------------------------

    protected buildBaseProps() {
        const state = this.getRideDisplay().getState()
        const isStarting = state === 'Idle' || state === 'Starting' || state === 'Error'

        return {
            rideState: state,
            rideType: this.getRideDisplay().getRideType(),
            startOverlayProps: isStarting ? this.getRideDisplay().getStartOverlayProps() : null,
            menuProps: this.menuProps,
            startGateProps: null
        }
    }

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

    // WorkoutRide.getStepTitle() (feeding wo.title) is shared with desktop/web, which does want the
    // workout name prefixed - so that method is not touched here. Mobile shows the workout name
    // elsewhere on screen, so it must not be repeated in the step title or dashboard shoutout line;
    // strip exactly the "<workout name>: " prefix getStepTitle() always adds when a name is set,
    // rather than reimplementing its segment/step/repeat composition (FIXES_BACKLOG #13).
    protected getMobileStepTitle(wo: WorkoutDisplayProperties): string {
        const title = wo.title ?? ''
        const name = wo.workout?.name
        const prefix = name ? `${name}: ` : ''
        return prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title
    }

    // "260W at 100-120HR for 5min - VO2 max (3/5)" (getStepTargetText + getStepDuration + the step
    // title/rep count) - one composed phrase, Zwift-style, deliberately not split into separate
    // power/duration/remaining fields (those are already live on WorkoutStepsList's current-step
    // row - repeating them here was the pre-1.0 design and is now considered wrong, session 3.3).
    protected buildDashboardLine(wo: WorkoutDisplayProperties): WorkoutDashboardLine {
        const limits = this.getWorkoutRide().getCurrentLimits()
        const title = this.getMobileStepTitle(wo)

        if (!limits)
            return { text: title, mode: wo.mode ?? null }

        const target = getStepTargetText(limits.step ?? {}, wo.ftp)
        const duration = getStepDuration({ duration: limits.duration })
        const text = title ? `${target} for ${duration} - ${title}` : `${target} for ${duration}`

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

    protected updatePageDisplay(): void {
        this.getPageObserver()?.emit('page-update')
    }

    protected emitNavigateBack(): void {
        this.getPageObserver()?.emit('navigate-back')
    }

    protected moveToPreviousPage(): void {
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
}

export const getWorkoutRidePageService = () => new WorkoutRidePageService()
