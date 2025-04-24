import { CyclingMode } from "incyclist-devices";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer } from "../../base/types/observer";
import { useDeviceRide } from "../../devices";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { valid } from "../../utils/valid";
import { PowerLimit,  StepDefinition, Workout } from "../base/model";
import { WorkoutListService, useWorkoutList } from "../list";
import { WorkoutSettings } from "../list/cards/types";
import { ActiveWorkoutLimit, WorkoutDisplayProperties } from "./types";
import { Injectable } from "../../base/decorators";

const DEFAULT_FTP = 200;
const WORKOUT_ZOOM = 1200;

/**
 * This service is used by the Front-End to manage the state of the previously selected workout
 * and to implement the business logic to display the content for a workout dashboard
 * 
 * The workout first needs to be initialized - which will reset the internal state (incl. counters and timers)
 * Once the workout has been initialized, it can be started/paused/resumed or stopped
 * 
 * The WorkoutRide Service implements an Observer pattern, were the Observer is created during initialization
 * It will then notify potantial consumers about relevant events:
 * 
 * - 'initialized' - The workout has been initialized and is ready to be used in a ride
 * - 'update' - There was an update, which requires the dashboard to be updated
 * - 'step-changed' - There was a new step selected, which requires the dashboard to be updated
 * - 'request-update' - There was an update, which requires to send updated requests to the SmartTrainer 
 *  
 * - 'started' - The workout has been started
 * - 'paused' - The workout has been paused
 * - 'resumed' - The workout has been resumed
 * - 'completed' - The workout has been completed or was stopped by the user
 * 
 * 
 * __Dashboard__
 * 
 * The dasboard component will typically only register for the updates and completed events to udpate its internal state
 * 
 * @example
 * ```
 * const {useWorkoutRide} = require('incyclist-services');
 * 
 * const service = useWorkoutRide()
 * 
 * const observer = service.getObserver()
 * if (observer) {
 *    observer
 *      .on('update',(displayProps)=> {console.log(displayProps)})
 *      .on('completed',()=> {console.log('Workout completed')})
 * }
 * ```
 * 
 * __Ride Workkflow__
 * 
 * The business logic of the actual ride, will typically initialize this service and then monitor for request updates 
 * 
 * @example
 * ```
 * const {useWorkoutRide} = require('incyclist-services');
 * 
 * const service = useWorkoutRide()
 * 
 * const observer = service.init()
 * if (observer) {
 *    observer
 *      .on('request-update',(requestProps)=> {console.log(requestProps)})
 *      .on('started',()=> {console.log('Workout started')})
 *      .on('completed',()=> {console.log('Workout completed')})
 * }
 * ```
 * 
 * @public
 * @noInheritDoc
 */

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
    protected currentLimits:ActiveWorkoutLimit
    protected updateInterval:NodeJS.Timeout
    protected currentStep: StepDefinition
    protected isFreeRide: boolean

    constructor () {
        super('WorkoutRide')   
        this.state='idle'
        this.isFreeRide = true        
    }

    /**
     * Prepares the workout for the upcoming ride
     * 
     * It will make use of the [[WorkoutList]] to get workout that was selected by the user and Start Settings ( ERGMode on/off and selected FTP)
     * If no workout was selected, the method will return without response
     * 
     * Once workout and settings were determined, it will reset the timers and manual offsets that the user has created 
     * during a previous ride
     * 
     * Finally, it will set the internal state to "initialized" and return an Observer, which can be used by 
     * the consumer to get notified about updates.
     * 
     * @returns [[Observer]] Observer object which will notify consumers about updates/status changes of the workout during the ongoing ride
     * @emits __initialized__
     * 
     */

    init():Observer {
        try {

            this.workoutList = this.getWorkoutList()
            this.workout = this.workoutList.getSelected()

            if (!this.workout)
                return;

            this.resetTimes()
            this.manualPowerOffset = 0;
    
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

    /**
     * Starts a ride with the workout that was previously selected/initialized
     * 
     * This will start an interval which checks every 500ms if the limits or dashboard need to be adjusted
     * If needed, it will trigger notifications to update the dashboard and/or the limits to be sent to the device
     * 
     * If the [[init]] method has not been called before, it will simply return without any response
     * 
     * @param paused    indicates whether the initial state after start should be _paused_. This should be set if the user is not yet cycling
     * @returns [[Workout]] The workout that has been started
     * @emits   __started__
     * @emits __update__      indicates that the dashboard needs to be adjusted
     *      will add a [[WorkoutDisplayProperties]] object as argument which contains the new display properties
     * @emits   __request-update__      indicates that the limits needs to be adjusted
     *      will add an [[ActiveWorkoutLimit]] object, which contains the udpated limits
     */
    start(paused:boolean=false):Workout {
        try {
            if (this.state!=='initialized' || !this.workout) {
                return
            }
            this.state = 'active'

            const ts = Date.now();
            this.tsStart=ts 
            this.tsCurrent=ts
            this.offset = 0
            this.manualTimeOffset = 0;
            this.currentLimits = undefined

            this.emit('started')
            this.logEvent( {message:'workout started',settings:this.settings})

            if (!this.updateInterval)  { 
                this.update()
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


    /**
     * Pauses the current workout
     * 
     * This method needs to be called upon pauses, to ensure that the dashboards and limits will not be updated anymore
     * 
     * If the [[init]] method has not been called before or the workout is not in _active_ state, it will simply return without any response
     * 
     * @emits   __paused__
     */
    pause():void {
        try {
            if (this.state!=='initialized' && this.state!=='active') {
                return
            }

            const ts = Date.now();
            this.tsPauseStart=ts 
            this.tsCurrent=ts
            this.state='paused'

            this.emit('paused')
            this.logger.logEvent( {message:'workout paused'})
        }
        catch(err) {
            this.logError(err,'pause')
        }
    }

    /**
     * Resumes the current workout
     * 
     * This method needs to be called to leave the _paused_ state of the workout so that the the dashboards and limits will be updated again
     * 
     * If the workout is not in _completed_ state, it will restart the workout
     * If the [[init]] method has not been called before or the workout is not in _pause_ state, it will simply return without any response
     * 
     * @emits   __resumed__
     */
    resume():void {
        try {
            if (this.state==='initialized' || this.state==='completed') {  
                this.state='initialized'             
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


    /**
     * stops the current workout
     * 
     * This method needs to be called whenever a workout is either completed or a user wants to manually stop it.
     * 
     * @param props - optional properties to be passed 
     * @param props.clearFromList - if set to true, the workout will be removed from the list after stopping
     * @param props.completed - if set to true, the workout will be marked as completed
     * @emits   __completed__  or __stopped__     depending on the value of `completed`
     */
    stop( props?:{clearFromList?:boolean, completed?:boolean}):void {
        const {clearFromList,completed} = props??{}

        try {
            if (!this.workout || this.state==='idle' || this.state==='completed') {
                if (clearFromList) {
                    useWorkoutList().unselect()
                }
                return;
            }

            this.state = 'completed'

            const stateEvent = completed ? 'completed':'stopped'
            this.logger.logEvent( {message: `workout ${stateEvent}`})
            this.emit(stateEvent)

            this.stopWorker();
    
            waitNextTick()
                .then( ()=>{this.resetWorkout()})

            if (clearFromList) {
                useWorkoutList().unselect()
            }
    
        }
        catch(err) {
            this.logError(err,'stop')
        }

    }


    /**
     * Move to the next workout step
     * 
     * This method moves the limits to the next workout step. 
     * This allows the user to jump over steps that cannot be maintained
     * 
     */
    forward():void {
        try {
            const ts = this.trainingTime
            const wo = this.workout;
            const limits = wo.getLimits(ts);
            
            this.manualTimeOffset += limits.remaining   
            this.update()
            this.observer.emit('forward',ts,limits.remaining )
        }
        catch(err) {
            this.logError(err,'forward')
        }

    }

    /**
     * Move back to the beginning of the current step or previous step
     * 
     * This method moves the limits to the beginning of the current step or previous step
     * This allows the user to repeat steps beyond the repetitions configured in the workout
     * 
     * If the user has completed more than 30s or 50% of a step, it will jump back to the beginning of the current step,
     * otherwise it will jump back to the beginning of the previous step
     * 
     */
    backward():void {

        try {
            const ts = this.trainingTime
            const wo = this.workout;
            const limits = wo.getLimits(ts,true);

            const completed = limits.duration-limits.remaining

            const stepBusyLmit = Math.min( 15, limits.duration/2)
            let diff = completed;
            let jumpType = 'current'
            let target

            
            if (completed>=stepBusyLmit || limits.start===0) {
                // jump to start of current step
                this.manualTimeOffset -= completed;
                target = limits?.step
            }
            else {
                // jump to start of prev step
                jumpType = 'previous'
                const timePrev = ts-completed-0.1;
                if (timePrev<0) {
                    this.manualTimeOffset -= completed
                }
                else {
                    const prevLimits = wo.getLimits(timePrev,true);
        
                    if (prevLimits ) {
                        this.manualTimeOffset -= (completed+prevLimits.duration)      
                        diff = completed+prevLimits.duration
                        target = prevLimits.step
                    }
                }    
            }

            this.update()
            this.observer.emit('backward',ts,diff,jumpType,limits?.step, target )


        }
        catch(err) {
            this.logError(err,'backward')
        }

    }

    /**
     * Adjusts the base level of th workout
     * 
     * This allows the user to increase the instensity of a workout. 
     * 
     * Depending on how the the step limits are defined, this will have different impact
     * - Step defined in "percentage of FTP": The FTP will be increased by _delta_ %
     * - Step defined in "Watts": The power limit will be increased by _delta_ Watts
     * 
     * @param delta adjustment of the FTP(in%) or current Power (in Watt)
     * 
     */
    powerUp(delta:number):void {
        try {
            if (this.settings?.ftp) {
                this.settings.ftp = this.settings.ftp * (1+delta/100)
                this.workoutList.setStartSettings(this.settings)
            }            
            this.manualPowerOffset += delta

            this.setCurrentLimits()
            this.emit('update', this.getDashboardDisplayProperties())
        }
        catch(err) {
            this.logError(err,'powerUp')
        }
    }

    /**
     * Adjusts the base level of th workout
     * 
     * This allows the user to decrease the instensity of a workout. 
     * 
     * Depending on how the the step limits are defined, this will have different impact
     * - Step defined in "percentage of FTP": The FTP will be decreased by _delta_ %
     * - Step defined in "Watts": The power limit will be decreased by _delta_ Watts
     * 
     * @param delta adjustment of the FTP(in%) or current Power (in Watt)
     * 
     */
    powerDown(delta:number):void {
        try {
            if (this.settings?.ftp) {
                this.settings.ftp = this.settings.ftp / (1+delta/100)
                this.workoutList.setStartSettings(this.settings)
            }

            this.manualPowerOffset -= delta

            this.setCurrentLimits()
            this.emit('update', this.getDashboardDisplayProperties())
        }
        catch(err) {
            this.logError(err,'powerDown')
        }
    }

    /**
     * Toggles between the originally selected mode and ERG mode
     * 
     * This allows to temporarily swith to SmartTrainer (SIM) mode, 
     * e.g. if there is a Sprint(max effort) segment upcoming and switch back to ERG after that segment
     * 
     */
    toggleCyclingMode():void {
        const  deviceRide = useDeviceRide()
        deviceRide.toggleCyclingMode()

        this.emit('update', this.getDashboardDisplayProperties())    }


    /**
     * Provides the information that should be displayed in the dashboard
     * 
     * This contains:
     * - The complete workout ( to be shown in the graph)
     * - The workout title (to be shown in the info bar)
     * - The current FTP setting
     * - The current limits ( to be shown as values in the dashboard) incl. step time and remaining step time
     * - Optionally: start and stop for the workout graph
     * 
     * This method also implements the logic to automatically adjust the zoom factor for the workout graph
     * every 30s. If the total remaining workout time is less than 20min, the zoom will contain the last 20mins
     * 
     * @returns [[WorkoutDisplayProperties]] Information to be shown in the dashboard
     * 
     */
    getDashboardDisplayProperties():WorkoutDisplayProperties {
        try {
            if (this.state==='idle' || this.state==='completed') {
                return {};
            }

            const {start,stop} = this.getZoomParameters(this.trainingTime);
            const title = this.getStepTitle(this.trainingTime)
            const canShowBackward = Math.round((this.trainingTime??0))>0
            
            const props = {
                workout:this.workout, title, 
                ftp:this.settings.ftp, 
                current:this.currentLimits,
                start,stop,
                mode: this.getCyclingModeText(),
                canShowBackward,
                canShowForward:true
            }

            return props

        }        
        catch(err)  { 
            this.logError(err,'getDashboardDisplayProperties')
            return{}
        }

    }

    /**
     * Provides the limits that are used in the current workout step
     * 
     * @returns [[ActiveWorkoutLimit]] the current limit or _undefined_ if the workout hasn't bee initialized or already was completed
     * 
     */
    getCurrentLimits():ActiveWorkoutLimit {
        if (this.state==='idle' || this.state==='completed') {
            return undefined;
        }

        return this.currentLimits
    }

    /**
     * Provides information if the dashboard should be shown
     * 
     * The dashboard should be shown as soon as a workout has been initialized until it has been completed
     * 
     * @return boolean true: dashboard should be shown, false: dashboard does not need to be shown
     */
    inUse(): boolean {
        return this.state!=='idle' && this.state!=='completed'
    }

    /**
     * Provides information if the workout is currently applying limits
     * 
     * A segment of the workout could represent a "free ride" (no limits)
     * In these cases, 
     *  - the app should behave as a ride without workout
     *  - but workout should still be shown in dashboard
     * 
     * @return boolean true: workout is applying limits, false: workout
     */
    appliesLimits(): boolean {
        return this.inUse() && !this.isFreeRide
    }
    
    /**
     * Provides information if the workout is in _active_ state
     * 
     * 
     * @return boolean true: workout is active, false: otherwise
     */
    isActive(): boolean {
        return this.state==='active'
    }

    /**
     * Provides the current workout beeing ridden
     * 
     * @return [[Workout]] the current workout or _undefined_ if init() hasn't been called
     */
    getWorkout():Workout {
        if (this.state==='idle')
            return undefined
        return this.workout
    }

    /**
     * Provides the Observer
     * 
     * @return [[Observer]] the current observer or _undefined_ if init() hasn't been called
     */
    getObserver():Observer {
        if (this.state==='idle')
            return undefined
        return this.observer

    }

    protected update(startIfInitialized=false) {
        if (!this.workout)
            return;

        try {
            const prevTime = Math.round(this.currentLimits?.time??0)

            if (startIfInitialized && this.state==='initialized') {
                this.start()
            }
            else if (this.state!=='active')
                return

            const time = this.checkIfDone()
            if (time===null)
                return


            const prevStep = this.currentStep
            this.setCurrentLimits(time)


            if (this.currentStep!==prevStep) {
                this.onStepChange(prevStep);
            }
            else if (Math.round(time)!==prevTime) {
                this.emit('update', this.getDashboardDisplayProperties())
            }
    
        }
        catch(err) {
            this.logError(err,'update')
        }

    }

    private onStepChange(prevStep: StepDefinition) {
        if (!this.currentStep.power && prevStep.power) {
            this.startFreeRide();
        }
        else if (this.currentStep.power && !prevStep.power) {
            this.stopFreeRide();
        }

        this.emit('step-changed', this.getDashboardDisplayProperties());
    }

    private checkIfDone() {
        const time = (Date.now() -this.tsStart-(this.offset??0)) / 1000 +  (this.manualTimeOffset??0);
        const end = this.workout.getEnd();

        if ( time>=end) {
            this.stop({completed:true})
            return null;
        }
        return time

    }


    protected async startFreeRide() {
        // we might have enforced ERG Mode
        if (this.settings.useErgMode) {
            useDeviceRide().resetCyclingMode(false)            
        }
        this.resetLimits()
    }

    protected async stopFreeRide() {
        if (this.settings.useErgMode) {
            useDeviceRide().enforceERG()           
        }
        this.resetLimits()        
    }

    protected async resetLimits() {

        const rideService =  useDeviceRide()
        
        const mode = rideService.getCyclingMode()
        
        const isERG = mode ? (mode.constructor as typeof CyclingMode).supportsERGMode() : false

        if (!this.currentLimits || !mode) 
            return;

        await rideService.waitForUpdateFinish()

        const data = rideService.getData()
        
        if (isERG ) {
            rideService.sendUpdate({targetPower:data.power})            
        }
        else if (data.slope!==undefined) {
            rideService.sendUpdate({slope:data.slope})            
        }
        else {
            const initRequests = mode.getBikeInitRequest()
            rideService.sendUpdate(initRequests)
        }

        



    }

    protected resetTimes() {
        this.manualTimeOffset= 0
        this.tsStart = undefined
        this.tsCurrent = undefined
        this.tsPauseStart = undefined
        this.offset = 0
    }


    protected setCurrentLimits( trainingTime?:number ):void {
        if (valid(trainingTime))
            this.trainingTime = trainingTime

        const time = this.trainingTime
        const ftp  = this.settings.ftp;
        const wo = this.workout;
        const limits = wo.getLimits(time,true);

        
        if ( limits!==undefined) {

            this.currentStep = limits.step
            const request:ActiveWorkoutLimit = {time:0, duration:0, remaining:0} 
    
            request.time = Math.round(time);
            request.minPower = this.getPowerVal(limits.power,'min')
            request.maxPower = this.getPowerVal(limits.power,'max')
            request.minCadence = limits?.cadence?.min ? Math.round(limits.cadence.min) : undefined;
            request.maxCadence = limits?.cadence?.max ? Math.round(limits.cadence.max) : undefined;
            request.minHrm = limits.hrm?.min ? Math.round(limits.hrm.min) : undefined;
            request.maxHrm = limits.hrm?.max ? Math.round(limits.hrm.max) : undefined;
            this.currentLimits = { ...request, duration: limits.duration, remaining:limits.remaining };                 
        }

        this.isFreeRide = limits?.power===undefined || limits?.power===null
        

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

    protected getStepTitle(time:number) {
        if (!this.workout)
            return

        let title = this.workout.name
        const limit = this.workout.getLimits(time,true);
        const segment = this.workout.getSegment(time) 


        let ch = ': '


        if (segment?.text) {
            title += `${ch}${segment.text}`
            ch=' - '
        }
        if (segment?.text &&  segment?.repeat>0) {
            const repeatTime = segment.duration/segment.repeat;
            const repeatCount = Math.floor((time-segment.getStart())/repeatTime )+1
            title += `(${repeatCount}/${segment.repeat})`    
        }

        if (limit.text)
            title += `${ch}${limit.text}`

        if (limit.text && segment && !segment.text && segment.repeat>0) {
            const repeatTime = segment.duration/segment.repeat;
            const repeatCount = Math.floor((time-segment.getStart())/repeatTime )+1
            title += `(${repeatCount}/${segment.repeat})`    
        }
    

        return title
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

    protected getFtpFromUserSettings() {
        try {
            const userSettings = this.getUserSettings()
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
        this.resetLimits()
    }

    emit(eventName: string , ...args): boolean {
        if (!this.observer)
            return false;

        this.observer.emit(eventName,...args)
        return true
    }

    protected stopWorker() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = undefined;
        }
    }

    protected getCyclingModeText():string {
        const deviceRide = useDeviceRide()
        const mode = deviceRide.getCyclingMode()

        const enabled = deviceRide.isToggleEnabled()

        if (!mode || !enabled)
            return

        if (mode.isERG())
            return 'SIM'
        if (mode.isSIM()) 
            return  'ERG'
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }

}

export const useWorkoutRide= () => new WorkoutRide()
export const getWorkoutRide= () => new WorkoutRide()

