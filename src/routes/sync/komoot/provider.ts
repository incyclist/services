import { KomootApi  } from "../../../apps";
import { KomootCoordinate, KomootSportTypeNames, KomootTourSummary } from "../../../apps/base/api/komoot/types";
import { KomootAppConnection } from "../../../apps/komoot";
import { calculateDistance } from "../../../utils/geo";
import { sleep } from "../../../utils/sleep";
import { Route } from "../../base/model/route";
import { RouteInfo, RoutePoint } from "../../base/types";
import { BaseSyncProvider } from "../base/provider";
import { RouteSyncFactory } from "../factory";
import { IRouteSyncProvider, RouteSyncSummary } from "../types";

const PAGE_LIMIT = 50
const SPORTS_FILTER = 'racebike'

const sportsOptions: Record<string,KomootSportTypeNames> ={
    touringbicycle: 'Cycling',
    mtb: 'Mountain biking',
    racebike: 'Road cycling',
    mtb_easy: 'Gravel riding',
    mtb_advancde: 'Enduro mountain biking'
}



export class KomootSyncProvider 
       extends BaseSyncProvider<KomootTourSummary,KomootApi,KomootAppConnection>  
       implements IRouteSyncProvider  {

    constructor() {
        super('KomootSync')       
    }

    async loadDetails(route:Route):Promise<Route> { 
        try {
            this.logEvent({message:'load route details', id:route?.description?.id, title:route?.description?.title})

            const id = this.getOriginalId(route)
            if (!id) return

            const coordinates = await this.getApi().getTourCoordinates( Number(id) )
            await this.adddRouteDetails(route,coordinates)

            return route
        }
        catch(err) {
            this.logError(err,'loadDetails',{id:route?.description?.id, title:route?.description?.title})
        }
        
    }


    // ------  PROTECTED MEMBERS ----------


    protected async loadRoutesFromApi(): Promise<{routes:Array<KomootTourSummary>,done:boolean,error:boolean}> { 
        const api = this.getApi()      
        let page = 0
        let done = false
        let error = false
        const routes: Array<KomootTourSummary> = []


        while (!done && !this.stopRequested) {
            try {
                const filters = {/*lastUpdateAfter: this.getLastSyncTime(), */sport:this.getSportFilter() , after:this.getCreatedFilter()}
                const pageTours = await api.getTours({type:'tour_planned',page,limit:PAGE_LIMIT},filters)
                if (pageTours.length>0)  {
                    routes.push(...pageTours)
                    page++
                }
                else 
                    done = true

                await sleep(100)

            }
            catch (err){ 
                this.logEvent( {message:'could not load routes', reason:err.message})
                done = true
                error = true
            }
        }
        return {routes,done,error}
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
            //previewUrl: tour.map_image_preview?.src,
            previewUrl: tour.vector_map_image_preview?.src,
            tsLastChange: (new Date(tour.changed_at)).valueOf()
        }
        return info
    }

    protected async adddRouteDetails( route:Route, coordinates:Array<KomootCoordinate> ): Promise<void> {
        const points = this.buildRoutePoints(coordinates, [])

        const last = points.at(-1);
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


        if (!descr.country && route.points?.length>0)   {
            this.logEvent({message:'route update required (country)',route:route.title})
            const updated = await route.updateCountryFromPoints();
            if (updated) {
                this.logEvent({message:'route updated (country)',route:route.title,country:route.description?.country})
                // no need to save here. The route entry will be saved once it is completely initialized
            }
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

    protected getAppId

    protected getSportFilter():string { 
        return SPORTS_FILTER
    }

    protected getAvailableSports():Array<string> {
        const keys = Object.keys(sportsOptions)
        return keys.map( sport=> sportsOptions[sport])
    }

    protected getRouteSyncSummary(route: KomootTourSummary): RouteSyncSummary {
        return {
            id: route.id.toString(),
            lastUpdate: route.changed_at,
            creation: route.date
        }
    }

    
    // ------  EXTERNAL DEPENDENCIES (Injectable)  ----------
    protected getApi():KomootApi {
        return this.getConnection().getApi()
    }

    protected getConnection():KomootAppConnection {
        return new KomootAppConnection()
    }

}


const factory = new RouteSyncFactory()
factory.add('komoot',new KomootSyncProvider())