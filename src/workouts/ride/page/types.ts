import type { RideMenuProps, RidePageDisplayProps } from "../../../ride/page/types"
import type { WorkoutGraphPlanBar } from "../../base/graph/types"

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

// RideMenuProps (ride/page/types.ts) already carries canStepBack/canStepForward as optional,
// folded in as part of the RidePageService/WorkoutRidePageService merge (FIXES_BACKLOG #24) - this
// alias just narrows them back to required for callers that specifically know they're dealing
// with a workout ride's menu.
export type WorkoutRideMenuProps = RideMenuProps & {
    canStepBack: boolean      // = WorkoutDisplayProperties.canShowBackward
    canStepForward: boolean   // = WorkoutDisplayProperties.canShowForward
}

// ---- gesture discoverability overlay ----------------------------------------------

export interface WorkoutGestureHint {
    visible: boolean
}

// ---- page display props ---------------------------------------------------------

// RidePageDisplayProps (ride/page/types.ts) already carries these fields as optional, folded in
// as part of the RidePageService/WorkoutRidePageService merge (FIXES_BACKLOG #24) - this alias
// just narrows them back to required for callers that specifically know they're dealing with a
// workout ride's display props (WorkoutRidePageService.getPageDisplayProps(), mobile's
// WorkoutRidePage/View).
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
}

// ---- callbacks / service interface -------------------------------------------------
//
// Previously WorkoutRidePageCallbacks/IWorkoutRidePageService, alongside a sibling
// IRidePageService/RidePageCallbacks in ride/page/types.ts - both are now collapsed into the one
// IRidePageService interface there (FIXES_BACKLOG #24), which RidePageService and
// WorkoutRidePageService both implement in full via RidePageServiceBase's safe no-op defaults.
