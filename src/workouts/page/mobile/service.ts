import { Singleton } from "../../../base/types";
import { IObserver } from "../../../types";
import { FileInfo } from "../../../api";
import { Observer } from "../../../base/types/observer";
import { WorkoutCard } from "../../list/cards/WorkoutCard";
import { WorkoutListPageService } from "../base/service";
import {
    GroupFilterProps,
    IWorkoutListPageService,
    ScheduledWorkoutItemProps,
    UpcomingTrainingProps,
    WorkoutImportDisplayProps,
    WorkoutListItemProps,
    WorkoutListPageDisplayProps
} from "./types";

const DEFAULT_IMPORT_GROUP = 'My Workouts'
const UPCOMING_COLLAPSED_COUNT = 3

/**
 * Workout list page for mobile: a flat, filterable list with an upcoming-training section and a
 * single-file import dialog.
 */
@Singleton
export class MobileWorkoutListPageService extends WorkoutListPageService implements IWorkoutListPageService {

    protected groupFilter: string | null = null

    protected importPhase: 'landing' | 'importing' | 'result' | 'error' | undefined
    protected importingFileName: string
    protected importResult: { id: string; workoutName: string; group: string }
    protected importError: string
    // Refreshed (to Date.now()) whenever the dialog stops caring about a specific
    // onImportFile() call (see onImportClose()). onImportFile()'s single-file import chain has
    // no abort mechanism - the parse/save promise keeps running in the background even after
    // the user cancels - so this generation marker lets the eventual .then()/.catch() recognise
    // it's stale and discard its own result instead of clobbering whatever the dialog (possibly
    // reopened, possibly mid a newer import) is showing by the time it settles. Date.now() (over
    // a plain incrementing counter) so two independent call sites can each mint a fresh value
    // without coordinating a shared counter.
    protected importGeneration = 0

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

    getImportDisplayProps(): WorkoutImportDisplayProps {
        try {
            const phase = this.importPhase ?? 'landing'
            const knownGroups = this.getKnownGroups()

            const props: WorkoutImportDisplayProps = { phase, knownGroups }
            if (phase==='importing')
                props.importing = { fileName: this.importingFileName }
            if (phase==='result')
                props.result = this.importResult
            if (phase==='error')
                props.error = this.importError

            return props
        }
        catch (err) {
            this.logError(err, 'getImportDisplayProps')
            return { phase:'landing', knownGroups:[] }
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

    // ---- import dialog (§6) --------------------------------------------------

    onImportOpen(): void {
        try {
            this.importPhase = 'landing'
            delete this.importError
            delete this.importResult
            this.emitImportUpdate()
        }
        catch (err) {
            this.logError(err, 'onImportOpen')
        }
    }

    onImportFile(file: FileInfo): IObserver {
        const observer = new Observer()
        const generation = this.importGeneration = Date.now()

        try {
            this.importPhase = 'importing'
            this.importingFileName = file?.name
            this.emitImportUpdate()
            this.logEvent({ message: 'workout import attempted', file: file?.name })

            this.getWorkoutList().import(file, { showImportCards:false })
                .then( ([card]) => {
                    const group = this.getLastUsedImportGroup()

                    observer.emit('success')
                    this.logEvent({ message: 'workout import succeeded', file: file?.name, workoutName: card.getTitle(), group })

                    // If onImportClose() (or a newer onImportFile()) ran while this promise was
                    // still in flight, importGeneration has moved on and this result is stale -
                    // don't let it clobber the dialog-facing state below, and (importantly) don't
                    // let its card.move() side effect silently overwrite a newer, still-live
                    // import's own group choice. That interleaving is reachable now that Cancel
                    // lets the user escape 'importing' and start a second import of the same file
                    // while the first is still resolving in the background - completion order
                    // isn't guaranteed to match start order.
                    if (generation !== this.importGeneration)
                        return

                    // new cards already land in DEFAULT_IMPORT_GROUP, so only move the card when
                    // the suggestion differs - this applies the last-used group by default while
                    // still leaving it fully changeable afterward via onImportSetGroup.
                    if (group !== DEFAULT_IMPORT_GROUP)
                        card.move(group)

                    this.importPhase = 'result'
                    this.importResult = { id: card.getId(), workoutName: card.getTitle(), group }
                    this.emitImportUpdate()
                })
                .catch( (err:Error) => {
                    // `observer` wraps a real Node EventEmitter, which special-cases the literal
                    // 'error' event: emitting it with zero listeners registered throws
                    // synchronously instead of being a no-op like any other event name. If that
                    // ever happens here, it aborts this callback before emitImportUpdate() below
                    // runs - which is exactly what caused WorkoutImportDialog to get stuck on
                    // 'importing' forever on mobile (5.12), because its caller discarded this
                    // observer without subscribing. Fixed by having the caller subscribe
                    // (mirroring RouteImportDialog's existing pattern) - every caller of
                    // onImportFile() must keep doing that until this event is renamed away from
                    // the special-cased 'error' string (tracked separately, not yet done).
                    observer.emit('error', err)
                    this.logEvent({ message: 'workout import failed', file: file?.name, error: err?.message })

                    // see the .then() branch above - discard a stale result the same way here.
                    if (generation !== this.importGeneration)
                        return

                    this.importPhase = 'error'
                    this.importError = err?.message
                    this.emitImportUpdate()
                })
        }
        catch (err) {
            this.logError(err, 'onImportFile')
        }
        return observer
    }

    onImportSetGroup(id: string, group: string): void {
        try {
            // includeScheduled defaults to false - same rationale as onChangeGroup() (5.19).
            const card = this.findWorkoutCard(id)
            card?.move(group)
            this.persistLastUsedImportGroup(group)

            if (this.importResult)
                this.importResult = { ...this.importResult, group }

            this.emitImportUpdate()
        }
        catch (err) {
            this.logError(err, 'onImportSetGroup')
        }
    }

    onImportClose(): void {
        try {
            // Invalidates any in-flight onImportFile() call's eventual result (see
            // importGeneration above) - covers both an explicit Cancel action and the dialog
            // simply unmounting mid-import (WorkoutImportDialog calls this from both places).
            this.importGeneration = Date.now()
            delete this.importPhase
            delete this.importingFileName
            delete this.importResult
            delete this.importError
            this.emitImportUpdate()
        }
        catch (err) {
            this.logError(err, 'onImportClose')
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

    protected getKnownGroups(): string[] {
        const lists = this.getWorkoutList().getLists(false) ?? []
        return lists.filter( l=>l.getId()!=='scheduled').map( l=>l.getTitle())
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

    protected getLastUsedImportGroup(): string {
        return this.getUserSettings().get('preferences.workouts.lastImportGroup', DEFAULT_IMPORT_GROUP)
    }

    protected persistLastUsedImportGroup(group: string): void {
        try {
            this.getUserSettings().set('preferences.workouts.lastImportGroup', group)
        }
        catch (err) {
            this.logError(err, 'persistLastUsedImportGroup')
        }
    }

    protected emitImportUpdate(): void {
        try {
            this.getPageObserver()?.emit('import-update')
        }
        catch (err) {
            this.logError(err, 'emitImportUpdate')
        }
    }
}
