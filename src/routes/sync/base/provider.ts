import { useAppsService } from "../../../apps";
import { IExternalAppApi } from "../../../apps/base/types";
import { Injectable } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { useUserSettings } from "../../../settings";
import { IConnectedApp } from "../../../types";
import { waitNextTick } from "../../../utils";
import { Route } from "../../base/model/route";
import { RoutePoint } from "../../base/types";
import { calculateDistance } from "../../../utils/geo";
import { IRouteList, RouteInfo } from "../../types";
import { RouteSyncFactory } from "../factory";
import { IRouteSyncProvider, RouteSyncSummary } from "../types";


interface SyncModifications<T> {
    added: Array<T>;
    updated: Array<Route>;
    deleted: Array<string>;
}

export abstract class BaseSyncProvider<T,A extends IExternalAppApi,C extends IConnectedApp> extends IncyclistService implements IRouteSyncProvider {
    protected lastSyncTS: number
    protected observer: Observer
    protected stopRequested: boolean

    
    sync(): Observer {
        // allready syncing, ... return observer and don't start a new one
        if (this.observer)
            return this.observer

        

        this.observer = new Observer()
        // the observer must be released immediately: if it was released later, a sync that is started
        // right after 'done' would get the observer that is already finished and never receive 'done'
        this.observer.once('done',()=>{
            this.stopRequested = false
            delete this.observer
        })

        this.observer.once('stop',()=>{this.stopSync() })

        this.runSync(this.observer).catch( err=>{ this.logError(err,'sync') })
        return this.observer

    }


    isConnected(): boolean {
        if (this.getApi().isAuthenticated()) {
            return true
        }

        const connected = this.getConnection().isConnected()
        return connected
    }

    abstract loadDetails(route: Route): Promise<Route> 

    // ------  PROTECTED MEMBERS ----------

    protected getOriginalId(route:Route):string {
        const app = this.getConnection().getAppKey()
        const idStr = route.description?.id
        if (!idStr.startsWith(`${app}:`))
            return
        return  idStr.split(':')[1]

    }

    /** runs the sync. Whatever happens, the sync ends with 'done' and the observer is released */
    protected async runSync(observer:Observer):Promise<void> {
        try {
            await this.loadTours()
        }
        catch (err) {
            this.logError(err,'sync')
        }
        finally {
            // a new sync might already have been started after 'done' (then this.observer is a different one)
            if (this.observer===observer)
                observer.emit('done')
        }
    }

    protected async loadTours(): Promise<Array<T>> { 

        const app = this.getConnection().getAppKey()
        if (!this.getAppsService().isEnabled(app,'RouteDownload')) {
            await waitNextTick()
            this.observer.emit('done')
            return []
        }
        this.logEvent({message:`start route sync`, externalApp:app})

        const {routes,done,error,incomplete} = await this.loadRoutesFromApi()

        if (error) {
            // nothing is reported (an incomplete list would mark routes as deleted), but the sync has to end
            this.logEvent({message:`route sync failed`,externalApp:app})
            this.observer.emit('done')
            return []
        }
        else if (done) {
            const {added,updated,deleted} = this.checkTours(routes,incomplete)
            this.updateLastSyncTime()

            this.observer.emit('done')
            this.logEvent({message:`route sync finished`, externalApp:app, added:added?.length, updated:updated?.length,deleted:deleted.length})
            return added

        }
        else {
            this.observer.emit('done')
            this.logEvent({message:`route sync stopped`,externalApp:app})
            return []
        }
    }


    /**
     * @param candidates the routes that were found
     * @param skipDeletions the list is incomplete: routes that are not part of it are not reported as deleted
     */
    protected checkTours( candidates:Array<T>, skipDeletions:boolean=false ): SyncModifications<T> {

        const app = this.getConnection().getAppKey()
        const routes = this.getRouteListService()?.getAllAppRoutes(app)??[]
        const matched = routes.map( r => ({id:r.id, matched:false}))

        const added:Array<T> = []
        const updated:Array<Route> = []

        candidates.forEach( tour => {
            const summary = this.getRouteSyncSummary(tour)
            const id = `${app}:${summary.id}`
            const route = routes.find( route => route.id === id)
            if (!route) {
                added.push(tour)
            }
            else if (route.isDeleted) {
                const matchRecord = matched.find( r=> r.id===id)
                if (matchRecord)
                    matchRecord.matched = true
            }
            else {
                const matchRecord = matched.find( r=> r.id===id)
                if (matchRecord)
                    matchRecord.matched = true
                const routeTS = route.tsLastChange??0
                const tourTS  =  (new Date(summary.lastUpdate)).valueOf()
                if (tourTS>routeTS) {
                    const description = this.buildRouteInfo(tour)                    
                    updated.push( new Route(description))
                }

            }
        })


        const unmatched = matched.filter(r=>!r.matched)
        const deleted = skipDeletions ? [] : unmatched.map( r=> r.id)
        this.emitUpdates(added, updated, deleted);

        return { added, updated,deleted }
    }


    /**
     * Adds the points of the track to a route: derives distance, elevation and loop flag, and (if missing) the country
     * @param route the route (as created by the list of routes)
     * @param points the points of the track
     */
    protected async applyRoutePoints(route:Route, points:Array<RoutePoint>):Promise<void> {
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

    protected stopSync() {
        this.stopRequested = true
    }

    protected emitUpdates(added: T[], updated: Route[], deleted: string[]) {
        if (added.length > 0) {
            this.emitAdded(added);
        }
        if (updated.length > 0) {
            this.emitUpdated(updated);
        }
        if (deleted.length > 0) {
            this.emitDeleted(deleted);
        }
    }


    protected emitAdded(tours:Array<T>) {
        this.observer.emit('added',tours.map(tour=>this.buildRouteInfo(tour)))
    }

    protected emitUpdated(routes:Array<Route>) {
        this.observer.emit('updated',routes)
    }
    protected emitDeleted(routes:Array<string>) {
        this.observer.emit('deleted',routes)
    }

    protected getLastSyncTime(): Date {
        const lastSyncTS = this.lastSyncTS??0;
        const key = this.getSyncKey()

        this.lastSyncTS = Math.max(
            lastSyncTS, 
            this.getUserSettings().get(key,lastSyncTS) )

        return this.lastSyncTS>0 ? new Date(this.lastSyncTS) : undefined
    }

    protected getCreatedFilter(days:number=365):Date {
        return new Date(Date.now()-days*24*60*60*1000)
    }

    protected updateLastSyncTime(): void { 
        this.lastSyncTS = Date.now()
        this.saveLastSyncTime()
    }

    protected saveLastSyncTime(): void {
        if (!this.lastSyncTS)
            return
        const key = this.getSyncKey()
        this.getUserSettings().set(key,this.lastSyncTS)
    }

    protected getSyncKey() {
        const app = this.getApp()
        return `apps.${app}.lastSync`
    }

    protected getApp() {
        let app:string
        try {
            app = this.getConnection().getAppKey()
        }
        catch (err) {
            this.logError(err,'getApp')
        }
        return app
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
    protected getAppsService() {
        return useAppsService()
    }



    protected abstract buildRouteInfo( tour:T ): RouteInfo
    protected abstract getApi():A
    protected abstract getConnection():C
    protected abstract getRouteSyncSummary(route:T): RouteSyncSummary
    /** `incomplete`: the routes are reported, but not finding a route does not mean that it was deleted */
    protected abstract loadRoutesFromApi(): Promise<{routes:Array<T>,done:boolean,error:boolean,incomplete?:boolean}>  


}