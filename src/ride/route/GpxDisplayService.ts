import { GoogleMapsService, useGoogleMaps } from "../../apps";
import { Injectable } from "../../base/decorators";
import { Observer } from "../../base/types";
import { getHeading } from "../../routes";
import { UserSettingsService, useUserSettings } from "../../settings";
import { CurrentRideDisplayProps, GpxDisplayProps,  RouteDisplayProps } from "../base";
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
    protected tsLastPovChanged: number
    protected povTimeout: NodeJS.Timeout
    protected updateDurations: Array<number> = []
    
    

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
    getSatelliteViewProps() {
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
            routeProps = {...routeProps, ...this.getSatelliteViewProps()}
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
            this.logEvent({message:'sat view error', error:this.mapError})
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

        const resetTimeout = ()=> {
            if (this.povTimeout) {
                clearTimeout(this.povTimeout)
                this.povTimeout = undefined
            }

        }

        if (event==='Loaded') {
            this.mapLoaded = true
            this.emit('state-update')
            this.tsLastSVEvent = Date.now()
        }
        else if (event==='Error') {
            this.mapError = data as string
            this.emit('state-update')
            this.logEvent({message:'street view position update error', error:this.mapError})
            resetTimeout()
        }
        else if ( event==='pano_changed') {
            this.logEvent({message:'street view panorama changed', panorama:data})
            this.tsLastSVEvent = Date.now()
        }
        else if ( event==='pov_changed') {

            if (this.tsLastPovChanged) {
                this.tsLastPovChanged = Date.now()
                this.tsLastSVEvent = Date.now()

                resetTimeout()
                this.povTimeout = setTimeout(() => {
                    this.povTimeout = undefined
                    let duration:number
                    if (this.tsPrevSVUpdate) {
                        duration = Date.now()-this.tsPrevSVUpdate;
                        if (duration>250) {
                            if (this.updateDurations.length==10) {
                                this.updateDurations.shift()
                            }
                            this.updateDurations.push(duration)
                        }
                    }
                    //console.log('# street view position confirmed', duration, clone({lat,lng,heading}), clone(this.svPosition))
                    if (duration!==undefined && duration>250) {
                        this.logEvent({message:'street view position update confirmed', duration})
                    }
                }, 100)
            }
            else {
                this.tsLastPovChanged = Date.now()
            }

            
        }
        else if ( event==='status_changed' || event==='position_changed') {
            this.tsLastSVEvent = Date.now()
        }

    }

    protected getStreetViewObserver () {
        this.svObserver = this.svObserver??new Observer()
        return this.svObserver
    }

    protected getStreetViewUpdateDelay() {
        const prefDelay = this.getUserSettings().getValue('preferences.sv.updateDelay',this.getDefaultUpdateFrequency())
        if (this.updateDurations.length>=10) {
            const avgDuration = this.updateDurations.reduce((a,b)=>a+b,0)/this.updateDurations.length
            let suggested = prefDelay
            if (avgDuration>800 && avgDuration<=1200)
                suggested = prefDelay+avgDuration
            else if (avgDuration>1200)
                suggested = SV_UPDATE_FREQ + avgDuration*1.5

            return Math.max(prefDelay, suggested)
        }
        return prefDelay
    }

    protected onPositionUpdate( state) {


        const {route,position} = state??{}

        const rideView = this.getUserSettings().getValue('preferences.rideView','sv')

        if (rideView==='sv') {
            const sincePrev = Date.now()-(this.tsPrevSVUpdate??0) 
            if (sincePrev>this.getStreetViewUpdateDelay()-25) {

                if (this.povTimeout) {
                    clearTimeout(this.povTimeout)
                    this.povTimeout = undefined
                }

                const freq = this.tsPrevSVUpdate ? sincePrev : undefined
                const {lat,lng,routeDistance} = position
                const heading = getHeading(route,position )
                this.getStreetViewObserver()?.emit('position-update',{lat,lng,heading})
                this.logEvent({message:'street view position update', lat,lng, routeDistance, heading, timeSinceLastUpdate:freq, timeSinceLastEvent:Date.now()-this.tsLastSVEvent})
                this.tsPrevSVUpdate = Date.now()
                delete this.tsPositionUpdateConfirmed
                delete this.tsLastSVEvent
                delete this.tsLastPovChanged
            }
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
                this.logEvent({message:'invalid setting', key,ret})
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

    @Injectable
    protected getGoogleMaps():GoogleMapsService {
        return useGoogleMaps()
    }

    
}
