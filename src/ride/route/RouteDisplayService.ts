import {  DeviceData, UpdateRequest } from "incyclist-devices";
import { ActiveWorkoutLimit } from "../../workouts";
import { RideModeService } from "../base/base";
import { CurrentPosition, ICurrentRideService, RouteDisplayProps, SideViewsShown } from "../base";
import { Injectable } from "../../base/decorators";
import { useUserSettings } from "../../settings";
import { getHeading, getNextPosition, GetNextPositionProps, getPosition, GetPositionProps, LapPoint, useRouteList } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { RouteSettings } from "../../routes/list/cards/RouteCard";
import { ScreenShotInfo } from "../../activities";

export class RouteDisplayService extends RideModeService {
    protected prevRequestSlope: number

    protected position: CurrentPosition    
    protected sideViews: SideViewsShown
    


    init(service: ICurrentRideService) {
        try {
            super.init(service)

            this.position =  this.setInitialPosition()
        }
        catch(err) {
            this.logError(err,'init')
        }
    }

    onActivityUpdate(data: any, request?: ActiveWorkoutLimit): UpdateRequest {
        try {
            const newSlope = this.position?.slope ?? undefined; // should convert null to undefined

            const update:UpdateRequest = {...(request??{})}
            if (newSlope !== undefined && newSlope !== this.prevRequestSlope) {
                update.slope = newSlope;
            }
            this.prevRequestSlope = this.position?.slope
            return update
        }
        catch(err) {
            this.logError(err,'onActivityUpdate')
        }
    }

    onDeviceData(data: DeviceData, udid: string): void {
        try {
            const newPosition = this.updatePosition(data);

            const isCompleted = this.checkFinishOptions(newPosition)
            if (!isCompleted) {
                const prevPosition = this.position
    
                this.position = newPosition
                this.observer.emit('position-update', this.service.getDisplayProperties())           
    
                if (this.position.lap !== prevPosition.lap) {
                    this.emit('lap-completed',prevPosition.lap,this.position.lap)
                }        
            }
    
        }
        catch(err) {
            this.logError(err,'onDeviceData')
        }

    }


    getDisplayProperties():RouteDisplayProps {

        const {realityFactor,startPos,endPos} = this.startSettings as RouteSettings
        
        return {
            position: this.position,
            sideViews: this.sideViews,
            route: this.route,
            realityFactor,
            startPos,endPos,
            
            
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

    protected setInitialPosition():CurrentPosition {
        const lapPoint =  getNextPosition (this.route, {routeDistance:this.startSettings.startPos??0})
        return this.fromLapPoint(lapPoint)
    }

    protected  updatePosition(data: DeviceData): CurrentPosition {
        try {
            const currentRouteDistance = this.position.routeDistance ?? 0;
            const newRouteDistance = currentRouteDistance + (data.distance??0);

            if (newRouteDistance !== currentRouteDistance) {
                const prev = this.toLapPoint(this.position)
                return  this.fromLapPoint(getNextPosition(this.route,{distance:data.distance,prev}))                
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

        const lapPoint =  {...position, totalDistance, routeDistance}
        delete lapPoint.lapDistance
        return lapPoint
    }

    protected fromLapPoint(position:LapPoint):CurrentPosition {
        const totalDistance = position.routeDistance
        const routeDistance = position.totalDistance??0
        const lapDistance = position.routeDistance ?? (position.totalDistance??0)%this.route.description.distance
        const lap = position.lap??1

        const currentPosition =  { ...position, lap,routeDistance,lapDistance}
        delete currentPosition.totalDistance
        return currentPosition
    }

    protected isLoop():boolean {
        return this.route?.description?.isLoop
    }

    protected checkIsRouteFinished(position:CurrentPosition): boolean {
        if (this.isLoop() && !this.startSettings?.loopOverwrite) 
            return false
        
        return position.routeDistance >= this.route.description.distance        
    }

    protected onRideFinished() {
        this.emit('route-completed')
    }

    protected checkFinishOptions(position:CurrentPosition):boolean {

        const finished = this.checkIsRouteFinished(position)
        if (finished) {
            this.onRideFinished()
        }
        
        return finished
    }


    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }


}
