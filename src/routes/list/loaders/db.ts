import { JsonRepository } from "../../../api"
import { Singleton } from "../../../base/types"
import { Observer, PromiseObserver } from "../../../base/types/observer"
import { Route } from "../../base/model/route"
import { RouteInfo } from "../../base/types"
import { RoutesLegacyDbLoader } from "./LegacyDB"
import { RouteInfoDBEntry } from "./types"
import { DBLoader } from "./DBLoader"
import { RouteApiDetail } from "../../base/api/types"
import { waitNextTick } from "../../../utils"
import { addDetails, getTotalElevation, validateDistance, validateSlopes } from "../../base/utils/route"
import { JSONObject } from "../../../utils/xml"
import clone from "../../../utils/clone"

@Singleton
export class RoutesDbLoader extends DBLoader<RouteInfoDBEntry>{
   
    protected loadObserver: Observer
    protected saveObserver: PromiseObserver<void>
    protected videosRepo: JsonRepository
    protected routesRepo: JsonRepository
    protected routeDescriptions: Array<RouteInfoDBEntry>
    protected routeHashes: Record<string,string>
    protected tsLastWrite:number
    protected isDirty:boolean
    protected routesSaveObserver:{ [index:string]:PromiseObserver<void>} = {}
    

    constructor () {
        super()
        this.routeDescriptions = []   
        this.routeHashes = {}
        this.isDirty = true;
    }

    async save(route:Route, enforcedWriteDetails:boolean = false):Promise<void> {
        const stringify = (json) => { try {return JSON.stringify(json)} catch (err) {/* */ console.log('# error',err)} }

        const updatedDescr = this.buildRouteDBInfo(route.description)
        const idx = this.routeDescriptions.findIndex( d=> d.id===route.description.id)

        let changed = false
        if (idx===-1) {
            this.routeDescriptions.push( clone(updatedDescr) )
            this.routeHashes[route.description.id] = stringify(updatedDescr)
            changed = true;
        }
        else { 
            const prev = this.routeHashes[route.description.id]??''
            const updated = stringify(updatedDescr)
            changed = (prev!==updated)
            if (changed) {
                this.routeDescriptions[idx] = clone(updatedDescr)
                this.routeHashes[route.description.id] = updated
            }
            
        }

    
        if (changed) {
            this.isDirty = true;
            this.write()
            this.writeDetails(route)
        }
        else {
            const details = await this.loadDetailRecord(route,false)

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
        await this.writeRepo()

        await this.deleteRouteDetails(route)

    }

    getDescription (id:string): RouteInfo { 
        const descr = this.routeDescriptions.find( d=>d.id===id)
        return descr
    }



    async getDetails (id:string): Promise<RouteApiDetail> {
        const descr = this.getDescription(id)
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
                this.isDirty = false
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
            observer.on('route.added',(r)=>{
                
                this.loadDetails(r,false).then( ()=>descriptions.push(r.description))
            })
            observer.on('done',()=>done(descriptions))
        })
    }

    protected async loadDescriptions():Promise<Array<RouteInfoDBEntry>> {
        const stringify = (json) => { try {return JSON.stringify(json)} catch (err) {/* */ console.log('# error',err)} }

        const descriptions = await this.getRoutesRepo().read('db') 
        if (descriptions) {
        
            const routes = descriptions as unknown as Array<RouteInfoDBEntry>
            const cleaned = this.removeDuplicates(routes)

            cleaned.forEach( r=> {
                this.routeHashes[r.id] = stringify(r)
            })
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


    protected verifyImportDate(routes:Array<RouteInfoDBEntry>)
    {
        
        let changed =false
        routes.forEach( r=> {
            if (!r.tsImported) {
                r.tsImported = Date.now()
                changed = true
            }
        })

        
        if (changed) {
             this.isDirty = true;
             this.write()
        }
        
    }

    protected async loadDetailRecord(target:Route|RouteInfo, log:boolean=true):Promise<RouteApiDetail> {
        
        const description = ((target as Route).description || target) as RouteInfo
        const repo = description?.hasVideo ? this.getVideosRepo() : this.getRoutesRepo()


        const loadFromRepo = async(id, logErrors=true):Promise<RouteApiDetail> => {
            try {

                const res = await repo.read(id) as undefined as RouteApiDetail                
                if (res) {

                    description.originalName = res.title

                    if (description.hasVideo && !description.segments) {
                        description.segments = res.video?.selectableSegments || res.selectableSegments
                    }
        
                }
                else if (logErrors) 
                    this.logger.logEvent({ message: 'could not load route details', id, title: description?.title, reason: 'no data received' })
                return res
            }
            catch (err) {
                this.logger.logEvent({ message: 'could not load route details', id, title: description?.title, reason: err.message, stack: err.stack })
                return null
            }
        }


        let details
        if (description.legacyId) {
            details = await loadFromRepo(description.legacyId,false) 
        }
        if (!details) {
            details = await loadFromRepo(description.id,log) 
        }


        if (!details) {
            return;
        }

        this.validateDetails(details)
        this.validateDescription(description, details)


        return details
    }
    
    private validateDetails(details: any) {
        if (!details.points || !Array.isArray(details.points)) {
            // legacy format?
            details.points = details.decoded
            delete details.decoded
        }

        if (details.localizedTitle && typeof (details.localizedTitle) === 'string') {
            details.localizedTitle = { en: details.localizedTitle }
        }

        validateDistance(details.points)
        validateSlopes(details.points)
    }

    private validateDescription(description: RouteInfo, details: any) {
        if (!description.elevation) {
            description.elevation = getTotalElevation(details)
        }
    }

    protected async loadDetails(route:Route, alreadyAdded?:boolean): Promise<void> {
        const details = await this.loadDetailRecord(route)
        let updated = false

        addDetails(route,details)
        updated ||= this.verifyRouteHash(route)
        updated ||= this.verifyVideoUrl(route)
        
        if (alreadyAdded)
            this.emitRouteUpdate(route)
        this.emitRouteAdded(route)

        this.verifyCountry(route)

        if (updated)
            this.save(route)


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
                await repo.write(id,route.details as undefined as JSONObject)
            }
            catch(err) {
                //console.log(err)
            }
        }
       
        this.routesSaveObserver[id] = new PromiseObserver( save())
        await this.routesSaveObserver[id].start()
        process.nextTick( ()=> {delete this.routesSaveObserver[id]})

    }

    protected async deleteRouteDetails(route:Route) {

        const repo = this.getDetailsRepo(route)
        if (!repo)
            return;

        const id = route.description.id
        if (this.routesSaveObserver[id])
            await this.routesSaveObserver[id].wait()

        const  _deleteRoute = async (id):Promise<void> => {
            await waitNextTick()
    
            try {
                await repo.delete(id)
                waitNextTick().then( ()=> {delete this.routesSaveObserver[id]})
            }
            catch(err) {
                waitNextTick().then( ()=> {delete this.routesSaveObserver[id]})
                throw err
            }    
        }
    

        this.routesSaveObserver[id] = new PromiseObserver( _deleteRoute(id))
        await this.routesSaveObserver[id].start()
    }

}
