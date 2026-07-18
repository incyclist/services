import type { IObserver } from "../../../base/typedefs"
import type { IPageService } from "../../../base/pages"
import type { RidePageDisplayProps } from "../../../ride/page/types"
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
    label: string                       // e.g. "260W", "FTP 95%", "Ramp 200-260W", "free"
    targetPower: number | null          // W at current FTP; null for a free-ride (no-limit) step
    duration: number                    // step duration (s)
    remaining: number | null            // s left in step - non-null ONLY for the current step
    isCurrent: boolean
}

export interface WorkoutUpcomingSteps {
    current: WorkoutStepDisplay | null  // the in-progress step (null before start / after completion)
    upcoming: WorkoutStepDisplay[]      // next 2-3 steps, plan order, empty near the end
}

// ---- dashboard shoutout line ----------------------------------------------------

export interface WorkoutDashboardLine {
    targetPower: number | null          // W target for the current step (null on a free-ride step)
    targetDuration: number              // current step duration (s)
    remaining: number                   // s remaining in current step
    text: string                        // step description + repetition count (e.g. "VO2 max (3/5)")
    mode: string | null                 // cycling-mode toggle text ('ERG'|'SIM') or null when not toggleable
}

// ---- menu ----------------------------------------------------------------------

export interface WorkoutRideMenuProps {
    showResume: boolean       // true = Resume, false = Pause
    canStepBack: boolean      // = WorkoutDisplayProperties.canShowBackward
    canStepForward: boolean   // = WorkoutDisplayProperties.canShowForward
    // Stop is always present (confirmation handled in the view); Increase-Load always enabled.
}

// ---- page display props ---------------------------------------------------------

export interface WorkoutRidePageDisplayProps extends RidePageDisplayProps {
    menuProps: WorkoutRideMenuProps | null
    graph:     WorkoutGraphPlan          // planned (low-frequency) series only; actuals via getGraphActuals()
    steps:     WorkoutUpcomingSteps      // compact upcoming-steps panel (WorkoutStepsList)
    dashboard: WorkoutDashboardLine      // target/actual shoutout for RideDashboard's tablet 2nd line
    title:     string                    // step/segment/repeat title (from WorkoutRide dashboard props)
}

// ---- callbacks -------------------------------------------------------------------

export interface WorkoutRidePageCallbacks {
    onMenuOpen    (): void
    onMenuClose   (): void

    onPause       (): void
    onResume      (): void
    onStop        (): void       // -> ride.stop(true)     (view enforces the confirmation tap)

    onStepBack    (): void       // -> ride.backward()     (delegates to WorkoutRide.backward)
    onStepForward (): void       // -> ride.forward()      (delegates to WorkoutRide.forward)
    onIncreaseLoad(): void       // -> service.adjustLoad(+increment)
    onDecreaseLoad(): void       // -> service.adjustLoad(-increment)

    onRetryStart  (): void
    onIgnoreStart (): void
    onCancelStart (): void
}

export interface IWorkoutRidePageService extends WorkoutRidePageCallbacks, IPageService {
    getRideObserver(): IObserver | null
    getPageDisplayProps(): WorkoutRidePageDisplayProps
    getGraphActuals(): WorkoutGraphActuals
    adjustLoad(deltaPct: number): void
}
