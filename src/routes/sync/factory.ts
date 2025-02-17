import { Observer, Singleton } from "../../base/types";
import { waitNextTick } from "../../utils";
import { Route } from "../base/model/route";
import { RouteInfo } from "../base/types";
import { IRouteList } from "../list/types";
import { IRouteSyncProvider, RouteSyncInfo } from "./types";

@Singleton
export class RouteSyncFactory {

    protected syncProviders: Array<RouteSyncInfo>
    protected routeList: IRouteList

    constructor() {
        this.syncProviders = []
    }

    /**
     * Adds a new route sync provider to the factory.
     * If the service already exists, its provider is replaced.
     * @param {string} service - The service of the uploader.
     * @param {IRouteSyncProvider} uploader - The uploader to add.
     */
    add( service:string, syncProvider: IRouteSyncProvider) {
        const existing = this.syncProviders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            this.syncProviders.push({service,syncProvider})
        else 
            this.syncProviders[existing] = {service,syncProvider}
    }

    get(service:string):IRouteSyncProvider {
        const existing = this.syncProviders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            return null
        else 
            return this.syncProviders[existing].syncProvider
    }

    /**
     * Performs a route sync with all connected services or one specific service.
     */
    sync( service?:string):Observer {
        const observer = new Observer()

        const syncs:Record<string,Observer> = {}

        const providers = service ? this.syncProviders.filter(i=>i.service===service)??[] : this.syncProviders
        const target =  providers?.filter( sp=> sp.syncProvider.isConnected()) 
        if (!target?.length) {

            observer.emit('done')
            waitNextTick().then(()=>{ observer.stop()})
            return null
        }

        target.forEach( sp=> {

            const {service,syncProvider} = sp
                const so = syncProvider.sync()
                syncs[service] = so
                so.on( 'added', (info: Array<RouteInfo>)=> observer.emit('added', service,info))
                so.on( 'updated', (routes: Array<Route>)=> observer.emit('updated', service,routes))

                so.on( 'details', (route:Route)=> observer.emit('details', service,route))
                so.on( 'done',()=>{ 
                    delete syncs[service]
                    if (Object.keys(syncs).length===0) {
                        observer.emit('done')
                        waitNextTick().then(()=>{ observer.stop()})
                    }
                })

        })
        observer.on('stop',()=>{
            Object.keys( syncs).forEach(service => {
                const so = syncs[service]
                so.emit('stop')
            })
    
        })
        return observer
    }

    async stopSync( observer:Observer) {
        observer.emit('stop')
        return new Promise(done=> {
            observer.on('done',done)
        })
    }

    setRouteList( list:IRouteList) {
        this.routeList = list
    }
    getRouteList():IRouteList {
        return this.routeList 
    }
    

}