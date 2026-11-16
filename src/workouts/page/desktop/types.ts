import type { IObserver } from "../../../types";
import type {
    ActiveImportProps,
    ScheduledWorkoutCardDisplayProperties,
    WorkoutCardDisplayProperties,
    WorkoutCardType,
    WorkoutCreateProps,
    WorkoutImportProps
} from "../../list/cards/types";
import type { DisplayType } from "../../../routes/list/types";
import type { WorkoutDetailsProps } from "../base/types";

export type DesktopWorkoutListDisplayProps = {
    loading: boolean                        // workoutList.isStillLoading() || lists===null
    lists: DesktopWorkoutListProps[]        // regular category lists (no 'scheduled'); [] while loading
    upcoming: DesktopUpcomingProps | null   // scheduled workouts; null if none or while loading
    displayType: DisplayType                // preferences.workoutListDisplayType (default 'tiles')
    detailWorkoutId: string | null          // details dialog open for this id
    createInfo: DesktopCreateInfoProps | null   // "how to create a workout" overlay
}

export type DesktopWorkoutListProps = {
    id: string                              // CardList.getId(): 'scheduled', 'myWorkouts', '<n>:<name>'
    title: string                           // CardList.getTitle()
    observer: IObserver                     // stable per list id; emits 'update' with DesktopWorkoutCardProps[]
    cards: DesktopWorkoutCardProps[]
}

export type DesktopUpcomingProps = DesktopWorkoutListProps & {
    todayId: string | null                  // id of today's scheduled card
}

export type DesktopWorkoutCardProps = {
    id: string                              // Card.getId(): workout.id | 'Import' | 'Create' | file name (active import)
    cardType: WorkoutCardType
    props: DesktopWorkoutCardContent
    observer?: IObserver                    // the domain card's own observer (Workout, ScheduledWorkout, ActiveWorkoutImport)
}

export type DesktopActiveImportCardContent = Omit<ActiveImportProps, 'observer'> & { canDelete: boolean }
export type DesktopWorkoutCardContentBase = Omit<WorkoutCardDisplayProperties, 'observer' | 'selected'>
export type DesktopScheduledCardContent = Omit<ScheduledWorkoutCardDisplayProperties, 'observer' | 'selected'> & { isToday: boolean }

export type DesktopWorkoutCardContent =
    | WorkoutImportProps
    | WorkoutCreateProps
    | DesktopActiveImportCardContent
    | DesktopWorkoutCardContentBase
    | DesktopScheduledCardContent

export type DesktopCreateInfoProps = {
    markAsSeenDefault: boolean
}

export type DesktopWorkoutDetailsProps = WorkoutDetailsProps & {
    stepChangeAudioSignal: boolean          // preferences.workouts.stepChangeAudioSignal (default true)
    canAddRoute: boolean                    // !attachedRoute
}
