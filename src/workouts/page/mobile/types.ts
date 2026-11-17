import { Workout } from "../../base/model";
import { WorkoutDetailsCallbacks, WorkoutDetailsProps, WorkoutImportCallbacks, WorkoutImportDisplayProps } from "../base/types";

// ---- top-level page props --------------------------------------------------

export type WorkoutListPageDisplayProps = WorkoutListContentProps

export interface WorkoutListContentProps {
    pageType:  'list'
    loading:   boolean              // preload in progress; UI shows spinner/skeleton
    upcoming:  UpcomingTrainingProps | null   // null = no scheduled workouts -> hide section
    groups:    GroupFilterProps               // chip filter row (always present)
    workouts:  WorkoutListItemProps[]         // flat list, ALREADY filtered by groups.selected
    selectedId: string | null       // the workout explicitly selected for the next ride (null = none)
    isEmpty:   boolean              // true when there are no imported workouts at all
    detailWorkoutId: string | null  // id of the workout whose WorkoutDetailsDialog is open (null = none) —
                                     // mirrors RoutesPageService.detailRouteId / ActivitiesPageService.detailActivityId
}

// ---- Upcoming Training (synced / scheduled) --------------------------------

export interface UpcomingTrainingProps {
    items:          ScheduledWorkoutItemProps[]  // sorted by date ascending (this week + 7 days)
    collapsedCount: number          // how many rows to show when collapsed (2–3)
    todayId:        string | null   // id highlighted as "today" (from app-state 'scheduledToday')
}

export interface ScheduledWorkoutItemProps {
    id:       string                // workout content's id (matches WorkoutCard.getId()/findWorkoutCard lookup) - NOT the calendar/sync entry's own id
    title:    string
    date:     Date                  // scheduled day
    duration: string                // pre-formatted, e.g. "45min"
    isToday:  boolean               // informational highlight (== id === todayId); NOT ride-selection
    selected: boolean               // ride-selection — true ONLY after an explicit user action (§3.1)
    workout:  Workout               // source object for WorkoutGraph `strip` mode
}

// ---- Group filter ----------------------------------------------------------

export interface GroupFilterProps {
    available: string[]             // group/category names, e.g. ['My Workouts','FTP Builder']
                                    //   'Scheduled Workouts' is NOT included here (own section)
    selected:  string | null        // currently selected group; null = "All groups"
}

// ---- Flat list row (imported / library workout) ----------------------------

export interface WorkoutListItemProps {
    id:        string
    title:     string
    group:     string               // the category/list this workout belongs to
    duration:  string               // pre-formatted
    selected:  boolean              // ride-selection (explicit only)
    canDelete: boolean
    workout:   Workout              // source object for WorkoutGraph `strip` mode
}

// ---- Callbacks & service contract ------------------------------------------

export interface WorkoutListPageCallbacks extends WorkoutDetailsCallbacks, WorkoutImportCallbacks {
    // list screen
    onSelectGroup:    (group: string | null) => void   // filter chips
}

export interface IWorkoutListPageService extends WorkoutListPageCallbacks {
    getPageDisplayProps(): WorkoutListPageDisplayProps
    getWorkoutDetailsProps(id: string): WorkoutDetailsProps | null
    getImportDisplayProps(): WorkoutImportDisplayProps
}
