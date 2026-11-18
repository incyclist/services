import { TrainingPeaksWorkout } from "../../../../apps/base/api/trainingpeaks"
import { TrainingPeaksAppConnection } from "../../../../apps/trainingpeaks/TrainingPeaksAppConnection"
import { Injectable } from "../../../../base/decorators"
import { ZwoParser } from "../../../base/parsers/zwo/zwo"
import { WorkoutCalendarEntry } from "../../types"
import { BaseCalendarSyncProvider } from "../base/provider"
import { WorkoutSyncFactory } from "../factory"

const SERVICE = 'trainingpeaks'

/** number of days (after the first day of the current week) for which the planned workouts are synced */
const SYNC_DAYS = 30

/** HTTP status codes that tell that there is no (usable) file for the workout. Any other error might be temporary (rate limit, network, token) */
const NO_FILE_STATUS = new Set([400, 404, 410, 415, 422])

/**
 * Synchronizes the planned (structured) cycling workouts of the TrainingPeaks calendar
 *
 * Only workouts of type `Bike` that can be exported as ZWO file are synced.
 * The list of workouts of a date range does not always tell the available file formats, so the file is requested
 * unless the formats are known and do not contain ZWO. Workouts that turned out to have no file are not requested again
 * until they are modified.
 */
export class TrainingPeaksCalendarSyncProvider extends BaseCalendarSyncProvider<TrainingPeaksWorkout> {

    /** workouts without usable file (id -> last modification at that time) */
    protected withoutFile: Map<string, string | undefined>

    constructor() {
        super('TrainingPeaksCalendarSync', SERVICE, SYNC_DAYS)
        this.withoutFile = new Map()
    }

    reset() {
        super.reset()
        this.withoutFile = new Map()
    }

    // ------  PROTECTED MEMBERS ----------

    protected getConnection() {
        return this.getTrainingPeaksAppConnection()
    }

    protected async fetchWorkouts(start: Date, end: Date) {
        return await this.getApi().getWorkouts(start, end)
    }

    protected selectWorkouts(all: Array<TrainingPeaksWorkout>, start: Date): Array<TrainingPeaksWorkout> {
        const cyclingWorkouts = all.filter(w => this.isCycling(w))
        const cycling = cyclingWorkouts.filter(w => this.isPlanned(w))

        this.logEvent({
            message: 'workout sync', externalApp: SERVICE,
            oldest: start.toLocaleDateString(), cntTotal: all.length, cntCycling: cyclingWorkouts.length, cntPlanned: cycling.length
        })
        return cycling
    }

    protected async applyChanges(cycling: Array<TrainingPeaksWorkout>) {
        this.removeDeletedWorkouts(cycling.map(c => String(c.Id)))
        await this.updateWorkouts(cycling)
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

        return planned.some(Boolean)
    }

    protected async updateWorkouts(current: Array<TrainingPeaksWorkout>, idx = 0): Promise<void> {
        // the files are downloaded one after the other to stay below the rate limits of TrainingPeaks
        if (idx >= current.length || this.stopRequested)
            return

        await this.updateWorkout(current[idx])
        await this.updateWorkouts(current, idx + 1)
    }

    protected async updateWorkout(workout: TrainingPeaksWorkout) {
        const workoutId = String(workout.Id)
        const updated = this.parseDate(workout.LastModifiedDate)
        const idx = this.findEntryIndex(workoutId)
        const existing = this.workouts[idx]

        // nothing to do (and nothing to download) if the workout was not modified since the last sync
        const lastUpdate = existing?.updated?.valueOf()
        if (lastUpdate !== undefined && lastUpdate === updated?.valueOf())
            return

        if (!this.shouldLoadFile(workout))
            return

        const entry = await this.loadEntry(workout, updated)
        if (!entry)
            return

        this.storeEntry(entry, idx)
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
            if (NO_FILE_STATUS.has(status))
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
}

const factory = new WorkoutSyncFactory()
factory.add(SERVICE, new TrainingPeaksCalendarSyncProvider())
