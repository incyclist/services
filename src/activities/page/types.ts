import { IPageService } from "../../base/pages";
import { ActivityInfoUI } from "../base";
import { AttachedWorkoutProps } from "../../routes/page/types";

export interface ActivitiesPageDisplayProps {
    loading: boolean;       // indicates that the service is still loading the activities
    activities?: Array<ActivityInfoUI>,
    detailActivityId?: string
}

// ---- cross-visibility (Phase 2, session 2.2) --------------------------------

export type { AttachedWorkoutProps }

/** Additive companion to what ActivityDetailsDialog reads from ActivityListService.openSelected() -
 *  see mobile/internal/designs/workout-combo-service-design.md §3.6. `openSelected()` is not
 *  touched. */
export interface ActivityDetailsProps {
    activityId:      string                     // echoed back, same as RouteDetailsProps.routeId
    attachedWorkout: AttachedWorkoutProps | null
    comboEnabled:    boolean
}

export interface IActivitiesPageService extends IPageService  {
    getPageDisplayProps():ActivitiesPageDisplayProps
    getActivityDetailsProps(activityId: string): ActivityDetailsProps
    onClearWorkoutSelection(): void   // '[x]' on the "Workout: <name>" row (Phase 2, HLD §4.2)
}
