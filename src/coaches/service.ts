import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { Observer } from "../base/types/observer";
import { DeviceConfigurationService, DevicePairingService, DeviceRideService, useDeviceConfiguration, useDevicePairing, useDeviceRide } from "../devices";
import { RouteListService, useRouteList } from "../routes";
import { RouteSettings } from "../routes/list/cards/RouteCard";
import { UserSettingsService, useUserSettings } from "../settings";
import { waitNextTick } from "../utils";
import { Coach } from "./coach";
import { DeviceData } from "incyclist-devices";
import { getNextPosition } from "../routes/base/utils/route";
import { useActivityRide } from "../activities";
import { Injectable } from "../base/decorators";
import { RideDisplayService, useRideDisplay } from "../ride";
import { useUnitConverter } from "../i18n";
import { Route } from "../routes/base/model/route";
import { sleep } from "../utils/sleep";

@Singleton
export class CoachesService extends IncyclistService {

    protected coaches: Array<Coach> = []
    protected observer: Observer    
    protected isPaused: boolean
    protected route!: Route

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
                if (this.observer) {
                    coach.stop()
                }
                this.coaches.splice(idx,1)    
            }
        }
        catch(err) {
            this.logError(err,'deleteCoach')
        }
    }


    async startRide(route:Route):Promise<Observer|null> {
        try {
            if (this.observer) {
                await this.stopRide()
            }

            if (!this.coaches?.length) {
                delete this.observer
                return null;
            }

            this.observer = new Observer()
            this.isPaused = false
            this.route = route

            const onDataUpdate = this.onCoachDataUpdate.bind(this)
            this.coaches.forEach( c => {
                const startSettings = this.routesService.getStartSettings() as RouteSettings
                let pos = 0;
                if ( startSettings.type==='Route') {
                    pos = startSettings.startPos
                }           

                const lead = (isNaN(c.settings?.lead) ? 0 : c.settings?.lead)??0
                c.setRoute(route)
                c.setProgress(lead+pos)
                c.setRiderPosition(pos)
                this.setCoachPosition(c,lead+pos)
    
                const user = this.userService.get('user',{})
                
                const mode= this.getDeviceRide().getCyclingMode()
                const bikeType = mode?.getSetting('bikeType')??'Race'
                c.initSimulator(user,bikeType)
                c.start(onDataUpdate)
            })        

            const setupListeners = (userRide:Observer)=> {
                userRide.on('data',this.onUserDataUpdate.bind(this))
                userRide.on('paused',this.pauseRide.bind(this))
                userRide.on('resumed',this.resumeRide.bind(this))
                userRide.once('completed',this.stopRide.bind(this))

            }


            const link = async ()=> {
                let success = false
                let attempt = 0

                while (!success && attempt<5) {
                    const userRide = this.getActivityRide().getObserver()
                    if (userRide) {
                        setupListeners(userRide)
                        success = true
                    }
                    else {
                        attempt++
                        await sleep(500)
                    }

                }

            }



            waitNextTick().then( ()=>{
                link()
                this.observer.emit('started') 
            })            
    
        }
        catch(err) {
            this.logError(err,'startRide')            
        }

        return this.observer
    }

    updateRoute(route:Route) {
        this.route = route
        if (this.observer) {
            this.coaches.forEach( c=>{c.setRoute(route)})
        }
    }

    async stopRide():Promise<void> {

        if (!this.observer)
            return
        try {
            this.coaches.forEach( c=> {c.stop()})
            this.isPaused = false;
            delete this.observer
        }
        catch(err) {
            this.logError(err,'stopRide')            
        }
    }

    pauseRide() {
        if (!this.observer)
            return

        try {
            this.isPaused = true
        }
        catch(err) {
            this.logError(err,'pauseRide')            
        }

    }

    resumeRide() {
        if (!this.observer)
            return

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

    getObserver() {
        return this.observer
    }

    protected onUserDataUpdate(data) {
        if (data)
            this.updateRiderPosition(data.routeDistance)
    }


    protected onCoachDataUpdate(coach:Coach, data:DeviceData) {

        if (this.isPaused)
            return;
        
        const startSettings = this.routesService.getStartSettings() as RouteSettings
        const {distance} = data        
        const route = this.route

        if(!route || !coach || !data)
            return;

        const prevRouteDistance = coach.getProgess()??0;
        const newRouteDistance = prevRouteDistance + data.distance 
        coach.setProgress(newRouteDistance)             
        
        if (startSettings.type==='Free-Ride')
            return;
        
        // update slope in simulator
        this.setCoachPosition(coach, distance);


    }


    protected setCoachPosition(coach: Coach, distance: number) {
        if (!this.observer)
            return;

        const startSettings = this.routesService.getStartSettings() as RouteSettings
        const {realityFactor=0} = startSettings
        const route = this.getRideDisplay().route

        if (!route)
            return

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

    @Injectable
    protected getDeviceRide():DeviceRideService {
        return useDeviceRide()
    }

    @Injectable
    protected getRideDisplay():RideDisplayService {
        return useRideDisplay()
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

    @Injectable getUnitConverter() {
        return useUnitConverter()
    }

    @Injectable
    protected getActivityRide() {
        return useActivityRide()
    }



}

export const getCoachesService = () => new CoachesService()