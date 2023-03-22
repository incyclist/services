import EventEmitter from "events"

import { AdapterFactory, DeviceData, DeviceSettings, IncyclistCapability,ControllableDeviceAdapter } from "incyclist-devices";
import { sleep } from "../../utils/sleep";
import { DeviceAccessService, useDeviceAccess } from "../access/service";
import {AdapterInfo, DeviceConfigurationService, useDeviceConfiguration} from "../configuration";
import CyclingMode, { UpdateRequest } from "incyclist-devices/lib/modes/cycling-mode";
import { AdapterRideInfo, PreparedRoute, RideServiceDeviceProperties } from "./model";
import clone from "../../utils/clone";
import { UserSettingsService, useUserSettings } from "../../settings";

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

        // TODO: add listeners to config changes
        this.configurationService.on('mode-changed',handleModeChange)
        this.userSettings = useUserSettings()
        
    }



    protected getAdapterStateInfo(adapterInfo:AdapterInfo) {

        const {udid,adapter,capabilities} = adapterInfo

        const name = adapter.getUniqueName()
        const isControl = adapter.hasCapability(IncyclistCapability.Control)

        return {udid, name,isControl,capabilities}

    }

    protected getAdapterList():AdapterRideInfo[] {
        if (!this.simulatorEnforced)
            return this.adapters

        const adapter = AdapterFactory.create({interface:'simulator', name:'Simulator'});
        return [{adapter,udid:'Simulator'+Date.now(), capabilities:adapter.getCapabilities(),isStarted:false}]
    } 


    prepareEppRoute(props:RideServiceDeviceProperties): PreparedRoute {
        // TODO: consider startPos with route/epp in  lapMode 
        
        const { route, startPos, realityFactor,rideMode} = props;
        if (!route || !route.get()) {
            return null;
        }

        let res:PreparedRoute

//        this.logger.logEvent( { message:'prepareRoute', route: route.getTitle() , start: startPos, reality: realityFactor})
        
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
   
        

    async start( props:RideServiceDeviceProperties  ):Promise<boolean> {
        this.lazyInit();

        const { forceErgMode, startPos, realityFactor, rideMode, route} = props;

        while (this.startPromises) {
            sleep(500)
        }

        const adapters = this.getAdapterList()

        this.emit('start-request', adapters.map( this.getAdapterStateInfo ))

        this.startPromises = adapters.map( ai=> {
            const startProps = clone(props)

            if (ai.adapter.isControllable()) {
                const d = ai.adapter as ControllableDeviceAdapter

                let mode,settings;

                if (!this.simulatorEnforced) {

                    if (forceErgMode) {
                        const modes = d.getSupportedCyclingModes().filter( C => C.isERG)
                        if (modes.length>0)  {
                            mode = new modes[0](d)                            
                            const modeInfo = this.configurationService.getModeSettings(ai.udid,mode)
                            settings = modeInfo.settings
                        }
                    }                    
                    if (!mode) {
                        const modeInfo = this.configurationService.getModeSettings(ai.udid)
                        mode = modeInfo.mode
                        settings = modeInfo.settings
                    }
    
                }

                if (!mode)
                    mode = d.getDefaultCyclingMode();


                d.setCyclingMode(mode,settings)

                // Special Case Daum8i "Daum Classic" mode:
                // we need to upload the route data (in Epp format) as part of the start commands
                if (d.getCyclingMode().getModeProperty('eppSupport')) {
                    startProps.route = this.prepareEppRoute({route,startPos,realityFactor,rideMode})
                    startProps.onStatusUpdate = (completed:number, total:number) => {                         
                        this.emit('start-update',this.getAdapterStateInfo(ai), completed,total)                    
                    }
                     
                }

            }

            return ai.adapter.start(startProps)
                .then(success=>{
                    if (success) {
                        this.emit('start-success', this.getAdapterStateInfo(ai))

                    }
                    ai.isStarted = true;
                    return success
                })
                .catch(err=>{                    
                    ai.isStarted = false;
                    this.emit('start-error', this.getAdapterStateInfo(ai), err)
                    return false
                })
        })
        
        const status = await Promise.all(this.startPromises)
        const allOK = status.find( s=>s===false)===undefined
        this.emit('start-result', allOK)

        if (allOK) {
            this.startRide(props)
        }

        this.startPromises = null;

        return allOK;
    }

    async cancelStart():Promise<boolean> {
        const adapters = this.getAdapterList()

        adapters.forEach(ai=> {
            const d = ai.adapter
            d.off('data',this.deviceDataHandler)
            if (!ai.isStarted)
                d.stop()
            
        })

        this.startPromises = null;
        
        return true;
    }

    // TODO: verify usage of props argument
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    startRide(_props) {
        const adapters = this.getAdapterList()

        adapters.forEach(ai=> {
            

            /*
            this.setBikePreferences(this.state.gear.bike);
            d.on('disconnected', (duration) => { this.onDeviceDisconnected('bike', duration, bike,d ) })
            d.on('timeout',()=> { this.onDeviceTimeout('bike', bike,d)})

            */


            ai.adapter.on('data',this.deviceDataHandler)
        })
    }

    async stop():Promise<boolean> {
        const adapters = this.getAdapterList();

        this.emit('stop-ride')
        adapters.forEach(ai=> {
            ai.adapter.off('data',this.deviceDataHandler)
        })

        return true
    }

    pause():void {
        const adapters = this.getAdapterList();

        adapters.forEach(ai=> {
            ai.adapter.pause()
            ai.adapter.off('data',this.deviceDataHandler)
        })
    }

    resume():void {
        const adapters = this.getAdapterList();

        adapters.forEach(ai=> {
            ai.adapter.resume()
            ai.adapter.on('data',this.deviceDataHandler)
        })
    }

    onData( deviceSettings:DeviceSettings, data:DeviceData) {
        const adapters = this.getAdapterList();


        const hasControl = adapters.find( ai=>ai.capabilities.includes(IncyclistCapability.Control))!==undefined
        const hasPower   = adapters.find( ai=>ai.capabilities.includes(IncyclistCapability.Power))!==undefined

        const adapterInfo = adapters.find( ai=>ai.adapter.isEqual(deviceSettings))
        adapterInfo.capabilities.forEach( capability=> {
            switch(capability) {
                case IncyclistCapability.HeartRate:
                    this.data.heartrate = data.heartrate
                    break;
                case IncyclistCapability.Power:
                    this.data.power = data.power
                    this.data.speed = data.speed;
                    break;
                case IncyclistCapability.Cadence:
                    this.data.cadence = data.cadence
                    if (hasControl && !hasPower) {
                        this.data.speed = data.speed
                        this.data.power = data.power;
                    }
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

        this.emit( 'data', this.data)


    }

    sendUpdate( request:UpdateRequest):void {
        const adapters = this.getAdapterList();

        adapters.forEach(ai=> {
            if ( ai.adapter.isControllable()) {
                const d = ai.adapter as ControllableDeviceAdapter
                d.sendUpdate(request)
            }
        })
    }

    getCyclingMode(udid?:string):CyclingMode {
        const adapters = this.getAdapterList();

        let adapter;
        if (udid) {
            adapter = adapters.find( ai=> ai.udid===udid)?.adapter
        }
        else {
            adapter = adapters.find( ai=> ai.adapter.hasCapability(IncyclistCapability.Control))?.adapter
        }
        if (adapter)
            return adapter.getCyclingMode()
    }

    onCyclingModeChanged(udid:string,mode:string, settings) {
        // TODO: 
        // if udid is currently being used, update adapter settings

        const currentMode = this.getCyclingMode(udid)
        if (!currentMode || currentMode.getName()!==mode) { // mode was changed
            // TODO
            const adapters = this.getAdapterList();
            const adapter = adapters.find( ai=> ai.udid===udid)?.adapter
            if (adapter && adapter.isControllable()) {
                const device = adapter as ControllableDeviceAdapter
                device.setCyclingMode(mode,settings)
            }
        }
        else {  // settings changed

            currentMode.setSettings(settings)
        }
    }

    enforceSimulator(enforced=true) {
        this.simulatorEnforced = enforced
    }


 
}


export const useDeviceRide = () => DeviceRideService.getInstance()


