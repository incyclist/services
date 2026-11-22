import { TrainerDayCalendarWorkout } from "../../../../apps/base/api/trainerday"
import { TrainerDayAppConnection } from "../../../../apps/trainerday/TrainerDayAppConnection"
import { Injectable } from "../../../../base/decorators"
import { convertTrainerDayWorkout, getTrainerDayWorkoutHash } from "../../../base/parsers/trainerday/converter"
import { WorkoutCalendarEntry } from "../../types"
import { BaseCalendarSyncProvider } from "../base/provider"
import { WorkoutSyncFactory } from "../factory"

const SERVICE = 'trainerday'

/** number of days (after the first day of the current week) for which the planned workouts are synced */
const SYNC_DAYS = 28

/**
 * Synchronizes the planned cycling workouts of the TrainerDay calendar.
 *
 * The calendar delivers the structure of the workouts inline, so there is nothing to download. Only workouts of type
 * `bike` are offered; workouts that can not be represented (see `convertTrainerDayWorkout`) are skipped and logged.
 * TrainerDay does not deliver a modification time, so a hash of the content of the workout is used to detect changes.
 */
export class TrainerDayCalendarSyncProvider extends BaseCalendarSyncProvider<TrainerDayCalendarWorkout,TrainerDayAppConnection> {

    constructor() {
        super('TrainerDayCalendarSync', SERVICE, SYNC_DAYS)
    }

    // ------  PROTECTED MEMBERS ----------

    protected getConnection() {
        return this.getTrainerDayAppConnection()
    }

    protected async fetchWorkouts(start: Date, end: Date) {
        return await this.getApi().getCalendar(start, end)
    }

    protected selectWorkouts(all: Array<TrainerDayCalendarWorkout>, start: Date): Array<TrainerDayCalendarWorkout> {
        const cycling = all.filter(w => this.isCycling(w))

        this.logEvent({
            message: 'workout sync', externalApp: SERVICE,
            oldest: start.toLocaleDateString(), cntTotal: all.length, cntCycling: cycling.length
        })
        return cycling
    }

    protected async applyChanges(cycling: Array<TrainerDayCalendarWorkout>) {
        if (this.stopRequested)
            return false

        const entries = this.convertWorkouts(cycling)

        this.removeDeletedWorkouts(entries.map(e => e.workoutId))
        this.updateWorkouts(entries)
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
                // no modification time available: the (stable) hash of the content is mapped to a Date. This is NOT a real
                // timestamp, it is only compared with the previous value to detect changes (nothing else reads `updated`)
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

    protected updateWorkouts(current: Array<WorkoutCalendarEntry>) {
        for (const entry of current) {
            if (this.stopRequested)
                return
            this.updateWorkout(entry)
        }
    }

    protected updateWorkout(entry: WorkoutCalendarEntry) {
        const idx = this.findEntryIndex(entry.workoutId)
        const existing = this.workouts[idx]

        // nothing to do if the workout was not modified since the last sync
        if (existing?.updated?.valueOf() === entry.updated.valueOf() && existing.day.valueOf() === entry.day.valueOf())
            return

        this.storeEntry(entry, idx)
    }

    @Injectable
    protected getTrainerDayAppConnection() {
        return new TrainerDayAppConnection()
    }

    protected getApi() {
        return this.getTrainerDayAppConnection().getApi()
    }
}

const factory = new WorkoutSyncFactory()
factory.add(SERVICE, new TrainerDayCalendarSyncProvider())
