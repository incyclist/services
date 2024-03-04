import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer } from "../../base/types/observer";
import { useRouteList } from "../../routes";
import { useUserSettings } from "../../settings";
import { formatDateTime, formatNumber, formatTime, getLegacyInterface, waitNextTick } from "../../utils";
import { DeviceData, IncyclistCapability } from "incyclist-devices";
import { ExtendedIncyclistCapability, HealthStatus, useDeviceConfiguration, useDeviceRide } from "../../devices";
import { ActivitiesRepository, ActivityDetails, ActivityLogRecord, ActivityRoute, ActivityRouteType, DB_VERSION, FitExportActivity, FitLogEntry, ScreenShotInfo, buildSummary } from "../base";
import { FreeRideStartSettings, RouteStartSettings } from "../../routes/list/types";
import { RouteSettings } from "../../routes/list/cards/RouteCard";
import { v4 as generateUUID } from 'uuid';
import { RouteInfo, RoutePoint } from "../../routes/base/types";
import { sleep } from "incyclist-devices/lib/utils/utils";
import { ActivityState } from "./types";
import { addDetails, checkIsLoop, getElevationGainAt, getNextPosition, getPosition, validateRoute } from "../../routes/base/utils/route";
import { Route } from "../../routes/base/model/route";
import { RouteApiDetail } from "../../routes/base/api/types";
import { ActivityStatsCalculator } from "./stats";
import { ActivityDuration } from "./duration";

const SAVE_INTERVAL = 5000;

/**
 * This service is used by the Front-End to manage the state of on ongoing ride (activity),
 * to implement the business logic to display the content for the dashboard
 * and to implement the business logic to save and update the current ride in the local activities repo
 * 
 * The ActivityRide Service implements an Observer pattern, were the Observer is created during start
 * It will then notify potantial consumers about relevant events:
 * 
 * - 'update' - There was an update, which requires the dashboard to be updated
 *  
 * - 'started' - The activity has been started
 * - 'paused' - The activity has been paused
 * - 'resumed' - The activity has been resumed
 * - 'completed' - The activity has been completed
 * - 'saved' - The activity has been saved
 * 
 * __Dashboard__
 * 
 * The dasboard component will typically only register for the updates and completed events to udpate its internal state
 * 
 * @example
 * ```
 * const {useActivityRide} = require('incyclist-services');
 * 
 * const service = useActivityRide()
 * 
 * const observer = service.getObserver()
 * if (observer) {
 *    observer
 *      .on('update',(displayProps)=> {console.log(displayProps)})
 *      .on('completed',()=> {console.log('Activity completed')})
 * }
 * ```
 * 
 * __Ride Workkflow__
 * 
 * The business logic of the actual ride, will typically initialize this service and then monitor for request updates 
 * 
 * @example
 * ```
 * const {useActivityRide} = require('incyclist-services');
 * 
 * const service = useActivityRide()
 * 
 * const observer = service.start()
 * if (observer) {
 *    observer
 *      .on('started',()=> {console.log('Activity started')})
 *      .on('completed',()=> {console.log('Activity completed')})
 * }
 * ```
 * 
 * @public
 * @noInheritDoc
 * 
 * 
 * The service has been implemented as singleton to ensure that only one Activity can be active per given time
 * 
 * This service depends on
 *  - User Settings Service ( to get information about the current user ( FTP, weight))
 *  - Route List Service ( to get information about the selected route)
 *  - DeviceRide Service ( to get data from the devices)
 *  

 */


@Singleton
export class ActivityRideService extends IncyclistService { 

    protected observer: Observer
    protected activity: ActivityDetails
    protected repo: ActivitiesRepository
    protected tsStart: number
    protected tsPauseStart:number
    protected prevLog: ActivityLogRecord
    protected prevLogRouteDistane: number
    protected state: ActivityState = 'idle'
    protected updateInterval:NodeJS.Timeout
    protected tsPrevSave: number
    protected prevEmit: { distance:number, routeDistance:number, speed:number}

    protected statsCalculator: ActivityStatsCalculator
    protected durationCalculator: ActivityDuration

    

    protected deviceDataHandler = this.onDeviceData.bind(this)

    protected current: {
        route?:Route
        position?: RoutePoint,       
        deviceData: DeviceData

        tsDeviceData?: number
        tsUpdate?:number,
        routeDistance?:number        
        elevationGain?: number,
        elevationGainAtPos?: number,
        elevationGainDisplay?:number,
        elevation?:number
        isAutoResume?: boolean,
        dataState: Record<string,HealthStatus>
    }

    constructor() {
        super('ActivityRide')
        
    }

    init(id?:string): Observer { 
        let isClean = true

        if (this.observer) {
            isClean = false;
            this.stop()
        }
        

        this.current = {
            deviceData:{},
            dataState:{}
        }
        const observer = new Observer()    

        if (isClean) {
            this.observer = observer
            this.state = 'ininitalized'
        }
        else {
            
            waitNextTick().then( async ()=>{                
                await sleep(10)
                this.observer = observer
                this.state = 'ininitalized'
            })
            
        }

        this.activity = this.createActivity(id)
        this.durationCalculator = new ActivityDuration(this.activity)

        this.getDeviceRide().on('data',this.deviceDataHandler)
        return observer
    }

    /** 
     * Starts a new activity
    */
    start() {
        
        if (!this.observer)
            this.init()
        if (this.state==='active')
            return;

        this.tsStart= Date.now()
        this.activity.startTime = new Date(this.tsStart).toUTCString()

        this.statsCalculator = new ActivityStatsCalculator(this.activity,this.logger)
        this._save()
        this.state = 'active'
        this.tsStart = Date.now()
        this.tsPauseStart = undefined

        this.logEvent({message:'activity started' })
        this.startWorker()

        this.emit('started')
    }

    stop() {
        this.stopWorker()

        useDeviceRide().off('data',this.deviceDataHandler)
        this.state = 'completed'

        this.updateActivityTime();
        this._save()
        this.emit('completed')

        this.tsPauseStart = undefined
        delete this.tsStart

        waitNextTick().then( ()=> {delete this.observer})
    }

    private updateActivityTime() {
        this.activity.timeTotal = (Date.now() - this.tsStart)/1000;
        this.activity.time = this.activity.timeTotal - (this.activity.timePause ?? 0);
    }

    pause(autoResume:boolean=false) {
        if (this.state!=='active')
            return;

        this.emit('paused')
        this.state = 'paused'
        this.tsPauseStart = Date.now()
        this.current.isAutoResume = autoResume
        this.logEvent({message:'activity paused', autoResume })

        this.updateActivityTime();
        this._save()
    }

    resume(requester:'user'|'system'='user') {
        if (this.state!=='paused')
            return;

        const pauseDuration = (Date.now()-this.tsPauseStart)/1000;
        this.tsPauseStart = undefined
        this.current.isAutoResume = false

        this.activity.timePause=(this.activity.timePause??0)+pauseDuration
        this.current.tsUpdate = Date.now()
        this.emit('resumed')
        this.state = 'active'

        this.logEvent({message:'activity resumed', requester })

        this.updateActivityTime();
        this._save()
    }

    getDashboardDisplayProperties() {

        try {
            const distance = (this.activity?.distance??0)/1000;
            const speed = (this.current.deviceData.speed??0);
            const power = (this.current.deviceData.power??0);
            const slope = this.current.position?.slope
            const heartrate = this.current.deviceData.heartrate;
            const cadence = (this.current.deviceData.cadence??0);
            const time = this.activity?.time??0
            
            const display = Math.floor(time/3)%2

            let distanceRemaining = (this.getTotalDistance()/1000-distance)
            if (isNaN(distanceRemaining)) distanceRemaining=undefined
            if (distanceRemaining<0) distanceRemaining=0

            const timeRemaining = this.durationCalculator.getRemainingTime(
                {route:this.current.route, speed:this.current.deviceData.speed,routePos:this.activity.distance+(this.activity.startPos??0)}
            )
        

            let speedDetails,powerDetails,elevationGain, heartrateDetails,cadenceDetails
            const stats =this.activity?.stats
            if (display===0) {                
                speedDetails = {value:formatNumber(stats?.speed?.max,1), label:'max'}
                powerDetails = {value:formatNumber(stats?.power?.max,0), label:'max'}
                heartrateDetails = {value:formatNumber(stats?.hrm?.max,0), label:'max'}
                cadenceDetails = {value:formatNumber(stats?.cadence?.max,0), label:'max'}
                elevationGain = {value:formatNumber(this.current.elevationGainDisplay??0,0),label:'elev gain',unit:'m'}
            }
            else {
                speedDetails = {value:formatNumber(stats?.speed?.avg,1), label:'avg'}
                powerDetails = {value:formatNumber(stats?.power?.avg,0), label:'avg'}
                heartrateDetails = {value:formatNumber(stats?.hrm?.avg,0), label:'avg'}
                cadenceDetails = {value:formatNumber(stats?.cadence?.avg,0), label:'avg'}

                let elevationGainRemaining = this.getTotalElevation()-this.current.elevationGainDisplay??0
                if (isNaN(elevationGainRemaining)) elevationGainRemaining=undefined
                if (elevationGainRemaining<0) elevationGainRemaining=0
                const value = elevationGainRemaining!==undefined ? `-${formatNumber(elevationGainRemaining,0)}` : undefined

                elevationGain = {value,label:'elev gain',unit:'m'}

            }
     
            const info = []
            
            info.push({ title:'Time', data:[
                {value:formatTime(time,true)},
                {value:timeRemaining!==undefined? `-${formatTime(timeRemaining,true)}` : undefined }]
            }),
            info.push({ title:'Distance', data:[{value:formatNumber(distance,2),unit:'km'},{value:distanceRemaining!==undefined? `-${formatNumber(distanceRemaining,2)}`: undefined  }]})
                
            info.push({ title:'Speed', data:[{value:formatNumber(speed,1),unit:'km/h'},speedDetails],dataState: this.current.dataState?.speed})
            info.push({ title:'Power', data:[{value:formatNumber(power,0),unit:'W'},powerDetails],dataState: this.current.dataState?.power})
            if (this.activity?.routeType!=='Free-Ride') {
                const rf = this.activity?.realityFactor??100
                const slopeInfo = rf===100 ? '' :`RF ${rf.toFixed(0)}%`
                info.push({ title:'Slope', data:[{value:formatNumber(slope,1),unit:'%',info:slopeInfo},elevationGain]})
            }
            info.push({ title:'Heartrate', data:[{value:formatNumber(heartrate,0),unit:'bpm'},heartrateDetails],dataState: this.current.dataState?.heartrate})
            info.push({ title:'Cadence', data:[{value:formatNumber(cadence,0),unit:'rpm'},cadenceDetails],dataState: this.current.dataState?.cadence})
            
            this.logger.logEvent({message:'Dashboard update',items:info.map(i=>`${i.title}:${i.data[0]?.value||''}:${i.data[1]?.value||''}${i.data[1]?.label?'('+i.data[1]?.label+')': ''}`).join('|')})

            return info
    
        }
        catch(err) {
            this.logError(err,'getDashboardDisplayProperties')
            return []
        }
    }

    getActivitySummaryDisplayProperties() {

    }

    getActivity():ActivityDetails {
        return this.activity
    }

    protected mapLogToFit(log:ActivityLogRecord): FitLogEntry {
        const {time,speed, slope, cadence, heartrate, distance, power, lat, lng,elevation} = log

        return {time,speed, slope, cadence, heartrate, distance, power, lat, lon:lng,elevation}

    }

    getFitActivity(): FitExportActivity {
        const {id,title, time,timeTotal,timePause,distance } = this.activity
        const status = 'active'

        const startTime = new Date(this.activity.startTime).toISOString()
        const logs = this.activity.logs.map(this.mapLogToFit.bind(this) )
        const screenshots = [] // TODO
        const laps = [] // TODO
        const user = {
            id: this.getUserSettings().get('uuid',undefined),
            weight: this.activity.user.weight
        }
        const stopTime= new Date(this.tsStart+timeTotal*1000).toISOString()

        return {id,title,status,logs,laps,startTime, stopTime, time, timeTotal, timePause, distance, user, screenshots}


    }

    /** user requested save: will save the activity and convert into TCX and FIT */
    save() {
        return this._save()

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



    addSceenshot( screenshot: ScreenShotInfo) {
        if (!this.activity)
            return;

        if (!this.activity.screenshots)
            this.activity.screenshots = []

        this.activity.screenshots.push(screenshot)        
    }

    onRouteUpdate(points:Array<RoutePoint>) {

        if (this.activity.routeType==='Free-Ride') {
            points.forEach( (p,cnt) => {
                p.elevation = 0;
                p.slope = 0;
                p.cnt=cnt
            })
        }

        this.current.route.details.points = points
        validateRoute(this.current.route.details)

        this.current.route.details.distance = points[points.length-1].routeDistance
        addDetails(this.current.route,this.current.route.details)
    }
    
    protected onPositionUpdate(position:RoutePoint) {
        this.current.position = position
    }


    protected onDeviceData(data:DeviceData) {
        this.current.tsDeviceData = Date.now()

        const update:DeviceData = {...data}
        if (data.distance<0 || data.speed===0) {
            update.distance = 0;
            update.speed=0
        }
       
        this.current.deviceData = { ...this.current.deviceData, ...update}
        
        if (this.state!=='active') {

            if (this.state==='paused' && data.speed>0 && this.current.isAutoResume) {
                this.resume('system')
                return;
            }
            if (this.state==='ininitalized' && data.speed>0) {
                this.start()
                return;
            }

            this.current.deviceData.speed = 0
            return;
        }

        //this.updateActivityState(data, update);
    }


    protected onDeviceHealthUpdate(udid:string,status:HealthStatus, capabilities:Array<ExtendedIncyclistCapability>) {
        capabilities.forEach(capability => {
            this.current.dataState[capability.toLowerCase()] = status
        })
    }


    /** @ignore */
    emit(eventName: string | symbol, ...args): boolean {
        if (!this.observer)
            return;

        const event = typeof(eventName)==='string' ? eventName : eventName.toString()
        this.observer.emit(event,...args)        
    }

    protected async _save():Promise<void> {
        const summary = buildSummary(this.activity)
        const info = {summary,details:this.activity}
        this.tsPrevSave = Date.now()
        await this.getRepo().save(info,true)
    }

    protected getSaveInterval():number{
        return SAVE_INTERVAL
    }

    protected async updateRepo():Promise<void> {
        if (!this.tsPrevSave || (Date.now()-this.tsPrevSave)>this.getSaveInterval()) {
            try {
                await this._save()   
            }
            catch {
                // ignore
            }
        }

    }



    protected getRepo() {
        if (this.repo)
            return this.repo

        return new ActivitiesRepository()
    }

    protected createLogRecord():ActivityLogRecord{
        const prevLogs = this.activity.logs
        const prev = prevLogs?.length ? prevLogs[prevLogs.length-1] : undefined
        const time = this.activity.time
        const timeDelta = prev? time-prev.time : time
        const deviceData = this.current?.deviceData

        const distance = (this.current.routeDistance??0)- (this.prevLogRouteDistane??this.activity.startPos)
        this.prevLogRouteDistane = this.current.routeDistance

        const log:ActivityLogRecord = {
            time,
            timeDelta,
            speed:deviceData?.speed,
            cadence:deviceData?.cadence,
            heartrate:deviceData?.heartrate,
            power:deviceData?.power,
            distance,
            slope: this.current.position?.slope,
            elevation: this.current.position?.elevation
        }
        if (this.current?.position?.lat && !isNaN(this.current?.position?.lat))
            log.lat = this.current?.position?.lat
        if (this.current?.position?.lng && !isNaN(this.current?.position?.lng)) {
            log.lng = this.current?.position?.lng
        }

        return log;
    }

    protected createActivity(requestedId?:string):ActivityDetails {

        const user = this.getUserSettings().get('user',{})
        const {weight,ftp} = user
        const uuid = this.getUserSettings().get('uuid',undefined)
                
        let selectedRoute = this.getRouteList().getSelected()        
        const startSettings:RouteStartSettings = this.getRouteList().getStartSettings()

        this.tsStart= Date.now()
        const startTime = new Date(this.tsStart).toUTCString()
        this.current = {deviceData:{},dataState:{}}

        let startPos = 0;
        let realityFactor
        let routeName
        let routeId
        let routeHash
        let routeType:ActivityRouteType;
        switch (startSettings.type) {
            case 'Free-Ride':
                {
                    // TODO: build route
                    // alternative: route is created in RouteList ( FreeRideCard)

                    const s = (startSettings as FreeRideStartSettings)
                    selectedRoute =  this.createFreeRide(s)
                    realityFactor = 0;
                    routeName = 'Free Ride';
                    routeType = 'Free-Ride';
                    routeHash = ''
                    this.current.position = getPosition(selectedRoute,{cnt:0})
                
                }
                break;
            case 'Route':
                {
                    validateRoute(selectedRoute.details)
                    const s = (startSettings as RouteSettings)
                    startPos = s.startPos
                    realityFactor = s.realityFactor
                    routeId = selectedRoute.description.id
                    routeHash = selectedRoute.description.routeHash
                    routeName = selectedRoute.description.title
                    routeType = selectedRoute.description.hasVideo ? 'Video':'GPX'
                    this.current.position = getPosition(selectedRoute,{distance:startPos})
                }
                break;
        }
        const title = 'Incyclist Ride'
        const id = requestedId ?? generateUUID()
        const date = formatDateTime (new Date (), "%Y%m%d%H%M%S", false)
        const name = `${title}-${date}`
        const fileName = this.getRepo().getFilename(name)
        const route:ActivityRoute = {name:routeName, hash:routeHash}
        if (routeId)
            route.id = routeId

        this.current.routeDistance = startPos
        this.current.route = selectedRoute
        this.current.elevationGain = 0
        this.current.elevationGainDisplay = 0
        this.current.elevationGainAtPos = realityFactor>0 ? getElevationGainAt(selectedRoute,startPos) : 0
        this.current.tsUpdate = Date.now()

        const activity:ActivityDetails =  { 
            type:'IncyclistActivity',version:DB_VERSION,  
            title,id,name,routeType,
            user: {uuid,ftp,weight},
            route,
            startTime,
            time:0, 
            timePause:0,
            timeTotal:0,
            distance:0,
            totalElevation:0,
            logs:[],
            startPos,realityFactor,
            fileName
        }

        return activity
        
    }


    protected updateActivityState() {
        if (this.state!=='active')
            return;

        const tsNow = Date.now()
        const t = (tsNow-this.current.tsUpdate)/1000
        this.updateActivityTime()

        try {

            // calculate distance since last update
            const speed = this.current.deviceData?.speed || 0;
            const v = speed / 3.6;
            const distance = v*t;
            
            // update total distance counters
            this.activity.distance+=distance
            this.current.routeDistance+=distance
            
            if (distance!==0) {
                // update position and elevation gain
                const position = getNextPosition(this.current.route,{distance,prev:this.current.position} )

                this.current.position = position

                if (this.activity.realityFactor>0) {
                    const gain = getElevationGainAt(this.current.route, this.current.routeDistance)
                    const prevGain = this.current.elevationGainAtPos
                    this.current.elevationGain += ((gain-prevGain)* this.activity.realityFactor / 100)
                    this.current.elevationGainDisplay += (gain-prevGain)
                    this.current.elevationGainAtPos = gain
                    this.activity.totalElevation = this.current.elevationGain
                }
            }
        }
        catch(err) {
            this.logError(err,'updateAcitivityState')
        }

        this.current.tsUpdate = tsNow

    }

    protected getTotalDistance():number {
        const route = this.current.route
        if (!route)
            return 0;

        const totalRouteDistance = route.points[route.points.length-1]?.routeDistance
        const isLoop = checkIsLoop(route)
        if (isLoop) {
            const currentLap = Math.floor((this.current.routeDistance??0)/totalRouteDistance)
            return totalRouteDistance-(this.activity.startPos??0)+currentLap*totalRouteDistance
        }
        else {
            return totalRouteDistance-(this.activity.startPos??0)
        }
    }

    protected getTotalElevation():number {
        const route = this.current.route
        if (!route)
            return 0;

        const totalElevation = route.points[route.points.length-1]?.elevationGain
        const totalRouteDistance = route.points[route.points.length-1]?.routeDistance
        const gainAtStart = getElevationGainAt(route,this.activity.startPos??0)
        const isLoop = checkIsLoop(route)
        if (isLoop) {
            const currentLap = Math.floor((this.current.routeDistance??0)/totalRouteDistance)
            return totalElevation-gainAtStart+currentLap*totalElevation
        }
        else {
            return totalElevation-gainAtStart
        }
    }


    protected update() {
        if (this.state!=='active')
            return;

        
        const prev = Math.floor(this.activity.time)
        this.updateActivityState()
        const time = Math.floor(this.activity.time)


        if (time!==prev) {
            const distance = this.current.routeDistance-(this.prevEmit?.routeDistance??0)
            const data = {
                speed: this.current.deviceData.speed,
                routeDistance: this.current.routeDistance,
                distance
            }
            this.emit('data', data)

            const logRecord = this.createLogRecord()


            if (logRecord){
                this.activity.logs.push(logRecord)
                this.statsCalculator.add(logRecord)
            }
            
            
            this.activity.distance  = this.current.routeDistance-this.activity.startPos
            this.activity.totalElevation =  this.current.elevationGain
            
            
            this.logActivityUpdateMessage()
            this.updateRepo()
    
        }

    }
    protected createFreeRide(settings:FreeRideStartSettings) {

        const path = settings.option?.path??[]
        const points = path.map((p,cnt)=>({...p,elevation:0,cnt,slope:0,routeDistance:undefined}))
        const id = 'Free-Ride'
        const title='Free-Ride'
        const details:RouteApiDetail = {
            id,
            title,
            points
        }
        validateRoute(details)

        const info:RouteInfo = {id ,title,hasGpx:true}
        
        const route = new Route( info)
        addDetails(route,details)


        return route
    }

    protected getMode( routeType:ActivityRouteType) {
        if (routeType==='Video')
            return 'video'
        if (routeType==='GPX')
            return 'follow route'
        return 'free ride'
    }

    getRideProps() {
        const {startPos,realityFactor,routeType} = this.activity
        const {title} = this.current.route.description
                


        let rideProps;
        if (routeType==='Free-Ride') {
            const {lat,lng} = this.current.position??{}
            rideProps = {route:'Free Ride', lat, lng }
        }
        else {
            const start = Number((startPos || 0) / 1000).toFixed(3);
            rideProps = {route:title, start, realityFactor:`${(realityFactor || 0)}%` }
        }        
        return rideProps
    }

    

    protected logActivityUpdateMessage() {
        if (this.state!=='active')
            return;
        

        const {routeType,id} = this.activity
        const rideProps = this.getRideProps()
        const { distance, time, timePause, totalElevation: elevationGain } = this.activity

        // TODO: add maxUsers to identify group rides
        const rideStats = { distance, duration:time, timePause, elevationGain, maxUsers:1 };

        this.logEvent({ message: 'activity update', 
            activityId: id, 
            mode: this.getMode(routeType), 
            ...rideProps, 
            bike: this.getBike(),
            interface: this.getBikeInterface(),
            rideStats, activityState: this.state, data:this.current.deviceData });
        

    }

    getBikeInterface() {        
        const devices = this.getDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control) || devices.getSelected(IncyclistCapability.Power) || devices.getSelected(IncyclistCapability.Speed) 
        return getLegacyInterface(adapter)                
    }

    getBike() {        
        const devices = this.getDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control) || devices.getSelected(IncyclistCapability.Power) || devices.getSelected(IncyclistCapability.Speed) 
        return adapter?.getUniqueName()
    }


    protected startWorker():void {
        if (!this.updateInterval)  { 
            this.update()
            this.updateInterval = setInterval( ()=>{ this.update()}, 500)
        }
    }

    protected stopWorker() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = undefined;
        }
    }


    // accessors to other services
    // functions are created to simplify moacking of these servcies

    protected getUserSettings() {
        return useUserSettings()
    }

    protected getRouteList() {
        return useRouteList()
    }
    protected getDeviceRide() {
        return useDeviceRide()
    }
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }


}

export const useActivityRide = ()=> new ActivityRideService()
