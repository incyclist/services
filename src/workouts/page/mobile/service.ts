import { Singleton } from "../../../base/types";
import { WorkoutCard } from "../../list/cards/WorkoutCard";
import { WorkoutListPageService } from "../base/service";
import {
    GroupFilterProps,
    IWorkoutListPageService,
    ScheduledWorkoutItemProps,
    UpcomingTrainingProps,
    WorkoutListItemProps,
    WorkoutListPageDisplayProps
} from "./types";

const UPCOMING_COLLAPSED_COUNT = 3

/**
 * Workout list page for mobile: a flat, filterable list with an upcoming-training section and a
 * single-file import dialog.
 */
@Singleton
export class MobileWorkoutListPageService extends WorkoutListPageService implements IWorkoutListPageService {

    protected groupFilter: string | null = null

    protected getRideTarget(ready: boolean): string {
        return ready ? '/rideDeviceOK' : '/pairingStart'
    }

    getPageDisplayProps(): WorkoutListPageDisplayProps {
        try {
            const service = this.getWorkoutList()
            const loading = service.isStillLoading()
            const upcoming = this.getUpcomingTrainingProps()

            const allWorkouts = this.getAllWorkoutItems()
            const groups = this.getGroupFilterProps()
            const workouts = groups.selected ? allWorkouts.filter( w=>w.group===groups.selected) : allWorkouts

            const selectedId = service.getSelected()?.id ?? null
            const isEmpty = allWorkouts.length===0

            return { pageType:'list', loading, upcoming, groups, workouts, selectedId, isEmpty, detailWorkoutId: this.detailWorkoutId }
        }
        catch (err) {
            this.logError(err, 'getPageDisplayProps')
            return {} as WorkoutListPageDisplayProps
        }
    }

    // ---- list screen callbacks ---------------------------------------------

    onSelectGroup(group: string | null): void {
        try {
            this.groupFilter = group
            this.emitPageUpdate()
        }
        catch (err) {
            this.logError(err, 'onSelectGroup')
        }
    }

    // ---- internal assembly helpers ------------------------------------------

    protected getUpcomingTrainingProps(): UpcomingTrainingProps | null {
        const calendar = this.getWorkoutCalendar()
        const scheduled = calendar.getScheduledWorkouts()

        if (!scheduled || scheduled.length===0)
            return null

        const todayId = calendar.getScheduledToday()?.id ?? null
        const selectedWorkout = this.getWorkoutList().getSelected()

        const items: ScheduledWorkoutItemProps[] = scheduled.map( w => ({
            id: w.workout?.id,
            title: w.workout?.name,
            date: w.day,
            duration: this.formatDuration(w.workout?.duration),
            isToday: todayId!==null && w.id===todayId,
            selected: selectedWorkout?.id!==undefined && selectedWorkout.id===w.workout?.id,
            workout: w.workout
        }))

        return { items, collapsedCount: UPCOMING_COLLAPSED_COUNT, todayId }
    }

    protected getGroupFilterProps(): GroupFilterProps {
        const available = this.getKnownGroups()
        return { available, selected: this.groupFilter }
    }

    protected getAllWorkoutItems(): WorkoutListItemProps[] {
        const lists = this.getWorkoutList().getLists(false) ?? []
        const items: WorkoutListItemProps[] = []

        lists.forEach( list => {
            if (list.getId()==='scheduled')
                return

            list.getCards().forEach( card => {
                if (card.getCardType()!=='Workout')
                    return

                const workoutCard = card as WorkoutCard
                const props = workoutCard.getDisplayProperties()
                items.push({
                    id: workoutCard.getId(),
                    title: props.title,
                    group: list.getTitle(),
                    duration: props.duration,
                    selected: props.selected,
                    canDelete: props.canDelete,
                    workout: props.workout
                })
            })
        })
        return items
    }
}
