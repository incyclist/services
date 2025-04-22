import { sleep } from "../../utils/sleep";
import { useDeviceAccess } from "../access/service";
import {AdapterInfo,  IncyclistDeviceSettings, useDeviceConfiguration} from "../configuration";
import { AdapterRideInfo, AdapterStateInfo, LegacyRoute, PreparedRoute, RideServiceCheckFilter, RideServiceDeviceProperties } from "./model";
import clone from "../../utils/clone";
import { useUserSettings } from "../../settings";
import { EventLogger } from 'gd-eventlog';
import { getLegacyInterface } from "../../utils/logging";
import { AdapterFactory, CyclingMode, DeviceData, DeviceProperties, DeviceSettings, IncyclistCapability, IncyclistDeviceAdapter, InterfaceFactory, SerialIncyclistDevice, UpdateRequest } from "incyclist-devices";
import { setInterval } from "timers";
import { getRouteList } from "../../routes";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Injectable } from "../../base/decorators/Injection";
import { Route } from "../../routes/base/model/route";
import { useGoogleMaps } from "../../apps";


const NO_DATA_THRESHOLD = 10000
const UNHEALTHY_THRESHOLD = 60000

type DuplicateInfo = {
    udid: string;
    info: AdapterRideInfo;
};

/**
 * Provides method to consume a devcie
 *  - start/stop/pause/resume a ride
 *  - check availability of a device
 *  - process bike updates
 *  - send bike updates
 * @noInheritDoc
 * 
 */
@Singleton
export class DeviceRideService  extends IncyclistService{

    protected initizialized: boolean
    protected adapters:AdapterRideInfo[]
    protected rideAdapters: AdapterRideInfo[]
    protected startPromises: Promise<boolean>[]
    protected data:DeviceData  ={}
    protected simulatorEnforced:boolean
    protected logger: EventLogger
    protected promiseSendUpdate: Promise<UpdateRequest|void>[]
    protected originalMode: CyclingMode
    protected deviceDataHandler = this.onData.bind(this)
    protected lazyInitDone: boolean
    protected lastDataInfo: Record<string,number> = {}
    protected reconnectBusy: boolean

    constructor() {
        super('DeviceRide')
        this.initizialized = false;
        this.simulatorEnforced = false
        this.lazyInitDone = false
        this.debug = false;   
    }

    protected waitForInit():Promise<void> {
        return new Promise(done => {
            const config = this.getDeviceConfiguration()
            if (config.isInitialized())
                return done();
            config.once('initialized' ,done)
            config.init()
        })
    }

    async lazyInit() {
        if (this.lazyInitDone)
            return;

        if (!this.initizialized) {
            await this.waitForInit()
        }
        const config = this.getDeviceConfiguration()
        this.adapters = this.getConfiguredAdapters()
        const handleModeChange = this.onCyclingModeChanged.bind(this)
        const handleDeviceDeleted = this.onDeviceDeleted.bind(this)

        config.on('mode-changed',handleModeChange)
        config.on('device-deleted',handleDeviceDeleted)    
        this.lazyInitDone = true
    }



    getAdapterStateInfo(adapterInfo:AdapterRideInfo):AdapterStateInfo {

        const {udid,adapter,capabilities,isControl} = adapterInfo

        const name = adapter.getUniqueName()
        const isStarted = adapter.isStarted()

        return {udid, name,isControl,capabilities,isStarted}

    }

    getData() {
        return this.data
    }

    protected getSelectedAdapters():AdapterRideInfo[] {
        if (this.rideAdapters)
            return this.rideAdapters

        this.rideAdapters = this.adapters = this.getConfiguredAdapters(true)
        const controlDevice = this.adapters.find ( d => d.capabilities.includes('control')) 
            ?? this.adapters.find ( d => d.capabilities.includes('power')) 
            ?? this.adapters.find ( d => d.capabilities.includes('speed')) 

        this.rideAdapters.forEach( ai => {
            ai.isControl = (ai.udid===controlDevice.udid)
        })

        if (!this.simulatorEnforced)
            return this.adapters

        const adapter = AdapterFactory.create({interface:'simulator', name:'Simulator'});        
        this.rideAdapters =  [{adapter,udid:'Simulator'+Date.now(), capabilities:adapter.getCapabilities(),isStarted:false, isControl:true}]
        return this.rideAdapters
    
    }
    protected getAllAdapters():AdapterRideInfo[] {
            const config = this.getDeviceConfiguration()
            const adapters = config.getAllAdapters()?.map( ai=> ({...ai, isStarted:false}))
            if (this.simulatorEnforced && !adapters.find( a=>a.adapter.getName()==='Simulator' )) {
                const adapter = AdapterFactory.create({interface:'simulator', name:'Simulator'});
                adapters.push({adapter,udid:'Simulator'+Date.now(), capabilities:adapter.getCapabilities(),isStarted:false})
            }
            return adapters
    } 
    protected getConfiguredAdapters(onlySelected=true):AdapterRideInfo[] {
        const config = this.getDeviceConfiguration()
        const adapters = config.getAdapters(onlySelected)?.map( ai=> ({...ai, isStarted:false}))
        return adapters
} 


    prepareEppRoute(props:RideServiceDeviceProperties): PreparedRoute {
       

        const { route, startPos, realityFactor,rideMode} = props;

        if ( !route)
            return

        const isLegacy = () => {
            const r = route as LegacyRoute
            return r.get && r.getTitle && r.isLap
        }

        const routeData = isLegacy() ? (route as LegacyRoute).get() : (route as Route).details
        if (!routeData) {
            return null;
        }
        const title = isLegacy() ? (route as LegacyRoute).getTitle() : (route as Route).description.title
        const isLap = isLegacy() ? (route as LegacyRoute).isLap() : (route as Route).description.isLoop


        let res:PreparedRoute

        this.logEvent( { message:'prepareRoute', route: title , start: startPos, reality: realityFactor})
        
        const userSettings = this.getUserSettings()
        const eppPreferences = clone(userSettings.get('eppPreferences',{}))
        if (!eppPreferences.programId)  
            eppPreferences.programId = 1;
        else {
            eppPreferences.programId++;
            if (eppPreferences.programId> 32767)
                eppPreferences.programId = 1;
        }
        userSettings.update({eppPreferences})            

        
        if ( routeData.epp) {
            const eppData = routeData.epp;
            let points = eppData.programData
            const offset = startPos || 0;
            
            if (startPos!==undefined && startPos!==0) {
                let idxBefore = 0;
                let idxAfter = points.length-1;                
                let done = false;
                for (let i=0; i<points.length && !done; i++) {
                    const p = points[i];
                    if (p.distance<=startPos) idxBefore =i;
                    if (p.distance>=startPos) {
                        idxAfter =i;
                        done =true;
                    }
                }

                if ( idxAfter>idxBefore) { 
                    const originalPoints = points;
                    const distance = startPos - originalPoints[idxBefore].distance;
                    const distanceGain =  originalPoints[idxAfter].distance - originalPoints[idxBefore].distance;
                    const elevationGain = originalPoints[idxAfter].elevation-originalPoints[idxBefore].elevation;

                    // overwrite points array
                    points = [];
                    points.push ( { distance: offset, elevation: originalPoints[idxBefore].elevation+elevationGain*distance/distanceGain } )
                    points = points.concat(originalPoints.slice(idxAfter));

                    if (isLap) {
                        points = points.concat( originalPoints.slice(1,idxBefore+1).map( p=> { p.distance+=routeData.distance; return p;}));
                        points.push ( { distance: routeData.distance+offset, elevation: originalPoints[idxBefore].elevation+elevationGain*distance/distanceGain } )
                    }

                }
                else {
                    const originalPoints = points;
                    points = originalPoints.slice(idxAfter);
                    if (isLap) {
                        points = points.concat( originalPoints.slice(1,idxBefore+1).map( p=> { p.distance+=routeData.distance; return p;}));
                    }
                }

            }
            
            const pStart = points[0];
            const elevationStart = pStart.elevation;
            const totalDistance = isLap ? routeData.distance : Math.ceil( routeData.distance-(startPos||0));

            res = {
                name: eppData.name,
                description: eppData.description,
                programId: eppPreferences.programId,
                type:  rideMode || 'free ride',
                totalDistance,
                lapMode: isLap,
                minElevation: eppData.minElevation,
                maxElevation: eppData.maxElevation,
                sampleRate: eppData.sampleRate,
                points: points.map ( p => {
                    const adjustedElevation = realityFactor===undefined ? p.elevation : elevationStart + (p.elevation-elevationStart)*realityFactor/100
                    return {
                        elevation: adjustedElevation , //Math.round(adjustedElevation*10)/10,
                        distance: p.distance,
                    }
                })
            }

            
        }
        else {
            const sampleRate = 10; 

            let points = routeData.points ?? routeData['decoded'];
            let totalDistance = Math.ceil(routeData.distance);

            if (startPos!==undefined && startPos!==0) {
                let idxBefore = 0;
                let idxAfter = points.length-1;                
                let done = false;
                for (let i=0; i<points.length && !done; i++) {
                    const p = points[i];
                    if (p.routeDistance<=startPos) idxBefore =i;
                    if (p.routeDistance>=startPos) {
                        idxAfter =i;
                        done =true;
                    }
                }

                if ( idxAfter>idxBefore) { 
                    const originalPoints = points;
                    const distance = startPos - originalPoints[idxBefore].routeDistance;
                    const distanceGain =  originalPoints[idxAfter].routeDistance - originalPoints[idxBefore].routeDistance;
                    const elevationGain = originalPoints[idxAfter].elevation-originalPoints[idxBefore].elevation;

                    // overwrite points array
                    points = [];
                    points.push ( { routeDistance: startPos, elevation: originalPoints[idxBefore].elevation+elevationGain*distance/distanceGain } )
                    points = points.concat(originalPoints.slice(idxAfter));
                    if (isLap) {
                        points = points.concat( originalPoints.slice(1,idxBefore+1).map( p=> { p.routeDistance+=routeData.distance; return p;}));
                        points.push ( { routeDistance: routeData.distance, elevation: originalPoints[idxBefore].elevation+elevationGain*distance/distanceGain } )
                    }


                }
                else {
                    const originalPoints = points;
                    points = originalPoints.slice(idxAfter);
                    if (isLap) {
                        points = originalPoints.slice(1,idxBefore+1).map( p=> { p.routeDistance+=routeData.distance; return p;});
                    }
                    
                }

                totalDistance = isLap ? routeData.distance : Math.ceil( routeData.distance-(startPos||0));
            }

            
            res = {
                name: routeData.title,
                description: '',
                programId: eppPreferences.programId,
                type:  rideMode || 'free ride',
                totalDistance,
                lapMode: isLap,
                minElevation: 0,
                maxElevation: Math.ceil( Math.max ( ...points.map(p => p.elevation)) /1000) *1000,
                sampleRate,
                points: []
            }

            const offset = startPos || 0;
            let d = offset; 
            let i = 0;
            let pStart = points[0];

            const elevationStart = pStart.elevation? Math.round(pStart.elevation*10)/10 : 0;

            const addPoint = (distanceValue, elevationValue, inc=true) => { 
                const distance = Math.round(distanceValue)
                let elevation = elevationValue>=0 ? Math.round(elevationValue*10)/10 : 0;
                if (realityFactor!==undefined) {
                        elevation = elevationStart + (elevation-elevationStart)*realityFactor/100;
                }
                res.points.push( {
                    elevation,
                    distance
                })
                if (inc) d+=sampleRate
            }


            while (d <= routeData.distance+offset && i<points.length) {
                const p = points[i];
                
                if (i===0) {
                    addPoint( 0, p.elevation,false);
                    i++;
                }
                else {

                    if (p.routeDistance<d) {
                        pStart = p;
                        i++;
                    }
                    else if (p.routeDistance===d+sampleRate) { 
                        addPoint( p.routeDistance-offset, p.elevation);
                        i++;

                    }
                    else if (p.routeDistance>d+sampleRate)  {

                        do {

                            const d1 = pStart.routeDistance
                            const d2 = p.routeDistance
                            const e1 = pStart.elevation;
                            const e2 = p.elevation
                            const dT = d+sampleRate;
                            const e = e1 + (e2-e1)*(dT-d1)/(d2-d1);
                            addPoint( dT-offset, e );
                        }
                        while (p.routeDistance>d+sampleRate);

                        // did we reach the end of the route?
                        if (p.routeDistance>=routeData.distance  || i===points.length-1) {
                            addPoint( p.routeDistance-offset, p.elevation);
                            i++;
    
                        }
                        else {
                            i++;
                            pStart = p;
                        }
                        
                    }   
                    else {
                        i++;                        
                    }                     
                }



            }


        }

        return res;

    }


    async waitForPreviousStartToFinish():Promise<boolean> {        
        const TIMEOUT = 3000;

        if (!this.startPromises)
            return true;

        const prevStartState = await Promise.race( [ 
            sleep(TIMEOUT).then(()=>'timeout'), 
            Promise.allSettled(this.startPromises)] ).then( ()=>'finished')
        
        return (prevStartState==='finished')
    }

    /**
     * Performs a check if a given device or a group of devices can be started
     * The check can be filltered by various criteria: interface(s), capability, udid
     * If multiple filter criteria are specified, the will be combined with an AND operation
     * 
     * @param filter allows to filter the devices that should be started
     * @returns void
     */

    async startCheck(filter: RideServiceCheckFilter):Promise<void> {
        await this.lazyInit();
        const adapters = this.getAdapters(filter)

        const goodToGo = await this.waitForPreviousStartToFinish()
        if (!goodToGo) 
            return;

        this.emit('check-request', adapters?.map( this.getAdapterStateInfo ))
        await this.startAdapters(adapters,'check')
    }

    /**
     * Filters the list of adapters based on various criteria: interface(s), capability, udid
     * If multiple filter criteria are specified, the will be combined with an AND operation
     * 
     * @param filter allows to filter the devices that should be started
     * @returns void
     */
    getAdapters(filter:RideServiceCheckFilter):AdapterRideInfo[] {

        const {udid,interface: ifName, interfaces} = filter      

        const onlySelected = !udid 
        let adapters:AdapterRideInfo[] = onlySelected ? this.getSelectedAdapters() :this.getAllAdapters() 
        

        const getIf = (adapter) => {
            const i = adapter?.getSettings()?.interface   
            if (!i)
                return
            if ( typeof(i)==='string')
                return i
            return i.getName()
        }

        if (udid) {
            adapters = adapters?.filter( ai => ai.udid===udid)    
        }
        if (ifName) {
            adapters = adapters?.filter( ai => getIf(ai.adapter)===ifName)    
        }
        if (interfaces) {            
            adapters = adapters?.filter( ai => interfaces.includes( getIf(ai.adapter)))    
        }

        return adapters||[]
    }

    setSerialPortInUse(adapter:IncyclistDeviceAdapter) {
        if (adapter.getInterface()==='serial' || adapter.getInterface()==='tcpip') {
            const device = adapter as SerialIncyclistDevice<DeviceProperties>
            const serial = device.getSerialInterface()
            serial.setInUse( device.getPort())
        }

    }

    /**
     * 
     * ANT+ seems to cause problems if the same deviceID is used as sensor for multiple capabilties. 
     * This will cause that multiple channels will be opened with the same DEviceID, causing CHANNEL_COLLISION events 
     * 
     * Thus, we need to check if mutliple sensors are used with the same device ID and if so, only start the "most powerful"
     * 
     * @param adapters 
     * 
     * @returns An array, where every record contains the udid of the "most powerful" adapter and the AdapterInfo of the duplicates
     */

    protected checkAntSameDeviceID(adapters:AdapterRideInfo[]):Array<DuplicateInfo> {

        try {

            const antDevices = adapters.map((ai,idx)=>({...ai,idx}))                      // keep index in adapter list for reference
                                        .filter(ai=>ai.adapter.getInterface()==='ant')     // we are only looking for ant adapters
                                        .map(ai=>({idx:ai.idx, deviceID:ai.adapter.getID(), capabilities:ai.capabilities,udid:ai.udid}))

            const antDeviceIds = antDevices.map(di=>di.deviceID)        
            const duplicateIds = antDeviceIds.filter((item, index) => antDeviceIds.indexOf(item) !== index)

            const score = (capabilities) => {
                let value = 0;
                if (capabilities.includes(IncyclistCapability.Control)) value += 100;
                if (capabilities.includes(IncyclistCapability.Power)) value += 50;
                value += capabilities.length
                return value;
            }

            const duplicateDevices = antDevices.filter( di=> duplicateIds.includes(di.deviceID) ).sort( (a,b) => score(b.capabilities)-score(a.capabilities) )
                

            const leading = duplicateDevices[0]

            const duplicateAdapters = []
            duplicateDevices.forEach( (di,i) => {
                if (i==0)
                    return
                
                duplicateAdapters.push( {udid:leading.udid, info:adapters[di.idx]})
                //adapters[di.idx] = null
                
            })
            return duplicateAdapters
        }
        catch {
            return []
        }

    }


   
    async startAdapters( adapters:AdapterRideInfo[], startType: 'start' | 'check' | 'pair',props?:RideServiceDeviceProperties ):Promise<boolean> {
        


        const duplicates = this.checkAntSameDeviceID(adapters)


        this.startPromises = adapters?.map( async ai=> 
            this.startSingleAdapter(ai,duplicates,props,startType)
        )

        if (!this.startPromises?.length)
            return true;

        const status = await Promise.all(this.startPromises)
        const allOK = status.find( s=>s===false)===undefined
        this.emit(`${startType}-result`, allOK)

        if (allOK && startType==='start') {
            this.startRide(props)
        }

        this.startPromises = null;
        return allOK;
        
    }

    protected async startSingleAdapter(ai: AdapterRideInfo,duplicates:Array<DuplicateInfo>,props,startType: 'start' | 'check' | 'pair' ) {
        if (duplicates.find(dai=>dai.info.udid===ai.udid))
            return;

        const startProps = clone(props??{})
        const { forceErgMode, startPos, realityFactor, rideMode, route} = props??{};


        this.initCyclingMode(ai, forceErgMode);

        if (startType==='check' || startType==='pair') {
            this.initForPairing(startProps, ai);
        }

        if (startType==='start') {            
            this.initForStart(ai, startProps, route, startPos, realityFactor, rideMode);
        }

        const sType = (ai.isControl ?? ai.adapter.hasCapability(IncyclistCapability.Control)) ? 'bike' : 'sensor'
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const logProps = {} as any
        logProps[sType] = ai.adapter.getUniqueName()
        logProps.cability = ai.adapter.getCapabilities().join('/')
        logProps.interface = getLegacyInterface(ai.adapter) 
        if (sType==='bike'){
            const bike = ai.adapter
            logProps.cyclingMode = bike.getCyclingMode()?.getName()
            logProps.bikeType = bike.getCyclingMode()?.getSetting('bikeType') 
        }


        this.logEvent( {message:`${startType} ${sType} request`,...logProps})
        return ai.adapter.start(startProps)
            .then( async (success)=>{
                if (success) {
                    await this.handleStartSuccess(startType, ai, duplicates, sType, logProps);
                    return true
                }
                
                await this.handleStartFailure(startType, ai, duplicates, sType, logProps);
                return false
            })
            .catch(async err=>{                    

                await this.handleStartRejection(startType, sType, logProps, err, ai, duplicates);
                return false
            })

    }

    private initForStart(ai: AdapterRideInfo, startProps: any, route: any, startPos: any, realityFactor: any, rideMode: any) {
        if (ai.adapter?.isControllable()) {
            const bike = ai.adapter;

            // Special Case Daum8i "Daum Classic" mode:
            // we need to upload the route data (in Epp format) as part of the start commands
            if (bike.getCyclingMode().getModeProperty('eppSupport')) {
                startProps.route = this.prepareEppRoute({ route, startPos, realityFactor, rideMode });
                startProps.onStatusUpdate = (completed: number, total: number) => {
                    this.emit('start-update', this.getAdapterStateInfo(ai), completed, total);
                };

            }


        }
    }

    private initForPairing(startProps: any, ai: AdapterRideInfo) {
        startProps.timeout = 10000;
        if (ai.adapter.getSettings().interface === 'ble')
            startProps.timeout = 30000;
    }

    private initCyclingMode(ai: AdapterRideInfo, forceErgMode: any) {
        let bike,mode,settings;

        if (ai.adapter?.isControllable()) {
            bike = ai.adapter;
            const config = this.getDeviceConfiguration()

            const modeInfo = config.getModeSettings(ai.udid);
            mode = modeInfo?.mode;
            settings = modeInfo?.settings || {};


            if (!this.simulatorEnforced && forceErgMode) {
                const modes = bike.getSupportedCyclingModes().filter(C => C.supportsERGMode());
                if (modes.length > 0) {
                    mode = new modes[0](bike);
                    const modeInfo = config.getModeSettings(ai.udid, mode);
                    settings = modeInfo.settings;
                }
            }
            
            mode = mode??bike.getDefaultCyclingMode();
            bike.setCyclingMode(mode, settings);
        }
    }

    private async handleStartRejection(startType: string, sType: string, logProps: any, err: any, ai: AdapterRideInfo, duplicates: DuplicateInfo[]) {
        this.logEvent({ message: `${startType} ${sType} request failed`, ...logProps, reason: err.message });

        this.emit(`${startType}-error`, this.getAdapterStateInfo(ai), err);
        if (duplicates.find(dai => dai.udid === ai.udid)) {
            duplicates.forEach(dai => { this.emit(`${startType}-error`, this.getAdapterStateInfo(dai.info)); });
        }
        if (startType === 'check' || startType === 'pair') {
            await ai.adapter.stop().catch(console.log);
        }

        ai.isStarted = false;
    }

    private async handleStartFailure(startType: string, ai: AdapterRideInfo, duplicates: DuplicateInfo[], sType: string, logProps: any) {
        this.emit(`${startType}-error`, this.getAdapterStateInfo(ai));
        if (duplicates.find(dai => dai.udid === ai.udid)) {
            duplicates.forEach(dai => { this.emit(`${startType}-error`, this.getAdapterStateInfo(dai.info)); });
        }

        this.logEvent({ message: `${startType} ${sType} request failed`, ...logProps });
        if (startType === 'check' || startType === 'pair')
            await ai.adapter.stop().catch(console.log);

        ai.isStarted = false;
    }

    private async handleStartSuccess(startType: string, ai: AdapterRideInfo, duplicates: DuplicateInfo[], sType: string, logProps: any) {
        this.emit(`${startType}-success`, this.getAdapterStateInfo(ai));
        if (duplicates.find(dai => dai.udid === ai.udid)) {
            duplicates.forEach(dai => { this.emit(`${startType}-success`, this.getAdapterStateInfo(dai.info)); });
        }
        this.logEvent({ message: `${startType} ${sType} request finished`, ...logProps });
        if (startType === 'check')
            await ai.adapter.pause().catch(console.log);
        if (ai.adapter.isControllable())
            this.setSerialPortInUse(ai.adapter);

        if (startType === 'start') {
            this.startHealthCheck(ai);
        }

        ai.isStarted = true
    }

    startHealthCheck(ai: AdapterRideInfo) {
        
        this.updateOnDatahandler(ai);

        const check = ()=> {
            if (!ai.ivToCheck) // I have no clue why this is needed, but removing it would cause the check() function to be executed after the interval has been cleared
                return;
            
            const tsNow = Date.now()
            const tsLastData =this.getLastDataTS(ai)

            const isPaused = ai.adapter.isPaused()
            const prevStatus = ai.dataStatus

            // paused or no data received yet => no need to check
            if (isPaused || !tsLastData) {
                this.setLastDataTS(ai, tsNow)                
                ai.dataStatus = 'green'
                return;
            }


            const isAmber = (tsNow-tsLastData)>NO_DATA_THRESHOLD
            const isRed = (tsNow-tsLastData)>UNHEALTHY_THRESHOLD


            ai.dataStatus = 'green'
            if (isAmber)
                ai.dataStatus = 'amber'
            if (isRed)
                ai.dataStatus = 'red'


            if (ai.isHealthy && (isAmber || isRed)) {                
                ai.isHealthy = false;
                this.logEvent({message:'device unhealthy', device:ai.adapter.getUniqueName(), udid:ai.udid, noDataSince: (tsNow-tsLastData), tsLastData:new Date(tsLastData).toISOString()  })
                this.prepareReconnect(ai)
            }
            else if (!ai.isHealthy && !isAmber && !isRed) {               
                ai.isHealthy = true;
                this.logEvent({message:'device healthy', device:ai.adapter.getUniqueName(), udid:ai.udid })                
            }

            if (ai.dataStatus!==prevStatus) {
                const {enabledCapabilities} = this.getEnabledCapabilities(ai)
                this.emit('health',ai.udid, ai.dataStatus, enabledCapabilities)                
            }
            
        }

        if (ai.ivToCheck) {
            this.stopHealthCheck(ai)
        }

        if (ai.adapter.getInterface()==='simulator')
            return;


        ai.ivToCheck = setInterval( ()=>{check()}, 1000)
        ai.isHealthy = true
        ai.isRestarting = false;

        if (ai.dataStatus!==undefined && ai.dataStatus!=='green') {
            ai.dataStatus = 'green'
            const {enabledCapabilities} = this.getEnabledCapabilities(ai)
            this.emit('health',ai.udid, ai.dataStatus, enabledCapabilities)                
        }

    }

    private updateOnDatahandler(ai: AdapterRideInfo) {
        this.logEvent({message:'init health check',device:ai.adapter.getName(), udid:ai.udid })
        ai.adapter.off('data', this.deviceDataHandler);
        ai.adapter.on('data', this.deviceDataHandler);
    }

    private removeOnDatahandler(ai: AdapterRideInfo) {
        this.logEvent({message:'cleanup health check', device:ai.adapter.getName(), udid:ai.udid })
        ai.adapter.off('data', this.deviceDataHandler);
    }

    stopHealthCheck(ai: AdapterRideInfo) {
        if (ai.ivToCheck) {
            clearInterval(ai.ivToCheck)
            delete ai.ivToCheck
            delete ai.isHealthy
            this.removeOnDatahandler(ai)
            this.lastDataInfo = {}
        }
        
    }



    async prepareReconnect(unhealthy:AdapterRideInfo) {


        this.logEvent({message:'prepareReconnect', device:unhealthy.adapter.getUniqueName(), udid:unhealthy.udid, noDataSince: (Date.now()-unhealthy.tsLastData), tsLastData:unhealthy.tsLastData, isRestarting: unhealthy.isRestarting  })

        if (unhealthy.isRestarting) {
            this.logEvent({message:'skipped reconnect - device already restarting', device:unhealthy.adapter.getUniqueName(), udid:unhealthy.udid, noDataSince: (Date.now()-unhealthy.tsLastData), tsLastData:unhealthy.tsLastData  })
            return;
        }

        await sleep( 1000)

        if (unhealthy.isHealthy || unhealthy.isRestarting) {
            this.logEvent({message:'skipped reconnect', device:unhealthy.adapter.getUniqueName(), udid:unhealthy.udid, noDataSince: (Date.now()-unhealthy.tsLastData), tsLastData:unhealthy.tsLastData  })
            return;
        }       
      
        // are all adapters on the same interface down?
        const ifName = unhealthy.adapter.getInterface()
        const adapters = this.rideAdapters?.filter( ai=> ai.adapter.getInterface()===ifName)
        const stillHealthy = adapters.filter(ai=>ai.isHealthy)

        this.logEvent({message:'reconnect confirmed', device:unhealthy.adapter.getUniqueName(), udid:unhealthy.udid, noDataSince: (Date.now()-unhealthy.tsLastData), tsLastData:unhealthy.tsLastData, stillHealthy:stillHealthy?.length, onSameInterface:adapters.length  })

        if ( !stillHealthy?.length && adapters.length>1)  {
            await this.reconnectInterface(ifName, adapters);

        }
        else {
            await this.reconnectSingle(unhealthy);  
            
        }
        unhealthy.isRestarting = false;       
    }

    private async reconnectInterface(ifName: string, adapters: AdapterRideInfo[]) {
        if (this.reconnectBusy) {
            return;
        }

        this.reconnectBusy = true;

        // simulator does not need to be restarted
        if (ifName==='simulator')
            return;


        if (ifName==='ble') {            
            try {
                throw new Error('ble interface restart request')
            }
            catch(err) {
                this.logError(err,'reconnectInterface')
            }
            this.reconnectBusy = false;
            
            return;
        }

        // restart Interface and adapaters
        this.logEvent({ message: 'restart interface', interface: ifName });

        let stopRequested = false;
        this.once('stop-ride',()=>{ stopRequested= true;})

        try {
            await this.stopAllAdaptersOnInterface(ifName)

            if (stopRequested) // could have changed in the meantime ( based on event)
                return;

            await this.performInterfaceReconnect(ifName);
            
            if (stopRequested) // could have changed in the meantime ( based on event)
                return;

            await this.reconnectAdapters(adapters, ifName);   
        }
        catch (err) {
            this.logEvent({ message: 'restart interface failed', interface: ifName, reason: err.message });
        }

        this.reconnectBusy = false;
    }


    private async performInterfaceReconnect(ifName: string) {
        const i = InterfaceFactory.create(ifName);


        if (ifName!=='ble') {
            await i.disconnect();
            await sleep(1000);
            await i.connect();
    
        }
    
    }

    protected stopAllAdaptersOnInterface(ifName:string) {
        const adapaters = this.getAllAdapters().filter( ai=> ai.adapter.getInterface()===ifName)
        return this.stopAdapters(adapaters)
    }

    private async stopAdapters(adapters: AdapterRideInfo[]) {
        const promisesStop = [];
        adapters.forEach(ai => {
            promisesStop.push(this.stopDuringInterfaceRestart(ai));


        });


        if (promisesStop.length > 0) {
            await Promise.race([sleep(66000), Promise.allSettled(promisesStop)]);
        }
    }

    private async reconnectAdapters(adapters: AdapterRideInfo[], ifName: string) {
        const promisesStart = [];
        adapters.forEach(ai => { 
            this.stopHealthCheck(ai)           
            promisesStart.push(ai.adapter.start()); 
        });

        if (promisesStart.length > 0) {
            // to avoid channel collisions, start ant adapters in sequence
            if (ifName === 'ant') {
                for (let i = 0; i < promisesStart.length; i++) {
                    try {
                        await promisesStart[i];
                    }
                    catch {
                        // ignore failures
                    }
                }

            }
            else {
                await Promise.allSettled(promisesStart);
            }


            adapters.forEach( ai=> {
                if (ai.adapter.isStarted()) {
                    this.logEvent({message:'device healthy', device:ai.adapter.getUniqueName(), udid:ai.udid })                
                    this.startHealthCheck(ai)
                }
            })
        }
    }

    protected async stopDuringInterfaceRestart(unhealthy: AdapterRideInfo) {
        this.emit('stop-adapter',unhealthy.udid)
        if (unhealthy.isRestarting) {
            
            await  new Promise<void>( done=> {

                const to = setTimeout( done, 65000)

                this.once('stop-adapter-confirmed',(udid)=>{ 
                    if(udid===unhealthy.udid) {
                        clearTimeout(to)
                        done()
                    }
                })
        
            })
        }
        unhealthy.isRestarting = true;
        unhealthy.adapter.off('data', this.deviceDataHandler);            

        try {
            await unhealthy.adapter.stop()
        }
        catch(err) {
            this.logError(err,'stopDuringInterfaceRestart')
        }

    }

    private async reconnectSingle(unhealthy: AdapterRideInfo) {
        unhealthy.isRestarting = true;

        this.stopHealthCheck(unhealthy)

        let stopRequested = false;
        this.once('stop-ride',()=>{ stopRequested= true;})
        this.once('stop-adapter',(udid)=>{ 
            if(udid===unhealthy.udid) 
                stopRequested= true;
        })

        let success = false;
        do {
            this.logEvent({ message: 'restart adapter', device: unhealthy.udid });
            
            const adapter = unhealthy.adapter;
            try {
                const started = await adapter.restart();
                if (started) {
                    this.logEvent({message:'device healthy', device:unhealthy.adapter.getUniqueName(), udid:unhealthy.udid })                
                    unhealthy.tsLastData = Date.now()
                    success = true;
                }
            }
            catch (err) {
                this.logEvent({ message: 'restart adapter failed', device: unhealthy.udid, reason: err.message });
            }

            if (success) {
                this.startHealthCheck(unhealthy)
                unhealthy.isStarted = true;
            }

            else {

                // retry in a minute                
                for (let i=0;i<60 && !stopRequested;i++)
                    await sleep(1000)
            }
        }
        while (!stopRequested && !success)

        unhealthy.isRestarting = false;
        this.emit('stop-adapter-confirmed', unhealthy.udid)
    }

    async start( props:RideServiceDeviceProperties  ):Promise<boolean> {
        await this.lazyInit();
        const adapters = this.getSelectedAdapters()
        this.rideAdapters = adapters

        this.emit('start-request', adapters?.map( this.getAdapterStateInfo.bind(this) ))

        const goodToGo = await this.waitForPreviousStartToFinish()
        if (!goodToGo) 
            return;

        this.storeOriginalCyclingMode()
        
        return this.startAdapters( adapters,'start',props)
    }

    async startRetry( props:RideServiceDeviceProperties  ):Promise<boolean> {
        await this.lazyInit();

        // notify the start of all adapters
        const selected = this.getSelectedAdapters()
        this.emit('start-request', selected?.map( this.getAdapterStateInfo ))

        // only try to start the adapters that are not already started
        const adapters = this.getSelectedAdapters().filter( ai=> !ai.adapter.isStarted())

        const goodToGo = await this.waitForPreviousStartToFinish()
        if (!goodToGo) 
            return;


        return this.startAdapters( adapters,'start',props)
    }

    async cancelStart():Promise<boolean> {

        if (!this.startPromises)
            return;

        this.logEvent({message:'cancel start'})

        const adapters = this.getSelectedAdapters()

        const promises:Array<Promise<boolean>> = []
        adapters?.forEach(ai=> {
            const d = ai.adapter
            d.off('data',this.deviceDataHandler)
            if (!d.isStarted()){
                this.logEvent({message:'cancel start of device',udid:ai.udid})
                promises.push(d.stop())
            }
            else {
                d.pause()
            }
            
        })

        await Promise.allSettled(promises)
        this.startPromises = null;

        delete this.rideAdapters

        return true;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    startRide(_props) {
        const adapters = this.getSelectedAdapters()
        adapters?.forEach(ai=> {
            ai.adapter.off('data',this.deviceDataHandler)
            ai.adapter.on('data',this.deviceDataHandler)
        })
    }

    async stop(udid?:string):Promise<boolean> {
        if (!udid)
            this.logEvent( {message:'stop devices'})
        else 
            this.logEvent( {message:'stop device',udid})


        
        const adapters = this.rideAdapters

        this.emit('stop-ride')

        const promises = adapters?.filter( ai=> udid ? ai.udid===udid : true)        
        .map(ai => {
            this.stopHealthCheck(ai)
            ai.adapter.off('data',this.deviceDataHandler)
            return ai.adapter.stop()

        })

        if (promises)        
            await Promise.allSettled(promises)

        delete this.rideAdapters
        return true
    }

    async resetLimits() {
        try {
            const mode = this.getCyclingMode()
            const resetRequest = mode?.getBikeInitRequest() ?? {}
            
            await this.sendUpdate({...resetRequest,slope:0,forced:true})
        }
        catch { }
    }

    pause():void {
        const adapters = this.getSelectedAdapters();

        adapters?.forEach(ai=> {
            ai.tsLastData = Date.now()
            ai.adapter.pause()
            ai.adapter.off('data',this.deviceDataHandler)
            this.stopHealthCheck(ai)
        })
    }

    resume():void {
        const adapters = this.getSelectedAdapters();

        adapters?.forEach(ai=> {
            ai.tsLastData = Date.now()
            ai.adapter.resume()
            this.startHealthCheck(ai)
        })
    }

    protected verifySelected( selectedDevices, capability:IncyclistCapability) {
        
        if (selectedDevices.find( sd => sd.capability===capability)===undefined) {

            const verify = ( toCheck:IncyclistCapability):boolean => {
                const found = selectedDevices.find( sd => sd.capability===toCheck)
    
                if (found) {
                    const additional = clone(found)
                    additional.capability  = capability
                    selectedDevices.push(additional)                
                }
                return found;
            }
    
            const added = verify(IncyclistCapability.Control)
            if (!added && capability!==IncyclistCapability.Power) verify(IncyclistCapability.Power)
        }

    }


    onData( deviceSettings:DeviceSettings, data:DeviceData) {


        const adapters = this.getSelectedAdapters();
        const config = this.getDeviceConfiguration()

        // get adapterinfo from the device that is sending data
        const adapterInfo = adapters?.find( ai=>ai.adapter.isEqual(deviceSettings))
        if (!adapterInfo)
            return;

        // register data update for health check
        this.registerData(adapterInfo,data)

        // refresh capabilities from device (might have changed since original scan)
        adapters?.forEach( ai => ai.capabilities = ai.adapter.getCapabilities())


        // get selected devices for each of the capabilities
        const selectedDevices = config.getSelectedDevices()

        // If we are still using the legacy framework, then there will be no device selected
        // for capabilities Speed and Cadence
        // We need to take these values from either Bike or Power Sensor
        this.verifySelected(selectedDevices, IncyclistCapability.Speed)
        this.verifySelected(selectedDevices, IncyclistCapability.Cadence)
        this.verifySelected(selectedDevices, IncyclistCapability.Power)


        // get list of capabilities, where the device sending the data was selected by the user
        const { enabledCapabilities, toBeReplaced } = this.getEnabledCapabilities(adapterInfo,selectedDevices);
                    
        this.logEvent({message:'Data Update', device:adapterInfo.adapter.getName(), data, enabledCapabilities})

        enabledCapabilities.forEach( capability=> {
            switch(capability) {
                case IncyclistCapability.HeartRate:
                    this.data.heartrate = data.heartrate
                    break;
                case IncyclistCapability.Power:
                    this.data.power = data.power
                    break;
                case IncyclistCapability.Speed:
                    this.data.speed = data.speed;
                    break;
                case IncyclistCapability.Cadence:
                    this.data.cadence = data.cadence
                    break;
                case IncyclistCapability.Control:
                    this.data.deviceDistanceCounter = data.deviceDistanceCounter;
                    this.data.deviceTime = data.deviceTime;
                    this.data.distance = data.distance;
                    this.data.internalDistanceCounter = data.internalDistanceCounter;
                    this.data.slope = data.slope;
                    this.data.timestamp = data.timestamp
                    break;      
            }
        })

        this.emit( 'data', this.data, adapterInfo.udid)
        if (toBeReplaced) {
            toBeReplaced.forEach( udid => {
                this.emit( 'data', this.data, udid)
            })
        }




    }

    protected registerData(adapterInfo: AdapterRideInfo,data:DeviceData) {
        const udid = adapterInfo.udid
        this.lastDataInfo[udid] = data.timestamp??Date.now()
    }
    protected getLastDataTS(adapterInfo: AdapterRideInfo) {
        const udid = adapterInfo.udid
        return this.lastDataInfo[udid] 
    }
    protected setLastDataTS(adapterInfo: AdapterRideInfo,ts:number) {        
        const udid = adapterInfo.udid
        this.lastDataInfo[udid]  = ts        
    }
    protected clearLastDataTS(adapterInfo: AdapterRideInfo) {        
        const udid = adapterInfo.udid
        delete this.lastDataInfo[udid]
    }

    private getEnabledCapabilities(adapterInfo: AdapterRideInfo, selected?:Array<{capability:IncyclistCapability,selected?:string }> ) {

        const adapters = this.getSelectedAdapters();
        const config = this.getDeviceConfiguration()

        const selectedDevices = selected ?? config.getSelectedDevices()

        let enabledCapabilities = [];

        const duplicates = this.checkAntSameDeviceID(adapters);
        const toBeReplaced = duplicates.filter(dai => dai.udid === adapterInfo.udid).map(dai => dai.info.udid);



        if (this.simulatorEnforced) {
            enabledCapabilities = [IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.Cadence];
        }
        else if (duplicates.length > 0 && duplicates.find(d => d.udid === adapterInfo.udid)) {


            const selected = clone(selectedDevices);
            selected.forEach(cd => {
                if (toBeReplaced.includes(cd.selected))
                    cd.selected = adapterInfo.udid;
            });

            selected.forEach(sd => {
                const duplicate = duplicates.find(dai => dai.info.udid === sd.selected);
                if (duplicate)
                    sd.selected = duplicate.udid;

            });
            enabledCapabilities = selected.map(c => c.capability);


        }
        else {
            enabledCapabilities = selectedDevices.filter(sd => sd.selected === adapterInfo.udid).map(c => c.capability);

        }
        return { enabledCapabilities, toBeReplaced };
    }

    isUpdateBusy():boolean {
        return this.promiseSendUpdate!==undefined && this.promiseSendUpdate!==null
    }

    async waitForUpdateFinish():Promise<void> {
        if (this.promiseSendUpdate) {
            try {
                await Promise.allSettled( this.promiseSendUpdate)
            }
            catch {}            
        }
    }


    async sendUpdate( request:UpdateRequest):Promise<void> {

        
        const adapters = this.getSelectedAdapters()??[];
        const targets = adapters.filter( ai =>  ai?.adapter?.isControllable() && ai?.adapter?.isStarted() &&  !ai.adapter?.isStopped())

        this.promiseSendUpdate = []
        targets?.forEach(ai=> {
            this.promiseSendUpdate.push( ai.adapter.sendUpdate(request) )
        })


        await this.waitForUpdateFinish()

        this.promiseSendUpdate = undefined        
    }

    getCyclingMode(udid?:string):CyclingMode {
        const adapters = this.getSelectedAdapters();

        let adapter;
        if (udid) {
            adapter = adapters?.find( ai=> ai.udid===udid)?.adapter
        }
        else {
            adapter = this.getControlAdapter()?.adapter
        }

        if (adapter)
            return adapter.getCyclingMode()
    }

    isToggleEnabled():boolean {
        const {adapter,udid} = this.getControlAdapter()??{}; 
        if (!adapter)
            return false


        const settings = useDeviceConfiguration().getModeSettings(udid)
        return settings?.isSIM
        

    }


    async toggleCyclingMode() {
        if (!this.isToggleEnabled())
            return
        const {adapter} = this.getControlAdapter()??{}; 
        if (!adapter)
            return

        const ergRide = (this.originalMode?.isERG())
        const targetMode = ergRide ? adapter.getDefaultCyclingMode() : this.originalMode
        const currentMode = adapter.getCyclingMode() as CyclingMode
        if (!currentMode)
            return

        let mode
        let request
        if (!currentMode.isERG())  {
            const power = adapter.getData().power
            this.enforceERG()
            request = {targetPower:power}
            adapter.sendUpdate(request)
            mode  = 'ERG'
        }
        else  {
            const slope = adapter.getData().slope
            adapter.setCyclingMode(targetMode)
            this.resetCyclingMode(false) 
            request = {slope}
            adapter.sendUpdate(request)
            mode='SIM'
        }

        this.emit('cycling-mode-toggle',mode,request)
        
    }


    async resetCyclingMode(sendInit:boolean=false):Promise<{changed:boolean, mode?:CyclingMode}> {
        try {
            const adapterInfo = this.getControlAdapter(); 
            if (!adapterInfo?.adapter)
                return {changed:false}

            const {udid,adapter} = adapterInfo
            const { mode, settings } = this.getConfiguredModeInfo(udid);

            if (mode===adapter.getCyclingMode().getName())
                return {changed:false, mode:adapter.getCyclingMode() as CyclingMode};
            
            // We can't switch back to DaumClassic mode on Daum Premium, we would have to sent the whole route mid ride
            if (adapter.getCyclingMode().getModeProperty('eppSupport'))
                return {changed:false};


            adapter.setCyclingMode(mode,settings)
            if (sendInit)
                await adapter.sendInitCommands()
            return {changed:true, mode:adapter.getCyclingMode() as CyclingMode}
        }
        catch(err) {
            this.logEvent({message:'error', error:err.message,fn:'resetCyclingMode'})
            return {changed:false};
        }

    }

    private getConfiguredModeInfo(udid: string) {
        const config = this.getDeviceConfiguration();
        const modeInfo = config.getModeSettings(udid);
        const mode = modeInfo?.mode;
        const settings = modeInfo.settings;
        return { mode, settings };
    }

    getControlAdapter() {
        const adapters = this.getSelectedAdapters();

        const adapterInfo = adapters?.find(ai => ai.isControl) ?? adapters?.find(ai => ai.adapter.hasCapability(IncyclistCapability.Control));
        return adapterInfo;
    }

    async enforceERG():Promise<void> {
        try {
            const adapters = this.getSelectedAdapters();

            const adapterInfo = adapters?.find( ai=> ai.adapter.hasCapability(IncyclistCapability.Control)) 
            if (!adapterInfo?.adapter)
                return
            const {udid,adapter} = adapterInfo
            const config = this.getDeviceConfiguration()

            // We can't switch back to DaumClassic mode on Daum Premium, we would have to sent the whole route mid ride
            if (adapter.getCyclingMode().getModeProperty('eppSupport'))
                return;
            
            const modes = adapter.getSupportedCyclingModes().filter( C => C.supportsERGMode())
            if (modes.length>0)  {
                const mode = new modes[0](adapter)
                const modeInfo = config.getModeSettings(udid,mode.getName())
                const settings = modeInfo.settings

                const device = adapter
                device.setCyclingMode(mode,settings)
    
            }
        }
        catch(err) {
            this.logEvent({message:'error', error:err.message,fn:'enforceERG'})
        }

    }


    async onCyclingModeChanged(udid:string,mode:string, settings):Promise<void> {
        const currentMode = this.getCyclingMode(udid)
        if (!currentMode || currentMode.getName()!==mode) { // mode was changed
            
            const adapters = this.getSelectedAdapters()
            const adapter = adapters?.find( ai=> ai.udid===udid)?.adapter
            if (adapter?.isControllable()) {
                adapter.setCyclingMode(mode,settings)
                await adapter.sendInitCommands()
            }
        }
        else {  // settings changed

            currentMode.setSettings(settings)
        }
    }

    onDeviceDeleted(settings: IncyclistDeviceSettings) {
        if (settings.interface==='serial' || settings.interface==='tcpip') {

            const device = AdapterFactory.create(settings)
            const serial = device.getSerialInterface()
            serial.releaseInUse( device.getPort() )
            
        }
    }

    enforceSimulator(enforced=true) {
        this.simulatorEnforced = enforced
    }

    canEnforceSimulator():boolean {
        const selected = getRouteList().getSelected()
        const personalApiKey = this.getGoogleMaps().hasPersonalApiKey()

        if (selected?.description?.hasVideo || personalApiKey)
            return true

        return useUserSettings().isNewUser()
        
    }

    protected storeOriginalCyclingMode() {
        const {adapter} = this.getControlAdapter()??{}
        if (adapter)
            this.originalMode = adapter.getCyclingMode() as CyclingMode
    }

    @Injectable
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getDeviceAccess() {        
        return useDeviceAccess()
    }

    @Injectable
    protected getGoogleMaps() {
        return useGoogleMaps()
    }


 
}


export const useDeviceRide = () => new DeviceRideService()



