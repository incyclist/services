import { sleep } from "incyclist-devices/lib/utils/utils";
import { useAppsService } from "../../../apps";
import { KomootCoordinate, KomootTourSummary } from "../../../apps/base/api/komoot/types";
import { KomootAppConnection } from "../../../apps/komoot";
import { Injectable } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer  } from "../../../base/types";
import { useUserSettings } from "../../../settings";
import { waitNextTick } from "../../../utils";
import { calculateDistance } from "../../../utils/geo";
import { Route } from "../../base/model/route";
import { RouteInfo, RoutePoint } from "../../base/types";
import { IRouteList } from "../../list/types";
import { RouteSyncFactory } from "../factory";
import { IRouteSyncProvider } from "../types";

const PAGE_LIMIT = 50

export class KomootSyncProvider extends IncyclistService  implements IRouteSyncProvider  {

    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean
    
    

    constructor() {
        super('KomootSync')       
    }

    sync(): Observer {
        // allready syncing, ... return observer and don't start a new one
        if (this.observer)
            return this.observer

        

        this.observer = new Observer()
        this.observer.once('done',()=>{
            waitNextTick().then( ()=>{
                this.stopRequested = false
                delete this.observer
            })
    
        })

        this.observer.once('stop',()=>{this.stopSync() })
       
        this.loadTours()
        return this.observer

    }

    isConnected(): boolean {
        if (this.getKomootApi().isAuthenticated()) {
            return true
        }

        const connected = this.getKomootAppConnection().isConnected()
        return connected
    }

    async loadDetails(route:Route):Promise<Route> { 
        try {
            this.logEvent({message:'load route details', id:route?.description?.id, title:route?.description?.title})

            const id = this.getKomootId(route)
            if (!id) return

            const coordinates = await this.getKomootApi().getTourCoordinates(id)
            this.adddRouteDetails(route,coordinates)

            return route
        }
        catch(err) {
            this.logError(err,'loadDetails',{id:route?.description?.id, title:route?.description?.title})
        }
        
    }

        
    protected getKomootId(route:Route):number {
        const idStr = route.description?.id
        if (!idStr.startsWith('komoot:'))
            return
        return  Number(idStr.split(':')[1])

    }


    protected stopSync() {
        this.stopRequested = true
    }


    protected async loadTours(): Promise<Array<KomootTourSummary>> { 

        if (!this.getAppsService().isEnabled('komoot','RouteDownload')) {
            await waitNextTick()
            this.observer.emit('done')
            return []
        }
        this.logEvent({message:'start komoot route sync'})

        const api = this.getKomootApi()
        let page = 0
        let done = false
        const tours: Array<KomootTourSummary> = []

        let cntAdded = 0;
        let cntUpdated = 0;

        while (!done && !this.stopRequested) {
            try {
                const filters = {lastUpdateAfter: this.getLastSyncTime(), sport:this.getSportFilter(), after:this.getCreatedFilter()}

                
                const pageTours = await api.getTours({type:'tour_planned',page,limit:PAGE_LIMIT},filters)
                                    
                if (pageTours?.length>0) {
                    const {added,updated} = this.checkTours(pageTours)
                    if (added.length>0) {
                        cntAdded+=added.length
                        this.emitAdded(added)
                        tours.push(...added)   
                    }
                    if (updated.length>0) {
                        cntUpdated+=updated.length
                        this.emitUpdated(updated)   
                    }

                    page++
                }
                else {
                    done = true
                }
                await sleep(100)

            }
            catch (err){ 
                this.logEvent( {message:'could not load tours', reason:err.message})
                done = true}
        }

        if (done) {
            this.lastSyncTS = Date.now()
            this.saveLastSyncTime()
        }

        this.logEvent({message:'komoot route sync finished', added:cntAdded, updated: cntUpdated})

        this.observer.emit('done')

        return tours

    }

    protected checkTours( tours:Array<KomootTourSummary> )
        : { added: Array<KomootTourSummary>, updated:Array<Route> } {

        const routes = this.getRouteListService()?.searchRepo( {routeSource:'komoot' } )?.routes??[]

        const added:Array<KomootTourSummary> = []
        const updated:Array<Route> = []

        tours.forEach( tour => {
            const id = 'komoot:'+tour.id
            const route = routes.find( route => route.id === id)
            if (!route) {
                added.push(tour)
            }
            else {
                const routeTS = route.tsLastChange??0
                const tourTS  =  (new Date(tour.changed_at)).valueOf()
                if (tourTS>routeTS) {
                    const description = this.buildRouteInfo(tour)                    
                    updated.push( new Route(description))
                }

            }
        })

        return { added, updated }
    }

    protected buildRouteInfo( tour:KomootTourSummary ): RouteInfo {
        const info:RouteInfo = {
            hasGpx:true,
            hasVideo:false,
            id: 'komoot:'+tour.id,
            title: tour.name,
            elevation: tour.elevation_up,
            distance: tour.distance, 
            category: 'external',
            source: 'komoot',
            previewUrl: tour.map_image_preview?.src,
            tsLastChange: (new Date(tour.changed_at)).valueOf()
        }
        return info
    }

    protected async adddRouteDetails( route:Route, coordinates:Array<KomootCoordinate> ): Promise<void> {
        const points = this.buildRoutePoints(coordinates, [])

        const last = points[points.length - 1];
        const first = points[0];
        const totalDistance = last.routeDistance;
        const totalElevation = last.elevationGain;
        const descr = route.description;

        if (descr.distance !== totalDistance) descr.distance = totalDistance;
        if (descr.elevation !== totalElevation) descr.elevation = totalElevation;
        descr.isLoop =  (calculateDistance(first.lat, first.lng, last.lat, last.lng) < 50) ;

        route.addDetails( {
            id: descr.id,
            title: descr.title,
            points,
            country: descr.country,
            distance: descr.distance,
            elevation: descr.elevation,
            category: descr.category,
        });


        if (!descr.country)   {
            await route.updateCountryFromPoints();
        }

        descr.points = points
    }

    protected buildRoutePoints(coordinates: KomootCoordinate[], points: RoutePoint[]) {

        const num = coordinates?.length;
        if (!num)
            return;

        
        let routeDistance = 0;
        let elevationGain = 0
        let prevPoint:RoutePoint
        let cnt = 0

        try {
            for (let i = 0; i < num; i++) {
                const p = coordinates[i]
                const prev = i>0 ? coordinates[i-1] : undefined

                let distance=0,gain=0

                if (i>0) {
                    distance = calculateDistance( p.lat, p.lng, prev.lat, prev.lng)
                    gain = p.alt-prev.alt 
                    routeDistance = routeDistance+distance
                    if (gain>0)
                        elevationGain += gain

                }

                if (distance==0 && i>0) {
                   continue 
                }


                const point: RoutePoint = {
                    lat: p.lat,
                    lng: p.lng,
                    slope:0,
                    elevation: p.alt,
                    elevationGain,
                    distance ,
                    routeDistance ,
                    cnt
                };
                if (i>0) {
                    prevPoint.slope = gain/distance*100
                }
                
                points.push(point);
                prevPoint = point
                cnt++
            }
        }
        catch(err) {
            this.logError(err,'buildRoutePoints')
        }
        return points
    }

    protected emitAdded(tours:Array<KomootTourSummary>) {
        this.observer.emit('added',tours.map(tour=>this.buildRouteInfo(tour)))
    }

    protected emitUpdated(routes:Array<Route>) {

        this.observer.emit('updated',routes)
    }

    protected getLastSyncTime(): Date {
        const lastSyncTS = this.lastSyncTS??0;

        this.lastSyncTS = Math.max(
            lastSyncTS, 
            this.getUserSettings().get('apps.komoot.lastSync',lastSyncTS) )

        return this.lastSyncTS>0 ? new Date(this.lastSyncTS) : undefined
    }

    protected getSportFilter():string { 
        return 'racebike'
    }

    protected getCreatedFilter(days:number=365):Date {
        return new Date(Date.now()-days*24*60*60*1000)
    }

    protected saveLastSyncTime(): void {
        if (!this.lastSyncTS)
            return

        this.getUserSettings().set('apps.komoot.lastSync',this.lastSyncTS)
    }
    

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getRouteListService():IRouteList {
        return this.getRouteSyncFactory().getRouteList()
    }

    @Injectable
    protected getRouteSyncFactory() {
        return new RouteSyncFactory()
    }

    @Injectable
    protected getKomootApi() {
        return this.getKomootAppConnection().getApi()

    }

    @Injectable
    protected getKomootAppConnection() {
        return new KomootAppConnection()
    }

    @Injectable
    protected getAppsService() {
        return useAppsService()
    }

}


const factory = new RouteSyncFactory()
factory.add('komoot',new KomootSyncProvider())