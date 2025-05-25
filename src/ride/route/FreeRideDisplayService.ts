import { ActivityRideService, useActivityRide } from "../../activities";
import { Injectable } from "../../base/decorators";
import { FreeRideService, useFreeRideService } from "../../routes/free-ride";
import { concatPaths } from "../../maps/MapArea/utils";
import { getTotalDistance, validateRoute } from "../../routes";
import { RouteApiDetail } from "../../routes/base/api/types";
import { Route } from "../../routes/base/model/route";
import { RouteInfo, RoutePoint } from "../../routes/base/types";
import {  FreeRideOption, FreeRideStartSettings } from "../../routes/list/types";
import { distanceBetween, LatLng } from "../../utils/geo";
import { CurrentPosition, CurrentRideDisplayProps, FreeRideDisplayProps, GpxDisplayProps, MapOverlayDisplayProps  } from "../base";
import { GpxDisplayService } from "./GpxDisplayService";
import { FreeRideContinuation } from "../../maps/MapArea/types";
import { MapViewPort } from "./types";

const DEFAULT_OPTIONS_DELAY = 5000
export class FreeRideDisplayService extends GpxDisplayService {

    protected initialPosition: LatLng
    protected isStarting: boolean = false
    protected isUpdating: boolean = false

    protected viewportRide: MapViewPort
    protected viewportPreview: MapViewPort
    protected prevViewport: MapViewPort
    protected tsLastOptionChange:number
    protected optionsVisible: boolean
    protected mapProps:MapOverlayDisplayProps

    protected onViewportChange? = this.saveViewport.bind(this)
    protected onOptionsVisibleChangedHandler? = this.onOptionsVisibleChanged.bind(this)


    protected get route():Route {
        return this.currentRoute
    }

    protected get currentOptions():FreeRideContinuation[]|undefined {
        return this.getFreeRideService().getOptions()        
    }


    getDisplayProperties(props:CurrentRideDisplayProps):FreeRideDisplayProps {
        let routeProps:GpxDisplayProps = super.getDisplayProperties(props)
        const options = this.getFreeRideService().buildUIOptions(this.currentOptions??[])


        return {
            ...routeProps,
            route:this.currentRoute,
            options,
            onOptionsVisibleChanged: this.onOptionsVisibleChangedHandler,
            optionsDelay: DEFAULT_OPTIONS_DELAY,
            optionsId: this.getOptionsId(),
            upcomingElevation: {show:false},
            totalElevation: {show:false},
        }    
    }

    getOverlayProps(overlay, props: CurrentRideDisplayProps):MapOverlayDisplayProps {
        const overlayProps:MapOverlayDisplayProps = super.getOverlayProps(overlay,props)

        if ( overlay==='map') {
            const mapProps = this.getMapProps()
            this.mapProps = {...overlayProps,...mapProps }
            return this.mapProps
        }
        return overlayProps
    }

    protected getOptionsId() {
        return 'options:'+this.currentOptions.map( o => o.id ).join('|')

    }

    protected getMapProps() {
        const prev = this.prevViewport
        const viewport = this.getViewport()
        const current = this.mapProps??{}

        return {
            ...current, 
            viewport,
            viewportOverwrite:viewport!==prev,
            onViewportChange: this.onViewportChange,
            
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

    saveViewport(viewport:MapViewPort) {
        if (Date.now()-this.tsLastOptionChange>DEFAULT_OPTIONS_DELAY)
            this.viewportRide = viewport
        else 
            this.viewportPreview = viewport
    }


    start() {
        super.start()

        console.log('# FreeRideDisplayService start')

        this.isStarting = true
        const startSettings = this.getRouteList().getStartSettings() as FreeRideStartSettings
        this.getFreeRideService().applyStartOption(startSettings.option)

        this.tsLastOptionChange = Date.now()
        delete this.viewportPreview // force UI to 

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
        this.tsLastOptionChange = Date.now()

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
        this.getFreeRideService().turnAround()
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

    selectOption(option:FreeRideOption|string) { 
        this.getFreeRideService().selectOption(option)
        return this.getFreeRideService().buildUIOptions(this.currentOptions)
    }

    protected getNextOptions(forStart?:boolean) {

        console.log(new Date().toISOString(),'# Display: looking for next options')

        const freeRide = this.getFreeRideService()

        freeRide.getNextOptions(forStart).then( () => { 

            console.log(new Date().toISOString(),'# Display:  got options',this.currentOptions)    
            


            if (this.isStarting) {
                this.isStarting = false    
                this.emit('state-update')
            }
            else {
                this.emitRouteUpdate()
            }

            
        }) 
    }



    protected getViewport():MapViewPort {
        const viewport = Date.now()-this.tsLastOptionChange>DEFAULT_OPTIONS_DELAY ? this.viewportRide : this.viewportPreview
        this.prevViewport = viewport
        return viewport

    }

    protected onOptionsVisibleChanged(visible) {
        console.log('# options visible changed',visible)

        const prev = this.optionsVisible
        this.optionsVisible = visible
        if (visible && !prev) {
            this.tsLastOptionChange = Date.now()
        }

    }

    protected emitRouteUpdate() {

        const options = this.getFreeRideService().buildUIOptions(this.currentOptions)
        const map = this.getMapProps()

        this.service.getObserver().emit('route-update',{route:this.currentRoute,options,map})

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
