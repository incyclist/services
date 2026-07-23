import { EventLogger } from "gd-eventlog"
import { Injectable } from "../../../base/decorators"
import { Singleton } from "../../../base/types"
import { IncyclistPageService } from "../../../base/pages"
import type { IObserver } from "../../../base/typedefs"
import type { CurrentRideState, RideType } from "../../../types"
import { useRideDisplay } from "../../../ride/display"
import { useActivityRide } from "../../../activities"
import { useWorkoutRide } from "../service"
import type { WorkoutDisplayProperties } from "../types"
import { getFlattenedSteps, getStepDuration, getStepTargetText, getWorkoutGraphSeries } from "../../base/graph"
import type { Workout } from "../../base/model"
import type { StepDefinition } from "../../base/model/types"
import type {
    IWorkoutRidePageService,
    WorkoutDashboardLine,
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

@Singleton
export class WorkoutRidePageService extends IncyclistPageService implements IWorkoutRidePageService {

    protected rideEventHandler: Record<string, any> = {}
    protected workoutEventHandler: Record<string, any> = {}
    protected workoutObserverSubscribed = false

    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService = false
    protected menuProps: WorkoutRideMenuProps | null = null
    protected isInitialized = false

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

            super.openPage()

            try {
                const service = this.getRideDisplay()

                if (!this.isInitialized) {
                    service.init()
                    this.isInitialized = true
                }
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
                title: wo.title ?? '',
                graph: this.buildGraphPlan(current, wo.ftp),
                steps: this.buildUpcomingSteps(current, wo.ftp),
                dashboard: this.buildDashboardLine(wo)
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

    // The menu's "Increase/Decrease Load" action always uses the same default increment;
    // a swipe gesture (session 5.4) instead sources its own increment and calls adjustLoad() directly.
    onIncreaseLoad(): void {
        this.adjustLoad(DEFAULT_LOAD_INCREMENT)
    }

    onDecreaseLoad(): void {
        this.adjustLoad(-DEFAULT_LOAD_INCREMENT)
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

    adjustLoad(deltaPct: number): void {
        try {
            if (deltaPct >= 0)
                this.getWorkoutRide().powerUp(deltaPct)
            else
                this.getWorkoutRide().powerDown(-deltaPct)
        }
        catch (err: any) {
            this.logError(err, 'adjustLoad')
        }
    }

    // ---- ride/workout observer handling -----------------------------------------

    protected onRideStateUpdate(state: CurrentRideState): void {
        this.subscribeToWorkoutObserver()

        switch (state) {
            case 'Paused':
                this.menuProps = { showResume: true, ...this.getStepFlags() }
                this.updatePageDisplay()
                break
            case 'Active':
                this.menuProps = null
                this.updatePageDisplay()
                break
            case 'Finished':
                this.emitNavigateBack()
                break
            case 'Error':
                this.updatePageDisplay()
                break
        }
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
            label: getStepTargetText(limits.step ?? {}, ftp, { min: limits.minPower, max: limits.maxPower }),
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
    protected buildDashboardLine(wo: WorkoutDisplayProperties): WorkoutDashboardLine {
        const limits = this.getWorkoutRide().getCurrentLimits()
        const title = wo.title ?? ''

        if (!limits)
            return { text: title, mode: wo.mode ?? null }

        const target = getStepTargetText(limits.step ?? {}, wo.ftp, { min: limits.minPower, max: limits.maxPower })
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
            dashboard: { text: '', mode: null }
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
}

export const getWorkoutRidePageService = () => new WorkoutRidePageService()
