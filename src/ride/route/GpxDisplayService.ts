import { Injectable } from "../../base/decorators";
import { Observer } from "../../base/types";
import { getHeading } from "../../routes";
import { UserSettingsService, useUserSettings } from "../../settings";
import { CurrentRideDisplayProps, GpxDisplayProps, ICurrentRideService, RouteDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";
import { SatelliteViewEvent, StreetViewEvent } from "./types";

const SV_UPDATE_FREQ = 3000
const SV_MIN_READY = 2000
const SV_MIN_DELAY = 1000

export class GpxDisplayService extends RouteDisplayService {

    protected mapLoaded:boolean = false
    protected mapError:string
    protected svObserver: Observer;
    protected svPosition: {lat:number, lng:number, heading:number}
    protected tsPrevSVUpdate: number
    protected tsLastSVEvent: number
    protected tsPositionUpdateConfirmed: number
    
    

    constructor() {
        super()

    }

    init(service: ICurrentRideService) {
        try {
            super.init(service)

            this.observer.on('position-update',this.onPositionUpdate.bind(this))

            
        }
        catch(err) {
            this.logError(err,'init')
        }
    }
    

    // for StreetView we can't update the position more frequently than every 3 seconds
    // also: we need to provide heading for StreetView
    getStreetViewProps() {
        
        const props:any =  {
            onDisplayEvent: this.onStreetViewEvent.bind(this),
            displayObserver: this.mapLoaded  ? this.getStreetViewObserver() : undefined,            
            initPosition: this.mapLoaded  ? undefined : this.position
        }

        return props
    }

    // We might need to restrict the position update frequency, similar to StreetView
    // {position,googleMaps,visible,options,onEvent}
    getSateliteViewProps() {
        return {
            onDisplayEvent: this.onSatelliteViewEvent.bind(this)
        }
    }
    

    getStartOverlayProps() {
        const rideView = this.getUserSettings().get('preferences.rideView','sv')
        if (rideView === 'map') {
            return {}
        }

        return {
            mapType: rideView==='sv' ? 'StreetView' : 'SatelliteView',
            mapState: this.mapLoaded ? 'Loaded' : 'Loading'
        }
    }

    isStartRideCompleted(): boolean {
        return this.mapLoaded
    }



    getDisplayProperties(props:CurrentRideDisplayProps):GpxDisplayProps {
        let routeProps:RouteDisplayProps = super.getDisplayProperties(props)
        const rideView = this.getUserSettings().get('preferences.rideView','sv')

        if (rideView==='sv') {
            routeProps = {...routeProps, ...this.getStreetViewProps()}
        }
        else if (rideView==='sat') {
            routeProps = {...routeProps, ...this.getSateliteViewProps()}
        }
        else {
            routeProps = {...routeProps,  showMap:false}
        }

        return {
           rideView,
            ...routeProps            
        }    
    }

    protected onSatelliteViewEvent(state:SatelliteViewEvent,error?:string) {
        if (state==='Loaded') {
            this.mapLoaded = true
        }
        else if (state==='Error') {
            this.mapError = error
        }
        this.emit('state-update')

    }

    protected onStreetViewEvent(event:StreetViewEvent,data:any) {
        if (event==='Loaded') {
            this.mapLoaded = true
            this.emit('state-update')
        }
        else if (event==='Error') {
            this.mapError = data as string
            this.emit('state-update')
        }
        if ( event==='position_changed') {
            this.tsPositionUpdateConfirmed = Date.now()
        }
        this.tsLastSVEvent = Date.now()

    }

    protected getStreetViewObserver () {
        this.svObserver = this.svObserver??new Observer()
        return this.svObserver
    }

    protected onPositionUpdate( state) {

        const {route,position} = state??{}

        const updatePending = (Date.now()-(this.tsPrevSVUpdate??0))> this.getDefaultUpdateFrequency()
        const stillBusy = !this.tsPositionUpdateConfirmed || (Date.now()-this.tsLastSVEvent)<this.getMinimalPause()
        const updatePossible = this.tsPositionUpdateConfirmed && (Date.now()-this.tsLastSVEvent)>this.getBestCaseUpdateFrequency()

        if ( !stillBusy && (updatePending || updatePossible) ){
            if (position) {
                const {lat,lng} = position

                const heading = getHeading(route,position )

                delete this.tsPositionUpdateConfirmed
                delete this.tsLastSVEvent
                this.getStreetViewObserver()?.emit('position-update',{lat,lng,heading})
                this.tsPrevSVUpdate = Date.now()
            }
        }
    }

    protected getDefaultUpdateFrequency() {
        return this.getSetting('SV_UPDATE_FREQ') ?? SV_UPDATE_FREQ
    }

    protected getMinimalPause() {
        return this.getSetting('SV_MIN_READY') ?? SV_MIN_READY
    }

    protected getBestCaseUpdateFrequency() {
        return this.getSetting('SV_MIN_DELAY') ?? SV_MIN_DELAY
    }

    protected getSetting(key:string) {
        try {
            return this.getUserSettings().get(key,undefined)
        }
        catch {}
    }

    @Injectable
    protected getUserSettings(): UserSettingsService {
        return useUserSettings()
    }

    
}
