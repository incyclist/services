import { IPageService } from "../../base/pages";
import { ActivityInfoUI } from "../base";
import { AttachedWorkoutProps, RouteVideoDisplayProps } from "../../routes/page/types";
import { RouteInfo } from "../../routes/base/types";
import { VideoKeepChoice } from "../../routes/video-availability/types";

export interface ActivitiesPageDisplayProps {
    loading: boolean;       // indicates that the service is still loading the activities
    activities?: Array<ActivityInfoUI>,
    detailActivityId?: string
    // Set when "Ride Again" could not start straight away because the route's video is not
    // available yet - the UI shows a "Before you ride" step instead of navigating. null/absent
    // means nothing is blocking, which is always the case without the fileAccess binding.
    rideAgainCheck?: RideAgainCheckDisplayProps | null
}

export interface RideAgainCheckDisplayProps {
    routeId: string
    routeTitle: string
    video: RouteVideoDisplayProps
    // True once the video finished downloading while this step was on screen, so the UI can
    // switch its primary button to "Start".
    downloadedWhileOpen: boolean
}

// ---- cross-visibility (Phase 2, session 2.2) --------------------------------

export type { AttachedWorkoutProps }

/** Additive companion to what ActivityDetailsDialog reads from ActivityListService.openSelected() -
 *  see mobile/internal/designs/workout-combo-service-design.md §3.6. `openSelected()` is not
 *  touched. */
export interface ActivityDetailsProps {
    activityId:      string                     // echoed back, same as RouteDetailsProps.routeId
    attachedWorkout: AttachedWorkoutProps | null
}

export interface IActivitiesPageService extends IPageService  {
    getPageDisplayProps():ActivitiesPageDisplayProps
    getActivityDetailsProps(activityId: string): ActivityDetailsProps
    onClearWorkoutSelection(): void   // '[x]' on the "Workout: <name>" row (Phase 2, HLD §4.2)
    // Navigates to ride or pairing, depending on device readiness - unless the route's video
    // needs a download or an access confirmation first, in which case navigation is held back,
    // `rideAgainCheck` is set instead, and this resolves 'blocked'. Existing callers that ignore
    // the resolved value keep working unchanged.
    onRideAgain(route?: RouteInfo): Promise<'started' | 'blocked'>
    onRideAgainCheckClosed(): void
    onRideAgainCheckStart(): Promise<'started' | 'blocked'>
    onVideoDownloadPressed(routeId: string): void
    onVideoDownloadConfirmed(routeId: string, choice: VideoKeepChoice): void
    onVideoDownloadDismissed(routeId: string): void
    onVideoStop(routeId: string): void
    onVideoRetry(routeId: string): void
    onVideoKeepInstead(routeId: string): void
    onVideoRemovePressed(routeId: string): void
    onVideoRemoveConfirmed(routeId: string): void
    onVideoRemoveDismissed(routeId: string): void
    onConfirmAccess(routeId: string): Promise<void>
    onDeleteActivity(id: string): Promise<boolean>
}
