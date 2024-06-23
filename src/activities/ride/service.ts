import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer, PromiseObserver } from "../../base/types/observer";
import { useRouteList } from "../../routes";
import { useUserSettings } from "../../settings";
import { formatDateTime, formatNumber, formatTime, getLegacyInterface, waitNextTick } from "../../utils";
import { DeviceData, IncyclistCapability } from "incyclist-devices";
import { ExtendedIncyclistCapability, HealthStatus, useDeviceConfiguration, useDeviceRide } from "../../devices";
import { ActivitiesRepository, ActivityConverter, ActivityConverterFactory, ActivityDetails, ActivityInfo, ActivityLogRecord, ActivityRoute, ActivityRouteType, DB_VERSION,ScreenShotInfo, buildSummary } from "../base";
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
import { ActivityUploadFactory } from "../upload";
import { getBindings } from "../../api";
import { PastActivityInfo, PastActivityLogEntry, PrevRidesListDisplayProps, useActivityList } from "../list";
import { useAvatars } from "../../avatars";
import clone from "../../utils/clone";

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
    protected saveObserver: PromiseObserver<boolean>
    protected isSaveDone: boolean

    protected statsCalculator: ActivityStatsCalculator
    protected durationCalculator: ActivityDuration

    

    protected deviceDataHandler = this.onDeviceData.bind(this)

    protected current: {
        route?:Route
        position?: RoutePoint,       
        deviceData?: DeviceData
        endPos?:number,
        tsDeviceData?: number
        tsUpdate?:number,
        routeDistance?:number        
        elevationGain?: number,
        elevationGainAtPos?: number,
        elevationGainDisplay?:number,
        elevation?:number
        isAutoResume?: boolean,
        showPrev?:boolean,
        dataState: Record<string,HealthStatus>
        prevRides?: Array<ActivityInfo>
        prevRidesLogs?: PastActivityInfo
    }

    constructor() {
        super('ActivityRide')
        this.current = { dataState:{}}
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

        const settings = useRouteList().getStartSettings()
        if (settings?.type==='Route') {
            const rs = settings as RouteSettings
            if (rs.showPrev) {
                this.initPrevActivities(rs)                
            }
            
        }

        this.durationCalculator = new ActivityDuration(this.activity)

        this.getDeviceRide().on('data',this.deviceDataHandler)

        return observer
    }

    /** 
     * Starts a new activity, should be called once initial pedalling was detected
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
        this.isSaveDone = false

        this.logEvent({message:'activity started' })
        this.startWorker()

        this.emit('started')
    }

    /** 
     * Stops the current activity and finally saves it into the JSON  file
    */
    stop() {
        
        this.stopWorker()
        if (!this.observer)
            return;

        useDeviceRide().off('data',this.deviceDataHandler)
        this.state = 'completed'

        this.updateActivityTime();
        this._save()
        this.emit('completed')

        this.tsPauseStart = undefined
        delete this.tsStart
        

        waitNextTick().then( ()=> {delete this.observer})
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

        this.isSaveDone = false;
    }

    ignoreEndPos() {
        delete this.current.endPos

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
                {route:this.current.route, speed:this.current.deviceData.speed,routePos:this.activity.distance+(this.activity.startPos??0), endPos:this.current.endPos}
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

        try {
            const route = useRouteList().getSelected()

            const showSave = this.activity!==undefined && !this.isSaveDone;
            const showContinue = this.state!=='completed'
            const showMap = route?.description?.hasGpx 
            const preview = showMap ? undefined: route?.description?.previewUrl
    
    
            const props = {
                activity: this.activity,
    
                showSave,
                showContinue,
                showMap,
                preview
    
            }
            
    
            return props
    
        }
        catch( err) {
            this.logError(err,'getActivitySummaryDisplayProperties()')
            return {}
        }
    }

    getActivity():ActivityDetails {
        return this.activity
    }

    setTitle(title:string) {
        this.activity.title = title;
        this._save()
    }

    async delete() {

        if (this.state==='idle' || !this.observer)
            return;

        if (this.state!=='completed') {
            this.stop()
            await new Promise( done => {this.observer.on( 'completed', done) })
        }

        this.getRepo().delete(this.activity.id)
        this.state = 'idle'        
    }


    /** user requested save: will save the activity, convert into TCX and FIT and upload to connected apps*/
    save():PromiseObserver<boolean> {

        if (this.saveObserver) {
            return this.saveObserver
        }

        const emit = (event,...args) =>{
            if (this.saveObserver)
                this.saveObserver.emit(event,...args)
        }

        const run = async():Promise<boolean> => {
            let success = false;

            try {
                emit('start',success)

                await this._save()
            
                let format = undefined;


                let uploadSuccess =false;
                let convertSuccess= await  this.convert('TCX')

                if (convertSuccess) {
                    format = 'TCX'
                    this.convert('FIT')
                }
                else {
                    convertSuccess== await this.convert('FIT')
                    if (convertSuccess)
                        format = 'FIT'
                }
        
                if (convertSuccess) {
                    uploadSuccess = await this.upload(format)
                }

                success = convertSuccess && uploadSuccess
                this.isSaveDone = true;

            }
            catch(err) {
    
                success = false
            }

            emit('done',success)
            waitNextTick().then( ()=> { 
                
                delete this.saveObserver
            })

            return success
        }

        this.saveObserver = new PromiseObserver<boolean>(run())
        return this.saveObserver

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
        validateRoute(this.current.route)

        this.current.route.details.distance = points[points.length-1].routeDistance
        addDetails(this.current.route,this.current.route.details)
    }


    getPrevRideStats( activities: Array<ActivityInfo>, current:ActivityLogRecord):PastActivityInfo {

        if (!activities?.length)
            return []

        const logs =  activities.map( ai=> { return this.getPrevActivityLog(ai,current)})?.filter( a => a!==null)
        if (logs.length===0)
                return logs
        
        logs.push( this.getCurrentActivityLog(activities[0],current))     
        const sorted =  logs.sort( (a,b) => b.distance-a.distance)

        
        this.current.prevRidesLogs = sorted
        console.log('~~~ PREV RIDES', activities.map(a=>`${a.summary.name}:${a.summary.startTime}`),sorted)
        
        return sorted
    }

    getPrevRidesListDisplay( maxEntries:number=12):Array<PrevRidesListDisplayProps> {

        const prevRides = this.current.prevRidesLogs
        if (!prevRides?.length)
            return []

        const sorted = prevRides.filter(a=>a!==null).sort( (a,b) => b.routeDistance-a.routeDistance);
        const props:Array<PrevRidesListDisplayProps> = sorted.map( (a,idx)=>{
            const position = idx+1;
            const key = a.title==='current' ? 'current' : `${a.tsStart}`
            const avatar = useAvatars().get(key)
            return {position,avatar,...a}
        })

        if (props.length>maxEntries) {
            const len = props.length
            const currentIdx = props.findIndex( a=> a.title==='current')
            if (currentIdx<maxEntries-1) {


                let deleted = props.splice(maxEntries-1)
                props.push({title:`+${deleted.length}`,tsStart:null, distanceGap:'',timeGap:''})
            }
            else if (currentIdx>maxEntries-1){
                // last two records
                if (currentIdx<props.length-2) {
                    const deleted = props.splice(currentIdx+1)
                    props.splice( maxEntries-2, currentIdx-(maxEntries-2))
                    props.push({title:`+${deleted.length}`,tsStart:null, distanceGap:'',timeGap:''})
                }
                else if (currentIdx===props.length-2) {
                    props.splice( maxEntries-2, props.length-maxEntries)
                }
                else {
                    const keep = maxEntries-1
                    const cut = props.length-maxEntries
                    props.splice( keep,cut)
                }

            }
            else if (currentIdx===props.length-2) {
                props.splice( maxEntries-2, props.length-maxEntries)
            }
            else if (currentIdx===maxEntries-1) {
                let deleted = props.splice( currentIdx+1, props.length-currentIdx)
                props.push({title:`+${deleted.length}`,tsStart:null, distanceGap:'',timeGap:''})   
                props.splice( currentIdx-1, 1)
            }
            
        }
        

        return props
    }
    


    protected getPrevActivityLog(ai:ActivityInfo,current:ActivityLogRecord):PastActivityLogEntry|null {
        try {
            if (!ai.details || !ai.summary) {
                return null;
            }

            const logs = ai.details.logs
            const totalDistance = ai.summary.distance

            // we are beyond the totals distance ridden in the previous ride -> skip
            if (current.distance>totalDistance)
                return null


            // calculate distance Gap, based on the record with same (or larger) timestamp
            let prev = undefined;
            let res = clone(logs.find( (log,idx) => {
                if (log.time>=current.time) {
                    if (idx>0)
                        prev = logs[idx-1]
                    return true
                }
                return false
            }))
            if (!res) {
                res = clone(logs[logs.length-1])
                
            }
            else {
                // At this point, res is the first record equal to or beyond the same timestamp as in current ride
                if (Math.abs(res.time-current.time)>0.1) {                
                    const t = res.time-current.time
                    const v = res.speed/3.6
                    res.distance-=(v*t)
                }
            }
            const distanceDelta = current.distance-res.distance
            const {power,heartrate,distance,speed} = res
            const routeDistance = res.distance + ai.summary.startPos

            let lat,lng;
            if ( this.current?.route?.description?.hasGpx) {
                const point = getPosition(this.current.route,{distance:routeDistance,nearest:true})
                lat = point?.lat
                lng = point?.lng
            }

            let prefix = Math.sign(distanceDelta)>0 ? '+' : ''
            const distanceGap = prefix + (Math.abs(distanceDelta)>1000 ? `${(distanceDelta/1000).toFixed(1)}km` : `${distanceDelta.toFixed(0)}m`)

            // calculate time Gap, based on the record with same (or larger) distance
            prev = undefined;
            res = clone(logs.find( (log,idx) => {
                if (log.distance>=current.distance) {
                    if (idx>0)
                        prev = logs[idx-1]
                    return true
                }
                return false
            }))


            const s = res.distance-current.distance
            const v = res.speed/3.6
            const t = v===0  ? Infinity : s/v 
            res.time-=t;         

            const timeDelta = res.time-current.time
            prefix = Math.sign(timeDelta)>0 ? '+' : '-'
            const timeGap = prefix+ ( Math.abs(timeDelta)<60 ? `${Math.abs(timeDelta).toFixed(1)}s` : formatTime(Math.abs(timeDelta),true) )


            const routeHash = ai.summary.routeHash
            const routeId = ai.summary.routeId
            const tsStart = ai.summary.startTime
            const title = new Date(ai.summary.startTime).toLocaleDateString()

            const calculate = {time:current.time, routeHash,routeId,tsStart,title,power,heartrate,speed,distance,timeGap,distanceGap,routeDistance,lat,lng} as  PastActivityLogEntry
            



            return  calculate 
        }
        catch(err) {
            this.logError(err,'getPrevActivityLog')
            return null;
        }        
    }

    protected getCurrentActivityLog(ai:ActivityInfo,current:ActivityLogRecord):PastActivityLogEntry|null {
        try {
            const timeGap = ''
            const distanceGap = ''
            const routeHash = ai.summary.routeHash
            const routeId = ai.summary.routeId
            const tsStart = ai.summary.startTime
            const title = 'current'
            const routeDistance = current.distance
            const {power,heartrate,distance,speed,lat,lng} = current

            const calculate = {routeHash,routeId,tsStart,title,power,heartrate,speed,distance,timeGap,distanceGap,lat,lng} as  PastActivityLogEntry
            calculate.routeDistance = calculate.distance + ai.summary.startPos
            return  calculate 
        }
        catch(err) {
            this.logError(err,'getCurrentActivityLog')
            return null
        }
        
    }

    
    protected onPositionUpdate(position:RoutePoint) {
        this.current.position = position
    }


    protected onDeviceData(data:DeviceData) {

        // not initialized yet
        if (!this.current)
            return 

        if (!data)
            return;

        try {
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
    
        }
        catch(err) {
            this.logError(err,'onDeviceData')
        }        
    }

    protected initPrevActivities(settings:RouteSettings) {
        try {
            if (!this.current || !this.activity?.route)
                return
            this.current.showPrev = settings.showPrev

            const {startPos,realityFactor} = settings
            const routeId = this.activity.route.id
            const routeHash = this.activity.route.hash
            const filter = { routeId,routeHash,startPos,realityFactor}
            const prevRides = useActivityList().getPastActivities(filter, {details:true})
                                .filter( a=> a.summary.rideTime>60)

            this.current.prevRides = prevRides
        }
        catch(err) {
            this.logError(err,'initPrevActivities')
        }
    }


    protected onDeviceHealthUpdate(udid:string,status:HealthStatus, capabilities:Array<ExtendedIncyclistCapability>) {
        // not initialized yet
        if (!this.current)
            return 

        try {
            capabilities.forEach(capability => {
                this.current.dataState[capability.toLowerCase()] = status
            })
    
        }
        catch(err) {
            this.logError(err,'onDeviceHealthUpdate')
        }
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

    protected async convert(format:string):Promise<boolean> {

        const emit = (event,...args) =>{
            if (this.saveObserver)
                this.saveObserver.emit(event,...args)
            else {
                try {
                    throw new Error('')
                }
                catch(err) {
                    console.log('~~~ WARN: emitting on non existing observer', event.args, err.stack)
                }
                
            }
        }

        const fs = this.getFileSystemBinding()
        emit('convert.start',format)
        try {
            let data
            data = await ActivityConverter.convert(this.activity,format)

            emit('convert.done',format,true)

            if (format.toLowerCase()==='fit') {
                const fileName = this.activity.fileName.replace('json','fit')
                await fs.writeFile(fileName, Buffer.from (data ))   
                this.activity.fitFileName = fileName
            }

            if (format.toLowerCase()==='tcx') {
                const fileName = this.activity.fileName.replace('json','tcx')
                await fs.writeFile(fileName, Buffer.from (data ))   
                this.activity.tcxFileName = fileName
            }
            await this._save()

            return true
        }
        catch(err) {
            emit('convert.error',format,err)
            return false
        }
    }

    protected async upload(format:string):Promise<boolean> {

        const factory =  this.getActivityUploadFactory()
        
        this.saveObserver.emit('upload.start',format)
        try {
            await factory.upload( this.activity, format.toLowerCase())
            this.saveObserver.emit('upload.done', format, true)
            return true
        }
        catch(err) {
            this.saveObserver.emit('upload.error', format, err)
            return false
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

        const distance = (this.current.routeDistance??this.activity.startPos??0)-(this.activity.startPos??0)
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
                
        let selectedRoute = this.getRouteList().getSelected()?.clone()
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
                    validateRoute(selectedRoute)
                    const s = (startSettings as RouteSettings)
                    startPos = s.startPos
                    this.current.endPos = s.endPos
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

    protected changeTitle(newTitle:string) {
        if (!newTitle?.length)
            return;

        this.activity.title = newTitle

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
                const prev = this.current.position

                // TODO: improve this. The function should deliver the RoutePoint representing the rider poition after the update. 
                //       Lat/Lng, Elevation and Slope should be as close as possible to the routeDistance ( considering laps and possibility that the point might be between two way points)
                const position = getNextPosition(this.current.route,{routeDistance:this.current.routeDistance,prev:this.current.position} ) ??
                                 getNextPosition(this.current.route,{distance,prev:this.current.position} ) 
                this.current.position = position??prev

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

        const isLoop = checkIsLoop(route)
        const totalRouteDistance = this.current.endPos!==undefined&&!isLoop  ? this.current.endPos : route.points[route.points.length-1]?.routeDistance
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

        const isLoop = checkIsLoop(route)
        const totalRouteDistance = this.current.endPos!==undefined&&!isLoop  ? this.current.endPos : route.points[route.points.length-1]?.routeDistance
        let totalElevation = route.points[route.points.length-1]?.elevationGain
        if (this.current.endPos!==undefined&&!isLoop) {
            const endPosPoint = route.points.find( p=> p.routeDistance>=this.current.endPos)
            if (endPosPoint) {
                totalElevation = endPosPoint.elevationGain
            }
                
        }

        const gainAtStart = getElevationGainAt(route,this.activity.startPos??0)
        if (isLoop) {
            const currentLap = Math.floor((this.current.routeDistance??0)/totalRouteDistance)
            return totalElevation-gainAtStart+currentLap*totalElevation
        }
        else {
            return totalElevation-gainAtStart
        }
    }


    protected update() {

        try {
            const prev = Math.floor(this.activity.time)
            this.updateActivityState()
            const time = Math.floor(this.activity.time)
    
    
            if (time!==prev && this.state==='active') {
                const distance = this.current.routeDistance-(this.prevEmit?.routeDistance??0)
                const data = {
                    time: this.activity.time,
                    speed: this.current.deviceData.speed,
                    routeDistance: this.current.routeDistance,
                    distance
                }


                const logRecord = this.createLogRecord()
    
    
                if (logRecord){
                    this.activity.logs.push(logRecord)
                    this.statsCalculator.add(logRecord)
                }
                
                
                this.activity.distance  = this.current.routeDistance-this.activity.startPos
                this.activity.totalElevation =  this.current.elevationGain
                let list
                
                if (this.current.showPrev) {
                    list = this.getPrevRideStats(this.current.prevRides, logRecord)
                    this.emit('prevRides',list)
                }

                this.emit('data', data,list)
                this.prevEmit = data;
                
                this.logActivityUpdateMessage()
                this.updateRepo()
        
            }
    
        }
        catch(err) {
            this.logError(err,'update')
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

        const info:RouteInfo = {id ,title,hasGpx:true}
        
        const route = new Route( info)
        addDetails(route,details)
        validateRoute(route)


        return route
    }

    protected getMode( routeType:ActivityRouteType) {
        if (routeType==='Video')
            return 'video'
        if (routeType==='GPX')
            return 'follow route'
        return 'free ride'
    }

    protected updateActivityTime() {
        if (!this.activity)
            return;

        this.activity.timeTotal = (Date.now() - this.tsStart)/1000;
        this.activity.time = this.activity.timeTotal - (this.activity.timePause ?? 0);
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
    // functions are created to simplify mocking of these (singleton) services
    
    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }

    // istanbul ignore next
    protected getRouteList() {
        return useRouteList()
    }
    // istanbul ignore next
    protected getDeviceRide() {
        return useDeviceRide()
    }
    // istanbul ignore next
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }

    protected getActivityUploadFactory() {
        return new ActivityUploadFactory()
    }

    protected getActivityConverterfactory() {
        return new ActivityConverterFactory()        
    }

    protected getFileSystemBinding() {
        return getBindings().fs        
    }


}

export const useActivityRide = ()=> new ActivityRideService()
