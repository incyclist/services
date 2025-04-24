import {  DeviceData, UpdateRequest } from "incyclist-devices";
import { ActiveWorkoutLimit } from "../../workouts";
import { RideModeService } from "../base/base";
import { CurrentPosition, CurrentRideDisplayProps, ICurrentRideService, RouteDisplayProps, SideViewsShown } from "../base";
import { Injectable } from "../../base/decorators";
import { useUserSettings } from "../../settings";
import { getHeading, getNextPosition, getPosition, GetPositionProps, LapPoint, useRouteList } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { RouteSettings } from "../../routes/list/cards/RouteCard";
import { ScreenShotInfo, useActiveRides } from "../../activities";
import { getBindings } from "../../api";
import { ActivityUpdate } from "../../activities/ride/types";
import clone from "../../utils/clone";
import { useDeviceRide } from "../../devices";

const MAX_INACTIVITY = 5000

export class RouteDisplayService extends RideModeService {
    protected prevRequestSlope: number

    protected position: CurrentPosition    
    protected sideViews: SideViewsShown

    protected hasNearbyRides: boolean  = false 
    protected prevRequestedSlope:undefined = undefined
    protected prevPowerTs: number


    init(service: ICurrentRideService) {
        try {
            super.init(service)

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
            const newPosition = this.updatePosition(activityPos);

            const isCompleted = this.checkFinishOptions(newPosition)
            if (!isCompleted) {
                const prevPosition = this.position
    
                this.position = newPosition

                const {lat,lng,routeDistance,lap} = newPosition
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
            this.logError(err,'onDeviceData')
        }



        super.onActivityUpdate(activityPos,data)
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
        }
        catch(err) {
            this.logError(err,'onStopped')
        }
    }


    getDisplayProperties(props: CurrentRideDisplayProps):RouteDisplayProps {

        
        const {realityFactor,startPos,endPos} = this.startSettings
        
        const hasNearbyRides  = this.getActiveRides().get()?.length > 0
        const showNearbyRides = hasNearbyRides && this.getUserSettings().get('preferences.sideViews.nearby-rides',true)
        const nearbyRides = this.getActiveRides().getObserver()

        if (this.hasNearbyRides !== hasNearbyRides) {
            this.hasNearbyRides = hasNearbyRides
            this.service.getObserver().emit('nearby-rides-update', {showNearbyRides, nearbyRides})
        }
        const showMapEnabled = this.getUserSettings().get('preferences.sideViews.map',true)
        const showMap = !props.hideAll 
        const minimizeMap = showMap && !showMapEnabled

        const showUpcomingElevationEnabled = this.getUserSettings().get('preferences.sideViews.slope',true)
        const showUpcomingElevation = !props.hideAll 
        const minimizeUpcomingElevation = showUpcomingElevation && !showUpcomingElevationEnabled

        const showTotalElevationEnabled = this.getUserSettings().get('preferences.sideViews.elevation',true)
        const showTotalElevation = !props.hideAll 
        const minimizeTotalElevation = showTotalElevation && !showTotalElevationEnabled

        return {
            position: this.position,
            sideViews: this.sideViews,
            route: this.route,
            realityFactor,
            startPos,endPos,
            showNearbyRides,nearbyRides,
            showMap,minimizeMap,
            showUpcomingElevation,minimizeUpcomingElevation,
            showTotalElevation,minimizeTotalElevation,
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

    protected get route():Route {
        return this.getRouteList().getSelected()
    }

    protected get startSettings():RouteSettings {
        return this.getRouteList().getStartSettings() as RouteSettings
    }

    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest { 
        const request = this._buildRequest(props)
        return request

    }
    protected _buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest {


        try {
            const mode = this.getDeviceRide().getCyclingMode()
            const isSIM = mode?.isSIM()

            const realityFactor = this.startSettings.realityFactor ?? 100
            const targetSlope = (this.position.slope ?? 0) * realityFactor / 100

            if (props?.limits && !isSIM) {
                delete this.prevRequestSlope
                return {...props?.limits, slope:targetSlope}
            }

            else {

                const hasSlopeChanged = this.prevRequestSlope===undefined || (this.prevRequestSlope !== this.position.slope)
                const request:UpdateRequest = (hasSlopeChanged||props?.reset) ? {slope:targetSlope} : {}

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
        const lapPoint =  getNextPosition (this.route, {routeDistance:this.startSettings.startPos??0})
        return this.fromLapPoint(lapPoint)
    }

    protected  updatePosition(activityPos:ActivityUpdate): CurrentPosition {
        try {
            const currentRouteDistance = this.position.routeDistance ?? 0;
            const newRouteDistance = activityPos.routeDistance ?? 0;

            if (newRouteDistance !== currentRouteDistance) {
                const prev = this.toLapPoint(this.position)
                return  this.fromLapPoint(getNextPosition(this.route,{routeDistance:activityPos.routeDistance,prev}))                
            }

            return this.position        
        }
        catch(err) {
            this.logError(err,'updatePosition')
        }
    }


    protected toLapPoint(position:CurrentPosition):LapPoint {
        const totalDistance = position.routeDistance
        const routeDistance = position.lapDistance??position.routeDistance%this.route.description.distance

        // point needs to be cloned otherwise the route points are modified
        const lapPoint =  clone({...position, totalDistance, routeDistance})
        delete lapPoint.lapDistance
        return lapPoint
    }

    protected fromLapPoint(position:LapPoint):CurrentPosition {
        const routeDistance = position.totalDistance??0       
        const lapDistance = position.routeDistance ?? (position.totalDistance??0)%this.route.description.distance

        const lap = position.lap??1

        // point needs to be cloned otherwise the route points are modified
        const currentPosition =  clone({ ...position, lap,routeDistance,lapDistance})
        delete currentPosition.totalDistance
        return currentPosition
    }

    protected isLoop():boolean {
        return this.route?.description?.isLoop
    }

    protected checkIsRouteFinished(position:CurrentPosition): boolean {
        if (this.isLoop() && !this.startSettings?.loopOverwrite) 
            return false
        
        const finished =  position.routeDistance >= this.route.description.distance        
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
            this.getActiveRides().init( session)

            // TODO: update map markers
            // ar.getObserver().on('update',(data)=>{
            //     this.state.activeRidesMapMarkers = data.filter( ar=>!ar.isUser)

            // })
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
        // should be implemented by sub classes, as location is ride mode specifc
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


    protected getAppInfo() {
        return getBindings().appInfo    
    }


}
