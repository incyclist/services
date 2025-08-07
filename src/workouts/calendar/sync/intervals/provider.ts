import { IntervalsCalendarEvent, useAppsService } from "../../../../apps"
import { IntervalsAppConnection } from "../../../../apps/intervals/IntervalsAppConnection"
import { Injectable } from "../../../../base/decorators"
import { Observer } from "../../../../base/types"
import { formatDateTime, getFirstDayOfCurrentWeek, waitNextTick } from "../../../../utils"
import { ZwoParser } from "../../../base/parsers/zwo"
import { WorkoutCalendarEntry } from "../../types"
import { WorkoutSyncFactory } from "../factory"
import { IWorkoutSyncProvider } from "../types"

export class IntervalsCalendarSyncProvider implements IWorkoutSyncProvider {
    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean
    protected workouts:Array<WorkoutCalendarEntry> 

    constructor() {
        this.lastSyncTS = 0
        this.workouts = []
    }   

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

            const cycling =cw.filter( w => w.type === 'Ride')

            await this.parseWorkouts(cycling)

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
        const parser = new ZwoParser()
        const promises: Array<Promise<void>> = []

        const transform = async (event: IntervalsCalendarEvent) => {
            try {
                const day = new Date(event.start_date_local)
                const updated = event.updated ? new Date(event.updated) : undefined

                // decode (base 64) the event.workout_file_base64 field
                const workoutStr = Buffer.from(event.workout_file_base64, 'base64').toString('utf-8')
                const fileName = event.workout_filename

                // parse workoutStr as ZWo file content
                const workout = await parser.fromStr(workoutStr,fileName)


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
                this.observer.emit('error', err, event)
            }
        }

        // if this is not the first sync then check for deleted workouts
        if (this.lastSyncTS) {

            const deletedWorkouts = this.workouts.filter(w => !events.find(e => e.id.toString() === w.workoutId))
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