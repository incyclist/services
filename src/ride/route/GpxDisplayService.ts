import { Injectable } from "../../base/decorators";
import { Observer } from "../../base/types";
import { getHeading } from "../../routes";
import { UserSettingsService, useUserSettings } from "../../settings";
import { CurrentRideDisplayProps, GpxDisplayProps, ICurrentRideService, RouteDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";
import { SatelliteViewEvent, StreetViewEvent } from "./types";

const SV_UPDATE_FREQ = 3000
const SV_MIN_READY = 1500
const SV_MIN_DELAY = 1000

export class GpxDisplayService extends RouteDisplayService {

    protected mapLoaded:boolean = false
    protected mapError:string
    protected svObserver: Observer;
    protected mapObserver: Observer;
    protected svPosition: {lat:number, lng:number, heading:number}
    protected tsPrevSVUpdate: number
    protected tsLastSVEvent: number
    protected tsPositionUpdateConfirmed: number
    
    

    constructor() {
        super()

    }

    protected initView() {
        try {

            const rideView = this.getUserSettings().get('preferences.rideView','sv')
            if ( rideView==='sv') {
                const updateFreq = this.getDefaultUpdateFrequency();
                const minimalPause = this.getMinimalPause()
                const bestFreq = this.getBestCaseUpdateFrequency()
                this.logEvent({message:'init streetview', updateFreq, minimalPause, bestFreq})                
            }

            
        }
        catch(err) {
            this.logError(err,'initView')
        }
    }
    

    // for StreetView we can't update the position more frequently than every 3 seconds
    // also: we need to provide heading for StreetView
    getStreetViewProps(rideProps: CurrentRideDisplayProps) {
        const sideViews = {
            enabled: true,
            hide: rideProps.hideAll,
            left: this.getUserSettings().get('preferences.sideViews.sv-left',true),
            right: this.getUserSettings().get('preferences.sideViews.sv-right',true),
        }

        const props:any =  {
            onDisplayEvent: this.onStreetViewEvent.bind(this),
            displayObserver: this.mapLoaded  ? this.getStreetViewObserver() : undefined,            
            displayPosition: this.mapLoaded  ? null : this.position,
            sideViews
        }

        return props
    }

    // We might need to restrict the position update frequency, similar to StreetView
    // {position,googleMaps,visible,options,onEvent}
    getSateliteViewProps() {
        return {
            onDisplayEvent: this.onSatelliteViewEvent.bind(this),
            displayPosition: this.position

            
        }
    }

    getMapViewProps() {
        return {
            onDisplayEvent: this.onMapViewEvent.bind(this),
            showMap:false,
            displayPosition: this.position
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
            routeProps = {...routeProps, ...this.getStreetViewProps(props)}
        }
        else if (rideView==='sat') {
            routeProps = {...routeProps, ...this.getSateliteViewProps()}
        }
        else {
            routeProps = {...routeProps, ...this.getMapViewProps()}
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
    protected onMapViewEvent(state:SatelliteViewEvent,error?:string) {
        if (state==='Loaded') {
            this.mapLoaded = true
        }
        this.emit('state-update')

    }

    protected onStreetViewEvent(event:StreetViewEvent,data:any) {
        //console.log('# streetview event', event, data)

        
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

        console.log('# on position update',{route,position} )

        const rideView = this.getUserSettings().get('preferences.rideView','sv')

        if (rideView==='sv') {
            const updatePending = (Date.now()-(this.tsPrevSVUpdate??0))> this.getDefaultUpdateFrequency()
            const stillBusy =  (!this.tsPositionUpdateConfirmed  && (Date.now()-(this.tsPrevSVUpdate??0))<500) || (Date.now()-(this.tsLastSVEvent??0))<this.getMinimalPause()
            const updatePossible = this.tsPositionUpdateConfirmed && (Date.now()-this.tsLastSVEvent)>this.getBestCaseUpdateFrequency()
    
            if ( (!stillBusy||!this.tsPrevSVUpdate) && (updatePending || updatePossible) ){
                if (position) {
    
                    const freq = this.tsPrevSVUpdate ? Date.now()-this.tsPrevSVUpdate : undefined
                    const duration = this.tsPrevSVUpdate ? (this.tsLastSVEvent??Date.now())-this.tsPrevSVUpdate : undefined
                   
                    const {lat,lng,routeDistance} = position
                    const heading = getHeading(route,position )
                    this.getStreetViewObserver()?.emit('position-update',{lat,lng,heading})
    
                    this.logEvent({message:'street view position update', lat,lng, routeDistance, heading, freq, duration})
    
                    this.tsPrevSVUpdate = Date.now()
                    delete this.tsPositionUpdateConfirmed
                    delete this.tsLastSVEvent
                }
            }    
            else {
                const duration = this.tsPrevSVUpdate ? Date.now()-this.tsPrevSVUpdate : undefined
                if (stillBusy) {                    
                    this.logEvent({message:'street view position update skipped', reason:'busy', duration})
                    // enforce next update after 10s
                    if (duration>10000) {
                        delete this.tsPrevSVUpdate
                        delete this.tsPositionUpdateConfirmed
                        delete this.tsLastSVEvent                            
                    }
                }
            }
        }
        else {
            //
            console.log('# position update', this.position)
        }

    }

    protected getDefaultUpdateFrequency() {
        return this.getNumSetting('SV_UPDATE_FREQ') ?? SV_UPDATE_FREQ
    }

    protected getMinimalPause() {
        return this.getNumSetting('SV_MIN_READY') ?? SV_MIN_READY
    }

    protected getBestCaseUpdateFrequency() {
        return this.getNumSetting('SV_MIN_DELAY') ?? SV_MIN_DELAY
    }

    protected getNumSetting(key:string):number {
        try {
            const ret = this.getUserSettings().get(key,undefined)
            if (!ret)
                return
            const val = Number(ret)
            if (isNaN(val)) {
                this.logEvent({message:'inalid setting', key,ret})
                return
            }
            return val

        }
        catch {}
    }

    @Injectable
    protected getUserSettings(): UserSettingsService {
        return useUserSettings()
    }

    
}
