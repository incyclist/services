import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer, PromiseObserver } from "../../base/types/observer";
import { useRouteList } from "../../routes";
import { useUserSettings } from "../../settings";
import { formatDateTime, formatNumber, formatTime, getLegacyInterface, waitNextTick } from "../../utils";
import { DeviceData, IncyclistCapability } from "incyclist-devices";
import { ExtendedIncyclistCapability, HealthStatus, useDeviceConfiguration, useDeviceRide } from "../../devices";
import { ActivitiesRepository, ActivityConverter, ActivityConverterFactory, ActivityDetails, ActivityInfo, ActivityLogRecord, ActivityRoute, ActivityRouteType,  DB_VERSION,DEFAULT_ACTIVITY_TITLE,ScreenShotInfo } from "../base";
import { FreeRideStartSettings, RouteStartSettings } from "../../routes/list/types";
import { RouteSettings } from "../../routes/list/cards/RouteCard";
import { v4 as generateUUID } from 'uuid';
import { RouteInfo, RoutePoint } from "../../routes/base/types";
import { ActivityState, ActivitySummaryDisplayProperties } from "./types";
import { addDetails, checkIsLoop, getElevationGainAt, getNextPosition, getPosition, getRouteHash, validateRoute } from "../../routes/base/utils/route";
import { Route } from "../../routes/base/model/route";
import { RouteApiDetail } from "../../routes/base/api/types";
import { ActivityStatsCalculator } from "./stats";
import { ActivityDuration } from "./duration";
import { ActivityUploadFactory } from "../upload";
import { getBindings } from "../../api";
import { PastActivityInfo, PastActivityLogEntry, PrevRidesListDisplayProps, useActivityList } from "../list";
import { useAvatars } from "../../avatars";
import clone from "../../utils/clone";
import { buildSummary } from "../base/utils";

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
    protected gearChangeHandler = this.onGearChange.bind(this)
    protected dataHealthHandler = this.onDeviceHealthUpdate.bind(this)

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
        lap?:number
    }

    constructor() {
        super('ActivityRide')
        this.current = { dataState:{}}
    }

    init(id?:string): Observer { 

        const observer = this.createObserver()

        const doInit = ()=> {


            try {
                delete this.activity
            
                this.current = {
                    deviceData:{},
                    dataState:{}
                }
        
        
                this.observer = observer
                this.state = 'ininitalized'
    
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
                this.getDeviceRide().on('gear-change',this.gearChangeHandler)
        
                waitNextTick().then( ()=>{
                    this.emit('initialized')
                })
            }
            catch(err) {
                this.logError(err,'init')
            }
  
        }

        if (this.observer) {
            this.cleanup().then(doInit )

        }
        else {
            doInit()
        }
      


        return observer
    }



    /** 
     * Starts a new activity, should be called once initial pedalling was detected
    */
    start() {
        this.logEvent({message:'start activity'})   
        
        try {
            if (!this.observer)
                this.init()
            if (this.state==='active')
                return;
    
            this.tsStart= Date.now()
            this.activity.startTime = new Date(this.tsStart).toISOString()
            this.current.tsUpdate = this.tsStart        
            this.statsCalculator = new ActivityStatsCalculator(this.activity,this.logger)
            this._save()
            this.state = 'active'
            this.tsStart = Date.now()
            this.tsPauseStart = undefined
            this.isSaveDone = false
    
            this.logEvent({message:'activity started' })
            this.startWorker()
            this.enableDeviceHealthCheck()
    
            this.emit('started')
    
        }
        catch(err) {
            this.logError(err,'start')
        }
    }

    /** 
     * Stops the current activity and finally saves it into the JSON  file
    */
    async stop() {
        
        this.stopWorker()
        if (!this.observer || !this.activity)
            return;

        if (this.state==='paused')  {
            const pauseDuration = (Date.now()-this.tsPauseStart)/1000;
            this.activity.timeTotal += pauseDuration
            this.activity.timePause=(this.activity.timePause??0)+pauseDuration
            this.current.tsUpdate = Date.now()

    
        }

        useDeviceRide().off('data',this.deviceDataHandler)
        useDeviceRide().off('gear-change',this.gearChangeHandler)
        this.disableDeviceHealthCheck()
        this.state = 'completed'

        this.updateActivityTime();

        this._save()            

        this.emit('completed')
        this.tsPauseStart = undefined
        delete this.tsStart
        

        await waitNextTick()
        delete this.observer
    }

    async cleanup() {
        if (this.state!=='idle' && this.state!=='completed')
            await this.stop()
        delete this.activity        
    }


    pause(autoResume:boolean=false) {
        if (this.state!=='active')
            return;

        this.state = 'paused'
        this.emit('paused')

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

        this.state = 'active'
        this.emit('resumed')

        this.logEvent({message:'activity resumed', requester })

        this.updateActivityTime();
        this._save()

        this.isSaveDone = false;
    }

    ignoreEndPos() {
        delete this.current.endPos

    }

    getDashboardDisplayProperties() {

        if (!this.current)
            return [];

        try {
            const currentValues = this.getCurrentValues();
            const {time } = currentValues
            const display = Math.floor(time / 3) % 2;
            const avgMaxStats = (display===0) ? this.getAverageValues() :  this.getMaximumValues();
    
            const info = this.buildDashboardInfo(currentValues, avgMaxStats, display);
            
            this.logEvent({message:'Dashboard update',items:info.map(i=>`${i.title}:${i.data[0]?.value??''}:${i.data[1]?.value??''}${i.data[1]?.label?'('+i.data[1]?.label+')': ''}`).join('|')})
            return info
    
        }
        catch(err) {
            this.logError(err,'getDashboardDisplayProperties')
            return []
        }
    }



    protected buildDashboardInfo(currentValues, avgMaxStats, display) {


        const { distance, time, speed, power, slope, heartrate, cadence,distanceRemaining,timeRemaining,gear } = currentValues
        const {speedDetails,powerDetails,elevationGain, heartrateDetails,cadenceDetails} = avgMaxStats
        const info = [];

        info.push({
            title: 'Time', data: [
                { value: formatTime(time, true) },
                { value: timeRemaining !== undefined ? `-${formatTime(timeRemaining, true)}` : undefined }
            ]
        });
        info.push({ title: 'Distance', data: [{ value: formatNumber(distance, 2), unit: 'km' }, { value: distanceRemaining !== undefined ? `-${formatNumber(distanceRemaining, 2)}` : undefined }] });

        info.push({ title: 'Speed', data: [{ value: formatNumber(speed, 1), unit: 'km/h' }, speedDetails], dataState: this.current.dataState?.speed });
        info.push({ title: 'Power', data: [{ value: formatNumber(power, 0), unit: 'W' }, powerDetails], dataState: this.current.dataState?.power });
        if (this.activity?.routeType !== 'Free-Ride' && this.activity?.routeType !== 'None') {
            const rf = this.activity?.realityFactor ?? 100;
            const slopeInfo = rf === 100 ? '' : `RF ${rf.toFixed(0)}%`;
            info.push({ title: 'Slope', data: [{ value: formatNumber(slope, 1), unit: '%', info: slopeInfo }, elevationGain] });
        }
        info.push({ title: 'Heartrate', data: [{ value: formatNumber(heartrate, 0), unit: 'bpm' }, heartrateDetails], dataState: this.current.dataState?.heartrate });
        info.push({ title: 'Cadence', data: [{ value: formatNumber(cadence, 0), unit: 'rpm' }, cadenceDetails], dataState: this.current.dataState?.cadence });

        if (gear) {
            info.push({ title: 'Gear', data: [{ value: gear }] });
        }

        return info;
    }

    getCurrentValues() {
        const distance = (this.activity?.distance ?? 0) / 1000;
        const speed = (this.current.deviceData?.speed ?? 0);
        const power = (this.current.deviceData?.power ?? 0);
        const slope = this.current.position?.slope;
        const heartrate = this.current.deviceData?.heartrate;
        const cadence = (this.current.deviceData?.cadence ?? 0);
        const time = this.activity?.time ?? 0;
        const position = this.current.position??{}
        const lap = this.current.lap
        const routeDistance = this.current.routeDistance
        const gear = this.current.deviceData?.gearStr
        

        let distanceRemaining = (this.getTotalDistance()/1000-distance)
        if (isNaN(distanceRemaining)) distanceRemaining=undefined
        if (distanceRemaining<0) distanceRemaining=0

        let timeRemaining 
        
        if (speed>0)  {
            timeRemaining = this.durationCalculator.getRemainingTime(
                {route:this.current.route, speed:this.current.deviceData?.speed,routePos:this.activity.distance+(this.activity?.startPos??0), endPos:this.current?.endPos}
            )    
        }

        return { position, distance, routeDistance, time, speed, power, slope, heartrate, cadence, timeRemaining, distanceRemaining,lap, gear };
    }

    protected getAverageValues() {
        const stats = this.activity?.stats
        const speedDetails = { value: formatNumber(stats?.speed?.max, 1), label: 'max' };
        const powerDetails = { value: formatNumber(stats?.power?.max, 0), label: 'max' };
        const heartrateDetails = { value: formatNumber(stats?.hrm?.max, 0), label: 'max' };
        const cadenceDetails = { value: formatNumber(stats?.cadence?.max, 0), label: 'max' };
        const elevationGain = { value: formatNumber(this.current.elevationGainDisplay ?? 0, 0), label: 'elev. done', unit: 'm' };
        return { speedDetails, powerDetails, heartrateDetails, cadenceDetails, elevationGain };
    }

    protected getMaximumValues() {
        const stats = this.activity?.stats
        const speedDetails = { value: formatNumber(stats?.speed?.avg, 1), label: 'avg' };
        const powerDetails = { value: formatNumber(stats?.power?.avg, 0), label: 'avg' };
        const heartrateDetails = { value: formatNumber(stats?.hrm?.avg, 0), label: 'avg' };
        const cadenceDetails = { value: formatNumber(stats?.cadence?.avg, 0), label: 'avg' };

        let elevationGainRemaining = this.getTotalElevation() - (this.current.elevationGainDisplay ?? 0);
        if (isNaN(elevationGainRemaining)) elevationGainRemaining = undefined;
        if (elevationGainRemaining < 0) elevationGainRemaining = 0;
        const value = elevationGainRemaining !== undefined ? `${formatNumber(elevationGainRemaining, 0)}` : undefined;

        const elevationGain = { value, label: 'elev. todo', unit: 'm' };
        return { speedDetails, powerDetails, heartrateDetails, cadenceDetails, elevationGain };
    }

    getActivitySummaryDisplayProperties():ActivitySummaryDisplayProperties {

        try {
            const route =  this.getRouteList().getSelected()
            const startSettings:RouteStartSettings = this.getRouteList().getStartSettings()

            const isFreeRide = startSettings?.type==='Free-Ride'
            const showSave = this.activity!==undefined && !this.isSaveDone;
            const showContinue = this.state!=='completed'

            const hasGPX = this.activity?.logs?.some( (log) => !!log.lat && !!log.lng)
            const showMap = hasGPX || isFreeRide || (route?.description?.hasGpx)
            const preview = showMap ? undefined: route?.description?.previewUrl

            this.logEvent({message:'activity summary shown', showSave, showContinue, showMap, fileLink: this.activity?.fitFileName})
    
    
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
                    convertSuccess= await this.convert('FIT')
                    if (convertSuccess)
                        format = 'FIT'
                }
        
                if (convertSuccess) {
                    uploadSuccess = await this.upload(format)
                }

                success = convertSuccess && uploadSuccess
                this.isSaveDone = true;

            }
            catch {
    
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



    addScreenshot( screenshot: ScreenShotInfo) {
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


    getPrevRideStats(  current:ActivityLogRecord):PastActivityInfo {

        const activities = this.current.prevRides
        if (!activities?.length)
            return []

        const logs =  activities.map( ai=> { return this.getPrevActivityLog(ai,current)})?.filter( a => a!==null)
        if (logs.length===0)
                return logs
        
        logs.push( this.getCurrentActivityLog(activities[0],current))     
        logs.sort( (a,b) => b.distance-a.distance)

        
        this.current.prevRidesLogs = logs
        
        return logs
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

        let logInfo = ''
        try {
            logInfo = `(${props.length}/${prevRides.length})`
                      + props.map( pr => `${pr.position}:${pr.avatar?.shirt}-${pr.avatar?.helmet}:${pr.title}:${pr.timeGap}:${pr.distanceGap}`)
                             .join(',')

        }
        catch {}
        this.logEvent({message:'PrevRides', prevRides:logInfo})
        


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
            if (!current?.distance ||current.distance>totalDistance)
                return null

            let prefix =''            
            const sameTime = this.getRecordWithSameOrBiggerTime(logs,current)
            if (!sameTime) 
                return null
                
            const {power,heartrate,distance,speed} = sameTime

            // calculate distance Gap, based on the record with same (or larger) timestamp
            const {distanceGap,routeDistance,lat,lng} = this.calculateDistanceGap(ai,sameTime,current)

            // calculate time Gap, based on the record with same (or larger) distance
            let sameDistance = this.getRecordWithSameOrBiggerDistance(logs,current)
            if (!sameDistance)
                return null
            const timeGap = this.calculateTimeGap(sameDistance,current)

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

    protected getRecordWithSameOrBiggerTime(logs,current) {

        let res = clone(logs.find( (log) => {
            if (log.time>=current.time) {
                return true
            }
            return false
        }))

        if (res) {
            // At this point, res is the first record equal to or beyond the same timestamp as in current ride
            if (Math.abs(res.time-current.time)>0.1) {                
                const t = res.time-current.time
                const v = res.speed/3.6
                res.distance-=(v*t)
            }            
        }
        else {
            res = clone(logs[logs.length-1])
        }
        
        return res
    }

    protected calculateDistanceGap(ai:ActivityInfo,res,current) {
       
        
        const distanceDelta = current.distance-res.distance
        const routeDistance = res.distance + ai.summary.startPos

        let lat,lng;
        if ( this.current?.route?.description?.hasGpx) {
            const point = getPosition(this.current.route,{distance:routeDistance,nearest:true})
            lat = point?.lat
            lng = point?.lng
        }

        let prefix = Math.sign(distanceDelta)>0 ? '+' : ''
        const distanceGap = prefix + (Math.abs(distanceDelta)>1000 ? `${(distanceDelta/1000).toFixed(1)}km` : `${distanceDelta.toFixed(0)}m`)

        return {distanceGap, routeDistance,lat,lng}
    }

    protected calculateTimeGap(sameDistance,current) { 
        const s = sameDistance.distance-current.distance
        const v = sameDistance.speed/3.6
        const t = v===0  ? Infinity : s/v 
        sameDistance.time-=t;         

        const timeDelta = sameDistance.time-current.time
        let prefix = Math.sign(timeDelta)>0 ? '+' : '-'
        const timeGap = prefix+ ( Math.abs(timeDelta)<60 ? `${Math.abs(timeDelta).toFixed(1)}s` : formatTime(Math.abs(timeDelta),true) )

        return timeGap

    }

    protected getRecordWithSameOrBiggerDistance(logs,current) { 
        const res = clone(logs.find( (log) => {
            if (log.distance>=current.distance) {
                return true
            }
            return false
        }))

        return res
    }

    protected getCurrentActivityLog(ai:ActivityInfo,current:ActivityLogRecord):PastActivityLogEntry|null {
        try {
            const timeGap = ''
            const distanceGap = ''
            const routeHash = ai.summary.routeHash
            const routeId = ai.summary.routeId
            const tsStart = ai.summary.startTime
            const title = 'current'
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

    protected onGearChange(gearStr:string) {
        if (!this.current.deviceData)
            this.current.deviceData = {}
        this.current.deviceData.gearStr = gearStr
        this.emit('data', {gear: gearStr})
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
    
                if (this.state==='paused' && (data.power>0||data.cadence>0) && this.current.isAutoResume) {
                    this.resume('system')
                    return;
                }

                if (this.state==='ininitalized' && (data.speed>0)) {
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
            this.current.prevRides = undefined

            const {startPos,realityFactor} = settings
            const routeId = this.activity.route.id
            const routeHash = this.activity.route.hash
            const filter = { routeId,routeHash,startPos,realityFactor,minTime:30, minDistance:500}

            useActivityList()
                .getPastActivitiesWithDetails(filter)
                .then( prevRides=> {
                    this.current.prevRides = prevRides
                    this.observer.emit('list.init',prevRides)
                })
            
        }
        catch(err) {
            this.logError(err,'initPrevActivities')
        }
    }

    protected enableDeviceHealthCheck() { 
        const devices = this.getDeviceRide()    
        devices.on( 'health', this.dataHealthHandler)
    }

    protected disableDeviceHealthCheck() { 
        const devices = this.getDeviceRide()    
        devices.off( 'health', this.dataHealthHandler)
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

        if (!this.activity)
            return

        try {
            const summary = buildSummary(this.activity)
            const info = {summary,details:this.activity}
            this.tsPrevSave = Date.now()
            await this.getRepo().save(info,true)
        }
        catch (err) {
            this.logError(err,'_save')
        }
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
        const startTime = new Date(this.tsStart).toISOString()
        this.current = {deviceData:{},dataState:{}}

        let startPos = 0;
        let endPos,segment
        let realityFactor
        let routeName
        let routeId
        let routeHash
        let routeTitle
        let routeType:ActivityRouteType;


        switch (startSettings?.type) {
            case 'Free-Ride':
                {
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
                    endPos = s.endPos
                    segment = s.segment
                    this.current.endPos = s.endPos
                    realityFactor = s.realityFactor
                    routeId = selectedRoute.description.id
                    routeHash = selectedRoute.description.routeHash?? getRouteHash(selectedRoute.details)
                    routeName = selectedRoute.description.originalName??selectedRoute.description.title
                    routeTitle = selectedRoute.description.title
                    routeType = selectedRoute.description.hasVideo ? 'Video':'GPX'
                    this.current.position = getPosition(selectedRoute,{distance:startPos})
                }
                break;
            default:
                if (selectedRoute===undefined ) { // Workout only mode
                    realityFactor = 0
                    routeName = 'Workout'
                    routeType = 'None'
                    this.current.position = undefined
                }
        }
        const title = DEFAULT_ACTIVITY_TITLE
        const id = requestedId ?? generateUUID()
        const date = formatDateTime (new Date (), "%Y%m%d%H%M%S", false)
        const name = `${title}-${date}`
        const fileName = this.getRepo().getFilename(name)
        const route:ActivityRoute = {name:routeName, hash:routeHash, title:routeTitle}

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
            startPos,endPos,segment,realityFactor,
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


        // TODO: if (control) device is unheathly calculate speed based on current power and slope
        // state is stored here: this.current.dataState[capability.toLowerCase()] 

        if (this.state!=='active')
            return;

        const tsNow = Date.now()
        const t = (tsNow-this.current.tsUpdate)/1000
        this.updateActivityTime()

        try {

            // calculate distance since last update
            const speed = this.current.deviceData?.speed ?? 0;
            const v = speed / 3.6;
            const distance = v*t;
            
            // update total distance counters
            this.activity.distance+=distance
            this.current.routeDistance+=distance
            
            if (distance!==0 && this.activity.routeType!=='None') {

                // update position and elevation gain
                const prev = this.current.position

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
        const totalRouteDistance = this.current?.endPos ?? route.points[route.points.length-1]?.routeDistance
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
        const totalRouteDistance = this.current?.endPos ?? route.points[route.points.length-1]?.routeDistance
        let totalElevation = route.points[route.points.length-1]?.elevationGain
        if (this.current?.endPos!==undefined) {
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

                if (this.isLoop()) {
                    this.current.lap = Math.floor( this.current.routeDistance/this.current.route.distance)+1
                }

                let list
                
                if (this.current.showPrev) {
                    list = this.getPrevRideStats(logRecord)
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

    protected isLoop () {
        return this.current.route?.description?.isLoop
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

        if (routeType==='None')
            return 'workout'

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
        const title = this.current.route?.getLocalizedTitle('en')


        let rideProps;
        if (routeType==='Free-Ride') {
            const {lat,lng} = this.current.position??{}
            rideProps = {route:'Free Ride', lat, lng }
        }
        else if (routeType==='None') { 
            rideProps = {route:'None'}
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
        const adapter = devices.getSelected(IncyclistCapability.Control) ?? devices.getSelected(IncyclistCapability.Power) ?? devices.getSelected(IncyclistCapability.Speed) 
        return getLegacyInterface(adapter)                
    }

    getBike() {        
        const devices = this.getDeviceConfiguration()
        const adapter = devices.getSelected(IncyclistCapability.Control) ?? devices.getSelected(IncyclistCapability.Power) ?? devices.getSelected(IncyclistCapability.Speed) 
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

    protected createObserver() {
        return new Observer()            
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
