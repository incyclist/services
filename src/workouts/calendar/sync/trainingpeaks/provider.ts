import { useAppsService } from "../../../../apps"
import { TrainingPeaksWorkout } from "../../../../apps/base/api/trainingpeaks"
import { TrainingPeaksAppConnection } from "../../../../apps/trainingpeaks/TrainingPeaksAppConnection"
import { Injectable } from "../../../../base/decorators"
import { IncyclistService } from "../../../../base/service"
import { Observer } from "../../../../base/types"
import { getFirstDayOfCurrentWeek, waitNextTick } from "../../../../utils"
import { ZwoParser } from "../../../base/parsers/zwo/zwo"
import { WorkoutCalendarEntry } from "../../types"
import { WorkoutSyncFactory } from "../factory"
import { IWorkoutSyncProvider } from "../types"

const SERVICE = 'trainingpeaks'

/** number of days (after the first day of the current week) for which the planned workouts are synced */
const SYNC_DAYS = 30

/** HTTP status codes that tell that there is no (usable) file for the workout. Any other error might be temporary (rate limit, network, token) */
const NO_FILE_STATUS = [400, 404, 410, 415, 422]

/**
 * Synchronizes the planned (structured) cycling workouts of the TrainingPeaks calendar
 *
 * Only workouts of type `Bike` that can be exported as ZWO file are synced.
 * The list of workouts of a date range does not always tell the available file formats, so the file is requested
 * unless the formats are known and do not contain ZWO. Workouts that turned out to have no file are not requested again
 * until they are modified.
 * The first sync emits `loaded`, all following syncs emit `added`, `updated` and `deleted` events
 * for the changes and `done` when finished.
 */
export class TrainingPeaksCalendarSyncProvider extends IncyclistService implements IWorkoutSyncProvider {
    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean
    protected workouts: Array<WorkoutCalendarEntry>

    /** workouts without usable file (id -> last modification at that time) */
    protected withoutFile: Map<string, string | undefined>

    constructor() {
        super('TrainingPeaksCalendarSync')
        this.lastSyncTS = 0
        this.workouts = []
        this.withoutFile = new Map()
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
            return this.getTrainingPeaksAppConnection().isConnected()
        }
        catch {
            return false
        }
    }

    reset() {
        this.lastSyncTS = 0
        this.workouts = []
        this.withoutFile = new Map()
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

            const all = await this.getApi().getWorkouts(start, end) ?? []
            const cyclingWorkouts = all.filter(w => this.isCycling(w))
            const cycling = cyclingWorkouts.filter(w => this.isPlanned(w))

            this.logEvent({
                message: 'workout sync', externalApp: SERVICE,
                oldest: start.toLocaleDateString(), cntTotal: all.length, cntCycling: cyclingWorkouts.length, cntPlanned: cycling.length
            })

            this.removeDeletedWorkouts(cycling)
            await this.updateWorkouts(cycling)

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

    protected isCycling(workout: TrainingPeaksWorkout): boolean {
        return workout.WorkoutType?.toLowerCase() === 'bike'
    }

    /**
     * TrainingPeaks does not distinguish between workouts and activities: an uploaded ride is a (completed) workout without any planned values.
     * Such an activity has no structure that could be exported, so it is not requested at all.
     * A workout that was planned stays a workout when it was completed, so it can still be repeated.
     */
    protected isPlanned(workout: TrainingPeaksWorkout): boolean {
        const planned = [workout.TotalTimePlanned, workout.DistancePlanned, workout.TssPlanned, workout.StartTimePlanned]

        // the planned values are not delivered at all: not known, the request of the file will tell
        if (planned.every(value => value === undefined))
            return true

        return planned.some(value => Boolean(value))
    }

    protected removeDeletedWorkouts(current: Array<TrainingPeaksWorkout>) {
        // nothing to compare to on the first sync
        if (this.lastSyncTS === 0)
            return

        const deleted = this.workouts.filter(w => !current.some(c => String(c.Id) === w.workoutId))
        deleted.forEach(w => {
            this.observer.emit('deleted', w, SERVICE)
            this.logEvent({ message: 'workout deleted', externalApp: SERVICE, workout: w.workout?.name })
        })
        this.workouts = this.workouts.filter(w => !deleted.includes(w))
    }

    protected async updateWorkouts(current: Array<TrainingPeaksWorkout>) {
        // the files are downloaded one after the other to stay below the rate limits of TrainingPeaks
        for (const workout of current) {
            if (this.stopRequested)
                break
            await this.updateWorkout(workout)
        }
    }

    protected async updateWorkout(workout: TrainingPeaksWorkout) {
        const workoutId = String(workout.Id)
        const updated = this.parseDate(workout.LastModifiedDate)
        const idx = this.workouts.findIndex(w => w.workoutId === workoutId)
        const existing = idx === -1 ? undefined : this.workouts[idx]

        // nothing to do (and nothing to download) if the workout was not modified since the last sync
        if (existing && updated && existing.updated?.valueOf() === updated.valueOf())
            return

        if (!this.shouldLoadFile(workout))
            return

        const entry = await this.loadEntry(workout, updated)
        if (!entry)
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

    /**
     * @returns false if it is known that there is no ZWO file for the workout (so that no request is required)
     */
    protected shouldLoadFile(workout: TrainingPeaksWorkout): boolean {
        const id = String(workout.Id)

        // the formats are not always provided: no formats means that it is not known, not that there is no file
        const formats = workout.WorkoutFileFormats?.map(f => f.toLowerCase()) ?? []
        if (formats.length > 0 && !formats.includes('zwo')) {
            this.logEvent({ message: 'workout skipped', externalApp: SERVICE, reason: 'format not supported', workout: workout.Title, formats: formats.join(',') })
            return false
        }

        // the workout turned out to have no file, and was not modified since then
        return !(this.withoutFile.has(id) && this.withoutFile.get(id) === workout.LastModifiedDate)
    }

    protected async loadEntry(workout: TrainingPeaksWorkout, updated?: Date): Promise<WorkoutCalendarEntry | undefined> {
        try {
            const str = await this.getApi().getWorkoutFile(workout.Id, 'zwo')
            if (typeof str !== 'string' || str.trim().length === 0) {
                this.markWithoutFile(workout, 'empty file')
                return undefined
            }

            const parsed = await this.parseWorkout(workout, str)
            if (!parsed)
                return undefined

            // a workout that was found now is no longer without file
            this.withoutFile.delete(String(workout.Id))

            return {
                day: this.parseDate(workout.WorkoutDay) ?? new Date(),
                // if TrainingPeaks does not provide a modification time, the workout is reloaded on the next sync
                updated: updated ?? new Date(),
                workoutId: String(workout.Id),
                workout: parsed
            }
        }
        catch (err) {
            const status = err.response?.status
            this.logEvent({ message: 'error loading workout', externalApp: SERVICE, status, error: err.message, workout: workout.Title })
            if (NO_FILE_STATUS.includes(status))
                this.withoutFile.set(String(workout.Id), workout.LastModifiedDate)
            return undefined
        }
    }

    protected async parseWorkout(workout: TrainingPeaksWorkout, content: string) {
        try {
            return await new ZwoParser().fromStr(content, workout.Title)
        }
        catch (err) {
            // the file will not be better the next time
            this.markWithoutFile(workout, 'not a valid workout file: ' + err.message)
            return undefined
        }
    }

    protected markWithoutFile(workout: TrainingPeaksWorkout, reason: string) {
        this.withoutFile.set(String(workout.Id), workout.LastModifiedDate)
        this.logEvent({ message: 'workout skipped', externalApp: SERVICE, reason, workout: workout.Title })
    }

    /**
     * TrainingPeaks delivers dates without time zone information (WorkoutDay in local time, LastModifiedDate in Mountain Time).
     * LastModifiedDate is only used to check if a workout was modified, so the offset is irrelevant
     */
    protected parseDate(value?: string): Date | undefined {
        if (!value)
            return undefined
        const date = new Date(value)
        return Number.isNaN(date.valueOf()) ? undefined : date
    }

    @Injectable
    protected getTrainingPeaksAppConnection() {
        return new TrainingPeaksAppConnection()
    }

    protected getApi() {
        return this.getTrainingPeaksAppConnection().getApi()
    }

    @Injectable
    protected getAppsService() {
        return useAppsService()
    }
}

const factory = new WorkoutSyncFactory()
factory.add(SERVICE, new TrainingPeaksCalendarSyncProvider())
