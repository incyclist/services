import { getBindings } from "../../api";
import { GoogleMapsService, useGoogleMaps } from "../../apps";
import { useAppState } from "../../appstate";
import { Injectable } from "../../base/decorators";
import { Observer } from "../../base/types";
import { getHeading } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { useRideSettingsDisplay } from "../../settings/display";
import { RoutePoint } from "../../types";
import { CurrentPosition, CurrentRideDisplayProps, GpxDisplayProps, RideViewType, RouteDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";
import { SatelliteViewEvent, StreetViewEvent, SvFallbackCause, SvViewState } from "./types";

const SV_UPDATE_FREQ = 3000
const SV_MIN_READY = 1500
const SV_MIN_DELAY = 1000

/**
 * Maximum time the start overlay waits for Street View to resolve before falling back to Map
 * for this ride. Measured from release (see `release()`), not from page init. Overridable via
 * the `SV_START_TIMEOUT` user setting.
 */
const SV_START_TIMEOUT = 15000

/**
 * Anti-flicker window: the Street View row/heading only switch to "loading" once this much
 * time has passed since release with no resolution yet, so a fast load never shows a changed
 * heading at all. Overridable via the `SV_PHASE_DELAY` user setting.
 */
const SV_PHASE_DELAY = 400

/**
 * Time since release after which the Street View row switches to "Still loading ..." and the
 * "Start with Map" button appears. Overridable via the `SV_SLOW_THRESHOLD` user setting.
 */
const SV_SLOW_THRESHOLD = 5000

/**
 * How long an automatic (non-user) fallback keeps the amber "Unavailable - using Map" row
 * visible before the overlay is allowed to close, so the switch away from Street View isn't a
 * surprise. Overridable via the `SV_FALLBACK_HOLD` user setting.
 */
const SV_FALLBACK_HOLD = 1500

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
 *
 * Street View panorama creation is deferred until the control device is ready to start -
 * see `release()`. The front-end only obeys `svInitAllowed`; this service owns when a
 * panorama may exist and what start phase the ride is in.
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

    /** set once the start overlay stopped waiting for the Satellite View 'Loaded' event */
    protected satStartTimedOut: boolean = false
    protected satStartTimeout: NodeJS.Timeout

    // --- Street View start sub-state machine ---

    protected tsInit: number
    /**
     * True for the rest of this ride once Street View becomes the active view - unlike
     * `getRideView()`, this is never flipped by a fallback, so `isStartRideCompleted()` and
     * `getStartOverlayProps()` can keep honouring the Street View state machine (including the
     * `SV_FALLBACK_HOLD`) even after `rideViewOverride` has switched the rendered view to Map.
     */
    protected svFlowActive: boolean = false
    /** current Street View start-phase state, only meaningful while svFlowActive */
    protected svViewState: SvViewState = 'waiting'
    /** monotonic: once true, a Street View panorama may exist for the rest of this page's life */
    protected svReleased: boolean = false
    protected tsSvReleased: number
    protected svInitTrigger: 'control-ready' | 'start-completed' | 'mid-ride' | 'eager'
    /** true once the rider actually saw the "loading"/"slow" phase (for the svPhaseVisible KPI) */
    protected svPhaseWasVisible: boolean = false
    protected svFallbackCause: SvFallbackCause
    /** this-ride-only override, never written back to preferences.rideView - see getRideView() */
    protected rideViewOverride: 'map'
    /** set once, right after an automatic fallback; read (and cleared) by getDisplayProperties() */
    protected rideViewNotice: {cause: SvFallbackCause}
    /** set on every no-coverage answer (start or mid-ride); read (and cleared) by getDisplayProperties() */
    protected svCoverageNotice: {ts: number}

    protected svPhaseDelayTimeout: NodeJS.Timeout
    protected svSlowTimeout: NodeJS.Timeout
    protected svStartTimeout: NodeJS.Timeout
    protected svFallbackHoldTimeout: NodeJS.Timeout



    constructor() {
        super()

    }

    protected initView() {
        try {
            this.tsInit = Date.now()

            const rideView = this.getRideView()
            if ( rideView==='sv') {
                this.svFlowActive = true

                const updateFreq = this.getDefaultUpdateFrequency();
                const minimalPause = this.getMinimalPause()
                const bestFreq = this.getBestCaseUpdateFrequency()
                this.logEvent({message:'init streetview', updateFreq, minimalPause, bestFreq})

                if (this.hasEagerInitKillSwitch())
                    this.release('eager')
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

            // only hands out the live observer once released - a panorama that never resolves
            // must still get position updates, otherwise it would be stuck frozen after a
            // timeout fallback
            displayObserver: this.svReleased  ? this.getStreetViewObserver() : undefined,
            // always a real position, never (0,0) and never nulled out once the ride is
            // running: the view can become active for the first time well after the ride has
            // started (map/satellite -> Street View mid-ride), and it needs a real coordinate
            // to create its panorama from at that point too, not just at ride start
            displayPosition: this.position,
            sideViews
        }

        if ( this.isMobile()) {
            // The native Street View component needs a concrete start position (including a
            // heading) so it can load the first panorama while the start overlay is still
            // shown. `this.position` honours the ride's start offset - the route's first
            // point, which the mobile view used before, does not.
            props.displayPosition = this.getInitialStreetViewPosition()
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
        return this.enrichWithHeading(this.position, 'getInitialStreetViewPosition')
    }

    /** Current position enriched with heading, for the satellite camera to rotate with. */
    protected getSatelliteViewPosition() {
        return this.enrichWithHeading(this.position, 'getSatelliteViewPosition')
    }

    /**
     * Adds `heading` to a position if it is not already present, computed from the rider's
     * progress along the route. Returns undefined while no position has been determined yet -
     * the mobile component must not be given a (0,0) fallback, which would request/render
     * imagery in the middle of the Atlantic.
     */
    protected enrichWithHeading(position: CurrentPosition|undefined, logContext: string) {
        if (!position)
            return undefined
        if (position.heading !== undefined)
            return position

        try {
            return {...position, heading: getHeading(this.getOriginalRoute(), position)}
        }
        catch (err) {
            this.logError(err, logContext)
            return position
        }
    }

    /**
     * True when the start overlay has to wait for the Street View component to report
     * 'Loaded'. This is the case on both mobile and desktop.
     */
    protected waitsForStreetView(): boolean {
        return this.getRideView() === 'sv'
    }

    /**
     * True when the start overlay has to wait for the Satellite View component to report
     * 'Loaded'. Mirrors waitsForStreetView() - see its comment for the rationale.
     */
    protected waitsForSatelliteView(): boolean {
        return this.getRideView() === 'sat'
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
            displayPosition: this.getSatelliteViewPosition()
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
     * For Street View, also exposes `viewState`/`viewFallbackCause`, the only signal
     * `StartRideOverlay` uses to render the Street View-specific header/row/button.
     * `mapStateError` is never set for Street View any more, so a Street View start can no
     * longer reach the Cancel-only map-error dead end.
     *
     * @returns Start overlay properties with map type and state information
     */
    getStartOverlayProps() {

        // checked first, and independent of getRideView(): a Street View fallback switches
        // getRideView() to 'map' (so the ride actually renders Map), but the overlay must keep
        // reporting the Street View row/state - including through the SV_FALLBACK_HOLD - rather
        // than falling into the generic (instant-complete) map branch below.
        if (this.svFlowActive) {
            const resolved = this.svViewState==='loaded' || this.svViewState==='unavailable'
            return {
                mapType: 'Street View',
                mapState: resolved ? 'Loaded' : 'Loading',
                viewState: this.svViewState,
                viewFallbackCause: this.svViewState==='unavailable' ? this.svFallbackCause : undefined
            }
        }

        const rideView = this.getRideView()

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
     * this completes immediately. For Street View, waits for the view to resolve (loaded, or
     * fallen back to Map after `SV_FALLBACK_HOLD`). For Satellite View, waits for load or the
     * satellite timeout.
     *
     * @returns True if the view is loaded and ready, false if still loading
     */
    isStartRideCompleted(): boolean {
        // see getStartOverlayProps() for why this is checked first, ahead of getRideView()
        if (this.svFlowActive) {
            return this.mapLoaded
        }

        const rideView = this.getRideView()
        if (rideView==='map' || (this.isMobile() && !this.waitsForStreetView() && !this.waitsForSatelliteView())) {
            this.mapLoaded = true
            return true;
        }

        // Satellite View: never block the rider indefinitely on a satellite image that may
        // never resolve.
        if (this.satStartTimedOut)
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
        const rideView = this.getRideView() as RideViewType

        if (rideView==='sv') {
            routeProps = {...routeProps, ...this.getStreetViewProps(props)}
        }
        else if (rideView==='sat') {
            routeProps = {...routeProps, ...this.getSatelliteViewProps()}
        }
        else {
            routeProps = {...routeProps, ...this.getMapViewProps()}
        }

        // read-once: the page renders it and the next call reports nothing new
        const rideViewNotice = this.rideViewNotice
        delete this.rideViewNotice
        const svCoverageNotice = this.svCoverageNotice
        delete this.svCoverageNotice

        return {
           rideView ,
           svInitAllowed: rideView==='sv' && this.svReleased,
           rideViewNotice,
           svCoverageNotice,
           ...routeProps
        }
    }

    /**
     * The ride view actually in effect. Every read of the ride view within this service must go
     * through here rather than `getRideSettingsDisplay().getRideView()` directly, so that a
     * Street View fallback is honoured everywhere - including side views - without ever
     * rewriting the user's `preferences.rideView`.
     */
    protected getRideView() {
        return this.rideViewOverride ?? this.getRideSettingsDisplay().getRideView()
    }

    /**
     * Clears a this-ride-only Street View fallback once the rider deliberately picks a ride
     * view in ride settings, on top of the inherited handling (reality-factor updates). Also
     * releases Street View immediately if the rider switches to it mid-ride and it was never
     * released during start (e.g. the ride started on Map/Satellite) - otherwise the view would
     * stay gated forever and never create a panorama.
     */
    onRideSettingsChanged(settings:{rideView?:string} = {}): void {
        super.onRideSettingsChanged(settings)

        if (this.rideViewOverride && settings?.rideView) {
            delete this.rideViewOverride
        }

        if (settings?.rideView==='sv' && !this.svReleased) {
            this.svFlowActive = true
            this.release('mid-ride')
        }
    }

    protected getRideViewName( ):string {

        const rideView = this.getRideView()
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
            this.mapError = error
            this.logEvent({message:'sat view error', error:this.mapError})
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
            // 'Loaded' means Google confirmed the status is OK - not just that the panorama
            // object was constructed.
            this.mapLoaded = true
            this.resolveStreetViewStart('loaded')
            this.tsLastSVEvent = Date.now()
        }
        else if (event==='NoPanorama') {
            // No coverage at a position is a legitimate answer, not a failure - the first
            // point on a route is routinely outside Street View's coverage. It never blocks
            // the start and never falls back to Map, at start or mid-ride - the rider just
            // gets a transient "no imagery here" notice. Genuine failures (Maps API errors, a
            // start that never gets any status) still go through the 'Error' event and the
            // start timeout fallback respectively.
            if (this.svViewState!=='loaded' && this.svViewState!=='unavailable') {
                this.mapLoaded = true
                this.resolveStreetViewStart('no-imagery')
            }
            this.reportNoCoverage(data)
        }
        else if (event==='Error') {
            this.mapError = data as string
            this.emit('state-update')
            this.logEvent({message:'street view position update error', error:this.mapError})
            resetTimeout()

            if (this.svViewState!=='loaded' && this.svViewState!=='unavailable')
                this.fallbackToMap('maps-api')
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

    // --- Street View start sub-state machine ---

    /**
     * Releases Street View panorama creation. Monotonic: once released, `svInitAllowed` stays
     * true for the rest of this page's life, including across Retry and across a later switch
     * away from and back to Street View.
     */
    protected release(trigger: 'control-ready' | 'start-completed' | 'mid-ride' | 'eager') {
        if (this.svReleased)
            return

        this.svReleased = true
        this.svInitTrigger = trigger
        this.tsSvReleased = Date.now()

        const svInitDelay = this.tsSvReleased - (this.tsInit ?? this.tsSvReleased)
        this.logEvent({message:'streetview init released', svInitTrigger:trigger, svInitDelay})

        this.armStreetViewPhaseTimers()
        this.emit('state-update')
    }

    protected armStreetViewPhaseTimers() {
        this.clearStreetViewPhaseTimers()

        const phaseDelay = this.getStreetViewPhaseDelay()
        this.svPhaseDelayTimeout = setTimeout(()=>{
            this.svPhaseDelayTimeout = undefined
            if (this.svViewState==='waiting') {
                this.svViewState = 'loading'
                this.svPhaseWasVisible = true
                this.emit('state-update')
            }
        }, phaseDelay)

        const slowThreshold = this.getStreetViewSlowThreshold()
        this.svSlowTimeout = setTimeout(()=>{
            this.svSlowTimeout = undefined
            if (this.svViewState==='waiting' || this.svViewState==='loading') {
                this.svViewState = 'slow'
                this.svPhaseWasVisible = true
                this.emit('state-update')
            }
        }, slowThreshold)

        const timeout = this.getStreetViewStartTimeout()
        this.svStartTimeout = setTimeout(()=>{
            this.svStartTimeout = undefined
            if (this.svViewState!=='loaded' && this.svViewState!=='unavailable') {
                this.logEvent({message:'street view start timeout', timeout, svInitTrigger:this.svInitTrigger})
                this.fallbackToMap('timeout')
            }
        }, timeout)
    }

    protected clearStreetViewPhaseTimers() {
        if (this.svPhaseDelayTimeout) {
            clearTimeout(this.svPhaseDelayTimeout)
            this.svPhaseDelayTimeout = undefined
        }
        if (this.svSlowTimeout) {
            clearTimeout(this.svSlowTimeout)
            this.svSlowTimeout = undefined
        }
        if (this.svStartTimeout) {
            clearTimeout(this.svStartTimeout)
            this.svStartTimeout = undefined
        }
    }

    /** Street View resolved OK ('loaded') or with no imagery at this point ('no-imagery'). */
    protected resolveStreetViewStart(svStartResult: 'loaded' | 'no-imagery') {
        if (this.svViewState==='loaded' || this.svViewState==='unavailable')
            return

        this.clearStreetViewPhaseTimers()
        this.svViewState = 'loaded'

        this.logEvent({message:'streetview start resolved', svStartResult, elapsed:this.getSvElapsed(), svPhaseVisible:this.svPhaseWasVisible})
        this.emit('state-update')
    }

    /**
     * A coverage gap ('NoPanorama') is not a failure - the rider just gets a transient notice,
     * at start or mid-ride, and Street View keeps running. Fires every time, unlike
     * `rideViewNotice` (once per ride): the rider can ride through several gaps on one route.
     */
    protected reportNoCoverage(status?: string) {
        this.svCoverageNotice = {ts: Date.now()}
        this.logEvent({message:'streetview no coverage', status})
        this.emit('state-update')
    }

    /**
     * Street View is never a reason not to ride: any problem after release falls back to Map
     * for this ride only, never into the Cancel-only map-error dead end.
     */
    protected fallbackToMap(cause: SvFallbackCause) {
        if (this.svViewState==='loaded' || this.svViewState==='unavailable')
            return

        this.clearStreetViewPhaseTimers()
        this.svViewState = 'unavailable'
        this.svFallbackCause = cause
        this.rideViewOverride = 'map'

        const svStartResult = cause==='maps-api' ? 'maps-api' : cause
        this.logEvent({message:'streetview start resolved', svStartResult, elapsed:this.getSvElapsed(), svPhaseVisible:this.svPhaseWasVisible})

        if (cause==='user') {
            // the rider explicitly chose Start with Map - no hold, no in-ride notice
            this.mapLoaded = true
            this.emit('state-update')
            return
        }

        this.rideViewNotice = {cause}
        this.emit('state-update') // paints the amber row immediately

        this.svFallbackHoldTimeout = setTimeout(()=>{
            this.svFallbackHoldTimeout = undefined
            this.mapLoaded = true
            this.emit('state-update')
        }, this.getStreetViewFallbackHold())
    }

    protected getSvElapsed() {
        return Date.now() - (this.tsSvReleased ?? this.tsInit ?? Date.now())
    }

    /**
     * Lets the rider skip a slow/failing Street View start, called via
     * `RideDisplayService.startWithMapFallback()`.
     */
    startWithMapFallback() {
        this.fallbackToMap('user')
    }

    protected hasEagerInitKillSwitch(): boolean {
        try {
            return this.getAppState().hasFeature('SV_EAGER_INIT')
        }
        catch {
            return false
        }
    }

    protected getStreetViewPhaseDelay() {
        return this.getNumSetting('SV_PHASE_DELAY') ?? SV_PHASE_DELAY
    }

    protected getStreetViewSlowThreshold() {
        return this.getNumSetting('SV_SLOW_THRESHOLD') ?? SV_SLOW_THRESHOLD
    }

    protected getStreetViewFallbackHold() {
        return this.getNumSetting('SV_FALLBACK_HOLD') ?? SV_FALLBACK_HOLD
    }

    protected getStreetViewStartTimeout() {
        return this.getNumSetting('SV_START_TIMEOUT') ?? SV_START_TIMEOUT
    }

    /**
     * Called by `RideDisplayService.checkStartStatus()` the first time the control device(s)
     * become ready to start. Sensors never delay this.
     */
    onStartDevicesReady(): void {
        if (this.getRideView()==='sv' && !this.svReleased)
            this.release('control-ready')
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
        // Safety net: if the user forced the start (Start/Ignore) before Street View was
        // released, release now so the view can still finish loading in the background.
        if (this.getRideView()==='sv' && !this.svReleased)
            this.release('start-completed')

        this.clearSatelliteViewStartTimeout()
        super.onStarted()
    }

    async stop(): Promise<void> {
        this.clearStreetViewPhaseTimers()
        this.clearSatelliteViewStartTimeout()
        if (this.svFallbackHoldTimeout) {
            clearTimeout(this.svFallbackHoldTimeout)
            this.svFallbackHoldTimeout = undefined
        }
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

        const rideView = this.getRideView()

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

    @Injectable
    protected getAppState() {
        return useAppState()
    }


}
