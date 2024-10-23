import { IncyclistCapability } from "incyclist-devices";
import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { Observer } from "../base/types/observer";
import { DeviceConfigurationService, DevicePairingService, DeviceRideService, useDeviceConfiguration, useDevicePairing, useDeviceRide } from "../devices";
import { RouteListService, useRouteList } from "../routes";
import { RouteSettings } from "../routes/list/cards/RouteCard";
import { UserSettingsService, useUserSettings } from "../settings";
import { waitNextTick } from "../utils";
import { Coach } from "./coach";
import { CoachStatus } from "./types";
import { IncyclistAdapterData } from "incyclist-devices/lib/types";
import { getNextPosition } from "../routes/base/utils/route";

@Singleton
export class CoachesService extends IncyclistService {

    protected coaches: Array<Coach> = []
    protected activeRide: Observer    
    protected isPaused: boolean

    constructor() {
        super('Coaches')
        this.isPaused = false

    }

    getCoaches():Array<Coach>{        
        return this.coaches
    }

    openCoachEdit( coach?:Coach):Coach{
        if (coach)
            return coach
        
        return new Coach({name:'', type:undefined, target:undefined})
    }

    
    saveCoach(coach:Coach) {
        try {

            const idx = this.coaches.findIndex( c => c.id===coach.id)
            if (idx!==-1)
                this.coaches[idx] = coach
            else 
                this.coaches.push(coach)
        }
        catch(err) {
            this.logError(err,'saveCoach')
        }
    }

    deleteCoach(coach:Coach) {
        try {
            const idx = this.coaches.findIndex( c => c.id===coach.id)
            if (idx!==-1) {
                if (this.activeRide) {
                    coach.stop()
                }
                this.coaches.splice(idx,1)    
            }
        }
        catch(err) {
            this.logError(err,'deleteCoach')
        }
    }


    async startRide():Promise<Observer|null> {
        
        try {
            if (this.activeRide) {
                await this.stopRide()
            }

            if (!this.coaches)
                return null;

            this.activeRide = new Observer()
            this.isPaused = false

            const onDataUpdate = this.onCoachDataUpdate.bind(this)
            this.coaches.forEach( c => {
                const startSettings = this.routesService.getStartSettings() as RouteSettings
                let pos = 0;
                if ( startSettings.type==='Route') {
                    pos = startSettings.startPos
                }           
    
                c.setProgress(c.settings.lead+pos)
                c.setRiderPosition(pos)
                this.setCoachPosition(c,c.settings.lead+pos)
    
                const user = this.userService.get('user',{})
                
                const adapter= this.deviceConfig.getSelected(IncyclistCapability.Control)
                const bikeType = adapter.getCyclingMode().getSetting('bikeType')||'Race'
                c.initSimulator(user,bikeType)
                c.start(onDataUpdate)
            })        

            waitNextTick().then( ()=>{this.activeRide.emit('started') })            
    
        }
        catch(err) {
            this.logError(err,'startRide')            
        }

        return this.activeRide
    }

    async stopRide():Promise<void> {
        try {
            this.coaches.forEach( c=> {c.stop()})
            this.isPaused = false;
            delete this.activeRide
        }
        catch(err) {
            this.logError(err,'stopRide')            
        }
    }

    pauseRide() {
        try {
            this.isPaused = true
        }
        catch(err) {
            this.logError(err,'pauseRide')            
        }

    }

    resumeRide() {
        try {
            this.isPaused = false

        }
        catch(err) {
            this.logError(err,'resumeRide')            
        }

    }

    updateRiderPosition( routeDistance:number) {
        
        try {
            this.coaches.forEach( c => {c.setRiderPosition(routeDistance)})        
        }
        catch(err) {
            this.logError(err,'updateRiderPosition')            
        }

    }

    protected onCoachDataUpdate(coach:Coach, data:IncyclistAdapterData) {

        if (this.isPaused)
            return;
        
        const startSettings = this.routesService.getStartSettings() as RouteSettings
        const {distance} = data        
        const route = this.routesService.getSelected()

        if(!route || !coach || !data)
            return;

        const prevRouteDistance = coach.getProgess();
        const newRouteDistance = prevRouteDistance + data.distance 
        coach.setProgress(newRouteDistance)             
        
        if (startSettings.type==='Free-Ride')
            return;
        
        // update slope in simulator
        this.setCoachPosition(coach, distance);


    }


    protected setCoachPosition(coach: Coach, distance: number) {
        if (!this.activeRide)
            return;

        const startSettings = this.routesService.getStartSettings() as RouteSettings
        const {realityFactor=0} = startSettings
        const route = this.routesService.getSelected()

        const prevPosition = coach.getPosition() || route.points[0];
        let nextPosition = undefined;

        if (distance > 0) {
            nextPosition = getNextPosition(route, { distance, prev: prevPosition });
            if (nextPosition) {
                const { slope } = nextPosition;
                coach.sendDeviceUpdate({ slope: slope * realityFactor / 100 });
            }
    
        }
    }

    protected get routesService():RouteListService {
        return useRouteList()
    }

    protected get rideService():DeviceRideService {
        return useDeviceRide()
    }
    protected get deviceConfig():DeviceConfigurationService {
        return useDeviceConfiguration()
    }

    protected get pairingService():DevicePairingService {
        return useDevicePairing()
    }

    protected get userService():UserSettingsService {
        return useUserSettings()
    }

}

export const getCoachesService = () => new CoachesService()