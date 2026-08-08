import { IPageService } from "../../base/pages"
import { Route } from "../../routes/base/model/route"
import { IObserver, RideType } from "../../types"
import { CurrentRideState, GPXStartOverlayProps, RideViewType, StartOverlayProps, VideoDisplayProps, VideoStartOverlayProps } from "../types"
import type { PowerAdjustmentResult } from "../../workouts/ride/types"
import type { WorkoutDashboardLine, WorkoutGestureHint, WorkoutGraphActuals, WorkoutGraphPlan, WorkoutUpcomingSteps } from "../../workouts/ride/page/types"


export interface StartGateProps {
    title: string
    body: string
}

export interface RideMenuProps {
    showResume?: boolean    // true = Resume button, false = Pause button
    finished?:boolean       // true = Activity is completed (finished)

    // Workout-only - present on a Workout ride's menu. Folded in here as optional (rather than a
    // separate WorkoutRideMenuProps branch) so RideMenuProps alone already covers every ride type -
    // see WorkoutRideMenuProps in workouts/ride/page/types.ts for a variant that guarantees them.
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

    // Ride-only (Video/GPX) - safe no-op on a Workout ride, see RidePageServiceBase
    onEndRide     ():void
    onRefreshSecrets(): void
    onContinueAnyway(): void

    // Workout-only - safe no-op on a Video/GPX ride, see RidePageServiceBase
    onStop        (): void
    onStepBack    (): void
    onStepForward (): void
    onIncreaseLoad(): void
    onDecreaseLoad(): void
    onSetLoadIncrement(value: number): void
    onGestureHintDismissed(props: { dontShowAgain: boolean }): void
}

// Single merged interface (FIXES_BACKLOG #24) replacing the former IRidePageService/
// IWorkoutRidePageService pair - both RidePageService and WorkoutRidePageService implement every
// member here in full (via RidePageServiceBase's safe no-op defaults for whichever half doesn't
// apply), so getRidePageService() can return one type with no instanceof checks or casts needed
// at any call site.
export interface IRidePageService extends RidePageCallbacks, IPageService{
    initPage(): Promise<RideType|undefined>
    getRideObserver(): IObserver|null
    getPageDisplayProps(): AnyRidePageDisplayProps
    getRideType(): RideType

    // Workout-only - safe no-op default on a Video/GPX ride, see RidePageServiceBase
    getGraphActuals(): WorkoutGraphActuals
    adjustLoad(deltaPct: number): PowerAdjustmentResult | undefined
}
