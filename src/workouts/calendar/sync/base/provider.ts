import { useAppsService } from "../../../../apps"
import { Injectable } from "../../../../base/decorators"
import { IncyclistService } from "../../../../base/service"
import { Observer } from "../../../../base/types"
import { IConnectedApp } from "../../../../types"
import { getFirstDayOfCurrentWeek, waitNextTick } from "../../../../utils"
import { WorkoutCalendarEntry } from "../../types"
import { IWorkoutSyncProvider } from "../types"

/**
 * Shared logic of the providers that sync the planned workouts of the calendar of an external app.
 *
 * The first sync emits `loaded`, all following syncs emit `added`, `updated` and `deleted` events
 * for the changes and `done` when finished.
 *
 * @typeParam T the type of a workout as delivered by the API of the external app
 */
export abstract class BaseCalendarSyncProvider<T,C extends IConnectedApp > extends IncyclistService implements IWorkoutSyncProvider {
    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean
    protected workouts: Array<WorkoutCalendarEntry>

    /**
     * @param name name of the service (used for logging)
     * @param service key of the external app
     * @param syncDays number of days (after the first day of the current week) for which the planned workouts are synced
     */
    protected constructor(name: string, protected readonly service: string, protected readonly syncDays: number) {
        super(name)
        this.lastSyncTS = 0
        this.workouts = []
    }

    sync(): Observer {
        // already syncing, ... return observer and don't start a new one
        if (this.observer)
            return this.observer

        this.observer = new Observer()

        const onDone = () => {
            waitNextTick().then(() => {
                this.stopRequested = false
                delete this.observer
            }).catch(err => { this.logError(err, 'sync') })
        }

        this.observer.once('done', onDone)
        this.observer.once('loaded', onDone)
        this.observer.once('stop', () => { this.stopRequested = true })

        this.loadWorkouts().catch(err => { this.logError(err, 'sync', {externalApp:this.getApp()}) })
        return this.observer
    }

    isConnected(): boolean {
        try {
            return this.getConnection().isConnected()
        }
        catch {
            return false
        }
    }

    reset() {
        this.lastSyncTS = 0
        this.workouts = []
    }

    // ------  HOOKS ----------

    /** requests the workouts of the calendar for a range of days */
    protected abstract fetchWorkouts(start: Date, end: Date): Promise<Array<T> | undefined>

    /** selects the workouts that are offered (e.g. cycling workouts) and logs the statistics of the sync */
    protected abstract selectWorkouts(all: Array<T>, start: Date): Array<T>

    /**
     * Brings the list of workouts up to date, emitting the changes
     * @returns `false` if the sync was interrupted (the sync is then not counted as completed)
     */
    protected abstract applyChanges(selected: Array<T>): Promise<boolean | void>

    // ------  PROTECTED MEMBERS ----------

    protected async loadWorkouts(): Promise<Array<WorkoutCalendarEntry>> {
        const event = this.lastSyncTS === 0 ? 'loaded' : 'done'

        // make sure that the caller was able to subscribe to the observer
        await waitNextTick()

        try {
            if (!this.isConnected() || !this.getAppsService().isEnabled(this.service, 'WorkoutDownload')) {
                this.observer.emit(event, [], this.service)
                return []
            }

            this.logEvent({message:'start workout sync',externalApp:this.service})
            const start = getFirstDayOfCurrentWeek()
            const end = new Date(start)
            end.setDate(end.getDate() + this.syncDays)

            const all = await this.fetchWorkouts(start, end) ?? []
            const selected = this.selectWorkouts(all, start)

            const completed = await this.applyChanges(selected)

            this.observer.emit(event, this.workouts, this.service)
            if (completed !== false)
                this.lastSyncTS = Date.now()
            this.logEvent({message:'workout sync finished',externalApp:this.service})
            return this.workouts
        }
        catch (err) {
            this.logEvent({ message: 'workout sync failed', externalApp: this.service, error: err.message })
            this.observer.emit(event, [], this.service)
            return []
        }
    }

    /** removes (and signals) the workouts that are not part of the calendar any longer */
    protected removeDeletedWorkouts(currentIds: Array<string>) {
        // nothing to compare to on the first sync
        if (this.lastSyncTS === 0)
            return

        const deleted = this.workouts.filter(w => !currentIds.includes(w.workoutId))
        deleted.forEach(w => {
            this.observer.emit('deleted', w, this.service)
            this.logEvent({ message: 'workout deleted', externalApp: this.service, workout: w.workout?.name })
        })
        this.workouts = this.workouts.filter(w => !deleted.includes(w))
    }

    /** @returns the position of the entry of a workout (-1 if unknown) */
    protected findEntryIndex(workoutId: string): number {
        return this.workouts.findIndex(w => w.workoutId === workoutId)
    }

    /**
     * Stores the entry of a workout and signals `updated` (if it replaces the entry at the given position) or `added`.
     * Nothing is signalled during the first sync, as the whole list is delivered with `loaded`
     */
    protected storeEntry(entry: WorkoutCalendarEntry, idx: number) {
        const emit = this.lastSyncTS > 0
        const event = idx === -1 ? 'added' : 'updated'

        if (idx === -1)
            this.workouts.push(entry)
        else
            this.workouts[idx] = entry

        if (emit) {
            this.observer.emit(event, entry, this.service)
            this.logEvent({ message: `workout ${event}`, externalApp: this.service, workout: entry.workout?.name })
        }
    }

    protected getApp():string {
        return this.service
    }

    protected abstract getConnection():C


    @Injectable
    protected getAppsService() {
        return useAppsService()
    }
}
