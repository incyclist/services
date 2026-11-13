import { useAppsService } from "../../../apps";
import { IExternalAppApi } from "../../../apps/base/types";
import { Injectable } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { useUserSettings } from "../../../settings";
import { IConnectedApp } from "../../../types";
import { waitNextTick } from "../../../utils";
import { Route } from "../../base/model/route";
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
        this.observer.once('done',()=>{
            waitNextTick().then( ()=>{
                this.stopRequested = false
                delete this.observer
            }).catch( err=>{ this.logError(err,'sync') })

        })

        this.observer.once('stop',()=>{this.stopSync() })

        this.loadTours().catch( err=>{ this.logError(err,'sync') })
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

    protected async loadTours(): Promise<Array<T>> { 

        const app = this.getConnection().getAppKey()
        if (!this.getAppsService().isEnabled(app,'RouteDownload')) {
            await waitNextTick()
            this.observer.emit('done')
            return []
        }
        this.logEvent({message:`start ${app} route sync`})

        const {routes,done,error} = await this.loadRoutesFromApi()

        if (error) {
            this.logEvent({message:`${app} route sync failed`})
        }
        else if (done) {
            const {added,updated,deleted} = this.checkTours(routes)
            this.updateLastSyncTime()

            this.observer.emit('done')
            this.logEvent({message:`${app} route sync finished`, added:added?.length, updated:updated?.length,deleted:deleted.length})
            return added

        }
        else {
            this.observer.emit('done')
            this.logEvent({message:`${app} route sync stopped`})
            return []
        }
    }


    protected checkTours( candidates:Array<T> ): SyncModifications<T> {

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
        const deleted = unmatched.map( r=> r.id)
        this.emitUpdates(added, updated, deleted);

        return { added, updated,deleted }
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
        const app = this.getConnection().getAppKey()
        return `apps.${app}.lastSync`
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
    protected abstract loadRoutesFromApi(): Promise<{routes:Array<T>,done:boolean,error:boolean}>  


}