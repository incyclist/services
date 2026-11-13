import { StravaApi, StravaApiErrorResponse, StravaAppConnection, StravaRoute } from "../../../apps";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../types";
import { BaseSyncProvider } from "../base/provider";
import { IRouteSyncProvider, RouteSyncSummary } from "../types";
import { GPXParser } from "../../base/parsers/gpx";
import { calculateDistance } from "../../../utils/geo";
import { RouteSyncFactory } from "../factory";
import { sleep } from "../../../utils/sleep";

const PAGE_LIMIT = 50
const SPORTS_FILTER = 'ride'

export class StravaSyncProvider 
        extends BaseSyncProvider<StravaRoute,StravaApi,StravaAppConnection> 
        implements IRouteSyncProvider {

    constructor() {
        super('StravaSync')       
    }


    async loadDetails(route: Route): Promise<Route> {
        try {
            this.logEvent({message:'load route details', id:route?.description?.id, title:route?.description?.title})

            const id = this.getOriginalId(route)
            if (!id) return

            const gpxContent = await this.getApi().getRouteAsGPX(id)

            

            if (typeof gpxContent=='string') {
                await this.addRouteDetails(route,gpxContent)

                return route

            }
            else {
                const error = gpxContent.error
                throw new Error( error)
            }
            
        }
        catch(err) {
            this.logError(err,'loadDetails',{id:route?.description?.id, title:route?.description?.title})
        }
        
    }

    protected async loadRoutesFromApi(): Promise<{routes:Array<StravaRoute>,done:boolean,error:boolean}> { 
        const api = this.getApi()      
        let page = 1
        let done = false
        let error = false
        const routes: Array<StravaRoute> = []


        while (!done && !this.stopRequested) {
            try {
                const filters = {sport:this.getSportFilter()}
                 // NOSONAR - sequential on purpose: pagination depends on previous page, and requests are rate-limited
                const pageRoutes = await api.getLoggedInAthleteRoutes({page,per_page:PAGE_LIMIT},filters)
                if (Array.isArray(pageRoutes) && pageRoutes.length>0) {
                    routes.push(...pageRoutes)
                    page++
                }
                else  {
                    done = true
                }

                 // NOSONAR - sequential on purpose: pagination depends on previous page, and requests are rate-limited
                await sleep(100)

            }
            catch (err){ 
                this.logEvent( {message:'could not load tours', reason:err.message})
                done = true
                error = true
            }

        }
        return {routes,done,error}
    }

    protected async addRouteDetails(route:Route,gpx:string):Promise<void> {

        const parser = new GPXParser()
        const parsed = await parser.parseFromString(gpx)
        const points = parsed.details.points

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

    protected getSportFilter():string { 
        return SPORTS_FILTER
    }
    protected getRouteSyncSummary(route: StravaRoute): RouteSyncSummary {
        return {
            id: route.id_str??route.id?.toString(),
            lastUpdate: route.updated_at,
            creation: route.created_at
        }
    }


    protected buildRouteInfo(route: StravaRoute): RouteInfo {
        const info:RouteInfo = {
            hasGpx:true,
            hasVideo:false,
            id: 'strava:'+(route.id_str??route.id?.toString()),
            title: route.name,
            elevation: route.elevation_gain,
            distance: route.distance, 
            category: 'external',
            source: 'strava',
            //previewUrl: not available
            tsLastChange: (new Date(route.updated_at)).valueOf()
        }
        return info

        
    }
    protected getApi(): StravaApi {
        return this.getConnection().getApi()
    }
    protected getConnection(): StravaAppConnection {
        return new StravaAppConnection()
    }
}

const factory = new RouteSyncFactory()
factory.add('strava',new StravaSyncProvider())