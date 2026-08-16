import { IPageService } from "../../base/pages"
import { Route } from "../../routes/base/model/route"
import { IObserver, RideType } from "../../types"
import { CurrentPosition, CurrentRideState, GPXStartOverlayProps, RideViewType, StartOverlayProps, StreetViewEvent, VideoDisplayProps, VideoStartOverlayProps } from "../types"
import type { LoadButtonMode, PowerAdjustmentResult } from "../../workouts/ride/types"
import type { WorkoutGraphPlanBar } from "../../workouts/base/graph/types"


export interface StartGateProps {
    title: string
    body: string
}

export interface RideMenuProps {
    showResume?: boolean    // true = Resume button, false = Pause button
    finished?:boolean       // true = Activity is completed (finished)

    // Workout-only - present on a Workout ride's menu. Folded in here as optional (rather than a
    // separate WorkoutRideMenuProps branch) so RideMenuProps alone already covers every ride type -
    // see WorkoutRideMenuProps below for a variant that guarantees them.
    canStepBack?: boolean
    canStepForward?: boolean
}

// Base -- common to all ride types. Workout-only fields (graph/steps/dashboard/title/gestureHint/
// loadIncrement) are folded in here as optional, rather than kept on a separate
// WorkoutRidePageDisplayProps branch - so this one shape already covers every ride type, and
// AnyRidePageDisplayProps below no longer needs a dedicated Workout variant.
export interface RidePageDisplayProps {
    rideState:         CurrentRideState
    rideType:          RideType
    startOverlayProps: StartOverlayProps | GPXStartOverlayProps | VideoStartOverlayProps | null
    menuProps:         RideMenuProps | null
    route?:            Route
    startGateProps:    StartGateProps | null

    graph?:            WorkoutGraphPlan
    steps?:            WorkoutUpcomingSteps
    dashboard?:        WorkoutDashboardLine
    title?:            string
    gestureHint?:       WorkoutGestureHint | null
    loadIncrement?:    number

    // NEW - Phase 2. True when the workout surface is live (see RidePageService.isWorkoutAttached()).
    // Always true for a 'Workout' ride; for 'Video'/'GPX' it is the combo flag the ride screen and
    // the Wave-3 overlay-arrangement hook branch on. Absent/false = render exactly as today.
    workoutAttached?:  boolean
    // NEW - Phase 2. Was previously only on the WorkoutRidePageDisplayProps narrowing; a combo ride
    // needs it too. WorkoutRidePageDisplayProps keeps narrowing it to required.
    loadButtonMode?:   LoadButtonMode
    // NEW - Phase 2 (ride-overlay-layout-design.md §6.4). Phone-fallback corner-widget preference -
    // which of the two competing corner widgets (elevation graph vs. workout info) a combo ride
    // currently shows. Only populated for a Video/GPX ride with a workout attached AND the combo
    // toggle on (RidePageService.getCornerWidget()); undefined elsewhere (default 'elevation').
    cornerWidget?:     'elevation' | 'workout'
}

// Video ride -- extends base with video-specific props
export interface VideoRidePageDisplayProps extends RidePageDisplayProps {
    video?:   VideoDisplayProps        // single video
    videos?:  VideoDisplayProps[]      // next-video chain (all loaded, hidden except active)
}

// Free-Ride -- to be defined when those pages are built
// interface  extends RidePageDisplayProps { ... }
// interface FreeRidePageDisplayProps extends RidePageDisplayProps { ... }

export interface GPXRidePageDisplayProps extends RidePageDisplayProps {
    rideView?:   RideViewType
    displayObserver?:IObserver
    /** initial position for the view, until displayObserver takes over */
    displayPosition?: CurrentPosition
    /** lets the view report its load state back to the service (Street View) */
    onDisplayEvent?: (event:StreetViewEvent, data?:any) => void
}

// Union for consumers that need to handle all ride types. RidePageDisplayProps itself already
// covers a Workout ride (its workout-only fields are optional there) - Video/GPX get their own
// dedicated variants since they add required-shape fields RidePageDisplayProps doesn't carry.
export type AnyRidePageDisplayProps =
    | VideoRidePageDisplayProps
    | GPXRidePageDisplayProps
    | RidePageDisplayProps           // GPX/Workout/fallback/future types

interface RidePageCallbacks {
    onMenuOpen    (): void
    onMenuClose   (): void

    onPause       ():void
    onResume      ():void

    onRetryStart  ():void
    onIgnoreStart ():void
    onCancelStart ():void

    // Video/GPX ride callbacks
    onEndRide     ():void
    onRefreshSecrets(): void
    onContinueAnyway(): void

    // Workout ride callbacks
    onStop        (): void

    // "Stop Workout, keep riding" (mobile Phase 2 session 5.3) - Video/GPX+workout combo only;
    // detaches the workout, the ride itself keeps going. Distinct from onStop() above.
    onStopWorkout (): void

    onStepBack    (): void
    onStepForward (): void
    onIncreaseLoad(): void
    onDecreaseLoad(): void
    onSetLoadIncrement(value: number): void
    onGestureHintDismissed(props: { dontShowAgain: boolean }): void

    // NEW - Phase 2 (ride-overlay-layout-design.md §6.4). Phone-fallback corner-widget toggle -
    // additive and inert until session 5.1 wires up the RideMenu row and the corner-slot tap
    // handler.
    onToggleCornerWidget(): void
}

// Single merged interface (FIXES_BACKLOG #24), implemented in full by the single RidePageService
// class (src/ride/page/service.ts), which handles Video/GPX/Workout ride types internally - so
// getRidePageService() callers never need an instanceof check or cast.
export interface IRidePageService extends RidePageCallbacks, IPageService{
    initPage(): Promise<RideType|undefined>
    // Overrides IPageService's parameterless openPage() - RidePageService.openPage() accepts an
    // optional simulate flag (Video/GPX/Workout callers pass this through from their own props),
    // which the interface never declared even before the single-class merge (mobile previously
    // typed its refs against the concrete RidePageService class, which masked the gap).
    openPage(simulate?: boolean): IObserver
    getRideObserver(): IObserver|null
    getPageDisplayProps(): AnyRidePageDisplayProps
    getRideType(): RideType

    getGraphActuals(): WorkoutGraphActuals
    adjustLoad(deltaPct: number): PowerAdjustmentResult | undefined
    // FIXES_BACKLOG #37: callers (useWorkoutRideGestures.ts's swipe handler, a future menu/settings
    // surface) must call this fresh at gesture/tap time - cycling mode can change mid-ride - rather
    // than caching a value read from getPageDisplayProps().loadButtonMode.
    getLoadButtonMode(): LoadButtonMode
}

// ---- Workout-specific display types (relocated from src/workouts/ride/page/types.ts as part of
// the RidePageService/WorkoutRidePageService merge, FIXES_BACKLOG #24) --------------------------

// ---- graph -------------------------------------------------------------------

// x is ALWAYS "seconds of elapsed activity time", never distance - the plan bars (built from
// the CURRENT workout) and the recorded telemetry share this one axis.
export interface WorkoutGraphPoint {
    x: number   // elapsed activity time (s)
    y: number   // value - Watts for power, bpm for heartrate
}

export interface WorkoutGraphPlan {
    bars: WorkoutGraphPlanBar[]         // whole CURRENT workout, zone-colored, absolute Watts
    ftp: number                         // FTP the bars were resolved with (for the FTP reference line)
    ftpLine: number                     // W value of the FTP reference line (= ftp)
    domain: {
        x: [number, number]             // [0, maxX] - NOT [0, plannedDuration]; grows on skip-back/overrun
        y: [number, number]
    }
}

export interface WorkoutGraphActuals {
    power: WorkoutGraphPoint[]          // recorded power over the ridden span (grey filled area)
    heartrate: WorkoutGraphPoint[]      // recorded HR over the ridden span (line); may be empty
    position: number                    // current elapsed activity time (s) - marker x & plan/actual split
}

// ---- upcoming steps ------------------------------------------------------------

export interface WorkoutStepDisplay {
    label: string                       // full target description, Zwift-style - see getStepTargetText
                                         // (e.g. "260W", "260W at 100-120HR", "100-120 rpm", "Ramp 200-260W", "free")
    targetPower: number | null          // W at current FTP; null for a free-ride (no-limit) step
    duration: number                    // step duration (s)
    remaining: number | null            // s left in step - non-null ONLY for the current step
    isCurrent: boolean
}

export interface WorkoutUpcomingSteps {
    // Built from the FLATTENED, repeat-expanded step sequence (getFlattenedSteps) - a repeated
    // segment contributes one entry per repetition here, not one entry for the whole segment.
    previous: WorkoutStepDisplay | null  // the step immediately before `current`; null if this is the first step
    current: WorkoutStepDisplay | null   // the in-progress step (null before start / after completion)
    upcoming: WorkoutStepDisplay[]       // next 2-3 steps, plan order, empty near the end
    hasMore: boolean                     // true if flattened steps exist beyond `upcoming`'s last entry -
                                          // lets the UI distinguish "more to come" from "this is the end"
}

// ---- dashboard shoutout line ----------------------------------------------------

export interface WorkoutDashboardLine {
    // Fully composed, e.g. "260W at 100-120HR for 5min - VO2 max (3/5)" (getStepTargetText's
    // target description + getStepDuration's duration, then the step title/rep count). No
    // separate numeric power/duration/remaining fields - those are already shown live by
    // WorkoutStepsList's current-step row; duplicating them here was the pre-1.0 design and is
    // now considered wrong (session 3.3 rework).
    text: string
    mode: string | null                 // cycling-mode toggle text ('ERG'|'SIM') or null when not toggleable
}

// ---- menu ----------------------------------------------------------------------

// RideMenuProps (above) already carries canStepBack/canStepForward as optional, folded in as
// part of the RidePageService/WorkoutRidePageService merge (FIXES_BACKLOG #24) - this alias just
// narrows them back to required for callers that specifically know they're dealing with a
// workout ride's menu.
export type WorkoutRideMenuProps = RideMenuProps & {
    canStepBack: boolean      // = WorkoutDisplayProperties.canShowBackward
    canStepForward: boolean   // = WorkoutDisplayProperties.canShowForward
}

// ---- gesture discoverability overlay ----------------------------------------------

export interface WorkoutGestureHint {
    visible: boolean
}

// ---- page display props ---------------------------------------------------------

// RidePageDisplayProps (above) already carries these fields as optional, folded in as part of
// the RidePageService/WorkoutRidePageService merge (FIXES_BACKLOG #24) - this alias just narrows
// them back to required for callers that specifically know they're dealing with a workout ride's
// display props (RidePageService.getWorkoutRideDisplayProps(), mobile's WorkoutRidePage/View).
export type WorkoutRidePageDisplayProps = RidePageDisplayProps & {
    menuProps:   WorkoutRideMenuProps | null
    graph:       WorkoutGraphPlan          // planned (low-frequency) series only; actuals via getGraphActuals()
    steps:       WorkoutUpcomingSteps      // compact upcoming-steps panel (WorkoutStepsList)
    dashboard:   WorkoutDashboardLine      // target/actual shoutout for RideDashboard's tablet 2nd line
    title:       string                    // step/segment/repeat title (from WorkoutRide dashboard props)
    // First-ride education overlay (WorkoutGestureHintOverlay). null = hidden. Non-null only when
    // the start/pairing overlay has fully cleared AND elapsed ride time is 0 AND cadence is 0 (no
    // pedaling has happened yet) AND the persisted `hints.workoutRideGestures` flag isn't set.
    // Computed entirely here - the mobile component must not independently inspect ride/activity
    // data to decide its own visibility.
    gestureHint: WorkoutGestureHint | null
    // Current `preferences.workouts.loadIncrement` setting (%) - the same key the swipe gesture
    // (session 5.4) and the menu's Increase/Decrease Load buttons (session 5.5) already read via
    // their own DEFAULT_LOAD_INCREMENT-driven callbacks. Exposed here so WorkoutSettingsDialog
    // (session 5.10) can display/edit the live value without a second settings key.
    loadIncrement: number
    // What a load-adjust action currently does (FIXES_BACKLOG #37) - see
    // IRidePageService.getLoadButtonMode(), the live version of this callers must re-check
    // at gesture/tap time rather than caching. Mirrored here for UI that only re-renders on a
    // getPageDisplayProps() refresh (e.g. a future settings/menu surface).
    loadButtonMode: LoadButtonMode
}
