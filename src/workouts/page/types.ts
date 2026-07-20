import { FileInfo, IObserver } from "../../types";
import { Workout } from "../base/model";

// ---- top-level page props --------------------------------------------------

export type WorkoutListPageDisplayProps =
    | WorkoutListPlaceholderProps
    | WorkoutListContentProps

export interface WorkoutListPlaceholderProps {
    pageType: 'placeholder'         // MOBILE_WORKOUTS feature off -> "under development"
}

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
    id:       string                // `${source}:${workoutId}` (calendar id)
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

// ---- Details dialog (overlay, not a navigated screen) ----------------------

export interface WorkoutDetailsProps {
    id:                  string
    title:               string
    description?:        string
    duration:            string
    workout:             Workout    // source object for WorkoutGraph `detail` mode
    // start-settings (see §12 Q3)
    ftp:                 number      // effective FTP (session override ?? user.ftp ?? 200)
    ftpRequired:         boolean     // false when every limit is absolute watts
    useErgMode:          boolean     // effective ERG (launch override ?? global default ?? true)
    // start affordances
    canStart:            boolean     // a route is selected -> "Start with route" (Phase 2)
    canStartWorkoutOnly: boolean     // no route selected -> "Start" (workout-only, Phase 1)
    // group management
    groups:              string[]    // existing groups for the GroupPicker
    group:               string      // current group ('scheduled' for a scheduled entry)
    canDelete:           boolean
    // scheduled-entry extras
    isScheduled:         boolean
    date?:               Date        // present only when isScheduled
}

// ---- Import dialog (single-file, Phase 1) ----------------------------------

export interface WorkoutImportDisplayProps {
    phase:       'landing' | 'importing' | 'result' | 'error'
    knownGroups: string[]           // existing groups, for the GroupPicker shown on the 'result' phase
    importing?:  { fileName: string }              // present during 'importing'
    result?:     { id: string; workoutName: string; group: string }  // present on 'result';
                                     // group is a suggestion (last-used ?? 'My Workouts'), NOT yet applied
    error?:      string             // present on 'error'
}

// ---- Callbacks & service contract ------------------------------------------

export interface WorkoutListPageCallbacks {
    // list screen
    onSelectGroup:    (group: string | null) => void   // filter chips
    onOpenDetails:    (id: string) => void
    onCloseDetails:   () => void
    // details dialog — start-settings
    onSetFtp:         (ftp: number) => void
    onSetErgMode:     (enabled: boolean) => void
    onChangeGroup:    (id: string, group: string) => void
    onDelete:         (id: string) => Promise<boolean>
    // ride hand-off (§3)
    onStart:          (id: string, opts: { noRoute: boolean }) => void  // select + navigate to ride
    onMarkForRoute?:  (id: string) => void   // Phase 2: explicit select-for-later (ride with a route)
    onClearSelection: () => void             // explicit unselect
    // import dialog
    onImportOpen:         () => void
    onImportFile:         (file: FileInfo) => IObserver   // returns observer: 'success' | 'error'
    onImportSetGroup:     (id: string, group: string) => void   // result-phase only
    onImportClose:        () => void
}

export interface IWorkoutListPageService extends WorkoutListPageCallbacks {
    getPageDisplayProps(): WorkoutListPageDisplayProps
    getWorkoutDetailsProps(id: string): WorkoutDetailsProps | null
    getImportDisplayProps(): WorkoutImportDisplayProps
}
