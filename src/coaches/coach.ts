import { EventLogger } from "gd-eventlog";
import { CoachEditProps, CoachSettings } from "./types";
import {AdapterFactory, DeviceProperties, DeviceSettings, INTERFACE, IncyclistDeviceAdapter} from 'incyclist-devices'
import { RoutePoint } from "../routes/base/types";
import { FormattedNumber, useUnitConverter } from "../i18n";
import { ActiveRideEntry } from "../activities";
import { Route } from "../routes/base/model/route";
import { getPointAtDistance } from "../routes";

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
    protected route: Route

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

    setRoute(route:Route) {
        this.route = route
    }

    setProgress(routeDistance:number) {
        try {
            this.routeDistance = routeDistance
            if (!this.route?.details?.points)
                return
                

            const isLap  = this.route?.description?.isLoop
            const totalDistance = this.route?.description?.distance

            const lapDistance = isLap ? this.routeDistance%totalDistance : this.routeDistance
            const position = getPointAtDistance(this.route, lapDistance, true)

            this.setPosition(position)
        }
        catch(err) {
            this.logger.logEvent({message:'error',fn:'setProgress',error:err.message, stack:err.stack})
        }
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

        const [C,U] = this.getUnitConversionShortcuts()

        const speedConverted =  {
            value: speed===undefined ? speed : C(speed,'speed',{digits:1}),
            unit: U('speed')
        }

        const props:CoachEditProps = { 
            name,type,speed:speedConverted,power, lead
        }

        if ( this.routeDistance!==undefined && this.riderPosition!==undefined)
            props.lead = this.lead


        props.lead = {
            value: props.lead===undefined ? undefined : C(props.lead,'distance',{digits:1}),
            unit: U('distance')
        }
       
        return props
    }

    getRidersListDisplayProperties(): Partial<ActiveRideEntry> {

        const {name} = this.settings
        return  {
            id: `coach:${name}`,
            user: {
                name:name,
                id: `coach:${name}`,
            },
            tsLastUpdate: Date.now(),
            currentRideDistance: this.getProgess(),
            currentPosition: this.getPosition(),
            isCoach:true
        }


    }

    update(settings:CoachEditProps) {
        const {name,power,speed: speedEdit,lead: leadEdit} = settings

        const getValue = (v:number|FormattedNumber, d:'distance'|'speed'):number  => {

            const [C,U] = this.getUnitConversionShortcuts()

            if (v===undefined || typeof(v)==='number') 
                return v as number
            if (v.unit===undefined)
                return undefined

            if (d==='distance') 
                return C( v.value, 'distance', {from:U('distance'),to:'m'})
            else {
                return C( v.value, 'speed', {from:U(d),to:'km/h'})
            }
        }

        const lead = getValue(leadEdit,'distance')
        const speed = getValue(speedEdit,'speed')
        

        if ( settings.type.toLowerCase()==='power')  {
            this._settings = { name,type:'power', target:power, lead }
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
        
        this.simulator = this.simulator ?? AdapterFactory.create(deviceSettings,props)
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
            this.logger.logEvent({message:'error', fn:'startCoach()', coach:this.settings.name, error:err.message});                
        }        

    }

    stop() {
        if (!this.simulator)
            return;
       
        this.simulator.stop()
        this.routeDistance = undefined
        this.route = undefined
    }

    protected getUnitConversionShortcuts () {
        return useUnitConverter().getUnitConversionShortcuts()
    }

    protected getUnits() {
        return useUnitConverter().getUnits()
    }

    

}