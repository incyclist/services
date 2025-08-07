import { useAppsService } from "../../apps";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Observer, Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { addDays, getFirstDayOfCurrentWeek } from "../../utils";
import { WorkoutSyncFactory } from "./sync";
import { ScheduledWorkout, WorkoutCalendarEntry } from "./types";

const SYNC_INTERVAL = 5* 60*1000

@Singleton
export class WorkoutCalendarService extends IncyclistService{
    protected syncInfo:  {iv?: NodeJS.Timeout, observer?: Observer} 
    protected initialized: boolean
    protected workouts: Array<WorkoutCalendarEntry>



    constructor() {
        super('WorkoutCalendar')

        this.syncInfo = {}        
        this.initialized = false

        const onAppConnectedHandler = this.onAppConnected.bind(this)
        const onAppDisconnectedHandler = this.onAppDisconnected.bind(this)
        this.getAppsService().on('connected', onAppConnectedHandler)
        this.getAppsService().on('disconnected', onAppDisconnectedHandler)
    }

    init() {
        this.startSync()
    }

    isInitialized():boolean {
        return this.initialized
    }

    getScheduledWorkouts():Array<ScheduledWorkout> {

        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const from = getFirstDayOfCurrentWeek()
        const to = addDays( today,7)
        if (this.workouts) {
            const workouts = this.workouts.filter( w=> w.day?.valueOf()>=from.valueOf() && w.day.valueOf()<=to.valueOf() )
            return workouts.map( w => ({type:'scheduled',name:w.workout.name, id:`${w.source??''}:${w.workoutId}`, ...w}))
        }

        return []
    }




    protected startSync() { 
        try {
            if (!this.syncInfo.iv) {
                // run sync every 5 minutes

                this.syncInfo.iv = setInterval( () => {
                    this.performSync()
                }, this.getSyncFrequency())

                this.performSync()
            }
        }
        catch(err) {
            this.logError(err,'startSync')
        }
    }

    protected async performSync(service?:string) {

        if (this.syncInfo.observer) {
            await new Promise<void>( done => this.syncInfo.observer.once('done',done))
        }

        return new Promise<void>( done =>{
            const observer = this.getWorkoutSyncFactory().sync(service)
            if (!observer)
                done()

            // TODO: this.observer.emit('sync-start')
            this.syncInfo.observer = observer
            const onAdded = this.onSyncWorkoutAdded.bind(this)
            const onUpdated = this.onSyncWorkoutUpdated.bind(this)
            const onDeleted = this.onSyncWorkoutDeleted.bind(this)

            observer.on('added',onAdded)
            observer.on('updated',onUpdated)    
            observer.on('deleted',onDeleted)    


            const onDone = ()=>{

                delete this.syncInfo.observer
                done()                
            }

            const onloaded = ( workouts)=>{
                this.workouts = workouts

                if (!this.initialized) {
                    this.initialized = true
                    this.emit('initialized')
                }

                this.checkIfScheduledCurrentDay()

                onDone()
            }
            observer.once('done',onDone)
            observer.once('loaded',onloaded)

        })
    }

    protected checkIfScheduledCurrentDay() {
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        const workouts = this.workouts.filter( w=> w.day?.toLocaleDateString()===today.toLocaleDateString() )
        if (workouts.length>0)  {
            this.emit('scheduled',workouts[0])
        }
            

    }
    protected onSyncWorkoutAdded(workout:WorkoutCalendarEntry,service:string) {
        if (!this.isInitialized)            
            return
        this.workouts.push({ ...workout, source:service})
    }
    protected onSyncWorkoutUpdated(workout:WorkoutCalendarEntry,service:string) {
        if (!this.isInitialized)            
            return

        const idx = this.workouts.findIndex( d=> d.source===service && d.workoutId===workout.workoutId)
        if (idx>-1)
            this.workouts[idx] = { ...workout, source:service}
        else 
            this.workouts.push({ ...workout, source:service})

    }
    protected onSyncWorkoutDeleted(workout:WorkoutCalendarEntry,service:string) {
        if (!this.isInitialized)            
            return

        const idx = this.workouts.findIndex( d=> d.source===service && d.workoutId===workout.workoutId)
        if (idx>-1)
            this.workouts.splice(idx,1)
    }

    protected onAppConnected(app:string,success:true) {
        this.performSync()
    }
    protected onAppDisconnected(app:string) {
        console.log('# app disconncted',app)
    }

    protected getSetting(key:string, def:any) {
        try {
            return this.getUserSettings().get(key, def)
        }
        catch {
            return def
        }
    }

    protected getSyncFrequency() {

        return this.getSetting('calendarSyncFrequency',null) ?? this.getSetting('calendar.syncFrequency',null) ?? this.getSetting('syncFrequency',SYNC_INTERVAL)
    }    

    @Injectable
    protected getWorkoutSyncFactory() {
        return new WorkoutSyncFactory()
    }

    @Injectable
    protected getUserSettings()  {
        return useUserSettings() 
    }

    @Injectable
    protected getAppsService()  {
        return  useAppsService() 
    }

    

    
}

export const useWorkoutCalendar = () => {
    return new WorkoutCalendarService()
}