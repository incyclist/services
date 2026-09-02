import { getBindings } from "../../api";
import { GoogleMapsService, useGoogleMaps } from "../../apps";
import { Injectable } from "../../base/decorators";
import { Observer } from "../../base/types";
import { getHeading } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { useRideSettingsDisplay } from "../../settings/display";
import { RoutePoint } from "../../types";
import { CurrentRideDisplayProps, GpxDisplayProps,  RouteDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";
import { SatelliteViewEvent, StreetViewEvent } from "./types";

const SV_UPDATE_FREQ = 3000
const SV_MIN_READY = 1500
const SV_MIN_DELAY = 1000

/**
 * Maximum time the start overlay waits for the Street View component to report 'Loaded'
 * before the ride is started anyway.
 *
 * Without this cap, a device that can never resolve a panorama (e.g. a blocked/stalled
 * request to Google's Street View backend) would be stuck on the start overlay forever.
 * Bailing out restores the previous behaviour (ride starts, view may stay black) instead
 * of blocking the user, so this can never be worse than not waiting at all.
 * Overridable via the `SV_START_TIMEOUT` user setting.
 */
const SV_START_TIMEOUT = 15000

/**
 * Maximum time the start overlay waits for the Satellite View component to report 'Loaded'
 * before the ride is started anyway. Mirrors SV_START_TIMEOUT - see its comment for the
 * rationale. Overridable via the `SAT_START_TIMEOUT` user setting.
 */
const SAT_START_TIMEOUT = 15000

/**
 * Service for managing GPX-based route ride display with multiple view modes.
 *
 * Extends RouteDisplayService to add support for Street View, Satellite View, and
 * traditional Map views during route rides. This service manages:
 * - Street View with dynamic position updates and heading synchronization
 * - Satellite View for geographic visualization
 * - Map View as a fallback for mobile devices
 * - View-specific display properties and event handling
 * - Dynamic update frequency optimization for Street View based on performance
 *
 * Intelligently switches between view modes based on user preferences and device
 * capabilities (e.g., uses Map view on mobile devices). Includes sophisticated
 * Street View update throttling to respect API rate limits and improve performance.
 */
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
    /** set once the start overlay stopped waiting for the Street View 'Loaded' event */
    protected svStartTimedOut: boolean = false
    protected svStartTimeout: NodeJS.Timeout
    /** set once the start overlay stopped waiting for the Satellite View 'Loaded' event */
    protected satStartTimedOut: boolean = false
    protected satStartTimeout: NodeJS.Timeout

    

    constructor() {
        super()

    }

    protected initView() {
        try {

            const rideView = this.getRideSettingsDisplay().getRideView()
            if ( rideView==='sv') {
                const updateFreq = this.getDefaultUpdateFrequency();
                const minimalPause = this.getMinimalPause()
                const bestFreq = this.getBestCaseUpdateFrequency()
                this.logEvent({message:'init streetview', updateFreq, minimalPause, bestFreq})

                if (this.waitsForStreetView())
                    this.armStreetViewStartTimeout()
            }
            else if ( rideView==='sat') {
                if (this.waitsForSatelliteView())
                    this.armSatelliteViewStartTimeout()
            }


        }
        /* istanbul ignore catch */
        catch(err) {
            this.logError(err,'initView')
        }
    }
    

    /**
     * Gets Street View display properties for the current ride position.
     *
     * Provides Street View-specific configuration including position, heading, and
     * event callbacks. Manages side view panels (left/right views) and respects the
     * user's hideAll preference. Position updates are throttled to respect Street View
     * API rate limits (minimum 3 second intervals).
     *
     * @param rideProps - Current ride display properties with hideAll flag
     * @returns Street View configuration with position, observer, and event handlers
     */
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

        if ( this.isMobile()) {
            // The native Street View component needs a concrete start position (including a
            // heading) so it can load the first panorama while the start overlay is still
            // shown. `this.position` honours the ride's start offset - the route's first
            // point, which the mobile view used before, does not.
            props.displayPosition = this.mapLoaded ? null : this.getInitialStreetViewPosition()
        }

        return props
    }

    /**
     * Start position for the native Street View component, enriched with the heading the
     * rider will be facing. Returns undefined while no position has been determined yet -
     * the mobile component must not be given a (0,0) fallback, which would request a
     * panorama in the middle of the Atlantic.
     */
    protected getInitialStreetViewPosition() {
        const position = this.position
        if (!position)
            return undefined
        if (position.heading !== undefined)
            return position

        try {
            return {...position, heading: getHeading(this.getOriginalRoute(), position)}
        }
        catch (err) {
            this.logError(err, 'getInitialStreetViewPosition')
            return position
        }
    }

    /**
     * True when the start overlay has to wait for the Street View component to report
     * 'Loaded'. Only relevant on mobile: desktop already waits (it has always received the
     * component's events), while mobile used to skip the wait entirely and therefore tore
     * the overlay down onto a panorama that had not loaded yet - a black screen.
     */
    protected waitsForStreetView(): boolean {
        return this.isMobile() && this.getRideSettingsDisplay().getRideView() === 'sv'
    }

    /**
     * True when the start overlay has to wait for the Satellite View component to report
     * 'Loaded'. Mirrors waitsForStreetView() - see its comment for the rationale.
     */
    protected waitsForSatelliteView(): boolean {
        return this.isMobile() && this.getRideSettingsDisplay().getRideView() === 'sat'
    }

    /**
     * Gets Satellite View display properties for the current ride position.
     *
     * Provides satellite/aerial imagery view of the route with the current position
     * marked. Satellite View allows users to see the actual terrain and surroundings
     * of the route they are riding on.
     *
     * @returns Satellite View configuration with position and event handlers
     */
    getSatelliteViewProps() {
        return {
            onDisplayEvent: this.onSatelliteViewEvent.bind(this),
            displayPosition: this.position


        }
    }

    /**
     * Gets Map View display properties for the current ride position.
     *
     * Provides a traditional 2D map view of the route with the current position marked.
     * This is the default view on mobile devices and serves as a fallback when other
     * views are unavailable.
     *
     * @returns Map View configuration with position and event handlers
     */
    getMapViewProps() {
        return {
            onDisplayEvent: this.onMapViewEvent.bind(this),
            showMap:false,
            displayPosition: this.position
        }
    }
    
    

    /**
     * Gets start overlay properties showing the view type and loading status.
     *
     * Displays information about the currently loading map/view during ride start,
     * including the view type name and load status. Helps users understand what view
     * is being loaded and if there are any errors.
     *
     * @returns Start overlay properties with map type and state information
     */
    getStartOverlayProps() {


        const rideView = this.getRideSettingsDisplay().getRideView()


        if (rideView === 'map' || (this.isMobile() && !this.waitsForStreetView() && !this.waitsForSatelliteView())) {
            return {
                mapType: this.getRideViewName(),
                mapState: 'Loaded'
            }
        }

        return {
            mapType: this.getRideViewName(),
            mapState: this.mapLoaded ? 'Loaded' : 'Loading',
            mapStateError: this.mapError
        }
    }

    /**
     * Checks if the ride start process has completed.
     *
     * Returns true when the map/view is fully loaded and ready. For map view on mobile,
     * this completes immediately. For Street View and Satellite View, waits for the
     * view to finish loading.
     *
     * @returns True if the view is loaded and ready, false if still loading
     */
    isStartRideCompleted(): boolean {
        const rideView = this.getRideSettingsDisplay().getRideView()
        if (rideView==='map' || (this.isMobile() && !this.waitsForStreetView() && !this.waitsForSatelliteView())) {
            this.mapLoaded = true
            return true;
        }

        // Never block the rider indefinitely on a panorama/satellite image that may never resolve.
        if (this.svStartTimedOut || this.satStartTimedOut)
            return true

        return this.mapLoaded
    }



    /**
     * Gets complete display properties for the GPX ride with the selected view mode.
     *
     * Extends the parent RouteDisplayService properties by adding view-specific settings
     * for Street View, Satellite View, or Map View based on user preferences and device
     * capabilities. Combines all necessary display data for rendering the GPX ride UI.
     *
     * @param props - Current ride display properties controlling visibility and layout
     * @returns Complete GPX display properties including selected view mode and view-specific props
     */
    getDisplayProperties(props:CurrentRideDisplayProps):GpxDisplayProps {
        let routeProps:RouteDisplayProps = super.getDisplayProperties(props)
        const rideView = this.getRideSettingsDisplay().getRideView() as 'sv' | 'map' | 'sat'

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
           rideView ,
            ...routeProps
        }
    }

    protected getRideView() {
        return this.getRideSettingsDisplay().getRideView()
    }

    protected getRideViewName( ):string {

        const rideView = this.getRideSettingsDisplay().getRideView()
        const map = {
            map: 'Map',
            sv: 'Street View',
            sat: 'Satellite View'
        }
        return map?.[rideView]??rideView

    }

    protected onSatelliteViewEvent(state:SatelliteViewEvent,error?:string) {
        if (state==='Loaded') {
            this.mapLoaded = true
            this.clearSatelliteViewStartTimeout()
        }
        else if (state==='Error') {
            this.logEvent({message:'sat view error', error:this.mapError})
            this.mapError = error
        }
        this.emit('state-update')

    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected onMapViewEvent(state:SatelliteViewEvent,_error?:string) {
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
            this.clearStreetViewStartTimeout()
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

            // Mobile has no 'pov_changed' equivalent, so the round-trip measurement that
            // feeds the adaptive update delay is taken from the panorama change instead.
            // Without this, updateDurations never fills on mobile and
            // getStreetViewUpdateDelay() stays pinned at the default frequency no matter
            // how slow the device actually is.
            if (this.isMobile())
                this.recordUpdateDuration()
        }
        else if ( event==='pov_changed') {

            if (this.tsLastPovChanged) {
                this.tsLastPovChanged = Date.now()
                this.tsLastSVEvent = Date.now()

                resetTimeout()
                this.povTimeout = setTimeout(() => {
                    this.povTimeout = undefined
                    this.recordUpdateDuration()
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

    /**
     * Records how long the last position update took to be acknowledged by the Street View
     * component. The samples drive getStreetViewUpdateDelay()'s adaptive back-off, so that
     * slow devices are not sent position updates faster than they can render them.
     */
    protected recordUpdateDuration() {
        if (!this.tsPrevSVUpdate)
            return

        const duration = Date.now()-this.tsPrevSVUpdate
        if (duration<=250)
            return

        if (this.updateDurations.length==10) {
            this.updateDurations.shift()
        }
        this.updateDurations.push(duration)
        this.logEvent({message:'street view position update confirmed', duration})
    }

    protected armStreetViewStartTimeout() {
        this.clearStreetViewStartTimeout()

        const timeout = this.getStreetViewStartTimeout()
        this.svStartTimeout = setTimeout( ()=>{
            this.svStartTimeout = undefined
            if (this.mapLoaded)
                return

            this.svStartTimedOut = true
            this.logEvent({message:'street view start timeout', timeout})
            // re-trigger the start check, which now no longer waits for the view
            this.emit('state-update')
        }, timeout)
    }

    protected clearStreetViewStartTimeout() {
        if (this.svStartTimeout) {
            clearTimeout(this.svStartTimeout)
            this.svStartTimeout = undefined
        }
    }

    protected getStreetViewStartTimeout() {
        return this.getNumSetting('SV_START_TIMEOUT') ?? SV_START_TIMEOUT
    }

    protected armSatelliteViewStartTimeout() {
        this.clearSatelliteViewStartTimeout()

        const timeout = this.getSatelliteViewStartTimeout()
        this.satStartTimeout = setTimeout( ()=>{
            this.satStartTimeout = undefined
            if (this.mapLoaded)
                return

            this.satStartTimedOut = true
            this.logEvent({message:'satellite view start timeout', timeout})
            // re-trigger the start check, which now no longer waits for the view
            this.emit('state-update')
        }, timeout)
    }

    protected clearSatelliteViewStartTimeout() {
        if (this.satStartTimeout) {
            clearTimeout(this.satStartTimeout)
            this.satStartTimeout = undefined
        }
    }

    protected getSatelliteViewStartTimeout() {
        return this.getNumSetting('SAT_START_TIMEOUT') ?? SAT_START_TIMEOUT
    }

    onStarted(): void {
        this.clearStreetViewStartTimeout()
        this.clearSatelliteViewStartTimeout()
        super.onStarted()
    }

    async stop(): Promise<void> {
        this.clearStreetViewStartTimeout()
        this.clearSatelliteViewStartTimeout()
        return super.stop()
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

    protected onPositionUpdate( state:{route:Route, position:RoutePoint}) {


        const {route,position} = state??{}

        const rideView = this.getRideSettingsDisplay().getRideView()

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

    protected getNumSetting(key:string):number|undefined {
        try {
            const ret = this.getUserSettings().get(key,undefined)
            if (!ret)
                return
            const val = Number(ret)
            if (Number.isNaN(val)) {
                this.logEvent({message:'invalid setting', key,ret})
                return
            }
            return val

        }
        catch {
            // intentionally empty
        } 
    }

    protected isMobile() {
        return this.getBindings().appInfo?.getChannel()==='mobile'
    }

    protected isIOS():boolean {
        return this.getBindings().appInfo?.getOS().platform==='ios'
    }


    /* istanbul ignore next */
    @Injectable
    protected getGoogleMaps():GoogleMapsService {
        return useGoogleMaps()
    }

    /* istanbul ignore next */
    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getRideSettingsDisplay() {
        return useRideSettingsDisplay()
    }

    
}
