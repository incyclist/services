import { ActiveRidesService, ActivityRideService, useActivityRide } from "../../activities";
import { Injectable } from "../../base/decorators";
import { FreeRideService, useFreeRideService } from "../../routes/free-ride";
import { concatPaths } from "../../maps/MapArea/utils";
import { getTotalDistance, validateRoute } from "../../routes";
import { RouteApiDetail } from "../../routes/base/api/types";
import { Route } from "../../routes/base/model/route";
import { RouteInfo, RoutePoint } from "../../routes/base/types";
import {  FreeRideOption, FreeRideStartSettings } from "../../routes/list/types";
import { distanceBetween, LatLng } from "../../utils/geo";
import { CurrentPosition, CurrentRideDisplayProps, FreeRideDisplayProps, GpxDisplayProps } from "../base";
import { GpxDisplayService } from "./GpxDisplayService";

export class FreeRideDisplayService extends GpxDisplayService {

    protected currentOptions: FreeRideOption[]
    protected initialPosition: LatLng
    protected isStarting: boolean = false
    protected isUpdating: boolean = false


    protected get route():Route {
        return this.currentRoute
    }


    getDisplayProperties(props:CurrentRideDisplayProps):FreeRideDisplayProps {
        let routeProps:GpxDisplayProps = super.getDisplayProperties(props)


        return {
            ...routeProps,
            route:this.currentRoute,
            options: this.currentOptions,
            upcomingElevation: {show:false},
            totalElevation: {show:false},
        }    
    }

    getLogProps(): object {

        const rideView = this.getUserSettings().get('preferences.rideView',undefined)??'sv(default)'
        const bikeProps = this.getBikeLogProps()
        const {lat,lng} = this.initialPosition

        const props =  {
            mode:'free ride',
            rideView,
            lat,lng,
            ...bikeProps
        }
        
        return props
    }


    start() {
        super.start()

        console.log('# FreeRideDisplayService start')

        this.isStarting = true
        const startSettings = this.getRouteList().getStartSettings() as FreeRideStartSettings
        this.getFreeRideService().applyOption(startSettings.option)

        this.getNextOptions(true)
    }

    isStartRideCompleted(): boolean {
        return this.currentOptions!==undefined
    }

    continueWithSelectedOption():boolean { 
        if (this.isUpdating)
            return;

        
        const freeRide = this.getFreeRideService()
        const selectedOption = freeRide.getSelectedOption()

        // no option available
        if (!selectedOption?.path?.length) {
            this.turnAround()
            return;
        }
    
        const finished = this.updateRouteWithSelectedOption()
        freeRide.applyOption(selectedOption)

        this.currentOptions = undefined

        if (!finished)
            this.getNextOptions()
        return finished
    }



    protected initRoute() {
        try {
            console.log('# Display: initRoute',this.getRouteList().getStartSettings() )

            const {position,option} = this.getRouteList().getStartSettings() as FreeRideStartSettings

            this.currentRoute = this.createRoute(position,option)
            this.initialPosition = position
            this.currentOptions = undefined

            
        }
        catch(err) {
            this.logError(err,'init')
        }
    }

    protected checkFinishOptions(position:CurrentPosition):boolean {

        let finished = false
        const segmentCompleted = this.checkIsRouteFinished(position)
        if (segmentCompleted) {

            console.log('#  Display: segment finsished' )

            finished = this.continueWithSelectedOption()
        }
        
        // free rides never finish
        return finished
    }


    protected createRoute( position:LatLng,option:FreeRideOption):Route {
        try{

            let routeDistance:number
            
            let pPrev;
            const points:RoutePoint[] = option.path.map( (p,idx)=> {
                const distance = idx===0 ? 0 : (p.distance?? distanceBetween(pPrev,p))
                routeDistance  = idx===0 ? 0 : routeDistance+distance;            
                pPrev = p
                return {lat:p.lat,lng:p.lng,distance:distance??0,routeDistance, elevation:0}
            } )

            const uuid = this.getUserSettings().get('uuid','')

            const details: RouteApiDetail = {
                id: `Free-Ride:${uuid}:${Date.now()}`,
                title: 'Free Ride',
                routeHash: `Free-Ride:${uuid}:${Date.now()}`,
                points
            }
            const desription: RouteInfo = {
                id: `Free-Ride:${uuid}:${Date.now()}`,
                title: 'Free Ride',
                routeHash: `Free-Ride:${uuid}:${Date.now()}`,
                points,
                hasGpx:true,
                hasVideo: false,
                isLoop: false


            }
            const route =  new Route( desription,details)
            validateRoute(route)        

            route.description.distance = route.details.distance = getTotalDistance(details)
            route.updateCountryFromPoints()

            return route
        }
        catch(err) {
            console.log('# error',err)
        }        

    }

    protected turnAround() {
        // TODO: implement
    }

    protected updateRouteWithSelectedOption ():boolean {
        
        try {
            this.isUpdating = true

            console.log(new Date().toISOString(),'# Display:  update route')
            const selected = this.getFreeRideService().getSelectedOption()       
            
            concatPaths( this.currentRoute.points, selected.path,'after' )

            // enforce re-calculation of route distance and verify new path
            this.currentRoute.points.forEach( p => {delete p.routeDistance} )
            validateRoute(this.currentRoute)

            this.service.onRouteUpdated(this.currentRoute)
            console.log(new Date().toISOString(),'# Display:  update route done')
        }
        catch(err) {
            console.log(new Date().toISOString(),'# error',err)  
            this.logError(err,'updateRouteWithSelectedOption')
        }
        this.isUpdating = false
        return false
    }

    protected selectOption(option:FreeRideOption) { 
        this.getFreeRideService().selectOption(option)
    }

    protected getNextOptions(forStart?:boolean) {

        console.log(new Date().toISOString(),'# Display: looking for next options')

        const freeRide = this.getFreeRideService()

        freeRide.getNextOptions(forStart).then( (options) => { 

            console.log(new Date().toISOString(),'# Display:  got options',options)    
            this.currentOptions = options


            if (this.isStarting) {
                this.emit('state-update')
                this.isStarting = false    
            }
            else {
                console.log( new Date().toISOString(),'# Display emitting route update')
                this.service.getObserver().emit('route-update',{route:this.currentRoute,options})
            }

            
        }) 
    }



    @Injectable
    getFreeRideService(): FreeRideService { 
        return useFreeRideService()
    }

    @Injectable
    getActivityRide(): ActivityRideService {
        return useActivityRide()
    }
    




    


    
}
