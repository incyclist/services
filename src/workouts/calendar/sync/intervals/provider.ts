import { IntervalsCalendarEvent, useAppsService } from "../../../../apps"
import { IntervalsAppConnection } from "../../../../apps/intervals/IntervalsAppConnection"
import { Injectable } from "../../../../base/decorators"
import { IncyclistService } from "../../../../base/service"
import { Observer } from "../../../../base/types"
import { getFirstDayOfCurrentWeek, waitNextTick } from "../../../../utils"
import { IntervalsJsonParser } from "../../../base/parsers/intervals/parser"
import { IntervalsWorkout } from "../../../base/parsers/intervals/types"
import { ZwoParser } from "../../../base/parsers/zwo/zwo"

import { WorkoutCalendarEntry } from "../../types"
import { WorkoutSyncFactory } from "../factory"
import { IWorkoutSyncProvider } from "../types"

/**
 * Syncs workout calendar entries from Intervals.icu into the local calendar.
 *
 * On the first call to {@link sync}, the observer emits a `loaded` event with
 * the full list of fetched workouts.  Subsequent calls emit a `done` event and
 * additionally fire `added`, `updated`, and `deleted` events for individual
 * changes detected since the previous sync.
 *
 * Only events of type `Ride` are included.  The provider parses each event
 * first via {@link IntervalsJsonParser} and falls back to {@link ZwoParser}
 * when the JSON representation is unavailable.
 */
export class IntervalsCalendarSyncProvider extends IncyclistService implements IWorkoutSyncProvider  {
    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean
    protected workouts:Array<WorkoutCalendarEntry>

    constructor() {
        super('IntervalsCalendarSync')
        this.lastSyncTS = 0
        this.workouts = []

    }

    /**
     * Starts a calendar sync and returns an {@link Observer} that emits
     * progress and result events.
     *
     * If a sync is already in progress the existing observer is returned and
     * no new network requests are made.
     *
     * **Events emitted on the returned observer:**
     * - `loaded` `(workouts: WorkoutCalendarEntry[], source: string)` – fired on
     *   the first sync once all workouts are fetched.
     * - `done` `(workouts: WorkoutCalendarEntry[], source: string)` – fired on
     *   subsequent syncs once all workouts are fetched.
     * - `added` `(workout: WorkoutCalendarEntry, source: string)` – a workout
     *   that did not exist in the previous snapshot.
     * - `updated` `(workout: WorkoutCalendarEntry, source: string)` – a workout
     *   whose `updated` timestamp is newer than the last sync.
     * - `deleted` `(workout: WorkoutCalendarEntry, source: string)` – a workout
     *   that is no longer present in Intervals.icu.
     *
     * Emit `stop` on the returned observer to request cancellation.
     *
     * @returns An observer for the sync lifecycle events.
     */
    sync(): Observer {
        // allready syncing, ... return observer and don't start a new one
        if (this.observer)
            return this.observer

        this.observer = new Observer()

        const onDone = ()=>{
            waitNextTick().then( ()=>{
                this.stopRequested = false
                delete this.observer
            })
        }

        this.observer.once('done',onDone)
        this.observer.once('loaded',onDone)

        this.observer.once('stop',()=>{this.stopSync() })
       
        this.loadWorkouts()
        return this.observer

    }

    /**
     * Returns whether the Intervals.icu integration is currently authenticated
     * and ready to sync.
     *
     * Checks the API token first; falls back to the app-connection state.
     * Returns `false` if any internal error occurs rather than throwing.
     *
     * @returns `true` when the provider can reach the Intervals.icu API.
     */
    isConnected(): boolean {
        try {
            if (this.getIntervalsApi().isAuthenticated()) {
                return true
            }

            const connected = this.getIntervalsAppConnection().isConnected()
            return connected
        }
        catch  {
            return false
        }
    }

    /**
     * Resets the provider to its initial state.
     *
     * Clears the cached workout list and the last-sync timestamp so that the
     * next call to {@link sync} is treated as a first sync and emits `loaded`
     * instead of `done`.
     */
    reset() {
        this.lastSyncTS = 0
        this.workouts = []
    }


    // ------  PROTECTED MEMBERS ----------

    protected stopSync() {
        this.stopRequested = true
    }

    protected async loadWorkouts():Promise<WorkoutCalendarEntry[]> {
        const isFirst = this.lastSyncTS === 0
        const event = isFirst ? 'loaded' : 'done'

        try {

            if (!this.isConnected()) {
                this.observer.emit(event,[],'intervals')
                return []
            }

            if (!this.getAppsService().isEnabled('intervals','WorkoutDownload')) {
                await waitNextTick()
                this.observer.emit(event,[],'intervals')
                return []
            }

            // set start date to Monday of current week
            const oldest = getFirstDayOfCurrentWeek()

            const cw = await this.getIntervalsApi().getCalendarWorkouts({oldest,days:30, ext:'zwo'}) ?? []

            // Stop was requested while the API call was in-flight — emit now so
            // the factory's stopSync can resolve instead of hanging indefinitely.
            if (this.stopRequested) {
                this.observer.emit(event,[],'intervals')
                return []
            }

            const cycling =cw.filter( w => w.type === 'Ride')

            await this.parseWorkouts(cycling)

            // Stop was requested while workouts were being parsed.
            if (this.stopRequested) {
                this.observer.emit(event,this.workouts,'intervals')
                return this.workouts
            }

            this.observer.emit(event,this.workouts,'intervals')

            this.lastSyncTS = Date.now()
            return this.workouts

        }
        catch {
            this.observer.emit(event,[],'intervals')
            return []
        }

    }

    protected async parseWorkouts( events: Array<IntervalsCalendarEvent>): Promise<Array<WorkoutCalendarEntry>> {
        const zwoParser = new ZwoParser()
        const promises: Array<Promise<void>> = []
        const parser = new IntervalsJsonParser()

        const transform = async (event: IntervalsCalendarEvent) => {
            try {
                const day = new Date(event.start_date_local)
                const updated = event.updated ? new Date(event.updated) : undefined

                // decode (base 64) the event.workout_file_base64 field

                let workout
                let error

                try {
                    workout =  parser.fromJSON(event.workout_doc as IntervalsWorkout, event.name)

                }
                catch (err) {
                    error = err

                    // Fallback : parse workoutStr as ZWo file content
                    const workoutStr = Buffer.from(event.workout_file_base64, 'base64').toString('utf-8')
                    const fileName = event.workout_filename

                    try {
                        workout = await zwoParser.fromStr(workoutStr,fileName)
                    }
                    catch {
                        throw error
                    }

                }   


                const w: WorkoutCalendarEntry = {
                    day,
                    updated,
                    workoutId: event.id.toString(),
                    workout
                }

                const existingIdx = this.workouts.findIndex( w => w.workoutId === event.id.toString())
                const isExisting = existingIdx!==-1


                if (this.lastSyncTS>0) {
                    // if workout does not exist yet then emit add event
                    if (!isExisting) {
                        this.observer.emit('added', w,'intervals')
                    }
                    else if (updated && updated.valueOf() > this.lastSyncTS) {
                        this.observer.emit('updated', w,'intervals')
                    }
                }


                if (isExisting) {
                    this.workouts[existingIdx] = w
                }
                else {
                    this.workouts.push(w)
                }


            }
            catch(err) {
                this.logEvent( {message:'error parsing workout', error:err.message, workout:event.name})
            }
        }

        // if this is not the first sync then check for deleted workouts
        if (this.lastSyncTS) {

            const deletedWorkouts = this.workouts.filter(w => !events.some(e => e.id.toString() === w.workoutId))
            for (const w of deletedWorkouts) {
                this.observer.emit('deleted', w, 'intervals')
            }

            // delete workouts from array
            this.workouts = this.workouts.filter(w => events.find(e => e.id.toString() === w.workoutId))

        }
        

        for (const event of events) {
            promises.push(transform(event))
        }

        await Promise.all(promises)

        return this.workouts


    }

    @Injectable
    protected getIntervalsApi() {
        return this.getIntervalsAppConnection().getApi()

    }

    @Injectable
    protected getIntervalsAppConnection() {
        return new IntervalsAppConnection()
    }


    @Injectable
    protected getAppsService() {
        return useAppsService()
    }

}   

const factory = new WorkoutSyncFactory ()
factory.add('intervals',new IntervalsCalendarSyncProvider())