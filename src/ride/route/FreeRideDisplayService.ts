import { ActivityRideService, useActivityRide } from "../../activities";
import { Injectable } from "../../base/decorators";
import { FreeRideService, useFreeRideService } from "../../routes/free-ride";
import { concatPaths, isOneWay } from "../../maps/MapArea/utils";
import { addDetails, getNextPosition, getTotalDistance, validateRoute } from "../../routes";
import { RouteApiDetail } from "../../routes/base/api/types";
import { Route } from "../../routes/base/model/route";
import { RouteInfo, RoutePoint } from "../../routes/base/types";
import {  FreeRideOption, FreeRideStartSettings } from "../../routes/list/types";
import { distanceBetween, LatLng } from "../../utils/geo";
import { CurrentPosition, CurrentRideDisplayProps, FreeRideDisplayProps, GpxDisplayProps, MapOverlayDisplayProps  } from "../base";
import { GpxDisplayService } from "./GpxDisplayService";
import { FreeRideContinuation, IncyclistNode } from "../../maps/MapArea/types";
import { MapViewPort } from "./types";
import { ActivityUpdate } from "../../activities/ride/types";
import { waitNextTick } from "../../utils";


const pathInfo = (path) => {
    return path.map(p => {
        const pp = p as IncyclistNode & RoutePoint
        const id = pp.id??'{lat:'+Number(p.lat).toFixed(4)+',lng:'+Number(p.lng).toFixed(4)+'}'
        return `${p.cnt},${p.routeDistance.toFixed(0)},${id})`
    })    
}

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
    protected distanceRemaining: number 
    protected timeRemaining: number 
    protected isNearbyOption: boolean = false
    protected isTurnEnabled: boolean = false
    protected turnPosition: IncyclistNode|RoutePoint
    protected currentRideDisplayProps: CurrentRideDisplayProps
    protected tsLastTurn

    protected onViewportChange? = this.saveViewport.bind(this)
    protected onOptionsVisibleChangedHandler? = this.onOptionsVisibleChanged.bind(this)
    protected onTurnHandler? = this.onTurn.bind(this)



    start() {
        try {
            super.start()
            this.initListeners()

            this.isStarting = true
            this.isTurnEnabled = false;
            const startSettings = this.getRouteList().getStartSettings() as FreeRideStartSettings
            this.getFreeRideService().applyStartOption(startSettings.option)

            this.tsLastOptionChange = Date.now()
            delete this.viewportPreview // force UI to 

            this.getNextOptions(true)
        }
        catch(err) {
            this.logError(err,'start')
        }
    }

    isStartRideCompleted(): boolean {
        return this.currentOptions!==undefined
    }

    selectOption(option:FreeRideOption|string) { 
        try {
            this.getFreeRideService().selectOption(option)
            return this.getFreeRideService().buildUIOptions(this.currentOptions)
    
        }
        catch(err) {
            this.logError(err,'selectOption')
        }
    }


    continueWithSelectedOption():boolean { 
        try {
            if (this.isUpdating)
                return;
    
            
            const freeRide = this.getFreeRideService()
            const selectedOption = freeRide.getSelectedOption()
    
            
            // no option available
            if (!selectedOption?.path?.length) {
                this.onTurn()
                return;
            }
        
            const finished = this.updateRouteWithSelectedOption()
            freeRide.applyOption(selectedOption)
            delete this.viewportPreview 
    
    
            if (!finished) {
                
                this.getNextOptions().then( ()=>{
                    
                    const currentSegment = this.getFreeRideService().getCurrentSegment()
                    const way = currentSegment?.map?.getWay(currentSegment?.id)                   

                    const turnEnabled = !isOneWay(way)

                    if (turnEnabled) {
                        // wait 5 seconds before enabling turn 
                        setTimeout( () =>{this.isTurnEnabled = turnEnabled} , DEFAULT_OPTIONS_DELAY)
                    }
                    
                })
            }
            return finished
    
        }
        catch(err) {
            this.logError(err,'continueWithSelectedOption')
        }
    }

    protected initListeners() {
        this.cleanupListeners();
        this.getFreeRideService().on('options-update', () => {   
            this.emitOptionsUpdate()
        })
    }

    protected cleanupListeners() {  
        this.getFreeRideService().removeAllListeners('options-update');
    }

    protected async onTurn() {
        this.turnPosition  = this.position
        this.isTurnEnabled = false

        this.tsLastTurn = Date.now()


        if (this.position.routeDistance) {
            const {prevPointIdx,atPoint,found} = this.findPointBeforeOrAtTurn(this.currentRoute?.points);
            const segmentDoneInfo = this.findStartOfCurrentSegment()

            if (found) {

                const {segmentStartIdx} = segmentDoneInfo
                const {lat,lng,routeDistance,elevation} = this.position

                
                // extract current segment from path
                const segmentCompleted = this.route?.points.slice(segmentStartIdx, prevPointIdx + 1);
                if (!atPoint ) {
                    segmentCompleted.push( {lat,lng,routeDistance,elevation} );
                }

                const nextSegmentPath = [...segmentCompleted]
                nextSegmentPath.reverse()
                const turnNode = this.turnPosition as IncyclistNode
                const currentSegment = this.getFreeRideService().getCurrentSegment()
                const segmentId = turnNode?.ways?.length===1 ? turnNode.ways[0] : currentSegment.id
                const nextSegment:FreeRideContinuation = { ...currentSegment, id: segmentId, path: nextSegmentPath, options:undefined }


                // Delete all points from routePath that are after the prevPointIdx
                const pathCompleted = this.route?.points.slice(0, prevPointIdx + 1);

                // If atPoint === true, add turnPosition to routePath
                if (!atPoint ) {
                    pathCompleted.push({lat,lng,routeDistance,elevation} );
                }

                this.updateRoutePoints(this.currentRoute, pathCompleted)
                this.appendOption(this.currentRoute, nextSegment)
                this.getFreeRideService().setCurrentSegment(nextSegment)

                this.optionsVisible = false
                this.emitRouteUpdate()
                await waitNextTick()
               
                await this.getNextOptions()

                this.isTurnEnabled=true
                this.turnPosition = undefined

                //this.logEvent({message:'turn completed', })

                
                
                return;

                //this.route = new Route({points:pathCompleted}
                
            }
            
        }
        else {
            console.log('# FreeRideDisplayService onTurn', this.position, {found:false})
        }

        delete this.turnPosition
        
    }

    protected findStartOfCurrentSegment() {
        const segment = this.getFreeRideService().getCurrentSegment()

        const segmentLength = segment.path.length
        const pathLength = this.route?.points.length

        const segmentStartIdx = pathLength - segmentLength

        return {segmentStartIdx, segmentLength, pathLength}
    }

    
    protected findPointBeforeOrAtTurn(path:RoutePoint[]) {
        let prevPointIdx;
        let atPoint: boolean = false;
        let found = false;
        let idx = path.findIndex(p => p.routeDistance >= this.position.routeDistance);
        if (idx > 0) {

            let point = path[idx];
            atPoint = (point.routeDistance === this.position.routeDistance);
            if (point.routeDistance > this.position.routeDistance) {
                idx--;
            }
            prevPointIdx = idx
            

        }
        found = idx !== -1;
        
        return {prevPointIdx, atPoint, found};
    }

    getDisplayProperties(props:CurrentRideDisplayProps):FreeRideDisplayProps {

        this.currentRideDisplayProps = props ?? this.currentRideDisplayProps

        try {
            let routeProps:GpxDisplayProps = super.getDisplayProperties(props)
            const options = this.getFreeRideService().buildUIOptions(this.currentOptions??[])
            
            const optionProps = {
                onOptionsVisibleChanged: this.onOptionsVisibleChangedHandler,     
                onTurn: this.onTurnHandler,       
                optionsDelay: DEFAULT_OPTIONS_DELAY,            
                optionsId: this.getOptionsId(),
                distance: this.distanceRemaining,
                isNearby: this.isNearbyOption,
                turn: this.isTurnEnabled
            }
    
            return {
                ...routeProps,
                route:this.currentRoute,
                options,
                optionProps,
                upcomingElevation: {show:false},
                totalElevation: {show:false},
            }    
        }
        catch(err) {
            this.logError(err,'getDisplayProperties')
            return props as unknown as  FreeRideDisplayProps
        }
    }

    getOverlayProps(overlay, props?: CurrentRideDisplayProps):MapOverlayDisplayProps {
        try {
            const overlayProps:MapOverlayDisplayProps = super.getOverlayProps(overlay,props??this.currentRideDisplayProps)

            if ( overlay==='map') {
                const mapProps = this.getMapProps()
                this.mapProps = {...overlayProps,...mapProps }
                return this.mapProps
            }
            return overlayProps    
        }
        catch(err) {
            this.logError(err,'getOverlayProps')
            return {} 
        }


    }

    onActivityUpdate(activityPos:ActivityUpdate,data):void { 

        // if we are currently busy with a turn, don't update position
        if (this.turnPosition)
            return

        try {


            super.onActivityUpdate(activityPos, data);

            this.distanceRemaining = data.distanceRemaining*1000
            this.timeRemaining = data.timeRemaining
            this.isNearbyOption = data.timeRemaining<6

            if (this.tsLastTurn) {
                delete this.tsLastTurn
            }

    
        }
        catch(err) {
            this.logError(err,'onActivityUpdate')
        }

    }


    getLogProps(): object {
        try {

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
        catch(err) {
            this.logError(err,'getLogProps')
            return {}
        }
    }


    protected getOptionsId() {
        if (!this.currentOptions?.length)
            return 'none'
        return 'options:'+this.currentOptions.map( o => o.id ).join('|')

    }

    protected getMapProps() {
        const viewport = this.getViewport()
        const viewportOverwrite = true
        const bounds = this.getMapBounds() 
        const center = this.getMapCenter() 

        const props:Partial<MapOverlayDisplayProps>= {
            viewport,
            center,
            bounds,
            viewportOverwrite,
            onViewportChange: this.onViewportChange,
            
        }
        if (this.optionsVisible) {
            props.show = true
        }
        return props

    }


    // this method was created for support until legacy UI code was removed
    protected _createRouteFromPoints(points:RoutePoint[]) {
        const id = 'Free-Ride'
        const title='Free-Ride'
        const details:RouteApiDetail = {
            id,
            title,
            points
        }

        const info:RouteInfo = {id ,title,hasGpx:true}
        
        const route = new Route( info)
        addDetails(route,details)
        validateRoute(route)
        this.currentRoute = route        
    }

    // this method was created for support until legacy UI code was removed
    protected _updateRouteFromPoints(points:RoutePoint[]) { 
            points.forEach( (p,cnt) => {
                p.elevation = 0;
                p.slope = 0;
                p.cnt=cnt
            })

        this.currentRoute.details.points = points
        validateRoute(this.currentRoute)

        this.currentRoute.details.distance = points[points.length-1].routeDistance
        addDetails(this.currentRoute,this.currentRoute.details)


    }

    protected initRoute() {
        try {
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
                return {...p,distance:distance??0,routeDistance, elevation:0}
            } )

            const uuid = this.getUserSettings().get('uuid','')

            const details: RouteApiDetail = {
                id: `Free-Ride:${uuid}:${Date.now()}`,
                title: 'Free Ride',
                routeHash: `Free-Ride:${uuid}:${Date.now()}`,
                points
            }
            const description: RouteInfo = {
                id: `Free-Ride:${uuid}:${Date.now()}`,
                title: 'Free Ride',
                routeHash: `Free-Ride:${uuid}:${Date.now()}`,
                points,
                hasGpx:true,
                hasVideo: false,
                isLoop: false


            }
            const route =  new Route( description,details)
            validateRoute(route)        

            route.description.distance = route.details.distance = getTotalDistance(details)
            route.updateCountryFromPoints()

            return route
        }
        catch(err) {
            console.log('# error',err)
        }        

    }


    protected updateRouteWithSelectedOption ():boolean {
        
        try {
            this.isUpdating = true

            const selected = this.getFreeRideService().getSelectedOption()       
            
            this.appendOption(this.currentRoute, selected)

            this.service.onRouteUpdated(this.currentRoute)
        }
        catch(err) {
            this.logError(err,'updateRouteWithSelectedOption')
        }
        this.isUpdating = false
        return false
    }


    protected getNextOptions(forStart?:boolean):Promise<void> {

        return new Promise (done => {
            const freeRide = this.getFreeRideService()

            freeRide.getNextOptions(forStart)
            .catch(err => {
                this.logError(err,'getNextOptions')
                done()
            })
            .then( () => { 
   
                done()
    
                if (this.isStarting) {
                    this.isStarting = false    
                    this.emit('state-update')
                }
                else {
                    this.emitRouteUpdate()
                }
    
                
            }) 
    
        })


    }

    protected saveViewport(viewport:MapViewPort) {

        if (!this.optionsVisible)
            this.viewportRide = viewport
        else 
            this.viewportPreview = viewport

    }


    protected getViewport():MapViewPort {
        const viewport = this.optionsVisible ? this.viewportPreview : this.viewportRide  
        return viewport
    }

    protected getMapBounds():number[][]|undefined {  
        if ( !this.optionsVisible || this.viewportPreview ) return;
        
        let minLat, minLng, maxLat, maxLng;
        this.currentOptions?.forEach( o => {
            o.path.forEach( p => {
                if (minLat===undefined || p.lat<minLat) minLat = p.lat
                if (maxLat===undefined || p.lat>maxLat) maxLat = p.lat
                if (minLng===undefined || p.lng<minLng) minLng = p.lng
                if (maxLng===undefined || p.lng>maxLng) maxLng = p.lng
            })
        })
        
        return [
            [maxLat,minLng],
            [minLat,maxLng]    
        ]        

        
    }

    protected getMapCenter(): LatLng { 
        if ( !this.optionsVisible || !this.currentOptions ) return;

        const {lat,lng} = this.currentOptions[0].path[0]
        return { lat, lng }
        
    }

    protected onOptionsVisibleChanged(visible) {
        if (visible ===this.optionsVisible) {
            return 
        }

        // TODO: consider logging this
        this.optionsVisible = visible
    }

    protected emitRouteUpdate() {

        const options = this.getFreeRideService().buildUIOptions(this.currentOptions)
        const map = this.getOverlayProps('map')

        this.service.getObserver().emit('route-update',{route:this.currentRoute,options,map})

    }
    protected emitOptionsUpdate() {

        const options = this.getFreeRideService().buildUIOptions(this.currentOptions)
        const map = this.getOverlayProps('map')

        this.service.getObserver().emit('options-update',{options,map})

    }

    protected  updatePosition(activityPos:ActivityUpdate): CurrentPosition {
        try {
            const currentRouteDistance = this.position.routeDistance ?? 0;
            const newRouteDistance = activityPos.routeDistance ?? 0;

            if (newRouteDistance !== currentRouteDistance) {
                const prev = {...this.position,totalDistance:this.position.routeDistance }

                let route = this.route
                if ( newRouteDistance>route.description.distance) { 
                    route = this.route.clone()                  
                    const selectedOption = this.getFreeRideService().getSelectedOption()
                    this.appendOption(route, selectedOption);
                }

                const nextPos = getNextPosition(route,{routeDistance:activityPos.routeDistance,prev})
                if (!nextPos) {
                    return this.position
                }
                return  this.fromLapPoint(nextPos)                
            }

            return this.position        
        }
        catch(err) {
            this.logError(err,'updatePosition')
        }
    }


    protected appendOption(route: Route, selectedOption: FreeRideContinuation) {
        try {
            concatPaths(route.points, selectedOption.path, 'after');
            
            validateRoute(route,true);
        }
        catch(err) {
            this.logError(err,'appendOption',{selectedOption})
        }
    }

    protected updateRoutePoints(route: Route, points: RoutePoint[]) {
        route.details.points = route.description.points = points
        
        validateRoute(route,true)        
    }

    protected savePosition() {        

        try {
            const {lat,lng} = this.position           
            this.getUserSettings().set(`routeSelection.freeRide.position`,{lat,lng})
        }
        catch (err) {
            this.logError(err,'savePosition')
        }


    }

    getCurrentRoute():Route {
        return this.currentRoute
    }

    protected get route():Route {
        return this.currentRoute
    }

    protected get currentOptions():FreeRideContinuation[]|undefined {
        return this.getFreeRideService().getOptions()        
    }


    protected getDashboardColumns(): number {
        const parent = super.getDashboardColumns()
        return parent-1; // (no slope)
    }

    reset() {
        super.reset()
        this.cleanupListeners();
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
