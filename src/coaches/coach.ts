import { EventLogger } from "gd-eventlog";
import { CoachEditProps, CoachSettings } from "./types";
import {AdapterFactory, DeviceProperties, DeviceSettings, INTERFACE, IncyclistDeviceAdapter} from 'incyclist-devices'
import { RoutePoint } from "../routes/base/types";

interface SimulatorProperties extends DeviceProperties { 
    port?:string
    isBot?: boolean,
    settings?,
    activity?
}

export class Coach {
    protected _settings: CoachSettings
    protected _id:string
    protected routeDistance:number
    protected riderPosition:number
    protected simulator:IncyclistDeviceAdapter
    protected logger: EventLogger
    protected position: RoutePoint

    constructor(settings:CoachSettings) {
        this._settings = settings
        this._id = Date.now().toString()
        this.logger = new EventLogger('Coach')
    }

    get id():string {
        return this._id
    }

    get settings():CoachSettings {
        return this._settings
    }

    get lead():number {
        const lead = this.routeDistance-this.riderPosition
        if (isNaN(lead))
            return 0
        return lead
    }

    setProgress(routeDistance:number) {
        this.routeDistance = routeDistance
    }
    getProgess() {
        return this.routeDistance
    }

    setPosition(point:RoutePoint) {
        this.position = point
    }
    getPosition() {
        return this.position
    }

    setRiderPosition(routeDistance:number) {
        this.riderPosition = routeDistance
    }

    sendDeviceUpdate(request) {
        if (this.simulator)
            this.simulator.sendUpdate(request )
    }

    getDisplayProperties():CoachEditProps {
        const {name,type,target,lead} = this._settings
        const power = type==='power' ? target : undefined
        const speed = type==='speed' ? target : undefined

        const props:CoachEditProps = { 
            name,type,speed,power, lead
        }

        if ( this.routeDistance!==undefined && this.riderPosition!==undefined)
            props.lead = this.lead
       
        return props
    }

    update(settings:CoachEditProps) {
        const {name,power,speed,lead} = settings

        if ( settings.type.toLowerCase()==='power')  {
            this._settings = { name,type:'power', target:power, lead}
            if (!name || name.length===0 && power!==undefined)
                this._settings.name = `${power.toFixed(0)}W Coach`
        }
        else if ( settings.type.toLowerCase()==='speed')  {
            this._settings = { name,type:'speed', target:speed, lead}
            if (!name || name.length===0 && speed!==undefined)
            this._settings.name = `${speed.toFixed(0)}km/h Coach`
        }
    }

    initSimulator(user:{weight:number},bikeType:string) {
        const {type,target} = this.settings

        const mode = type==='power' ? 'Power' : 'Speed'
        const power = type==='power' ? target : undefined
        const speed = type==='speed' ? target : undefined

        const deviceSettings:DeviceSettings = {name:this.settings.name,interface:INTERFACE.SIMULATOR}        
        const props:SimulatorProperties = {port:'',isBot:true,user, settings:{bikeType,mode,power,speed}}

        if (!this.simulator)
            this.simulator = AdapterFactory.create(deviceSettings,props)
    }

    async start( onData) {
        if (!this.simulator)
            return;

        try {
            await this.simulator.start({})
            
            this.simulator.onData(  (data) => {
                onData( this, data)                
            })
                            
            
        } catch (err) {
            this.logger.logEvent({message:'error', fn:'startCoach()', coach:this.settings.name, error:err.message||err});                
        }        

    }

    stop() {
        if (!this.simulator)
            return;
       
        this.simulator.stop()
        this.routeDistance = undefined
    }

    

}