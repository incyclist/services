import { ActivityDetails, ActivityUser, useActivityRide } from "../../activities";
import { IncyclistService } from "../../base/service";
import { Observer, Singleton } from "../../base/types";
import { Injectable } from "../../base/decorators";
import { Segment, Step, useWorkoutList, useWorkoutRide, Workout } from "../../workouts";
import { useRouteList } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { CurrentRideDeviceInfo, CurrentRideState, IRideModeService, RideType } from "../base";
import { AdapterStateInfo, ExtendedIncyclistCapability, HealthStatus, useDeviceConfiguration, useDeviceRide } from "../../devices";
import { useUserSettings } from "../../settings";
import { CyclingMode, DeviceData, IncyclistCapability, UpdateRequest } from "incyclist-devices";
import { formatDateTime, getLegacyInterface, waitNextTick } from "../../utils";
import { RideModeService } from "../base/base";
import { FreeRideDisplayService } from "../route/FreeRideDisplayService";
import { FollowRouteDisplayService } from "../route/FollowRouteDisplayService";
import { VideoDisplayService } from "../route/VideoDisplayService";
import { WorkoutDisplayService } from "../workout/WorkoutDisplayService";
import { INativeUI } from "../../api/ui";
import { getBindings } from "../../api";
import { ICurrentRideService } from "../base/types";
import clone from "../../utils/clone";

@Singleton
export class CurrentRideService extends IncyclistService implements ICurrentRideService {

    protected observer: Observer
    protected type: RideType
    protected pauseReason: 'user' | 'device'
    protected state: CurrentRideState = 'Idle'
    protected prevRequestTS: number
    protected deviceInfo:CurrentRideDeviceInfo [] 
    protected displayService: IRideModeService
    protected deviceData: DeviceData
    protected actualWorkout: Workout

    protected readonly onChangeState = this.setState.bind(this)
    protected startDeviceHandlers
    protected isResuming: boolean

    constructor() {
        super('Ride')
        this.debug = this.getUserSettings().get('debug',false)
    }

    
    async init() :Promise<Observer>{
        try {
            if (this.observer || (this.state!=='Idle')) {
                await this.stop()
            }

            this.observer = new Observer()
            try {
                this.displayService = this.getRideModeService()
                this.displayService.init(this)
            }
            catch(err) {
                this.logError(err,'init')    
                delete this.observer
            }

            return this.observer 
        }
        catch(err) {
            this.logError(err,'init')
        }
    }

    start():void { 
        try {
            const rideProps =  this.getRideModeService().getLogProps()
            this.logEvent({ message: 'Start ride', ...rideProps, 
                bike: this.getBike(),
                interface: this.getBikeInterface()            
            });

            if (!this.getRideType()) {
                this.observer.emit('start-error',new Error('No active ride'))
                this.setState('Error')
            }

            // Trigger showing the start overlay
            this.setState('Starting')
            this.logEvent({message:'overlay shown',overlay:'start overlay' })


            // start devices and prepare ride ( load video/map/....)
            this.startDevices()

            this.startRide()
        }
        catch(err) {
            this.logError(err,'stop')
        }

    }

    startWithMissingSensors() {
        try {
            const props = this.getStartOverlayProps()
            this.logEvent({message:'button clicked',overlay:'start overlay',button:'Ignore',state:props,eventSource:'user', })
            this.logEvent({message:'overlay closed',overlay:'start overlay' })        
            this.onStartCompleted()
        }
        catch(err) {
            this.logError(err,'startWithMissingSensors')
        }
    }

    retryStart() {
        try {
            const props = this.getStartOverlayProps()

            this.logEvent({message:'button clicked',overlay:'start overlay',button:'Retry',state:props,eventSource:'user', })
            this.logEvent({message:'overlay closed',overlay:'start overlay' })        
    

            const rideProps =  this.getRideModeService().getLogProps()
            this.logger.logEvent({ message: 'Start ride retry', ...rideProps, 
                bike: this.getBike(),
                interface: this.getBikeInterface()            
            });

            // start devices and prepare ride ( load video/map/....)
            this.startDevices(true)
            this.startRide(true)
        }
        catch(err) {
            this.logError(err,'retryStart')
        }
    }

    async cancelStart() {
        try {
            const props = this.getStartOverlayProps()
            this.logEvent({message:'button clicked',overlay:'start overlay',button:'Cancel',reason: 'user cancel', state:props, eventSource:'user'})
            await this.stop()

        }
        catch(err) {
            this.logError(err,'cancelStart')
        }

    }

    pause(requester: 'user' | 'device'='user') {
        try {
            if (this.state!=='Active')
                return

            this.logEvent({ message: "pause activity request",activity: this.activity?.id, userRequested: requester === 'user'});

            this.state = 'Paused'
            this.getActivityRide().pause( requester === 'device')
            this.getWorkoutRide().pause()   
            this.displayService.pause()  

            this.observer?.emit('state-update',this.state)        
            this.pauseReason = requester
        }
        catch(err) {
            this.logError(err,'pause')
        }
    }

    resume(requester: 'user' | 'device'='user') {
        try {
            if (this.state!=='Paused' || this.isResuming)
                return

            this.logEvent({ message: "continue activity request",activity: this.activity?.id,userRequested: requester === 'user'});

            this.isResuming = true
            this.state = 'Active'
            
            this.getActivityRide().resume()
            this.getWorkoutRide().resume()
            this.displayService.resume()   

            this.observer?.emit('state-update',this.state)        
            waitNextTick().then( ()=>this.isResuming = false)
            
            delete this.pauseReason
        }
        catch(err) {
            this.logError(err,'resume')
        }
    }

    backward() {
        this.getWorkoutRide().backward()
    }

    forward() {
        this.getWorkoutRide().forward()

    }

    async stop(exit:boolean = false):Promise<void> {


        try {
            if ( this.state !== 'Starting' && this.state !=='Idle') {
                this.logEvent({ message: "activity stopped",activity: this.activity?.id});                   
            }

            const prevState = this.state
                this.state = 'Finished' // only update state internally, don't yet emit to UI

            this.observer?.stop()
            waitNextTick().then( ()=>delete this.observer)

            if (prevState==='Finished' || prevState==='Idle') {
                this.state = 'Idle'
                return;    
            }

            this.stopDevices(exit)
            this.displayService.stop()

            const activityService = this.getActivityRide()
            activityService.stop()
            
            this.observer?.emit('state-update',this.state)         // emit fnished state to UI

            const workoutService = this.getWorkoutRide()
            workoutService.stop({clearFromList:true, completed:true})

            if (prevState!=='Starting')
                this.enableScreensaver()

            delete this.type
            this.state = 'Idle'
        }
        catch(err) {
            this.logError(err,'stop')
        }
    }

    toggleCyclingMode() {
        try {
            if (!this.actualWorkout) {
                this.getWorkoutRide().toggleCyclingMode()
            }
            else {
                this.getDeviceRide().toggleCyclingMode()

            }       
        }
        catch(err) {
            this.logError(err,'toggleCyclingMode')
        }
    }

    async takeScreenshot() {
        try {

            const fileName = this.getScreenshotName()
        
            this.logEvent({ message: 'capture screen', fileName });   
            const fullPath = await this.getUIBinding().takeScreenshot({ fileName });
            const success = fullPath !== null && fullPath !== undefined;
            this.logEvent({ message: 'Screenshot done', result: { success, fileName: fullPath } });

            // add screenshot to activity
            this.addScreenshot(fullPath)
        }
        catch (err) {
            this.logError(err, 'takeScreenshot');
        }
    }



    /**
     * Stops the current workout and continues the ride. 
     * This method should be called if the user decides to stop the workout - while the ride and workout are still valid.
     * 
     * It should not be called if the end of the ride or the workout have been reached
     */
    stopWorkout() {
        try {

            const workoutService = this.getWorkoutRide()
            workoutService.stop({clearFromList:true})
        }
        catch(err) {
            this.logError(err,'stopWorkout')
        }       
    }

    adjustPower( increase:boolean, large:boolean ) {
        try {

            const sgn = increase ? 1:-1
            

            if (this.actualWorkout) {
                const inc = large ? sgn*5:sgn*1
                this.getWorkoutRide().powerUp(inc)    
            }
            else {
                const inc = large ? sgn*50:sgn*5
                this.devicePowerUp(inc)
            }
        }
        catch(err) {
            this.logError(err,'adjustPower')
        }        
    }

    getDisplayProperties() {
        try {
            const serviceProps = this.displayService?.getDisplayProperties()??{}
            
            const startOverlayProps = this.state==='Starting' ? this.getStartOverlayProps(): {}       
            return { workout: this.actualWorkout, route: this.route, activity: this.activity, state:this.state,startOverlayProps,...serviceProps }
        }
        catch(err) {
            this.logError(err,'getDisplayProperties')
            return {}
        }
    }

    getObserver():Observer {
        return this.observer
    }

    getRideType():RideType {
        if (!this.type) {
            this.type = this.detectRideType()
        }
        return this.type
    }

    getState():CurrentRideState {
        return this.state
    }

    // Shortcuts to current actvity, workout and route


    get activity():ActivityDetails {
        return this.getActivityRide().getActivity()
    }

    get plannedWorkout():Workout {        
        return this.getWorkoutRide().getWorkout() ?? this.getWorkoutList().getSelected()
        
    }
    

    get route():Route {
        return this.getRouteList().getSelected()
    }

    get user():ActivityUser {
        return useUserSettings().get('user',{})
    }


    // Protected

    protected setState(state:CurrentRideState) {        
        this.state = state
        this.observer?.emit('state-update',this.state)        
    }

    protected detectRideType():RideType { 


        const startSettings= this.getRouteList().getStartSettings()
        const workout = this.getWorkoutList().getSelected()

        if( startSettings?.type ==='Free-Ride') {
            return 'Free-Ride'
        }

        if (!this.route && this.getWorkoutList().getSelected()) {
            return 'Workout'
        }

        if (!this.route)
            throw new Error('unknown ride typpe')

        return this.route?.description?.hasVideo ? 'Video' : 'GPX'
    }

    protected getRideModeService():IRideModeService {
        if (this.displayService)    
            return this.displayService

        const type = this.getRideType()

        switch(type) {
            case 'Free-Ride': return new FreeRideDisplayService()
            case 'GPX':return new FollowRouteDisplayService()
            case 'Video': return new VideoDisplayService()
            case 'Workout': return new WorkoutDisplayService()
            default:
                return new RideModeService()
        }

    }

    protected checkStartStatus() {
        const devices = this.isStartDeviceCompleted()
        const ride = this.displayService.isStartRideCompleted()

        if (devices && ride) {
            this.onStartCompleted()
        }
        else {
            // send  start status update, so that UI can refresh
            this.setState('Starting')
        }

    }

    protected createActivity() {
        
        const activityService = this.getActivityRide()
        const observer = activityService.init()

        observer.once('started', ()=>{ this.onActivityWentActive()} )
        observer.on('paused', (autoResume)=>{ this.onActivityPaused(autoResume)} )
        observer.on('resumed', ()=>{ this.onActivityResumed()} )       
        observer.on('data',this.onActivityUpdate.bind(this) )   
    }

    protected updateActivityWorkout() {
        this.activity.workout = this.actualWorkout
    }

    protected onActivityWentActive() {
        this.logEvent({ message: 'Activity went active', activity:this.activity?.id, interface: this.getBikeInterface() });

        this.getWorkoutRide().start()
        this.setState('Active')
    }

    protected onActivityPaused(autoResume) {
        if (this.state==='Paused')
            return

        if (autoResume && this.state==='Active')
            this.pause('device')
    }

    protected onActivityResumed() {
        if (this.state!=='Paused')
            return

        this.resume('device')
    }


    protected onActivityUpdate(data) {

        if (this.state==='Active') {
            const currentValues = this.getActivityRide().getCurrentValues()
            if (!currentValues)
                return

            if (currentValues.speed===0) {
                this.pause('device')
                return;
            }
            this.getRideModeService().onActivityUpdate(data,currentValues)
            this.observer.emit('data-update',data,currentValues )
        }
    }

    protected onWorkoutStopped() {

        const currentStep = this.getWorkoutRide().getCurrentLimits()
        const time = this.activity.time

        this.actualWorkout?.steps?.forEach( s=> {
            if (time<s.start) {
                delete s.power
                delete s.text               
            }
            else if (time>=s.start && time<s.end) {

                const newDuration = time-s.start
                this.adjustStepDuration(s, newDuration)
                delete s.text               
            }
        })
        this.updateActivityWorkout
    }
    protected onForward(workoutTime:number, remaining: number) {
        const time = Math.round(this.activity.time)

        const currentStep = this.actualWorkout.steps.find(s=>s.start<=time && s.end>time)
        if (!currentStep)
            return

        const newDuration = time-currentStep.start
        this.adjustCurrentStepDuration(time,newDuration )

        this.updateActivityWorkout()

    }

    protected adjustCurrentStepDuration(time: number, newDuration: number) {

        let delta = 0;
        this.actualWorkout?.steps?.forEach( s=> {
            if (time>=s.start && time<s.end) {
                delta = (s.end - s.start) - newDuration
                this.adjustStepDuration(s, newDuration)
            }
            else if (time<s.start) {
                s.start-=delta
                s.end-=delta
            }
        })
        this.actualWorkout.duration -= delta

    }

    protected onBackward(workoutTime:number, duration: number, jumpType:'current'|'previous', jumpFrom:Step, jumpTo:Step) {           
        const time = Math.round(this.activity.time)

        const idx = this.actualWorkout.steps.findIndex(s=>s.start<=time && s.end>time)
        if (idx==-1)
            return

        const currentStep = this.actualWorkout.steps[idx]
        const currentCopy = new Step({...this.actualWorkout.steps[idx]})

        // shorten current stop
        const newDuration = time-currentStep.start
        this.adjustCurrentStepDuration(time,newDuration ) 

        let delta = 0
        let inserted = 0

        if (jumpType==='current' || currentStep.start===0 || idx===0) {
            const currDuration = currentCopy.duration ?? (currentCopy.end - currentCopy.start)
            currentCopy.start = currentStep.end
            currentCopy.duration = currDuration
            currentCopy.end = currentCopy.start + currDuration

            // insert current
            this.actualWorkout.steps.splice(idx+1,0,currentCopy)

            delta = currDuration
            inserted = 1
            
        }
        else if (jumpType==='previous') {

            const prevCopy = new Step({...jumpTo})

            const prevDuration = prevCopy.duration ?? (prevCopy.end - prevCopy.start)
            prevCopy.start = currentStep.end
            prevCopy.duration = prevDuration
            prevCopy.end = prevCopy.start + prevDuration

            const currDuration = currentCopy.duration ?? (currentCopy.end - currentCopy.start)
            currentCopy.start = prevCopy.end
            currentCopy.duration = currDuration
            currentCopy.end = currentCopy.start + currDuration

            // insert prev & current
            this.actualWorkout.steps.splice(idx+1,0,prevCopy, currentCopy)

            delta = prevDuration+currDuration
            inserted = 2
        }

        // adjust timings of following steps
        this.actualWorkout.steps.forEach( (s,i)=> {
            if (i>idx+inserted) {
                s.start+=delta
                s.end+=delta
            }
        })

        this.updateActivityWorkout()

    }


    protected adjustStepDuration(s:Step, newDuration) { 
        const oldDuration = s.end-s.start

        s.end = s.start+newDuration
        s.duration = newDuration

        if (!s.steady) {
            if (s.power?.max>(s.power?.min??0)) {
                s.power.max = (s.power.max-s.power.min)*newDuration/oldDuration+s.power.min
            }
        }


        
    }

    protected createActualWorkout() {
        const {type,id,name,steps,repeat} = this.plannedWorkout
        
        const workout = new Workout({type,id,name})

        this.copyFlattenedWorkout(workout, this.plannedWorkout)
        return workout
        
    }

    protected copyFlattenedWorkout(target:Workout, source:Workout) {
        const {steps} = source
        steps?.forEach( s=> {
            this.addFlattenedStep(target, s)
        })
    }

    protected addFlattenedSegment(target:Workout, segment:Segment) {   
        for (let i=0; i<(segment.repeat??1); i++) {            
            segment.steps?.forEach( s=> {                
                this.addFlattenedStep(target, s  )
            })
        }
    }

    protected addFlattenedStep(target:Workout, step:Step) {

        try {
            if (step.type==='segment' && (step as Segment).steps ) 
                this.addFlattenedSegment(target, step as Segment)                                   
            else {
                target.addStep(this.cloneStep(step))
            }
                
        }
        catch (err){
            this.logError(err,'addFlattenedStep')
        }
           
    }

    protected cloneStep(step) {
        const def = {...step}
        if (!def.duration)
            def.duration = def.end-def.start
        delete def.start
        delete def.end
        delete def.repeat
        return def
        
    }


    protected insertStep(target, time, step) { 

    }

        


    protected initWorkout() {
        try {
    
            const observer = this.getWorkoutRide().init()
            if (!observer)
                return;

            this.actualWorkout = this.createActualWorkout()

            observer
                .on( 'forward', this.onForward.bind(this) )
                .on( 'backward', this.onBackward.bind(this) )
                .on( 'stopped', this.onWorkoutStopped.bind(this) )
                .once( 'completed', this.stop.bind(this) )

            // TODO:
            // observer
            //     .on('request-update',(limits)=>{
            //         this.onWorkoutUpdates(limits)
            //     })
            //     .on('completed',()=>{
            //         this.onWorkoutUpdates(undefined)
            //     })
    
        }
        catch(err) {
            this.logError(err,'initWorkouts')
        }
    }

    protected onStartCompleted() {
        const logProps = this.getRideModeService().getLogProps
        this.logEvent({ message: 'Start success', ...logProps })

        this.createActivity()
        this.initWorkout()
        this.updateActivityWorkout()
        this.startListeningForDeviceData()
        this.setState('Started')

        this.logEvent({ message: 'Start activity', activityId: this.activity?.id, ...logProps,interface: this.getBikeInterface()});   
    }

    protected startRide(retry?:boolean) { 
        this.displayService.start(retry)

    }

    protected startDevices(retry?:boolean) {
        const devices = this.getDeviceRide()

        const startSettings = this.getDeviceStartSettings()??{}
        const props = {
            user: this.user,
            route: this.route,

            ...startSettings,
        }

        const logError = (err:Error) => {
            this.logError(err,'startDevices')
        }

        this.initDeviceHandlers()
        if (retry)
            devices.startRetry( props ).catch(logError)
        else 
            devices.start( props ).catch(logError)

    }

    

    protected stopDevices(exit:boolean = false) {

        if (this.startDeviceHandlers?.deviceDataHandler)
            this.getDeviceRide().off('data',this.startDeviceHandlers?.deviceDataHandler)
        this.resetDeviceHandlers()

        if (exit)
            this.getDeviceRide().stop()
        else 
            this.getDeviceRide().pause()
    }

    protected initDeviceHandlers() {
        if (this.startDeviceHandlers)
            return;
        
        this.startDeviceHandlers = {
            deviceStartHandler: this.onDeviceStartRequest.bind(this),
            deviceStartUpdateHandler: this.onDeviceStartStatusUpdate.bind(this),
            deviceStartOKHandler: this.onDeviceStartOK.bind(this),
            deviceStartNOKHandler:this.onDeviceStartError.bind(this),
            deviceDataHandler: this.onDeviceData.bind(this) ,
            toggleCyclingModeHandler: this.onCyclingModeToggled.bind(this),
        }

        const h = this.startDeviceHandlers
        const devices = this.getDeviceRide()    
        devices.on( 'start-request', h.deviceStartHandler)
        devices.on( 'start-success', h.deviceStartOKHandler)
        devices.on( 'start-update', h.deviceStartUpdateHandler)
        devices.on( 'start-error',   h.deviceStartNOKHandler)
        devices.on( 'cycling-mode-toggle', h.toggleCyclingModeHandler)
        
    }

    protected resetDeviceHandlers() {

        if (!this.startDeviceHandlers)
            return;

        const h = this.startDeviceHandlers
        const devices = this.getDeviceRide()    

        devices.off( 'start-request', h.deviceStartHandler)
        devices.off( 'start-success', h.deviceStartOKHandler)
        devices.off( 'start-update', h.deviceStartUpdateHandler)
        devices.off( 'start-error',   h.deviceStartNOKHandler)
        devices.off( 'cycling-mode-toggle', h.toggleCyclingModeHandler)

        delete this.startDeviceHandlers        
    }

    protected devicePowerUp(inc:number) {

        const device = this.getControlDevice()
        if (!device ) 
            return;

        const mode = this.getDeviceRide().getCyclingMode(device.udid);

        if (mode.getName()==='Simulator') {
            this.simulatorPowerUp(mode,inc)
        }
        else if (mode.isERG()) {
            this.getRideModeService().sendUpdate({targetPowerDelta:inc} )
        }      

    }

    protected simulatorPowerUp(mode:CyclingMode, powerInc:number) {

        const simMode = mode.getSetting('mode') as any as string // TODO: fix getSetting declaration
        let request = {}
        if (simMode==='Power') {
            const currentPowerTarget = mode.getSetting('power')
            const targetPower = Number(currentPowerTarget)+powerInc
            mode.setSetting('power', targetPower)
            request = {targetPower}
        }
        else {
            const currentSpeedTarget = mode.getSetting('speed')
            const speedInc = powerInc/5
            const speed = Number(currentSpeedTarget)+speedInc
            mode.setSetting('speed', speed)
            request = {speed}
        }
        
        this.getRideModeService().sendUpdate(request)

    }

    getControlDevice() {
        return  this.deviceInfo?.find( di=> di.capabilities.includes(IncyclistCapability.Control))
    }



    protected onDeviceStartRequest(devices:AdapterStateInfo[]) {

        this.deviceInfo = devices.map( d=> ({
            name: d.name,
            udid: d.udid,
            isMandatory: d.isControl,
            isControl: d.isControl,            
            capabilities: d.capabilities,
            status: d.isStarted ? 'Started' : 'Starting'
        }))
    }   
    
    protected onDeviceStartOK(device:AdapterStateInfo) {
        if (this.state!=='Starting')
            return

        const startDevice = this.deviceInfo.find( d=> d.udid===device.udid)
        if (!startDevice)
            return;

        this.disableScreensaver();

        startDevice.status = 'Started'
        this.checkStartStatus()
    }

    protected getScreenshotName():string {
        const date = formatDateTime(new Date(), "%Y%m%d%H%M%S", false);
        const fileName = `screenshot-${date}.jpg`;
        return fileName
    }

    protected addScreenshot(fileName:string) {    

        // TODO: move to mode specifc function ( for GPX we should also add position)
        const time = this.activity.time 
        this.getActivityRide().addSceenshot({fileName,time})
        
    }


    protected disableScreensaver() {
        try {
            this.logEvent({ message: 'Screensaver disabled' });
            this.getUIBinding().disableScreensaver();
        }
        catch (err) {
            this.logError(err, 'disableScreensaver');
        }
    }

    protected enableScreensaver() {
        try {
            this.logEvent({ message: 'Screensaver enabled' });
            this.getUIBinding().enableScreensaver();
        }
        catch (err) {
            this.logError(err, 'enableScreensaver');
        }
    }

    protected onDeviceStartError(device)  {
        if (this.state!=='Starting')
            return

        const startDevice = this.deviceInfo.find( d=> d.udid===device.udid)
        if (!startDevice)
            return;

        if (startDevice.status!=='Error') { 
            const key = startDevice.isMandatory ? 'Device' : 'Sensor'
            this.logEvent({ message: `${key} start error shown`, overlay: 'start overlay', device: startDevice.name, });
        }

        startDevice.status = 'Error'
        this.checkStartStatus()

    }

    protected onDeviceStartStatusUpdate(device,completed,total) { 
        if (this.state!=='Starting')
            return

        const startDevice = this.deviceInfo.find( d=> d.udid===device.udid)
        if (!startDevice)
            return;

        const pct = Math.round(completed/total*100);

        this.logEvent( {message:'onDeviceStartStatusUpdate', pct})            

        startDevice.stateText = `uploading (${pct}%)`;
    }

    protected onDeviceData(data:DeviceData,udid:number) {

        this.deviceData = data
        if (this.state!=='Active') {
            return;
        }

        this.getRideModeService().onDeviceData(data,udid)
    }

    onCyclingModeToggled(mode:'SIM' | 'ERG', request:UpdateRequest) {
        this.observer.emit('cycling-mode-toggle', mode, request)
    }

    protected startListeningForDeviceData() {
        
        const { deviceDataHandler } = this.startDeviceHandlers??{}
        if (deviceDataHandler)
            this.getDeviceRide().on('data',deviceDataHandler)
    }    

    protected isStartDeviceCompleted() {
        if (!this.deviceInfo?.length)
            return false;

        const starting = this.deviceInfo.filter( d=> d.status !== 'Started')
        return !starting.length
    }

    protected getStartOverlayProps = ()=>{
        const mode = this.getRideType()
        const devices = this.deviceInfo

        const mandatory = devices?.filter( d=>d.isMandatory)??[]
        const readyToStart = !mandatory?.length || mandatory.filter(d=>d.status==='Started').length == mandatory.length

        return {mode, rideState:this.state, devices, readyToStart}
    }

    protected getDeviceStartSettings() {
        const forceErgMode = this.getWorkoutList().getStartSettings()?.useErgMode
        const settings =  this.displayService.getDeviceStartSettings()??{}        
        return {...settings, forceErgMode}
    }                        

    protected   isSimulator() {
        const devices = this.getDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control)
        return (adapter?.getInterface()==='simulator')        
    }

    protected getBike() {
        const devices = this.getDeviceConfiguration()
        let adapter = devices.getSelected(IncyclistCapability.Control) || devices.getSelected(IncyclistCapability.Power) || devices.getSelected(IncyclistCapability.Speed) 
        return adapter?.getUniqueName()
    }

    protected getBikeInterface() {        
        const devices = useDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control) || devices.getSelected(IncyclistCapability.Power) || devices.getSelected(IncyclistCapability.Speed) 
        return getLegacyInterface(adapter)                
    }

    protected getLogRideMode() {
        const mode = this.getRideType()
        switch (mode) {
            case 'Free-Ride': return 'free-ride';
            case 'Workout': return 'workout';
            case 'Video': return 'video';   
            case 'GPX': return 'follow-route';
        }
    }



    
    


    @Injectable
    protected getActivityRide() {
        return useActivityRide()
    }

    @Injectable
    protected getWorkoutRide() {
        return useWorkoutRide()
    }

    protected getWorkoutList() {
        return useWorkoutList()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getDeviceRide() {
        return useDeviceRide() 
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }

    @Injectable
    protected getUIBinding(): INativeUI {
        return getBindings().ui
    }

}

export const useCurrentRide = () => {
    return new CurrentRideService()
}