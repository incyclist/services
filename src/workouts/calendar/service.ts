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
    protected syncInfo:  {iv?: NodeJS.Timeout, observer?: Observer, listChanged?:boolean} 
    protected initialized: boolean
    protected workouts: Array<WorkoutCalendarEntry>
    protected listActive: boolean



    constructor() {
        super('WorkoutCalendar')

        this.syncInfo = {}        
        this.initialized = false
        this.listActive = false

        const onAppConnectedHandler = this.onAppConnected.bind(this)
        const onAppDisconnectedHandler = this.onAppDisconnected.bind(this)
        this.getAppsService().on('connected', onAppConnectedHandler)
        this.getAppsService().on('disconnected', onAppDisconnectedHandler)
    }

    init() {
        this.performSync()
        //this.startSync()
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
            workouts.sort( (a,b)=> a.day.valueOf() - b.day.valueOf() )
            return workouts.map( w => this.getScheduledWorkout(w))
        }

        return []
    }

    setActive(active:boolean) {
        this.listActive = active

        this.stopSync()
        if (active)
            this.startSync(active)
    }

    protected  getScheduledWorkout(w: WorkoutCalendarEntry): ScheduledWorkout {
        return { type: 'scheduled', name: w.workout.name, id: `${w.source ?? ''}:${w.workoutId}`, ...w };
    }

    protected startSync(initial:boolean=true) { 
        try {
            if (!this.syncInfo.iv) {
                // run sync every 5 minutes
                const frequency =  this.getSyncFrequency()                
                this.syncInfo.iv = setInterval( () => {
                    this.performSync()
                }, frequency)

                if (initial) {
                    this.performSync()
                }
            }
        }
        catch(err) {
            this.logError(err,'startSync')
        }
    }

    protected stopSync() {
        if (this.syncInfo.iv) {
            clearInterval(this.syncInfo.iv)
            this.syncInfo.iv = undefined
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

            this.syncInfo.observer = observer
            this.syncInfo.listChanged = false
            const onAdded = this.onSyncWorkoutAdded.bind(this)
            const onUpdated = this.onSyncWorkoutUpdated.bind(this)
            const onDeleted = this.onSyncWorkoutDeleted.bind(this)

            observer.on('added',onAdded)
            observer.on('updated',onUpdated)    
            observer.on('deleted',onDeleted)    


            const onDone = ()=>{
                delete this.syncInfo.observer

                if (this.syncInfo.listChanged) {
                    this.emitListUpdate()
                    
                }
                delete this.syncInfo.listChanged
                done()                

            }

            const onloaded = ( workouts)=>{
                this.workouts = workouts.map( w => ({ ...w, observer:new Observer()}))

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

        this.workouts.push({ ...workout, source:service, observer:new Observer()})
        this.syncInfo.listChanged = true
    }

    protected onSyncWorkoutUpdated(workout:WorkoutCalendarEntry,service:string) {
        if (!this.isInitialized)            
            return

        const idx = this.workouts.findIndex( d=> d.source===service && d.workoutId===workout.workoutId)
        if (idx>-1) {
            const prev = this.workouts[idx]
            this.workouts[idx] = { ...prev, ...workout, source:service}
            prev.observer?.emit('updated',this.getScheduledWorkout(workout))
        }
        else  {
            this.workouts.push({ ...workout, source:service, observer:new Observer()})
            this.syncInfo.listChanged = true
        }

    }
    protected onSyncWorkoutDeleted(workout:WorkoutCalendarEntry,service:string) {
        if (!this.isInitialized)            
            return

        const idx = this.workouts.findIndex( d=> d.source===service && d.workoutId===workout.workoutId)
        if (idx>-1) {
            this.workouts.splice(idx,1)
            this.syncInfo.listChanged = true
        }
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
    
    protected emitListUpdate() {
        this.emit('updated')
    }

    protected getSyncFrequency() {
        if (this.listActive)
            return 10000 // polling every 10 seconds when workout list is shown 

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