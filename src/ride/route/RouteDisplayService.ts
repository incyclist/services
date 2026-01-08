import { CyclingMode, UpdateRequest } from "incyclist-devices";
import { ActiveWorkoutLimit } from "../../workouts";
import { RideModeService } from "../base/base";
import { CurrentPosition, CurrentRideDisplayProps, ICurrentRideService, NearbyDisplayProps, OverlayDisplayProps, RouteDisplayProps, RouteMarker, SideViewsShown } from "../base";
import { Injectable } from "../../base/decorators";
import { useUserSettings } from "../../settings";
import { getHeading, getNextPosition, getPosition, GetPositionProps, LapPoint, useRouteList } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { RouteSettings } from "../../routes/list/cards/RouteCard";
import { ActiveRideListDisplayItem, ScreenShotInfo, useActiveRides } from "../../activities";
import { getBindings } from "../../api";
import { ActivityUpdate } from "../../activities/ride/types";
import clone from "../../utils/clone";
import { useDeviceRide } from "../../devices";

const MAX_INACTIVITY = 5000

export class RouteDisplayService extends RideModeService {
    protected prevRequestSlope: number

    protected position: CurrentPosition    
    protected sideViews: SideViewsShown
    protected currentRoute: Route

    protected hasNearbyRides: boolean  = false 
    protected prevRequestedSlope:undefined = undefined
    protected prevPowerTs: number

    protected nearbyRiders: ActiveRideListDisplayItem[]
    protected _startSettings: RouteSettings



    init(service: ICurrentRideService) {
        try {
            super.init(service)

            this.initRoute()
            this.initView()


            this.position =  this.setInitialPosition()
            
        }
        catch(err) {
            this.logError(err,'init')
        }
    }



    getDeviceStartSettings() {
        const startSettings:RouteSettings = this.getRouteList().getStartSettings() as RouteSettings
        const route = this.getRouteList().getSelected() 
        const {realityFactor,startPos} = startSettings

        return {realityFactor,startPos,route}
    }

    
    onActivityUpdate(activityPos:ActivityUpdate,data):void { 

        if (data.power>0)
            this.prevPowerTs = Date.now()

        if (data.power===0 && (data.speed===0 ||  data.speed<5 && (Date.now()-(this.prevPowerTs??0))>MAX_INACTIVITY)) {
            this.service.pause('device')
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
        catch(err) {
            this.logError(err,'onActivityUpdate')
        }



        super.onActivityUpdate(activityPos,data)
    }

    protected onPositionUpdate(state) {

    }

    onRideSettingsChanged(settings) {
        try {
            const {reality} = settings

            this.startSettings.realityFactor = reality
           

        }
        catch(err) {
            this.logError(err,'onRideSettingsChanged')
        }
    }

    onStarted() {
        try {
            this.prepareActiveRides()
            this.sendUpdate(this.buildRequest())
            
        }
        catch(err) {
            this.logError(err,'onStarted')
        }

    }

    onStopped() {
        try {
            this.cleanupActiveRides()
            delete this._startSettings
        }
        catch(err) {
            this.logError(err,'onStopped')
        }
    }

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
        return markers
    }

    getOverlayProps(overlay, props: CurrentRideDisplayProps):OverlayDisplayProps {
        const showMapEnabled = this.getUserSettings().get(`preferences.sideViews.${overlay}` ,true)
        const show = !props.hideAll 
        const minimized = !showMapEnabled
        return {show,minimized}
    }

    getNearbyRidesProps(props: CurrentRideDisplayProps):NearbyDisplayProps { 
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


    getDisplayProperties(props: CurrentRideDisplayProps):RouteDisplayProps {

        
        const {realityFactor,startPos,endPos} = this.startSettings
        const parent = super.getDisplayProperties(props)
        const map = this.getOverlayProps('map',props)
        const upcomingElevation = this.getOverlayProps('slope',props)
        const totalElevation = this.getOverlayProps('elevation',props)
        const nearbyRides = this.getNearbyRidesProps(props)


        return {
            ...parent,
            position: this.position,markers: this.getMarkers(props),
            sideViews: this.sideViews,
            route: this.getCurrentRoute(),
            realityFactor,
            startPos,endPos,
            nearbyRides,
            map,upcomingElevation, totalElevation,
            
        }    
    }

    getScreenshotInfo(fileName: string, time: number):ScreenShotInfo {
        const {lat,lng,routeDistance,elevation} = this.position
        const position = {lat,lng,routeDistance,elevation}
        return {fileName, position, time}        
    }


    getRoutePosition(distance:number):CurrentPosition {

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

            pos.distance = distance;
            pos.lapDistance = pos.routeDistance%route.description.distance;
            pos.heading = getHeading(route,pos);
            
            return pos;
        }
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

        return this._startSettings
    }

    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest { 
        const request = this._buildRequest(props)
        return request

    }
    protected _buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest {
        if (this.isStopped)
            return

        try {
            const mode = this.getDeviceRide().getCyclingMode() as CyclingMode
            const isSIM = mode?.isSIM() 

            const realityFactor = this.startSettings?.realityFactor ?? 100
            const targetSlope = (this.position.slope ?? 0) * realityFactor / 100

            if (props?.limits && !isSIM) {
                delete this.prevRequestSlope
                return {...props?.limits, slope:targetSlope}
            }

            else {
                //const hasSlopeChanged = this.prevRequestSlope===undefined || (this.prevRequestSlope !== this.position.slope)
                const request:UpdateRequest = {slope:targetSlope} //(hasSlopeChanged||props?.reset) ?  : {refresh:true}

                this.prevRequestSlope = targetSlope
                return request
            }
        }
        catch(err) {
            this.logError(err,'buildRequest')        
            return {}
        }

    }


    protected setInitialPosition():CurrentPosition {
        try {
            const lapPoint =  getNextPosition (this.getCurrentRoute(), {routeDistance:this.startSettings?.startPos??0})
            return this.fromLapPoint(lapPoint)
        }
        catch(err) {
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
        catch(err) {
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
        
        const finished =  position.routeDistance >= this.getCurrentRoute().description.distance   
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
        catch(err) {
            this.logError(err,'prepareActiveRides')
        }
    }

    cleanupActiveRides() {
        try {
            this.getActiveRides().stop()
        }
        catch(err) {
            this.logError(err,'cleanupActiveRides')
        }

    }

    protected savePosition(startPos?:number) {
        // should be implemented by sub classes, as location is ride mode specific
    }

    getOriginalRoute():Route {
        return this.route
    }

    getCurrentRoute():Route {
        return this.currentRoute
    }
    



    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getActiveRides() {
        return useActiveRides()
    }

    @Injectable
    protected getDeviceRide() {
        return useDeviceRide() 
    }

    @Injectable
    protected getAppInfo() {
        return getBindings().appInfo    
    }


}
