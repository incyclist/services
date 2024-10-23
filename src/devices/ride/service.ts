import EventEmitter from "events"
import { sleep } from "../../utils/sleep";
import { DeviceAccessService, useDeviceAccess } from "../access/service";
import {AdapterInfo, DeviceConfigurationService, IncyclistDeviceSettings, useDeviceConfiguration} from "../configuration";
import { AdapterRideInfo, AdapterStateInfo, PreparedRoute, RideServiceCheckFilter, RideServiceDeviceProperties } from "./model";
import clone from "../../utils/clone";
import { UserSettingsService, useUserSettings } from "../../settings";
import { EventLogger } from 'gd-eventlog';
import { getLegacyInterface } from "../../utils/logging";
import { AdapterFactory, CyclingMode, DeviceData, DeviceProperties, DeviceSettings, IncyclistCapability, IncyclistDeviceAdapter, InterfaceFactory, SerialIncyclistDevice, UpdateRequest } from "incyclist-devices";
import { setInterval } from "timers";


const NO_DATA_THRESHOLD = 10000
const UNHEALTHY_THRESHOLD = 60000

/**
 * Provides method to consume a devcie
 *  - start/stop/pause/resume a ride
 *  - check availability of a device
 *  - process bike updates
 *  - send bike updates
 * @noInheritDoc
 * 
 */
export class DeviceRideService  extends EventEmitter{

    protected static _instance: DeviceRideService
    protected configurationService: DeviceConfigurationService
    protected userSettings: UserSettingsService
    protected accessService: DeviceAccessService
    protected initizialized: boolean
    protected adapters:AdapterRideInfo[]
    protected startPromises: Promise<boolean>[]
    protected data:DeviceData  ={}
    protected simulatorEnforced:boolean
    protected logger: EventLogger
    protected debug;
    protected promiseSendUpdate: Promise<UpdateRequest|void>[]

    protected deviceDataHandler = this.onData.bind(this)

    static getInstance():DeviceRideService{
        if (!DeviceRideService._instance)
        DeviceRideService._instance = new DeviceRideService()
        return DeviceRideService._instance
    }

    constructor() {
        super()
        this.initizialized = false;
        this.simulatorEnforced = false
        this.logger = new EventLogger('Ride')
        this.debug = false;   
    }

    logEvent(event) {
        this.logger.logEvent(event)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = global.window as any
    
        if (this.debug || w?.SERVICE_DEBUG) 
            console.log('~~~ RIDE-SVC', event)
    }

    setDebug(enabled:boolean) {
        this.debug = enabled
    }

    protected waitForInit():Promise<void> {
        return new Promise(done => {
            this.accessService = useDeviceAccess();
            this.configurationService  =useDeviceConfiguration();            
            if (this.configurationService.isInitialized())
                return done();
            this.configurationService.once('initialized' ,done)
            this.configurationService.init()
        })
    }

    async lazyInit() {
        if (!this.initizialized) {
            await this.waitForInit()
        }
        
        this.adapters = this.configurationService.getAdapters()?.map( ai=> Object.assign({}, {...ai, isStarted:false}))
        const handleModeChange = this.onCyclingModeChanged.bind(this)
        const handleDeviceDeleted = this.onDeviceDeleted.bind(this)

        // TODO: add listeners to config changes
        this.configurationService.on('mode-changed',handleModeChange)
        this.configurationService.on('device-deleted',handleDeviceDeleted)
        this.userSettings = useUserSettings()
        
    }



    getAdapterStateInfo(adapterInfo:AdapterInfo):AdapterStateInfo {

        const {udid,adapter,capabilities} = adapterInfo

        const name = adapter.getUniqueName()
        const isControl = adapter.hasCapability(IncyclistCapability.Control)
        const isStarted = adapter.isStarted()

        return {udid, name,isControl,capabilities,isStarted}

    }

    getData() {
        return this.data
    }

    protected getAdapterList(onlySelected=true):AdapterRideInfo[] {

        if (onlySelected) {
            if (!this.simulatorEnforced)
                return this.adapters

            const adapter = AdapterFactory.create({interface:'simulator', name:'Simulator'});
            return [{adapter,udid:'Simulator'+Date.now(), capabilities:adapter.getCapabilities(),isStarted:false}]
        }
        else {
            const adapters = this.configurationService.getAllAdapters()?.map( ai=> Object.assign({}, {...ai, isStarted:false}))
            if (this.simulatorEnforced && !adapters.find( a=>a.adapter.getName()==='Simulator' )) {
                const adapter = AdapterFactory.create({interface:'simulator', name:'Simulator'});
                adapters.push({adapter,udid:'Simulator'+Date.now(), capabilities:adapter.getCapabilities(),isStarted:false})
            }
            return adapters
        }
    } 


    prepareEppRoute(props:RideServiceDeviceProperties): PreparedRoute {
        // TODO: consider startPos with route/epp in  lapMode 
        
        const { route, startPos, realityFactor,rideMode} = props;
        if (!route || !route.get()) {
            return null;
        }

        let res:PreparedRoute

        this.logEvent( { message:'prepareRoute', route: route.getTitle() , start: startPos, reality: realityFactor})
        
        // TODO: should move into a User/AppState Service
        const eppPreferences = clone(this.userSettings.get('eppPreferences',{}))
        if (!eppPreferences.programId)  
            eppPreferences.programId = 1;
        else {
            eppPreferences.programId++;
            if (eppPreferences.programId> 32767)
                eppPreferences.programId = 1;
        }
        this.userSettings.update({eppPreferences})            

        const routeData = route.get();
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

                    // TODO lapMode
                    if (route.isLap()) {

                        points = points.concat( originalPoints.slice(1,idxBefore+1).map( p=> { p.distance+=routeData.distance; return p;}));
                        points.push ( { distance: routeData.distance+offset, elevation: originalPoints[idxBefore].elevation+elevationGain*distance/distanceGain } )
                    }

                }
                else {
                    const originalPoints = points;
                    points = originalPoints.slice(idxAfter);
                    if (route.isLap()) {
                        points = points.concat( originalPoints.slice(1,idxBefore+1).map( p=> { p.distance+=routeData.distance; return p;}));
                    }
                }

            }
            
            const pStart = points[0];
            const elevationStart = pStart.elevation;
            const totalDistance = route.isLap() ? routeData.distance : Math.ceil( routeData.distance-(startPos||0));

            res = {
                name: eppData.name,
                description: eppData.description,
                programId: eppPreferences.programId,
                type:  rideMode || 'free ride',
                totalDistance,
                lapMode: route.isLap(),
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
            const sampleRate = 10; // Math.round(routeData.distance/routeData.duration);

            let points = routeData.decoded;
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
                    if (route.isLap()) {
                        points = points.concat( originalPoints.slice(1,idxBefore+1).map( p=> { p.routeDistance+=routeData.distance; return p;}));
                        points.push ( { routeDistance: routeData.distance, elevation: originalPoints[idxBefore].elevation+elevationGain*distance/distanceGain } )
                    }


                }
                else {
                    const originalPoints = points;
                    points = originalPoints.slice(idxAfter);
                    if (route.isLap()) {
                        points = originalPoints.slice(1,idxBefore+1).map( p=> { p.routeDistance+=routeData.distance; return p;});
                    }
                    
                }

                totalDistance = route.isLap() ? routeData.distance : Math.ceil( routeData.distance-(startPos||0));
            }

            
            res = {
                name: routeData.title,
                description: '',
                programId: eppPreferences.programId,
                type:  rideMode || 'free ride',
                totalDistance,
                lapMode: route.isLap(),
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
        let adapters:AdapterRideInfo[] = this.getAdapterList(onlySelected)
        

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

    protected checkAntSameDeviceID(adapters:AdapterRideInfo[]):Array<{udid:string,info:AdapterInfo}> {

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
        catch(err) {
            return []
        }

    }
   
    async startAdapters( adapters:AdapterRideInfo[], startType: 'start' | 'check' | 'pair',props?:RideServiceDeviceProperties ):Promise<boolean> {
        

        const { forceErgMode, startPos, realityFactor, rideMode, route} = props||{};

        const duplicates = this.checkAntSameDeviceID(adapters)


        this.startPromises = adapters?.map( async ai=> {
            if (duplicates.find(dai=>dai.info.udid===ai.udid))
                return
            const startProps = clone(props||{})

            let mode,settings,bike;

            if (ai.adapter?.isControllable()) {
                bike = ai.adapter

                const modeInfo = this.configurationService.getModeSettings(ai.udid)
                mode = modeInfo?.mode
                settings = modeInfo?.settings||{}


                if (!this.simulatorEnforced && forceErgMode) {
                    const modes = bike.getSupportedCyclingModes().filter( C => C.supportsERGMode())
                    if (modes.length>0)  {
                        mode = new modes[0](bike)
                        const modeInfo = this.configurationService.getModeSettings(ai.udid,mode)
                        settings = modeInfo.settings
                    }
                }

                if (!mode)
                    mode = bike.getDefaultCyclingMode();


                bike.setCyclingMode(mode,settings)
            }


            if (startType==='check' || startType==='pair') {
                startProps.timeout = 10000;
                if (ai.adapter.getSettings().interface==='ble')
                    startProps.timeout = 30000;
            }

            if (startType==='start') {
                
                if (ai.adapter?.isControllable()) {

                    // Special Case Daum8i "Daum Classic" mode:
                    // we need to upload the route data (in Epp format) as part of the start commands
                    if (bike.getCyclingMode().getModeProperty('eppSupport')) {
                        startProps.route = this.prepareEppRoute({route,startPos,realityFactor,rideMode})
                        startProps.onStatusUpdate = (completed:number, total:number) => {                         
                            this.emit('start-update',this.getAdapterStateInfo(ai), completed,total)                    
                        }
                        
                    }


                }
            }

            // TODO: if Control and Power are started, only log for Control
            const sType = ai.adapter.hasCapability(IncyclistCapability.Control) ? 'bike' : 'sensor'
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const logProps = {} as any
            logProps[sType] = ai.adapter.getUniqueName()
            logProps.cability = ai.adapter.getCapabilities().join('/')
            logProps.interface = getLegacyInterface(ai.adapter) 
            if (sType==='bike'){
                const bike = ai.adapter
                logProps.cyclingMode = bike.getCyclingMode()?.getName()
                logProps.bikeType = bike.getCyclingMode().getSetting('bikeType') 
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
        })

        if (!this.startPromises)
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

    private async handleStartRejection(startType: string, sType: string, logProps: any, err: any, ai: AdapterRideInfo, duplicates: { udid: string; info: AdapterInfo; }[]) {
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

    private async handleStartFailure(startType: string, ai: AdapterRideInfo, duplicates: { udid: string; info: AdapterInfo; }[], sType: string, logProps: any) {
        this.emit(`${startType}-error`, this.getAdapterStateInfo(ai));
        if (duplicates.find(dai => dai.udid === ai.udid)) {
            duplicates.forEach(dai => { this.emit(`${startType}-error`, this.getAdapterStateInfo(dai.info)); });
        }

        this.logEvent({ message: `${startType} ${sType} request failed`, ...logProps });
        if (startType === 'check' || startType === 'pair')
            await ai.adapter.stop().catch(console.log);

        ai.isStarted = false;
    }

    private async handleStartSuccess(startType: string, ai: AdapterRideInfo, duplicates: { udid: string; info: AdapterInfo; }[], sType: string, logProps: any) {
        this.emit(`${startType}-success`, this.getAdapterStateInfo(ai));
        if (duplicates.find(dai => dai.udid === ai.udid)) {
            duplicates.forEach(dai => { this.emit(`${startType}-success`, this.getAdapterStateInfo(dai.info)); });
        }
        this.logEvent({ message: `${startType} ${sType} request finished`, ...logProps });
        if (startType === 'check')
            await ai.adapter.pause().catch(console.log);
        if (ai.adapter.isControllable())
            this.setSerialPortInUse(ai.adapter as IncyclistDeviceAdapter);

        if (startType === 'pair') {
            ai.adapter.on('data', this.deviceDataHandler);
        }
        else if (startType === 'start') {
            this.startHealthCheck(ai);
        }

        ai.isStarted = true
    }

    startHealthCheck(ai: AdapterRideInfo) {

        const check = ()=> {
            if (!ai.ivToCheck) // I have no clue why this is needed, but removing it would cause the check() function to be executed after the interval has been cleared
                return;
            
            const tsNow = Date.now()

            const isPaused = ai.adapter.isPaused()
            const prevStatus = ai.dataStatus

            // paused or no data received yet => no need to check
            if (isPaused || !ai.tsLastData) {
                ai.tsLastData = tsNow
                ai.dataStatus = 'green'
                return;
            }

            const isAmber = (tsNow-ai.tsLastData)>NO_DATA_THRESHOLD
            const isRed = (tsNow-ai.tsLastData)>UNHEALTHY_THRESHOLD


            ai.dataStatus = 'green'
            if (isAmber)
                ai.dataStatus = 'amber'
            if (isRed)
                ai.dataStatus = 'red'


            if (ai.isHealthy && (isAmber || isRed)) {                
                ai.isHealthy = false;
                this.logEvent({message:'device unhealthy', device:ai.adapter.getUniqueName(), udid:ai.udid, noDataSince: (tsNow-ai.tsLastData), tsLastData:ai.tsLastData  })


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
    }

    stopHealthCheck(ai: AdapterRideInfo) {
        if (ai.ivToCheck) {
            clearInterval(ai.ivToCheck)
            delete ai.ivToCheck
            delete ai.isHealthy
        }
        
    }

    async prepareReconnect(unhealthy:AdapterRideInfo) {
        if (unhealthy.isRestarting)
            return;

        await sleep( UNHEALTHY_THRESHOLD-NO_DATA_THRESHOLD-5000)

        if (unhealthy.isHealthy || unhealthy.isRestarting)
            return;
      
        // are all adapters on the same interface down?
        const ifName = unhealthy.adapter.getInterface()
        const adapters = this.getAdapterList().filter( ai=> ai.adapter.getInterface()===ifName)
        if (!adapters.find(ai=>ai.isHealthy)) {
            await this.reconnectInterface(ifName, adapters);

        }
        else {
            await this.reconnectSingle(unhealthy);  
            
        }
        unhealthy.isRestarting = false;       
    }

    private async reconnectInterface(ifName: string, adapters: AdapterRideInfo[]) {

        // simulator does not need to be restarted
        if (ifName==='simulator')
            return;

        // restart Interface and adapaters
        this.logger.logEvent({ message: 'restart interface', interface: ifName });

        let stopRequested = false;
        this.once('stop-ride',()=>{ stopRequested= true;})

        try {
            await this.stopAdapters(adapters);

            if (stopRequested) // could have changed in the meantime ( based on event)
                return;

            await this.performInterfaceReconnect(ifName);
            
            if (stopRequested) // could have changed in the meantime ( based on event)
                return;

            await this.reconnectAdapters(adapters, ifName);   
        }
        catch (err) {
            this.logger.logEvent({ message: 'restart interface failed', interface: ifName, reason: err.message });
        }

        this.finalizeAdaptersAfterRestart(adapters);
    }

    private finalizeAdaptersAfterRestart(adapters: AdapterRideInfo[]) {
        adapters.forEach(ai => {
            if (ai.adapter.isStarted()) {
                ai.tsLastData = Date.now();
            }
            else {
                ai.isRestarting = false;
                this.prepareReconnect(ai);
            }
            ai.adapter.on('data', this.deviceDataHandler);
            ai.isRestarting = false;
        });
    }

    private async performInterfaceReconnect(ifName: string) {
        const i = InterfaceFactory.create(ifName);
        await i.disconnect();
        await sleep(1000);
        await i.connect();
    }

    private async stopAdapters(adapters: AdapterRideInfo[]) {
        const promisesStop = [];
        adapters.forEach(ai => {
            promisesStop.push(this.stopAfterRestart(ai));


        });


        if (promisesStop.length > 0) {
            await Promise.race([sleep(66000), Promise.allSettled(promisesStop)]);
        }
    }

    private async reconnectAdapters(adapters: AdapterRideInfo[], ifName: string) {
        const promisesStart = [];
        adapters.forEach(ai => { promisesStart.push(ai.adapter.start()); });

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
        }
    }

    protected async stopAfterRestart(unhealthy: AdapterRideInfo) {
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

        await unhealthy.adapter.stop()
    }

    private async reconnectSingle(unhealthy: AdapterRideInfo) {
        unhealthy.isRestarting = true;

        let stopRequested = false;
        this.once('stop-ride',()=>{ stopRequested= true;})
        this.once('stop-adapter',(udid)=>{ 
            if(udid===unhealthy.udid) 
                stopRequested= true;
        })

        let success = false;
        do {
            this.logger.logEvent({ message: 'restart adapter', device: unhealthy.udid });
            unhealthy.adapter.off('data', this.deviceDataHandler);
            const adapter = unhealthy.adapter;
            try {
                const started = await adapter.restart();
                if (started) {
                    unhealthy.tsLastData = Date.now()
                    success = true;
                }
            }
            catch (err) {
                this.logger.logEvent({ message: 'restart adapter failed', device: unhealthy.udid, reason: err.message });
                this.prepareReconnect(unhealthy);
            }
            unhealthy.adapter.on('data', this.deviceDataHandler);

            if (!success) {

                // retry in a minute                
                for (let i=0;i<60 && !stopRequested;i++)
                    await sleep(1000)
            }
        }
        while (!stopRequested && !success)

        this.emit('stop-adapter-confirmed', unhealthy.udid)
    }

    async start( props:RideServiceDeviceProperties  ):Promise<boolean> {
        await this.lazyInit();
        const adapters = this.getAdapterList()

        this.emit('start-request', adapters?.map( this.getAdapterStateInfo ))

        const goodToGo = await this.waitForPreviousStartToFinish()
        if (!goodToGo) 
            return;
        
        return this.startAdapters( adapters,'start',props)
    }

    async startRetry( props:RideServiceDeviceProperties  ):Promise<boolean> {
        await this.lazyInit();

        // notify the start of all adapters
        const allAdapters = this.getAdapterList()
        this.emit('start-request', allAdapters?.map( this.getAdapterStateInfo ))

        // only try to start the adapters that are not already started
        const adapters = this.getAdapterList().filter( ai=> !ai.adapter.isStarted())

        const goodToGo = await this.waitForPreviousStartToFinish()
        if (!goodToGo) 
            return;


        return this.startAdapters( adapters,'start',props)
    }

    async cancelStart():Promise<boolean> {

        if (!this.startPromises)
            return;

        this.logEvent({message:'cancel start'})

        const adapters = this.getAdapterList()

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
        
        return true;
    }

    // TODO: verify usage of props argument
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    startRide(_props) {
        const adapters = this.getAdapterList()
        adapters?.forEach(ai=> {
            

            /*
            this.setBikePreferences(this.state.gear.bike);
            d.on('disconnected', (duration) => { this.onDeviceDisconnected('bike', duration, bike,d ) })
            d.on('timeout',()=> { this.onDeviceTimeout('bike', bike,d)})

            */

            ai.adapter.off('data',this.deviceDataHandler)
            ai.adapter.on('data',this.deviceDataHandler)
        })
    }

    async stop(udid?:string):Promise<boolean> {
        if (!udid)
            this.logEvent( {message:'stop devices'})
        else 
            this.logEvent( {message:'stop device',udid})



        const adapters = this.getAdapterList();

        this.emit('stop-ride')

        const promises = adapters?.filter( ai=> udid ? ai.udid===udid : true)        
        .map(ai => {
            this.stopHealthCheck(ai)
            ai.adapter.off('data',this.deviceDataHandler)
            return ai.adapter.stop()

        })

        if (promises)        
            await Promise.allSettled(promises)

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
        const adapters = this.getAdapterList();

        adapters?.forEach(ai=> {
            ai.tsLastData = Date.now()
            ai.adapter.pause()
            ai.adapter.off('data',this.deviceDataHandler)
            this.stopHealthCheck(ai)
        })
    }

    resume():void {
        const adapters = this.getAdapterList();

        adapters?.forEach(ai=> {
            ai.tsLastData = Date.now()
            ai.adapter.resume()
            ai.adapter.on('data',this.deviceDataHandler)
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

        
        const adapters = this.getAdapterList();

        // get adapterinfo from the device that is sending data
        const adapterInfo = adapters?.find( ai=>ai.adapter.isEqual(deviceSettings))
        if (!adapterInfo)
            return;

        // register data update for health check
        adapterInfo.tsLastData = data.timestamp||Date.now()

        // refresh capabilities from device (might have changed since original scan)
        adapters?.forEach( ai => ai.capabilities = ai.adapter.getCapabilities())

        // get selected devices for each of the capabilities
        const selectedDevices = this.configurationService.getSelectedDevices()

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

    private getEnabledCapabilities(adapterInfo: AdapterRideInfo, selected?:Array<{capability:IncyclistCapability,selected?:string }> ) {

        const adapters = this.getAdapterList();
        const selectedDevices = selected ?? this.configurationService.getSelectedDevices()

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
        
        const adapters = this.getAdapterList();

        this.promiseSendUpdate = []
        adapters?.forEach(ai=> {
            if ( ai.adapter && ai.adapter.isControllable()) {
                const d = ai.adapter as IncyclistDeviceAdapter
                this.promiseSendUpdate.push( d.sendUpdate(request) )
            }
        })

        await this.waitForUpdateFinish()

        this.promiseSendUpdate = undefined        
    }

    getCyclingMode(udid?:string):CyclingMode {
        const adapters = this.getAdapterList();

        let adapter;
        if (udid) {
            adapter = adapters?.find( ai=> ai.udid===udid)?.adapter
        }
        else {
            adapter = adapters?.find( ai=> ai.adapter.hasCapability(IncyclistCapability.Control))?.adapter
        }
        if (adapter)
            return adapter.getCyclingMode()
    }

    async resetCyclingMode(sendInit:boolean=false) {
        try {
            const adapters = this.getAdapterList();

            const adapterInfo = adapters?.find( ai=> ai.adapter.hasCapability(IncyclistCapability.Control)) 
            if (!adapterInfo?.adapter)
                return

            const {udid,adapter} = adapterInfo
            const modeInfo = this.configurationService.getModeSettings(udid)
            const mode = modeInfo?.mode
            const settings = modeInfo.settings
            
            // We can't switch back to DaumClassic mode on Daum Premium, we would have to sent the whole route mid ride
            if (adapter.getCyclingMode().getModeProperty('eppSupport'))
                return;


            const device = adapter
            device.setCyclingMode(mode,settings)
            if (sendInit)
                await device.sendInitCommands()
        }
        catch(err) {
            this.logEvent({message:'error', error:err.message,fn:'resetCyclingMode'})
        }

    }

    async enforceERG() {
        try {
            const adapters = this.getAdapterList();

            const adapterInfo = adapters?.find( ai=> ai.adapter.hasCapability(IncyclistCapability.Control)) 
            if (!adapterInfo?.adapter)
                return
            const {udid,adapter} = adapterInfo

            // We can't switch back to DaumClassic mode on Daum Premium, we would have to sent the whole route mid ride
            if (adapter.getCyclingMode().getModeProperty('eppSupport'))
                return;
            
            const modes = adapter.getSupportedCyclingModes().filter( C => C.supportsERGMode())
            if (modes.length>0)  {
                const mode = new modes[0](adapter)
                const modeInfo = this.configurationService.getModeSettings(udid,mode.getName())
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
        // TODO: 
        // if udid is currently being used, update adapter settings

        const currentMode = this.getCyclingMode(udid)
        if (!currentMode || currentMode.getName()!==mode) { // mode was changed
            // TODO
            const adapters = this.getAdapterList();
            const adapter = adapters?.find( ai=> ai.udid===udid)?.adapter
            if (adapter && adapter.isControllable()) {
                const device = adapter as IncyclistDeviceAdapter
                device.setCyclingMode(mode,settings)
                await device.sendInitCommands()
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


 
}


export const useDeviceRide = () => DeviceRideService.getInstance()



