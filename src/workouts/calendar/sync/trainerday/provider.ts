import { useAppsService } from "../../../../apps"
import { TrainerDayCalendarWorkout } from "../../../../apps/base/api/trainerday"
import { TrainerDayAppConnection } from "../../../../apps/trainerday/TrainerDayAppConnection"
import { Injectable } from "../../../../base/decorators"
import { IncyclistService } from "../../../../base/service"
import { Observer } from "../../../../base/types"
import { getFirstDayOfCurrentWeek, waitNextTick } from "../../../../utils"
import { convertTrainerDayWorkout, getTrainerDayWorkoutHash } from "../../../base/parsers/trainerday/converter"
import { WorkoutCalendarEntry } from "../../types"
import { WorkoutSyncFactory } from "../factory"
import { IWorkoutSyncProvider } from "../types"

const SERVICE = 'trainerday'

/** number of days (after the first day of the current week) for which the planned workouts are synced */
const SYNC_DAYS = 28

/**
 * Synchronizes the planned cycling workouts of the TrainerDay calendar.
 *
 * The calendar delivers the structure of the workouts inline, so there is nothing to download. Only workouts of type
 * `bike` are offered; workouts that can not be represented (see `convertTrainerDayWorkout`) are skipped and logged.
 * TrainerDay does not deliver a modification time, so a hash of the content of the workout is used to detect changes.
 * The first sync emits `loaded`, all following syncs emit `added`, `updated` and `deleted` events
 * for the changes and `done` when finished.
 */
export class TrainerDayCalendarSyncProvider extends IncyclistService implements IWorkoutSyncProvider {
    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean
    protected workouts: Array<WorkoutCalendarEntry>

    constructor() {
        super('TrainerDayCalendarSync')
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

        this.loadWorkouts().catch(err => { this.logError(err, 'sync') })
        return this.observer
    }

    isConnected(): boolean {
        try {
            return this.getTrainerDayAppConnection().isConnected()
        }
        catch {
            return false
        }
    }

    reset() {
        this.lastSyncTS = 0
        this.workouts = []
    }

    // ------  PROTECTED MEMBERS ----------

    protected async loadWorkouts(): Promise<Array<WorkoutCalendarEntry>> {
        const event = this.lastSyncTS === 0 ? 'loaded' : 'done'

        // make sure that the caller was able to subscribe to the observer
        await waitNextTick()

        try {
            if (!this.isConnected() || !this.getAppsService().isEnabled(SERVICE, 'WorkoutDownload')) {
                this.observer.emit(event, [], SERVICE)
                return []
            }

            const start = getFirstDayOfCurrentWeek()
            const end = new Date(start)
            end.setDate(end.getDate() + SYNC_DAYS)

            const all = await this.getApi().getCalendar(start, end) ?? []
            const cycling = all.filter(w => this.isCycling(w))

            this.logEvent({
                message: 'workout sync', externalApp: SERVICE,
                oldest: start.toLocaleDateString(), cntTotal: all.length, cntCycling: cycling.length
            })

            if (this.stopRequested) {
                this.observer.emit(event, this.workouts, SERVICE)
                return this.workouts
            }

            const entries = this.convertWorkouts(cycling)

            this.removeDeletedWorkouts(entries)
            this.updateWorkouts(entries)

            this.observer.emit(event, this.workouts, SERVICE)
            this.lastSyncTS = Date.now()
            return this.workouts
        }
        catch (err) {
            this.logEvent({ message: 'workout sync failed', externalApp: SERVICE, error: err.message })
            this.observer.emit(event, [], SERVICE)
            return []
        }
    }

    protected isCycling(workout: TrainerDayCalendarWorkout): boolean {
        return workout.workoutType === 'bike'
    }

    /** converts the workouts of the calendar, workouts that can not be converted are skipped */
    protected convertWorkouts(workouts: Array<TrainerDayCalendarWorkout>): Array<WorkoutCalendarEntry> {
        const entries: Array<WorkoutCalendarEntry> = []

        for (const w of workouts) {
            const entry = this.convertWorkout(w)
            if (entry)
                entries.push(entry)
        }
        return entries
    }

    protected convertWorkout(w: TrainerDayCalendarWorkout): WorkoutCalendarEntry | undefined {
        if (!w.eventId) {
            this.logEvent({ message: 'workout skipped', externalApp: SERVICE, reason: 'no eventId', workout: w.title })
            return undefined
        }

        try {
            const workout = convertTrainerDayWorkout(w)
            const hash = getTrainerDayWorkoutHash(w)

            return {
                day: this.parseDay(w.date),
                // no modification time available: the (stable) hash of the content is used as marker
                updated: new Date(Number.parseInt(hash.slice(0, 10), 16)),
                workoutId: w.eventId,
                workout,
                source: SERVICE
            }
        }
        catch (err) {
            this.logEvent({ message: 'workout skipped', externalApp: SERVICE, reason: err.message, workout: w.title })
            return undefined
        }
    }

    /** the day is delivered as YYYY-MM-DD (without time zone): interpreted as local day */
    protected parseDay(value?: string): Date {
        const date = value ? new Date(`${value}T00:00:00`) : undefined
        return date && !Number.isNaN(date.valueOf()) ? date : new Date()
    }

    protected removeDeletedWorkouts(current: Array<WorkoutCalendarEntry>) {
        // nothing to compare to on the first sync
        if (this.lastSyncTS === 0)
            return

        const deleted = this.workouts.filter(w => !current.some(c => c.workoutId === w.workoutId))
        deleted.forEach(w => {
            this.observer.emit('deleted', w, SERVICE)
            this.logEvent({ message: 'workout deleted', externalApp: SERVICE, workout: w.workout?.name })
        })
        this.workouts = this.workouts.filter(w => !deleted.includes(w))
    }

    protected updateWorkouts(current: Array<WorkoutCalendarEntry>) {
        for (const entry of current) {
            if (this.stopRequested)
                return
            this.updateWorkout(entry)
        }
    }

    protected updateWorkout(entry: WorkoutCalendarEntry) {
        const idx = this.workouts.findIndex(w => w.workoutId === entry.workoutId)
        const existing = idx === -1 ? undefined : this.workouts[idx]

        // nothing to do if the workout was not modified since the last sync
        if (existing?.updated?.valueOf() === entry.updated.valueOf() && existing.day.valueOf() === entry.day.valueOf())
            return

        const emit = this.lastSyncTS > 0
        if (existing) {
            this.workouts[idx] = entry
            if (emit) {
                this.observer.emit('updated', entry, SERVICE)
                this.logEvent({ message: 'workout updated', externalApp: SERVICE, workout: entry.workout?.name })
            }
        }
        else {
            this.workouts.push(entry)
            if (emit) {
                this.observer.emit('added', entry, SERVICE)
                this.logEvent({ message: 'workout added', externalApp: SERVICE, workout: entry.workout?.name })
            }
        }
    }

    @Injectable
    protected getTrainerDayAppConnection() {
        return new TrainerDayAppConnection()
    }

    protected getApi() {
        return this.getTrainerDayAppConnection().getApi()
    }

    @Injectable
    protected getAppsService() {
        return useAppsService()
    }
}

const factory = new WorkoutSyncFactory()
factory.add(SERVICE, new TrainerDayCalendarSyncProvider())
