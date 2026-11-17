import { FileInfo, IObserver } from "../../../types";
import { Workout } from "../../base/model";

// ---- Details dialog (overlay, not a navigated screen) ----------------------

/** The route this workout is currently paired with for the next ride. At most one route is ever
 *  selected (design §2), and RouteListService is its single source - mirror image of
 *  AttachedWorkoutProps (routes/page/types.ts), which RouteListService's counterpart provides for
 *  the route side. */
export interface AttachedRouteProps {
    id:    string      // route.description.id
    title: string      // route.title (localised)
}

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
    // cross-visibility (Phase 2, session 2.2)
    attachedRoute:       AttachedRouteProps | null   // null = nothing attached
}

// ---- Callbacks shared by every platform ------------------------------------

export interface WorkoutDetailsCallbacks {
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
    onClearRouteSelection: () => void        // '[x]' on the "Route: <name>" row (Phase 2, §3.4.3) - clears
                                              // only the route side of the attachment
}

// ---- Import dialog (single-file) -------------------------------------------

export interface WorkoutImportDisplayProps {
    phase:       'landing' | 'importing' | 'result' | 'error'
    knownGroups: string[]           // existing groups, for the GroupPicker shown on the 'result' phase
    importing?:  { fileName: string }              // present during 'importing'
    result?:     { id: string; workoutName: string; group: string }  // present on 'result';
                                     // group is a suggestion (last-used ?? 'My Workouts'), NOT yet applied
    error?:      string             // present on 'error'
}

export interface WorkoutImportCallbacks {
    onImportOpen:         () => void
    onImportFile:         (file: FileInfo) => IObserver   // returns observer: 'success' | 'error'
    onImportSetGroup:     (id: string, group: string) => void   // result-phase only
    onImportClose:        () => void
}
