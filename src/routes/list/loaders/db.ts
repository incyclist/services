import { JSONObject, JsonRepository } from "../../../api"
import { Singleton } from "../../../base/types"
import { Observer, PromiseObserver } from "../../../base/types/observer"
import { Route } from "../../base/model/route"
import { RouteInfo } from "../../base/types"
import { RoutesLegacyDbLoader } from "./LegacyDB"
import { RouteInfoDBEntry } from "./types"
import { DBLoader } from "./DBLoader"
import { RouteApiDetail } from "../../base/api/types"
import { waitNextTick } from "../../../utils"

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

    async save(route:Route, enforcedWriteDetails:boolean = false):Promise<void> {
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
            this.writeDetails(route)
        }
        else {
            const details = await this.loadDetailRecord(route)

            if (!details || enforcedWriteDetails)
                this.writeDetails(route)
        }

    }

    async delete(route:Route):Promise<void> {
        const id = route.description.id
        const idx = this.routeDescriptions.findIndex( d=> d.id===id)
        if (idx==-1)
            throw new Error('route not found')

        this.routeDescriptions.splice(idx,1)

        this.isDirty = true;
        this.write()

        await this.deleteRoute(id)

    }

    getDescription (id:string): RouteInfo { 
        const descr = this.routeDescriptions.find( d=>d.id===id)
        return descr
    }



    async getDetails (id:string): Promise<RouteApiDetail> {
        const descr = this.routeDescriptions.find( d=>d.id===id)
        if (!descr)
            return;

        const details = await this.loadDetailRecord(descr)
        return details
    }


    protected async writeRepo() {
        // avoid concurrent updates
        if (this.saveObserver)
            await this.saveObserver.wait()

        const save = async ():Promise<void>=> {
            try {
                await this.routesRepo.write('db',this.routeDescriptions.map(this.buildRouteDBInfo.bind(this)) as JSONObject)
            }
            catch(err) {
                this.logger.logEvent({message:'could not safe repo',error:err.message })
            }
        }
       
        this.saveObserver = new PromiseObserver( save())
        await this.saveObserver.start()
        process.nextTick( ()=> {delete this.saveObserver})

    }


    protected write() {

        if (this.isDirty && (this.tsLastWrite===undefined || Date.now()-this.tsLastWrite>=1000)) {
            this.isDirty = false;
            this.tsLastWrite = Date.now()            
            this.writeRepo()
        }

        if (this.isDirty && Date.now()-this.tsLastWrite<1000) {
            setTimeout( ()=>{this.write()},  this.tsLastWrite+1000-Date.now())
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
        
            const routes = descriptions as unknown as Array<RouteInfoDBEntry>
            const cleaned = this.removeDuplicates(routes)
            return cleaned
        }

        const legacy = await this.loadFromLegacy()
        return legacy
    }

    protected removeDuplicates(routes: Array<RouteInfoDBEntry>) {
        const ids = routes.map( r=> r.legacyId || r.id)
        const uniqueIds = ids.filter( (d,pos)=> ids.indexOf(d)===pos)

        const cleaned=[]
        uniqueIds.forEach( id=> {
            const routeWithLegacy = routes.find( r=> r.legacyId===id)
            
            const route = routeWithLegacy || routes.find( r=> r.id===id)
            if (route)
                cleaned.push(route)
        })
        return cleaned
    }


    protected async loadDetailRecord(target:Route|RouteInfo):Promise<RouteApiDetail> {
        
        const description = ((target as Route).description || target) as RouteInfo
        const repo = description?.hasVideo ? this.getVideosRepo() : this.getRoutesRepo()

        let details;
        try {
            const id = description.legacyId || description.id
            details = await repo.read(id) as RouteApiDetail
            description.originalName = details.title
        }
        catch(err) {
            this.logger.logEvent({message:'could not load route details', id:description?.legacyId || description?.id, reason:err.message, stack:err.stack})
        }
    
        if (!details) {
            return;
        }

        if (!details.points || !Array.isArray(details.points)) {
            // legacy format?
            details.points = details.decoded
            delete details.decoded
        }        
        return details
    }
    

    protected async loadDetails(route:Route, alreadyAdded?:boolean): Promise<void> {
        const details = await this.loadDetailRecord(route)
        this.addDetails(route,details)
        this.verifyRouteHash(route)
        
        if (alreadyAdded)
            this.emitRouteUpdate(route)
        this.emitRouteAdded(route)

        this.verifyCountry(route)


    } 

    protected getVideoRepo() {
        if (!this.videosRepo)
            this.videosRepo  =JsonRepository.create('videos')
        return this.videosRepo
    }

    protected getRoutesRepo() {
        if (!this.routesRepo)
            this.routesRepo  =JsonRepository.create('routes')
        return this.routesRepo
    }

    protected getDetailsRepo(route:Route) {
        return route?.description?.hasVideo ? this.getVideoRepo() : this.getRoutesRepo()
    }

    protected async writeDetails(route:Route) {

        const repo = this.getDetailsRepo(route) 
        if (!repo) {
            return;
        }

        const id = route.description.legacyId || route.description.id
        // avoid concurrent updates

        if (this.routesSaveObserver[id]) {
            await this.routesSaveObserver[id].wait()
        }

        const save = async ():Promise<void>=> {
            try {
                await repo.write(id,route.details)
            }
            catch(err) {
                console.log(err)
            }
        }
       
        this.routesSaveObserver[id] = new PromiseObserver( save())
        await this.routesSaveObserver[id].start()
        process.nextTick( ()=> {delete this.routesSaveObserver[id]})

    }

    protected async deleteRoute(id:string) {
        if (!this.routesRepo)
            return;

        if (this.routesSaveObserver[id])
            return this.routesSaveObserver[id]

        this.routesSaveObserver[id] = new PromiseObserver( this._deleteRoute(id))
        await this.routesSaveObserver[id].start()
        

    }

    protected async _deleteRoute(id):Promise<void> {

        await waitNextTick()

        try {
            await this.routesRepo.delete(id)
            waitNextTick().then( ()=> {delete this.routesSaveObserver[id]})
        }
        catch(err) {
            waitNextTick().then( ()=> {delete this.routesSaveObserver[id]})
            throw err
        }

    }



}
