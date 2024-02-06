import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer } from "../../base/types/observer";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { valid } from "../../utils/valid";
import { PowerLimit, Workout } from "../base/model";
import { WorkoutListService, getWorkoutList } from "../list";
import { WorkoutSettings } from "../list/cards/types";
import { ActiveWorkoutLimit } from "./types";

const DEFAULT_FTP = 200;
const WORKOUT_ZOOM = 1200;

let _instance = 0;

@Singleton
export class WorkoutRide extends IncyclistService{

    protected manualTimeOffset:number
    protected manualPowerOffset:number
    protected workout:Workout
    protected settings:WorkoutSettings
    protected workoutList: WorkoutListService
    protected observer:Observer
    protected state: 'idle'|'initialized'|'active'|'paused'|'completed'
    protected tsStart:number
    protected offset:number
    protected tsPauseStart:number
    protected tsCurrent:number
    protected trainingTime:number
    protected currentLimits
    protected updateInterval:NodeJS.Timeout
    protected id

    constructor () {
        super('WorkoutRide')   
        this.state='idle'
        this.id = _instance++
    }

    init():Observer {
        try {

            this.workoutList = getWorkoutList()
            this.resetTimes()
            this.manualPowerOffset = 0;

            this.workout = this.workoutList.getSelected()

            if (!this.workout)
                return;

            this.settings = this.workoutList.getStartSettings()??{}
            if (!valid(this.settings.ftp)) {
                this.settings.ftp = this.getFtpFromUserSettings() ?? 200
                this.workoutList.setStartSettings(this.settings)
            }
            this.setCurrentLimits(0)
            this.observer = new Observer()
            this.state = 'initialized'
            this.logEvent( {message:'workout initialized',workout:this.workout.name,settings:this.settings})
            waitNextTick().then(()=>{
                this.emit('initialized')
            })
            return this.observer
            
        }
        catch(err) {
            this.logError(err,'init')
        }
    }

    start(paused:boolean=false):Workout {
        try {
            if (this.state!=='initialized') {
                return
            }
            this.state = 'active'

            const ts = Date.now();
            this.tsStart=ts, 
            this.tsCurrent=ts
            this.offset = 0
            this.manualTimeOffset = 0;

            this.emit('started')
            this.logEvent( {message:'workout started',settings:this.settings})

            if (!this.updateInterval)  { 
                this.updateInterval = setInterval( ()=>{ this.update()}, 500)
            }
            
            if (paused)
                this.pause();

            return this.workout
        }
        catch(err) {
            this.logError(err,'start')
        }
    }

    pause() {
        try {
            if (this.state!=='initialized' && this.state!=='active') {
                return
            }

            const ts = Date.now();
            this.tsPauseStart=ts, 
            this.tsCurrent=ts
            this.state='paused'

            this.emit('paused')
            this.logger.logEvent( {message:'workout paused'})
        }
        catch(err) {
            this.logError(err,'pause')
        }
    }

    resume() {
        try {
            if (this.state==='initialized' || this.state==='completed') {
                this.start();
                return;
            }
    
            if (this.state!=='paused')
                return;
    
            const ts = Date.now();       
    
            if (valid(this.tsPauseStart)) {
                this.offset += (ts-this.tsPauseStart)
            }
    
            this.tsPauseStart = undefined        
            this.tsCurrent = ts
           
            this.state='active'
            this.logger.logEvent( {message:'workout resumed',offset:this.offset})
            this.emit('resumed')
    
        }
        catch(err) {
            this.logError(err,'resume')
        }

    }

    stop() {
        try {
            this.state = 'completed'
            this.logger.logEvent( {message: 'workout completed'})
            this.emit('completed')
            if (this.updateInterval) {
                clearInterval(this.updateInterval)
                this.updateInterval = undefined
            }
    
            waitNextTick()
                .then( ()=>{this.resetWorkout()})
    
        }
        catch(err) {
            this.logError(err,'stop')
        }

    }

    forward() {
        try {
            const ts = this.getTime()
            const wo = this.workout;
            const limits = wo.getLimits(ts);
            
            this.manualTimeOffset += limits.remaining   
        }
        catch(err) {
            this.logError(err,'forward')
        }

    }

    backward() {
        try {
            const ts = this.getTime()
            const wo = this.workout;
            const limits = wo.getLimits(ts);

            const completed = limits.duration-limits.remaining
            const timePrev = ts-completed-1;
            const prevLimits = wo.getLimits(timePrev);

            if (prevLimits ) {
                this.manualTimeOffset -= (completed+prevLimits.duration)               
            }
        }
        catch(err) {
            this.logError(err,'backward')
        }

    }

    powerUp(delta:number) {
        try {
            if (this.settings.ftp)
                this.settings.ftp = this.settings.ftp * (1+delta/100)
            
            this.manualPowerOffset += delta

            this.workoutList.setStartSettings(this.settings)
            this.setCurrentLimits()
            this.emit('update', this.getDashboardDisplayProperties())
        }
        catch(err) {
            this.logError(err,'powerUp')
        }
    }

    powerDown(delta:number) {
        try {
            if (this.settings.ftp)
                this.settings.ftp = this.settings.ftp / (1+delta/100)
            
            this.manualPowerOffset -= delta

            this.workoutList.setStartSettings(this.settings)
            this.setCurrentLimits()
            this.emit('update', this.getDashboardDisplayProperties())
        }
        catch(err) {
            this.logError(err,'powerDown')
        }

    }


    update(startIfInitialized=false) {

        try {
            const prevTime = Math.round(this.currentLimits.time)

            if (startIfInitialized && this.state==='initialized') {
                this.start()
            }
            else if (this.state!=='active')
                return

            const time = (Date.now() -this.tsStart-this.offset??0) / 1000 +  this.manualTimeOffset??0;
            const end = this.workout.getEnd();

            if ( time>end) {
                this.stop()
                return;
            }

            this.setCurrentLimits(time)

            if (Math.round(time)!==prevTime)
                this.emit('update', this.getDashboardDisplayProperties())
        }
        catch(err) {
            this.logError(err,'update')
        }

    }
    
    getDashboardDisplayProperties() {
        try {
            if (this.state==='idle' || this.state==='completed') {
                return {};
            }

            const {start,stop} = this.getZoomParameters(this.trainingTime);

            
            return {
                workout:this.workout, title:this.workout.name, 
                ftp:this.settings.ftp, 
                current:this.currentLimits,
                start,stop
            }

        }
        catch(err) {
            this.logError(err,'getDashboardDisplayProperties')
            return{}
        }

    }

    inUse(): boolean {
        return this.state!=='idle' && this.state!=='completed'
    }

    isActive(): boolean {
        return this.state==='active'
    }

    getWorkout():Workout {
        if (this.state==='idle')
            return undefined
        return this.workout
    }

    getObserver():Observer {
        if (this.state==='idle')
            return undefined
        return this.observer

    }

    protected resetTimes() {
        this.manualTimeOffset= 0
        this.tsStart = undefined
        this.tsCurrent = undefined
        this.tsPauseStart = undefined
        this.offset = undefined
    }


    protected setCurrentLimits( trainingTime?:number ):void {
        if (valid(trainingTime))
            this.trainingTime = trainingTime

        const time = this.trainingTime
        const wo = this.workout;
        const ftp  = this.settings.ftp;
        const limits = wo.getLimits(time);

        
        const request:ActiveWorkoutLimit = {time:0, duration:0, remaining:0} 
        
        if ( limits!==undefined) {
            request.time = time;
            request.minPower = this.getPowerVal(limits.power,'min')
            request.maxPower = this.getPowerVal(limits.power,'max')
            request.minCadence = limits?.cadence?.min ? Math.round(limits.cadence.min) : undefined;
            request.maxCadence = limits?.cadence?.max ? Math.round(limits.cadence.max) : undefined;
            request.minHrm = limits.hrm?.min ? Math.round(limits.hrm.min) : undefined;
            request.maxHrm = limits.hrm?.max ? Math.round(limits.hrm.max) : undefined;
            this.currentLimits = { ...request, duration: limits.duration, remaining:limits.remaining };                 
        }
        
        
        

        this.logger.logEvent( {message: 'workout requests', ...this.currentLimits,ftp})
        this.emit('request-update',this.currentLimits)
    }


    protected getZoomParameters(time: number) {
        let start, stop;
        const seconds = Math.round(time || 0) % 60;
        if (seconds >= 30) {
            start = Math.round(time || 0) - seconds + 30;
            stop = start + WORKOUT_ZOOM;

            if (stop > this.workout.duration) {
                stop = this.workout.duration;
                start = Math.max(0, stop - WORKOUT_ZOOM);
            }
        }
        return { start, stop };
    }

    protected getPowerVal( power:PowerLimit,key:'min'|'max') {
        if ( power===undefined) 
            return undefined;

        const val = power[key];
        if (val===undefined) 
            return val;

        if ( power.type === 'pct of FTP') {
            const pct = val
            const ftp = this.settings.ftp??DEFAULT_FTP
            const ftpVal = this.settings.ftp??ftp+this.manualPowerOffset
            return Math.round(pct * ftpVal/100);
        }

        return Math.round(val+this.manualPowerOffset);

    }

    protected getTime() {
        
        if ( this.state==='initialized' || this.state==='idle')
            return 0;
        
        let ts = (this.tsCurrent-this.tsStart-(this.offset||0)) / 1000 + this.manualTimeOffset
        if (ts<0) {
            this.manualTimeOffset-=ts;
            ts = 0;
        }

        return ts;
    }

    protected getFtpFromUserSettings() {
        try {
            const userSettings = useUserSettings()
            const user = userSettings.get('user',{})    
            return user.ftp
        }
        catch  {  // not initilized
            // ignrore
        }

    }

    protected resetWorkout() {
        this.observer.reset();
        this.workout = undefined
        this.state = 'idle'
        this.resetTimes()
        this.manualPowerOffset = 0
        this.currentLimits = undefined
    }

    emit(eventName: string , ...args): boolean {
        if (!this.observer)
            return false;

        this.observer.emit(eventName,...args)
        return true
    }


}

export const useWorkoutRide= () => new WorkoutRide()
export const getWorkoutRide= () => new WorkoutRide()

