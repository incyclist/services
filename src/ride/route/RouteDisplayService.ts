import { CyclingMode, UpdateRequest } from "incyclist-devices";
import { ActiveWorkoutLimit } from "../../workouts";
import { RideModeService } from "../base/base";
import { CurrentPosition, CurrentRideDisplayProps, ICurrentRideService, NearbyDisplayProps, OverlayDisplayProps, RouteDisplayProps, RouteMarker, SideViewsShown } from "../base";
import { Injectable } from "../../base/decorators";
import { useUserSettings } from "../../settings";
import { getHeading, getNextPosition, getPosition, GetPositionProps, LapPoint, useRouteList } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { RouteSettings } from "../../routes/list/cards/types";
import { ActiveRideListDisplayItem, ScreenShotInfo, useActiveRides } from "../../activities";
import { getBindings } from "../../api";
import { ActivityUpdate, CurrentActivityData } from "../../activities/ride/types";
import clone from "../../utils/clone";
import { useDeviceRide } from "../../devices";
import { FormattedNumber, getUnitConversionShortcuts, useUnitConverter } from "../../i18n";
import { RoutePoint } from "../../types";
import { Observer } from "../../base/types";

const MAX_INACTIVITY = 5000

/**
 * Service for managing route-based ride display and tracking.
 *
 * Extends RideModeService to provide route-specific functionality including:
 * - Position tracking along a route
 * - Lap completion detection
 * - Route distance and elevation calculations
 * - Display properties for route visualization (markers, overlays, etc.)
 * - Integration with nearby rides and previous ride data
 *
 * The service tracks user position on the selected route and manages display elements
 * like maps, elevation profiles, and nearby rider markers. It handles both loop and
 * linear routes, with configurable start/end positions and reality factor adjustments.
 */
export class RouteDisplayService extends RideModeService {
    protected prevRequestSlope?: number

    protected position?: CurrentPosition    
    protected sideViews?: SideViewsShown
    protected currentRoute?: Route

    protected hasNearbyRides: boolean  = false 
    protected prevRequestedSlope:undefined = undefined
    protected prevPowerTs?: number

    protected nearbyRiders?: ActiveRideListDisplayItem[]
    protected _startSettings?: RouteSettings



    /**
     * Initializes the route display service with a current ride service instance.
     *
     * Sets up the route, initial position, and views. Must be called before other operations.
     *
     * @param service - The current ride service providing observer and lifecycle callbacks
     */
    init(service: ICurrentRideService) {
        try {
            super.init(service)

            this.initRoute()
            this.initView()


            this.position =  this.setInitialPosition()

        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'init')
        }
    }



    /**
     * Gets the device start settings for the route ride.
     *
     * Returns route-specific settings including reality factor and starting position
     * to be sent to the device at the beginning of a ride.
     *
     * @returns Object containing realityFactor (0-100), startPos (meters), and the selected route
     */
    getDeviceStartSettings() {
        const startSettings:RouteSettings = this.getRouteList().getStartSettings() as RouteSettings
        const route = this.getRouteList().getSelected()
        const {realityFactor=100,startPos=0} = startSettings

        return {realityFactor,startPos,route}
    }

    
    /**
     * Handles activity updates during the ride.
     *
     * Updates the user's position on the route, detects lap completions, and emits
     * position update events. Ignores updates when the user is inactive (low power and speed).
     *
     * @param activityPos - Current activity update with ride metrics including route distance
     * @param data - Additional activity data including power and speed
     */
    onActivityUpdate(activityPos:ActivityUpdate,data:CurrentActivityData):void {

        if ((data.power??0)>0)
            this.prevPowerTs = Date.now()

        if (data.power===0 && (data.speed===0 ||  (data.speed??0)<5 && (Date.now()-(this.prevPowerTs??0))>MAX_INACTIVITY)) {
            return
        }

        try {
            const prevPosition = {...this.position}
            const newPosition = this.updatePosition(activityPos);
            if (!newPosition)
                return;

            const isCompleted = this.checkFinishOptions(newPosition)
            if (!isCompleted) {
    
                this.position = {...newPosition}
                const {lat,lng,routeDistance,lap} = newPosition

                this.onPositionUpdate({route:this.getOriginalRoute(),position:this.position})
                this.logEvent({message:'position update', lat,lng,routeDistance,lap  })
                this.observer.emit('position-update', this.service.getDisplayProperties())           
    
                if (this.position.lap !== prevPosition.lap) {
                    this.logEvent({message:'lap completed update', lap:prevPosition.lap  })
                    this.emit('lap-completed',prevPosition.lap,this.position.lap)
                }        
                this.savePosition()
            }

    
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'onActivityUpdate')
        }



        super.onActivityUpdate(activityPos,data)
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected onPositionUpdate(_state:{route:Route, position:RoutePoint}) {
        /* to be implemented by sub-class */
    }

    /**
     * Handles changes to ride settings during an active ride.
     *
     * Updates the reality factor based on settings changes, which affects the slope
     * adjustments sent to the device.
     *
     * @param settings - Updated ride settings object containing reality factor
     */
    onRideSettingsChanged(settings:any) {
        try {
            const {reality} = settings

            this.startSettings.realityFactor = reality


        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'onRideSettingsChanged')
        }
    }

    /**
     * Called when the ride has started.
     *
     * Initializes nearby rides tracking and sends the initial device update request
     * with the starting slope and reality factor settings.
     */
    onStarted() {
        try {
            this.prepareActiveRides()
            this.sendUpdate(this.buildRequest())

        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'onStarted')
        }

    }

    /**
     * Called when the ride has stopped.
     *
     * Cleans up nearby rides tracking and clears cached start settings, allowing
     * fresh settings to be loaded if the ride is resumed or a new ride is started.
     */
    onStopped() {
        try {
            this.cleanupActiveRides()
            delete this._startSettings
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'onStopped')
        }
    }

    /**
     * Gets route markers for nearby and previous ride data.
     *
     * Combines nearby active riders and previous ride data into route markers
     * that can be displayed on the route map.
     *
     * @param props - Current ride display properties containing previous rides data
     * @returns Array of route markers with position and avatar information
     */
    getMarkers(props: CurrentRideDisplayProps):Array<RouteMarker> {

        const nearby:ActiveRideListDisplayItem[] = this.nearbyRiders??[]

        const nearbyMarkers = nearby.map( m=> {
            const {lat,lng,lapDistance: routeDistance,avatar} = m
            return {lat,lng,routeDistance,avatar}
        })

        const prevRides = props.prevRides?.list??[]
        const prevRidesMarkers = prevRides.map ( pri => {
            const {lat,lng,routeDistance,avatar} = pri
            return {lat,lng,routeDistance,avatar}

        })

        const markers = [...nearbyMarkers, ...prevRidesMarkers]
        return markers as Array<RouteMarker>
    }

    /**
     * Gets display properties for a specific overlay.
     *
     * Determines whether an overlay (map, elevation, slope, etc.) should be shown
     * and whether it should be displayed minimized based on user preferences and
     * current display state.
     *
     * @param overlay - The overlay type (e.g., 'map', 'slope', 'elevation')
     * @param props - Current ride display properties with hideAll flag
     * @returns Overlay display properties with show and minimized flags
     */
    getOverlayProps(overlay:string, props: CurrentRideDisplayProps):OverlayDisplayProps {
        const showMapEnabled = this.getUserSettings().get(`preferences.sideViews.${overlay}` ,true)
        const show = !props.hideAll
        const minimized = !showMapEnabled
        return {show,minimized}
    }

    /**
     * Gets display properties for nearby rides overlay.
     *
     * Determines whether to show the nearby rides panel based on whether active rides
     * are available and the current display state. Emits an overlay-update event if
     * the nearby rides availability has changed.
     *
     * @param props - Current ride display properties with hideAll flag
     * @returns Nearby rides display properties with show flag, minimized state, and observer
     */
    getNearbyRidesProps(props: CurrentRideDisplayProps):NearbyDisplayProps {
        try {
            const {minimized} = this.getOverlayProps('',props)
            const hasNearbyRides  = this.getActiveRides().get()?.length > 0
            const show = hasNearbyRides && !props.hideAll
            const observer = this.getActiveRides().getObserver()??null

            const nearbyRides = {show,minimized,observer}

            if (this.hasNearbyRides !== hasNearbyRides) {
                this.hasNearbyRides = hasNearbyRides
                this.service.getObserver().emit('overlay-update', {nearbyRides})
            }

            return nearbyRides
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'getNearbyRidesProps')
            return {show:false,minimized:true, observer:null as unknown as Observer}
        }
    }


    /**
     * Gets complete display properties for rendering the route ride UI.
     *
     * Assembles all display data including position, route, markers, elevation scales,
     * overlay states, and nearby rides. Handles route-specific configuration like loop
     * routes and custom start/end positions.
     *
     * @param props - Current ride display properties controlling visibility and layout
     * @returns Complete route display properties for UI rendering
     */
    getDisplayProperties(props: CurrentRideDisplayProps):RouteDisplayProps {


        const {realityFactor,startPos,endPos, loopOverwrite=false} = this.startSettings
        const parent = super.getDisplayProperties(props)
        const map = this.getOverlayProps('map',props)
        const upcomingElevation = this.getOverlayProps('slope',props)
        const totalElevation = this.getOverlayProps('elevation',props)
        const nearbyRides = this.getNearbyRidesProps(props)

        const [C,U] = this.getUnitConversionShortcuts()

        const isLoop = this.currentRoute?.description?.isLoop
        const xScale:FormattedNumber = { value: C( 1,'distance', {from:'m'}), unit:U('distance') }
        const yScale:FormattedNumber = { value: C( 1,'elevation', {from:'m'}), unit:U('elevation') }

        const mapStartPos = ( isLoop&& !loopOverwrite)  ? undefined : startPos

        return {
            ...parent,
            position: this.position,
            markers: this.getMarkers(props),
            sideViews: this.sideViews,
            route: this.getCurrentRoute(),
            realityFactor,
            startPos:mapStartPos??0,
            endPos,
            nearbyRides,
            xScale,yScale,
            map,upcomingElevation, totalElevation,

        }
    }

    /**
     * Gets screenshot metadata for capturing the current route state.
     *
     * Creates metadata including the current position on the route, filename, and timestamp
     * for saving screenshots during the ride.
     *
     * @param fileName - Name of the screenshot file to be created
     * @param time - Ride time in milliseconds when the screenshot was taken
     * @returns Screenshot information with position data and metadata
     */
    getScreenshotInfo(fileName: string, time: number):ScreenShotInfo {
        const {lat,lng,routeDistance,elevation} = this.position??{}
        const position = this.position===undefined ? undefined : {lat,lng,routeDistance,elevation} as RoutePoint
        return {fileName, position, time}
    }


    /**
     * Gets the position information at a specific distance along the route.
     *
     * Calculates geographic coordinates, heading, and lap-relative distance for any
     * point on the route. Useful for previewing route positions or finding coordinates
     * at specific distances.
     *
     * @param distance - Total distance in meters from the route start
     * @returns Position object with coordinates, heading, and lap information, or undefined if invalid
     */
    getRoutePosition(distance:number):CurrentPosition|undefined {

        const {route} = this;

        if (route === undefined || distance === undefined) {
            return;
        }

        try {
            let props:GetPositionProps = { distance, nearest: true };

            if (distance === 0) {
                props = { cnt: 0 };
            }

            const pos = getPosition(route, props) as CurrentPosition;
            const totalDistance = route.description?.distance
            if (!totalDistance)
                return

            pos.distance = distance;
            pos.lapDistance = pos.routeDistance%totalDistance;
            pos.heading = getHeading(route,pos);

            return pos;
        }
        /* istanbul ignore catch */
        catch (error) {
            this.logger.logEvent({ message: 'Error', fn: 'setRoutePosition', args: { distance }, error })
        }
    }

    protected initRoute() { 
        this.currentRoute =  this.getRouteList().getSelected().clone()
    }

    protected initView() { /* logic can be defined by subclasses */ }


    protected get route():Route {
        return this.getRouteList().getSelected()
    }

    protected get startSettings():RouteSettings {

        // cache the start settings as they can be changed during the ride, 
        // but might also be deleted when route is finished, but workout continues
        const prev = this._startSettings

        this._startSettings = this.getRouteList().getStartSettings() as RouteSettings ?? prev

        this._startSettings.startPos = this._startSettings.startPos??0
        this._startSettings.realityFactor = this._startSettings.realityFactor??100

        return this._startSettings
    }

    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest { 
        const request = this._buildRequest(props)
        return request!

    }
    protected _buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest|undefined {
        if (this.isStopped)
            return

        try {
            const mode = this.getDeviceRide().getCyclingMode() as CyclingMode
            const isSIM = mode?.isSIM() 

            const realityFactor = this.startSettings?.realityFactor ?? 100
            const targetSlope = (this.position?.slope ?? 0) * realityFactor / 100

            if (props?.limits && !isSIM) {
                delete this.prevRequestSlope
                return {...props?.limits, slope:targetSlope}
            }

            else {
                const request:UpdateRequest = {slope:targetSlope} //(hasSlopeChanged||props?.reset) ?  : {refresh:true}

                this.prevRequestSlope = targetSlope
                return request
            }
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'buildRequest')
            return {}
        }

    }


    protected setInitialPosition():CurrentPosition {
        try {
            const lapPoint =  getNextPosition (this.getCurrentRoute(), {routeDistance:this.startSettings?.startPos??0})
            return this.fromLapPoint(lapPoint)
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'setInitialPosition',{cntPoints:this.getCurrentRoute()?.points?.length,routeDistance:this.startSettings?.startPos??0 })
        }
    }

    protected  updatePosition(activityPos:ActivityUpdate): CurrentPosition {

        let currentRouteDistance
        let newRouteDistance
        let props
        try {
            currentRouteDistance = this.position?.routeDistance ?? 0;
            newRouteDistance = activityPos?.routeDistance ?? 0;

            if (newRouteDistance !== currentRouteDistance) {
                const current = this.toLapPoint(this.position)
                props = {routeDistance:activityPos?.routeDistance,prev: current}
                const next = getNextPosition(this.getCurrentRoute(),props)
                this.position = this.fromLapPoint(next)                
            }

            return this.position        
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'updatePosition',{currentRouteDistance, newRouteDistance, getNextPositionProps:props})
        }
    }


    protected toLapPoint(position:CurrentPosition):LapPoint {
        if (!position)
            return;

        const totalDistance = position.routeDistance
        const routeDistance = position.lapDistance??position.routeDistance%this.getCurrentRoute().description.distance

        // point needs to be cloned otherwise the route points are modified
        const lapPoint =  clone({...position, totalDistance, routeDistance})
        delete lapPoint.lapDistance
        return lapPoint
    }

    protected fromLapPoint(position:LapPoint):CurrentPosition {
        if (!position)
            return;

        const routeDistance = position.totalDistance??0       
        const lapDistance = position.routeDistance ?? (position.totalDistance??0)%this.getCurrentRoute().description.distance

        const lap = position.lap??1

        // point needs to be cloned otherwise the route points are modified
        const currentPosition =  clone({ ...position, lap,routeDistance,lapDistance})
        delete currentPosition.totalDistance
        return currentPosition
    }

    protected isLoop():boolean {
        return this.getOriginalRoute()?.description?.isLoop
    }

    protected checkIsRouteFinished(position:CurrentPosition): boolean {
        if (this.isLoop() && !this.startSettings?.loopOverwrite) 
            return false

        if (this.startSettings.endPos!==undefined && position.routeDistance>this.startSettings.endPos)
            return true;
        
        const totalDistance = this.getCurrentRoute().description.distance   
        if (totalDistance===undefined)
            return false

        const finished =  position.routeDistance >= totalDistance
        return finished
    }

    protected onRideFinished() {
        this.logEvent({message: 'Route completed'})
        this.savePosition(0)
        this.emit('route-completed')
    }

    

    protected checkFinishOptions(position:CurrentPosition):boolean {

        const finished = this.checkIsRouteFinished(position)
        if (finished) {
            this.onRideFinished()
        }
        
        return finished
    }

    protected prepareActiveRides() {
        const session = this.getAppInfo().session

        try {
            const observer = this.getActiveRides().init( session)

            observer.on('update',(data)=>{
                 this.nearbyRiders = data.filter( ar=>!ar.isUser)
            })
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'prepareActiveRides')
        }
    }

    cleanupActiveRides() {
        try {
            this.getActiveRides().stop()
        }
        /* istanbul ignore catch */
        catch(err:any) {
            this.logError(err,'cleanupActiveRides')
        }

    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected savePosition(_startPos?:number) {
        // should be implemented by sub classes, as location is ride mode specific
    }

    /**
     * Gets the original selected route from the route list.
     *
     * Returns the unmodified route selected by the user, as opposed to the cached
     * current route which may be a clone used during ride tracking.
     *
     * @returns The selected route from the route list
     */
    getOriginalRoute():Route {
        return this.route
    }

    /**
     * Gets the current route being used for ride tracking.
     *
     * Returns the cached route clone that was initialized during service setup.
     * This is the route used for position tracking and display calculations.
     *
     * @returns The current route object with all point and metadata information
     */
    getCurrentRoute():Route {
        return this.currentRoute
    }
    



    /* istanbul ignore next */
    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    /* istanbul ignore next */
    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    /* istanbul ignore next */
    @Injectable
    protected getActiveRides() {
        return useActiveRides()
    }

    /* istanbul ignore next */
    @Injectable
    protected getDeviceRide() {
        return useDeviceRide()
    }

    /* istanbul ignore next */
    @Injectable
    protected getAppInfo() {
        return getBindings().appInfo
    }

    /* istanbul ignore next */
    protected getUnitConversionShortcuts () {
        return getUnitConversionShortcuts()
    }

    /* istanbul ignore next */
    @Injectable
    protected getUnitConverter() {
        return useUnitConverter()
    }


}
