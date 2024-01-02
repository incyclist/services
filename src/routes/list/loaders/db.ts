import { JSONObject, JsonRepository } from "../../../api"
import { Singleton } from "../../../base/types"
import { Observer, PromiseObserver } from "../../../base/types/observer"
import { Route } from "../../base/model/route"
import { RouteInfo } from "../../base/types"
import { RoutesLegacyDbLoader } from "./LegacyDB"
import { RouteInfoDBEntry } from "./types"
import { DBLoader } from "./DBLoader"
import { RouteApiDetail } from "../../base/api/types"

@Singleton
export class RoutesDbLoader extends DBLoader<RouteInfoDBEntry>{
   
    protected loadObserver: Observer
    protected saveObserver: PromiseObserver<void>
    protected videosRepo: JsonRepository
    protected routesRepo: JsonRepository
    protected routeDescriptions: Array<RouteInfoDBEntry>
    protected tsLastWrite:number
    protected isDirty:boolean
    protected routesSaveObserver:{ [index:string]:PromiseObserver<void>} = {}
    

    constructor () {
        super()
        this.routeDescriptions = []     
        this.isDirty = true;
    }

    async writeRepo() {
        // avoid concurrent updates
        if (this.saveObserver)
            await this.saveObserver.wait()

        const save = async ():Promise<void>=> {
            try {
                await this.routesRepo.write('db',this.routeDescriptions.map(this.buildRouteDBInfo.bind(this)) as JSONObject)
            }
            catch(err) {
                console.log(err)
            }
        }
       
        this.saveObserver = new PromiseObserver( save())
        await this.saveObserver.start()
        process.nextTick( ()=> {delete this.saveObserver})

    }

    async writeRoute(route:Route) {
        if (!this.routesRepo)
            return;

        const id = route.description.id
        // avoid concurrent updates

        if (this.routesSaveObserver[id])
            await this.routesSaveObserver[id].wait()

        const save = async ():Promise<void>=> {
            try {
                await this.routesRepo.write(id,route.details)
            }
            catch(err) {
                console.log(err)
            }
        }
       
        this.routesSaveObserver[id] = new PromiseObserver( save())
        await this.routesSaveObserver[id].start()
        process.nextTick( ()=> {delete this.routesSaveObserver[id]})

    }

    write() {

        if (this.isDirty && (this.tsLastWrite===undefined || Date.now()-this.tsLastWrite>=1000)) {
            this.isDirty = false;
            this.tsLastWrite = Date.now()            
            this.writeRepo()
        }

        if (this.isDirty && Date.now()-this.tsLastWrite<1000) {
            setTimeout( ()=>{this.write()},  this.tsLastWrite+1000-Date.now())
        }

    }


    async save(route:Route):Promise<void> {
        const stringify = (json) => { try {JSON.stringify(json)} catch {/* */}}

        let prev
        const idx = this.routeDescriptions.findIndex( d=> d.id===route.description.id)

        if (idx===-1)
            this.routeDescriptions.push( route.description)
        else { 
            prev = stringify(this.buildRouteDBInfo(this.routeDescriptions[idx]))
            this.routeDescriptions[idx] = route.description
            
        }

        const changed = !prev || stringify(this.buildRouteDBInfo(this.routeDescriptions[idx]))!==prev
    
        if (changed) {
            this.isDirty = true;
            this.write()
            this.writeRoute(route)
            
        }
    }


    protected getLegacyLoader():RoutesLegacyDbLoader {
        return new RoutesLegacyDbLoader()        
    }

    protected buildRouteInfo(descr:RouteInfoDBEntry):RouteInfo {        
        return descr
    }

    protected buildRouteDBInfo(descr:RouteInfo):RouteInfoDBEntry {
        const data = {...descr}
        delete data.points
        return data
    }

    protected async loadFromLegacy():Promise<Array<RouteInfoDBEntry>> {

        return new Promise( done => {
            const observer = this.getLegacyLoader().load();
            const descriptions: Array<RouteInfoDBEntry> = []
            observer.on('route.added',(r)=>{descriptions.push(r.description)})
            observer.on('done',()=>done(descriptions))
        })
    }

    protected async loadDescriptions():Promise<Array<RouteInfoDBEntry>> {

        const descriptions = await this.getRoutesRepo().read('db') 
        if (descriptions) {
            return descriptions as unknown as Array<RouteInfoDBEntry>
        }

        const legacy = await this.loadFromLegacy()
        return legacy
    }

    protected async loadDetails(route:Route, alreadyAdded?:boolean): Promise<void> {
        const repo = route.description.hasVideo ? this.getVideosRepo() : this.getRoutesRepo()

        let details;
        try {
            details = await repo.read(route.description.id) as RouteApiDetail
        }
        catch(err) {
            console.log(err)
        }

        if (!details) {
            return;
        }

        if (!details.points || !Array.isArray(details.points)) {
            // legacy format?
            details.points = details.decoded
            delete details.decoded
        }
        this.addDetails(route,details)

        if (alreadyAdded)
            this.emitRouteUpdate(route)
        this.emitRouteAdded(route)

        this.verifyCountry(route)

    } 

}
