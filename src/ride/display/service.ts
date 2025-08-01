import { ActivityDetails, ActivityUser, useActivityRide } from "../../activities";
import { IncyclistService } from "../../base/service";
import { Observer, Singleton } from "../../base/types";
import { Injectable } from "../../base/decorators";
import { Segment, Step, useWorkoutList, useWorkoutRide, Workout } from "../../workouts";
import { useRouteList } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { CurrentRideDeviceInfo, CurrentRideState, IRideModeService, RideType } from "../base";
import { AdapterStateInfo, useDeviceConfiguration, useDeviceRide } from "../../devices";
import { useUserSettings } from "../../settings";
import { CyclingMode, DeviceData, IncyclistCapability, UpdateRequest } from "incyclist-devices";
import { formatDateTime, getLegacyInterface, waitNextTick } from "../../utils";
import { RideModeService } from "../base/base";
import { FreeRideDisplayService } from "../route/FreeRideDisplayService";
import { FollowRouteDisplayService } from "../route/FollowRouteDisplayService";
import { WorkoutDisplayService } from "../workout/WorkoutDisplayService";
import { INativeUI } from "../../api/ui";
import { getBindings } from "../../api";
import { CurrentRideDisplayProps, ICurrentRideService, PrevRidesDisplayProps, StartOverlayProps } from "../base/types";
import { RouteSettings } from "../../routes/list/cards/RouteCard";
import { FreeRideOption } from "../../routes/list/types";
import { RLVDisplayService } from "../route/RLVDisplayService";

@Singleton
export class RideDisplayService extends IncyclistService implements ICurrentRideService {

    protected observer: Observer
    protected type: RideType
    protected pauseReason: 'user' | 'device'
    protected state: CurrentRideState = 'Idle'
    protected prevRequestTS: number
    protected deviceInfo:CurrentRideDeviceInfo [] 
    protected displayService: IRideModeService
    protected deviceData: DeviceData
    protected actualWorkout: Workout
    protected hideAll: boolean = false

    protected readonly onChangeState = this.setState.bind(this)
    protected startDeviceHandlers
    protected isResuming: boolean
    //protected prevRides: PrevRidesListDisplayProps

    constructor() {
        super('RideDisplay')
        this.debug = this.isDebug()
    }

    
    async init() :Promise<Observer>{

        await this.closePrevRide();
            
        this.observer = new Observer()
        
        try {
            this.displayService = this.getRideModeService(true)

            const ftNewUI = this.getUserSettings().get('NEW_GPX_UI',false)
            if (ftNewUI || this.displayService instanceof WorkoutDisplayService) {
                
                this.displayService.init(this)

                this.displayService.on('lap-completed',this.onLapCompleted.bind(this))
                this.displayService.on('route-completed',this.onRouteCompleted.bind(this))
                /* TODO:
                    'prepare-next-video' event
                    'next-video' event
                    
                */
                this.hideAll = false
            }
            

        }
        catch(err) {
            this.logError(err,'init')    
            delete this.observer
        }
        return this.observer 
    }

    start(simulate?:boolean):void { 
        try {

            if(simulate)
                this.enforceSimulator()


            const rideProps =  this.getRideModeService().getLogProps()
            this.logEvent({ message: 'Start ride', ...rideProps, 
                bike: this.getBike(),
                interface: this.getBikeInterface()            
            });

            if (!this.getRideType()) {
                this.observer.emit('start-error',new Error('No active ride'))
                this.setState('Error')
            }


            // start devices and prepare ride ( load video/map/....)
            this.startDevices()
            this.startRide()

            this.setState('Starting')
            this.logEvent({message:'overlay shown',overlay:'start overlay' })

        }
        catch(err) {
            this.logError(err,'start')
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
            await this.stopRide()

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
        try {
            if (this.getWorkoutRide().inUse()) { 
                this.getWorkoutRide()?.backward()
            }
        }
        catch(err) {
            this.logError(err,'forward')
        }
    }

    forward() {
        try {
            if (this.getWorkoutRide().inUse()) { 
                this.getWorkoutRide()?.forward()
            }
        }
        catch(err) {
            this.logError(err,'backward')
        }

    }

    async stop(exit:boolean = false) {
        try {
            this.getRideModeService()?.onStopped()
        }
        catch(err) {
            this.logError(err,'stop')
        }

        await this.stopRide({exit,noStateUpdates:true})
        this.getActivityRide().cleanup()

        delete this.type

        
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

    toggleAllOverlays() {
        this.hideAll = !this.hideAll
        this.observer?.emit('overlay-update',this.getDisplayProperties())
                
    }

    toggleUpcomingElevation() {
        this.toggleOverlay('slope')
    }

    toggleTotalElevation() {
        this.toggleOverlay('elevation')
    }

    toggleMap() {
        this.toggleOverlay('map')
    }

    toggleLeftSideView() {
        this.toggleOverlay('sv-left')
    }
    
    hideRightSideView() {
        this.toggleOverlay('sv-right')
        
    }

    onArrowKey(event) {
        try {
            const { key, shiftKey } = event;

            switch (key) {
                case 'ArrowLeft': 
                    this.backward();
                    return;
                case 'ArrowRight':
                    this.forward();
                    return
                case 'ArrowUp':
                case 'ArrowDown':
                    this.adjustPower(key==='ArrowUp', shiftKey)
                    return
            }
            
        }
        catch(err) {
            this.logError(err,'onHotKey')
        }
    }

    onSettingsChanged(area, settings) {
        if (area==='Ride' || area==='route') {
            this.getRideModeService().onRideSettingsChanged(settings)
        }

    }

    selectFreeRideOption(option:FreeRideOption|string) {
        const service = this.getRideModeService() as FreeRideDisplayService

        return service.selectOption(option)           
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

    getPrevRidesProps():PrevRidesDisplayProps {
        const startSettings = this.getRouteList().getStartSettings() as RouteSettings
        const list = this.getActivityRide().getPrevRidesListDisplay()??[]
        const show = !!this.route && startSettings?.showPrev && list.length>0 && !this.hideAll 
        const showOverlay = this.getUserSettings().get('preferences.sideViews.prev-rides',true)
        return {show, minimized:!showOverlay, list}
    }

    getDisplayProperties():CurrentRideDisplayProps {
        try {
            const startOverlayProps = this.state==='Starting' ? this.getStartOverlayProps() : undefined

            if (this.state==='Finished') {
                return {state:this.state}                
            }

            const props = { 
                workout: this.actualWorkout, route: this.route, activity: this.activity,  state:this.state,
                startOverlayProps,
                prevRides: this.getPrevRidesProps(),
                hideAll: this.hideAll,
                }

            const childProps = this.getRideModeService()?.getDisplayProperties(props)??{}

            return { ...props, ...childProps }
        }
        catch(err) {
            this.logError(err,'getDisplayProperties')
            return {state:this.state}
        }
    }

    getObserver():Observer {
        return this.observer
    }

    getRideType(overwrite?:boolean):RideType {
        if (overwrite) {
            delete this.type
        }

        if (!this.type) {
            try {
                this.type = this.detectRideType()
            }
            catch(err) {
                console.log('# error detecting ride type',err)
            }
            //catch { /* ignore error*/ }
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
        const route = this.getRouteList().getSelected()
        const settings = this.getRouteList().getStartSettings()

        // Free rides will have no selected route, but will actively manage a current (dynamic) route in the mode service
        if ( !route && settings?.type==='Free-Ride' ) {
            return this.getRideModeService().getCurrentRoute()            
        }
        // Videos might change the route during the ride ( e.g. next video functionality)
        if ( route?.description?.hasVideo && settings?.type==='Route' ) {
            return this.getRideModeService().getCurrentRoute() ??route
        }

        return route
    }

    get user():ActivityUser {
        return useUserSettings().get('user',{})
    }


    // Protected

    protected async stopRide( props:{exit?:boolean, noStateUpdates?:boolean}={} ):Promise<void> {

        try {
            if ( this.state !== 'Starting' && this.state !=='Idle') {
                this.logEvent({ message: "activity stopped",activity: this.activity?.id});                   
            }

            const prevState = this.state
            this.state = prevState==='Starting' ? 'Closing' : 'Finished' // only update state internally, don't yet emit to UI

            this.observer?.stop({immediately:props.noStateUpdates})
            if (props.noStateUpdates)
                delete this.observer
            else 
                waitNextTick().then( ()=>delete this.observer)

            if (prevState==='Finished' || prevState==='Idle' || prevState==='Closing') {
                this.state = 'Idle'
                return;    
            }

            this.stopDevices(props.exit)
            this.displayService.stop()

            this.getActivityRide().stop()
            this.observer?.emit('state-update',this.state)         // emit fnished state to UI

            const workoutService = this.getWorkoutRide()
            workoutService.stop({clearFromList:true, completed:true})

            if (this.route) {
                this.getRouteList().unselect()
            }

            if (prevState!=='Starting')
                this.enableScreensaver()

            this.state = 'Idle'
        }
        catch(err) {
            this.logError(err,'stopRide')
        }

        delete this.type
        delete this.displayService

    }

    protected async closePrevRide() {
        try {
            if (this.observer || (this.state !== 'Idle')) {
                await this.stopRide({ noStateUpdates: true });
            }

        }
        catch (err) {
            this.logError(err, 'init');
        }
    }




    protected setState(state:CurrentRideState) {        
        this.state = state
        this.observer?.emit('state-update',this.state)        
    }

    protected detectRideType():RideType { 

        const route = this.getRouteList().getSelected()
        const startSettings= this.getRouteList().getStartSettings()
        const workout = this.getWorkoutList().getSelected()

        console.log('# detectRideType', {route:!!route?.details, type:startSettings?.type, workout:!!workout, hasVideo:route?.description?.hasVideo})

        if( startSettings?.type ==='Free-Ride') {
            return 'Free-Ride'
        }

        if (!route?.details && !!workout) {
            return 'Workout'
        }

        if (!route?.details) {
            return 'Workout'  // TODO
            //throw new Error('unknown ride type')
        }

        return route?.description?.hasVideo ? 'Video' : 'GPX'
    }

    getRideModeService(overwrite?:boolean):IRideModeService {
        if (this.displayService && !overwrite)    
            return this.displayService

        const createService = ()=> {
            const type = this.getRideType(overwrite)
            switch(type) {
                case 'Free-Ride': return new FreeRideDisplayService()
                case 'GPX':return new FollowRouteDisplayService()
                case 'Video': return new RLVDisplayService()
                case 'Workout': return new WorkoutDisplayService()
                default:
                    return new RideModeService()
            }
        }

        this.displayService = createService();
        return this.displayService
    }

    protected checkStartStatus() {
        const devices = this.isStartDeviceReadyToStart()
        const sensors = this.isSensorsReadyToStart()
        const ride = this.getRideModeService().isStartRideCompleted()

        if (devices && sensors && ride) {
            this.onStartCompleted()
        }
        else {
            // send  start status update, so that UI can refresh
            this.setState('Starting')
        }

    }

    protected createActivity() {

        const observer = this.getActivityRide().init()

        observer.once('started', ()=>{ this.onActivityWentActive()} )
        observer.on('paused', (autoResume)=>{ this.onActivityPaused(autoResume)} )
        observer.on('resumed', ()=>{ this.onActivityResumed()} )       
        observer.on('data',this.onActivityUpdate.bind(this) )   
//        observer.on('prevRides', this.onPrevRidesUpdate.bind(this))
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

    // protected onPrevRidesUpdate(list: PrevRidesListDisplayProps) {
    //     this.prevRides = list
    //     this.observer.emit( 'prev-rides-update', this.getDisplayProperties())

    // }

    protected onWorkoutStopped() {
        this.logEvent({message: 'Workout stopped by user', activity:this.activity?.id });

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
        this.updateActivityWorkout()
        this.checkCyclingModeToggle()
    }

    protected onWorkoutCompleted() {
        this.logEvent({message: 'Workout completed', activity:this.activity?.id });

        if (this.state!=='Active' && this.state!=='Paused')
            return

        if (this.getRideType()==='Workout') {
            this.stopRide()
        }
        this.checkCyclingModeToggle()
       
    }

    protected checkCyclingModeToggle() { 
        if (this.getRideType()!=='Workout') {

            this.getDeviceRide().resetCyclingMode(false).then( res=> {
                if (res?.changed) {
                    this.getRideModeService().sendUpdate()
                }
                    
            })
        }
    }



    protected onLapCompleted(oldLap:number, newLap:number):void {
        console.log('# lap completed', oldLap, newLap)
        // TODO:
        // add lap to activity
        // emit lap update to UI, so that Ui can display lap totals/stats
    }

    onRouteUpdated( route: Route ) {
        this.getActivityRide().onRouteUpdate(route.points)
    }

    protected onRouteCompleted() {
        if (this.state!=='Active' && this.state!=='Paused')
            return

        console.log('# route completed', this.getWorkoutRide().inUse())


        // workout is not completed yet, continue in workout display mode
        if (this.getWorkoutRide().inUse()) { 

            this.getRouteList().unselect()

            this.type  = 'Workout'
            this.displayService = new WorkoutDisplayService()
            this.observer?.emit('view-changed')  
            
            return
        }



        this.stopRide()
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

    protected adjustPower( increase:boolean, large:boolean ) {
        try {

            const sgn = increase ? 1:-1
            

            if (this.getWorkoutRide().inUse()) {
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
        const {type,id,name} = this.plannedWorkout
        
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
        
        def.duration = def.duration ?? (def.end-def.start)
        delete def.start
        delete def.end
        delete def.repeat
        return def
        
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
                .once( 'completed', this.onWorkoutCompleted.bind(this) )    
        }
        catch(err) {
            this.logError(err,'initWorkouts')
        }
    }

    protected onStartCompleted() {
        // avoid double start due to parallel events
        if (this.state==='Started')
            return

        const logProps = this.getRideModeService().getLogProps()
        this.logEvent({ message: 'Start success',  ...logProps })

        this.state = 'Started'

        this.disableScreensaver();
        this.createActivity()
        this.initWorkout()
        this.updateActivityWorkout()
        this.startListeningForDeviceData()
        this.getRideModeService().onStarted()
        this.setState('Started')

        this.logEvent({ message: 'Start activity', activityId: this.activity?.id, ...logProps,interface: this.getBikeInterface()});   
    }

    protected startRide(retry?:boolean) { 
        this.displayService.start(retry)

        this.displayService.on('state-update',()=>{
            this.checkStartStatus()
            this.updateStartOverlay()            
        })
        .on('route-updated', this.onRouteUpdated.bind(this) )

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

        const device = this.getDeviceRide().getControlAdapter()
        if (!device ) 
            return;

        const mode = this.getDeviceRide().getCyclingMode(device.udid) as CyclingMode;

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


    protected onDeviceStartRequest(devices:AdapterStateInfo[]) {

        this.deviceInfo = devices.map( d=> ({
            name: d.name,
            udid: d.udid,
            isControl: d.isControl,
            capabilities: d.capabilities,
            status: d.isStarted ? 'Started' : 'Starting'
        }))

        this.updateStartOverlay()
    }   

    protected updateStartOverlay() {
        this.observer?.emit('state-update',this.state)

    }
    
    protected async onDeviceStartOK(device:AdapterStateInfo) {
        if (this.state!=='Starting')
            return

        const startDevice = this.deviceInfo.find( d=> d.udid===device.udid)
        if (!startDevice)
            return;

        startDevice.status = 'Started'
        this.checkStartStatus()
    }

    protected enforceSimulator() {
        this.getDeviceRide().enforceSimulator()
        
    }

    protected getScreenshotName():string {
        const date = formatDateTime(new Date(), "%Y%m%d%H%M%S", false);
        const fileName = `screenshot-${date}.jpg`;
        return fileName
    }

    protected toggleOverlay(overlay:string) {   
        // state is managed in user settings
        try {     
            const show = this.getUserSettings().get(`preferences.sideViews.${overlay}`,true)

            this.getUserSettings().set(`preferences.sideViews.${overlay}`,!show)
            this.observer?.emit('overlay-update', this.getDisplayProperties());
        }
        catch(err) {
            this.logError(err,'toggleOverlay')
        }
    }


    protected addScreenshot(fileName:string) {   
        
        const time = this.activity.time 
        const info = this.getRideModeService().getScreenshotInfo(fileName,time)
        this.getActivityRide().addScreenshot(info)
        
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
            const key = startDevice.isControl ? 'Device' : 'Sensor'
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

    protected onDeviceData(data:DeviceData,udid:string) {

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

    protected isStartDeviceReadyToStart() {
        const devices = this.deviceInfo??[]

        const mandatory = devices?.filter( d=>d.isControl)??[]

        return !mandatory?.length || mandatory.filter(d=>d.status==='Started').length == mandatory.length
    }
    protected isSensorsReadyToStart() {
        const devices = this.deviceInfo??[]

        const mandatory = devices?.filter( d=>!d.isControl)??[]
        if (!mandatory.length)
            return true

        return mandatory.filter(d=>d.status==='Started').length == mandatory.length
    }

    protected getStartOverlayProps = ():StartOverlayProps =>{
        const mode = this.getRideType()
        const readyToStart = this.isStartDeviceReadyToStart() && this.getRideModeService().isStartRideCompleted()
        const devices = this.deviceInfo??[]

        const displayOverlayProps = this.getRideModeService().getStartOverlayProps()??{}
        return {mode, rideState:this.state, devices, readyToStart, ...displayOverlayProps}
    }

    protected getDeviceStartSettings() {
        let forceErgMode = false
        if (this.getWorkoutList().getSelected()) {
             forceErgMode = this.getWorkoutList().getStartSettings()?.useErgMode
        }
        const settings =  this.getRideModeService().getDeviceStartSettings()??{}        
        return {...settings, forceErgMode}
    }                        

    protected   isSimulator() {
        const devices = this.getDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control)
        return (adapter?.getInterface()==='simulator')        
    }

    protected getBike() {
        const devices = this.getDeviceConfiguration()
        let adapter = devices.getSelected(IncyclistCapability.Control) ?? devices.getSelected(IncyclistCapability.Power) ?? devices.getSelected(IncyclistCapability.Speed) 
        return adapter?.getUniqueName()
    }

    protected getBikeInterface() {        
        const devices = useDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control) ?? devices.getSelected(IncyclistCapability.Power) ?? devices.getSelected(IncyclistCapability.Speed) 
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

    protected isDebug() {
        try {
            this.getUserSettings().get('debug',false)        
        }
        catch {
            return false
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

    @Injectable
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

export const useRideDisplay= () => {
    return new RideDisplayService()
}