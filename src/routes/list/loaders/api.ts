import { EventLogger } from "gd-eventlog";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { IIncyclistRoutesApi, RouteApiDescription, RouteApiDetail } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { addDetails } from "../../base/utils/route";
import { RoutesDbLoader } from "./db";
import { Loader,LoadDetailsTargets } from "./types";
import { sleep } from "../../../utils/sleep";
import { settleWithLimit } from "../../../utils/settleWithLimit";
import { Injectable } from "../../../base/decorators";
import { useIncyclistRoutesApi } from "../../base/api/factory";
import { useUserSettings } from "../../../settings";
import { useRouteServerStatus } from "../../servers/status";
import { pascalCase } from "../../../utils";
import { toSourceKey } from "../../servers/validator";

const ROUTE_DETAILS_CONCURRENCY = 4

const valid = (v) => (v!==undefined && v!==null)

class ApiError extends Error {
    constructor( error:Error, private readonly _type:string ) {super(error.message)}
    get type (): string {
        return this._type
    }

}

const ExistingAndNotUpdated = (existing: RouteInfo, descr: RouteInfo) => {
    if (!existing)
        return false

    const {isDeleted=false} = descr
    if (existing.isLocal)
        return true

    return ((existing.version || 0) >= (descr.version || 0))
        && (!isDeleted || (isDeleted && existing.isDownloaded));
}

/** one load of the route list: all of its requests and processing run inside one job, the jobs run one after the other */
interface LoadJob {
    observer: Observer
    stopped: boolean
    /** address of every external server that this load requested, to detect a removal (or change) while the request was open */
    servers: Map<string,string>
    /** set for the load of a single server */
    serverKey?: string
}

/** the descriptions that one group of requests (built-in api, external servers) returned */
interface LoadSource {
    results: Promise<Array<PromiseSettledResult<Array<RouteApiDescription>>>>
    isExternal: boolean
}

const enrichApi = (v:RouteApiDescription,type:string):RouteApiDescription => ({type, ...v }) as RouteApiDescription

/** the source a route belongs to (undefined: Incyclist or local) */
const getOwner = (route:{apiServer?:string}):string|undefined => route?.apiServer ? toSourceKey(route.apiServer) : undefined

export class RoutesApiLoader extends Loader<RouteApiDescription> {

    protected api: IIncyclistRoutesApi
    protected saveObserver: PromiseObserver<void>
    protected logger: EventLogger
    protected processed: Array<string> = []

    // Loads must not overlap: they share the observer and the list of processed ids. Every load is a job that
    // starts when the previous one has finished completely (including the clean-up of its observer).
    protected tail?: Promise<void>
    protected jobs: Set<LoadJob> = new Set()
    protected fullLoad?: LoadJob

    constructor () {
        super()
        this.api = this.getIncyclistRoutesApi().create() 
        this.logger = new EventLogger('RoutesApi')
    }

    /**
     * Loads the routes of the built-in server and of all configured external route servers.
     *
     * The returned observer emits `route.added`/`route.updated`, `loaded` (the routes of the built-in server
     * have been processed) and `done` (everything has been processed, including the other servers).
     */
    load():Observer {
        // no concurrent loads
        if (this.fullLoad)
            return this.fullLoad.observer

        const job = this.createJob()
        this.fullLoad = job
        this.enqueue(job, ()=>this.startFullLoad(job))
        return job.observer
    }

    /**
     * Loads the routes of a single external route server (e.g. right after it was added), without waiting for
     * (or repeating) a full load. If a load is currently running, this load starts as soon as that one is done.
     *
     * The returned observer emits the same events as load()
     */
    loadServer(key:string):Observer {
        const job = this.createJob(key)
        this.enqueue(job, ()=>this.startServerLoad(job,key))
        return job.observer
    }

    stopLoad() {
        this.jobs.forEach( job => {
            job.stopped = true
            job.observer.stop()
        })
        delete this.fullLoad
        delete this.loadObserver
    }

    protected createJob(serverKey?:string):LoadJob {
        return { observer: new Observer(), stopped: false, servers: new Map(), serverKey }
    }

    protected enqueue(job:LoadJob, start:()=>Array<LoadSource>) {
        this.jobs.add(job)

        const execute = async ():Promise<void> => {
            try {
                if (!job.stopped)
                    await this.runLoad(job, start)
            }
            catch(err) {
                this.logger.logEvent({message:'could not process route list load', error:err?.message})
            }
            finally {
                this.jobs.delete(job)
                if (this.fullLoad===job)
                    delete this.fullLoad
            }
        }

        // an idle loader starts right away (the requests are sent before this method returns)
        const previous = this.tail
        const current = previous===undefined ? execute() : previous.then(execute)
        this.tail = current
        void current.then( ()=>{ if (this.tail===current) delete this.tail })
    }

    protected startFullLoad(job:LoadJob):Array<LoadSource> {
        // run two async REST queries in parallel
        const api = [
            this.api.getRouteDescriptions({type:'gpx'},true).then( v=> v.map(e=>enrichApi(e,'gpx'))).catch(error => {throw new ApiError(error,'gpx')}) ,
            this.api.getRouteDescriptions({type:'video'},true).then( v=> v.map(e=>enrichApi(e,'video'))).catch(error => {throw new ApiError(error,'video')}) ,
        ]
        const sources:Array<LoadSource> = [ { results:Promise.allSettled(api), isExternal:false } ]

        const external = this.getExternalRouteServers()
        if (external.length) {
            const promises = external.map( ({key,api:externalApi,url}) => {
                job.servers.set(key,url)
                return this.loadRoutesFromServer(job,key,externalApi,url)
            })
            sources.push( { results:Promise.allSettled(promises), isExternal:true } )
        }
        return sources
    }

    protected startServerLoad(job:LoadJob, key:string):Array<LoadSource> {
        const url = this.getConfiguredUrl(key)
        if (!url) {
            this.logger.logEvent({message:'route server is not configured, load skipped', key})
            return [ { results:Promise.resolve([]), isExternal:true } ]
        }

        job.servers.set(key,url)
        const api = this.getIncyclistRoutesApi().create(key)
        return [ { results:Promise.allSettled([ this.loadRoutesFromServer(job,key,api,url) ]), isExternal:true } ]
    }

    protected getExternalRouteServers():Array<{key:string, api:IIncyclistRoutesApi, url:string}> {
        const externalConfig:Record<string,string> = this.getUserSettings().getValue('routes.servers',null)
        
        const apis = []
        if (!externalConfig)
            return apis

        Object.keys(externalConfig).forEach(key=> {
            const url = externalConfig[key]

            this.logger.logEvent({message:'adding external route server', key, url})

            const api = this.getIncyclistRoutesApi().create(key) 
            apis.push({key,api,url})
        })
        return apis


    }

    /** the address of a route server, as long as it is configured */
    protected getConfiguredUrl(key:string):string|undefined {
        const config = this.getUserSettings().getValue('routes.servers',null)
        if (!config || !Object.hasOwn(config,key))
            return undefined
        return config[key] || undefined
    }

    /** false if the server was removed (or got another address) after the load had requested it: its result must be dropped */
    protected isServerCurrent(job:LoadJob, key:string):boolean {
        if (!job.servers.has(key))
            return true
        return this.getConfiguredUrl(key)===job.servers.get(key)
    }

    /**
     * Loads the route descriptions (video and GPX) of one external route server and records the outcome
     * (in memory only) so that the settings can show the status of each server.
     *
     * The video request decides whether the server counts as reachable. The GPX request is best effort:
     * a server that only offers video routes might not support it, and that must not make it "unreachable".
     *
     * If the server was removed while the requests were open, nothing is recorded and no route is returned.
     * A server that does not answer in time (the timeout is set on its api) is "unreachable".
     */
    protected async loadRoutesFromServer(job:LoadJob, key:string, api:IIncyclistRoutesApi, url?:string):Promise<Array<RouteApiDescription>> {
        const status = this.getRouteServerStatus()
        const isCurrent = ()=> url===undefined || this.getConfiguredUrl(key)===url

        status.setLoading(key)

        try {
            const [videoRoutes, gpxRoutes] = await Promise.all([
                api.getRouteDescriptions({type:'video'},true),
                api.getRouteDescriptions({type:'gpx'},true).catch( error => {
                    this.logger.logEvent({message:'could not load gpx routes of route server', key, reason:error?.message})
                    return [] as Array<RouteApiDescription>
                })
            ])
            if (!Array.isArray(videoRoutes))
                throw new TypeError('route server did not return a list')

            if (!isCurrent())
                return this.dropRemovedServer(job,key)

            // the server is the owner of what it returns, whatever the response claims
            const gpx = Array.isArray(gpxRoutes) ? gpxRoutes : []
            const descriptions = [
                ...videoRoutes.map(e=>({...enrichApi(e,'video'), apiServer:key})),
                ...gpx.map(e=>({...enrichApi(e,'gpx'), apiServer:key}))
            ]

            status.setResult(key, { status: descriptions.length>0 ? 'ok':'empty', routeCount:descriptions.length })
            return descriptions
        }
        catch(error) {
            if (!isCurrent())
                return this.dropRemovedServer(job,key)

            status.setResult(key, { status:'unreachable', routeCount:0 })
            throw new ApiError(error,'video')
        }
    }

    protected dropRemovedServer(job:LoadJob, key:string):Array<RouteApiDescription> {
        this.logger.logEvent({message:'route server was removed while loading, result dropped', key})

        // a load that is queued behind this one (the server was added again) owns the loading flag now
        if (!this.hasNewerLoad(job,key))
            this.getRouteServerStatus().clearLoading(key)
        return []
    }

    protected hasNewerLoad(job:LoadJob, key:string):boolean {
        return Array.from(this.jobs).some( j => j!==job && !j.stopped && (j.serverKey===undefined || j.serverKey===key) )
    }

    /**
     * Runs one load: the requests of all sources are sent at once, their descriptions are processed one source after
     * the other (the built-in server first). The load is done when all sources and the loading of the missing
     * details have finished. A problem in one source never prevents `done`.
     */
    protected async runLoad(job:LoadJob, start:()=>Array<LoadSource>):Promise<void> {
        const observer = job.observer
        this.loadObserver = observer
        this.processed = []

        const details: Array<Promise<void>> = []
        try {
            const sources = start()
            let loaded = false

            // one source after the other (the built-in server first), so that 'loaded' is not delayed by a slow server
            const processOne = async (source:LoadSource):Promise<void> => {
                if (job.stopped)
                    return
                const res = await source.results
                if (job.stopped)
                    return

                const required = await this.processSource(job, res, source.isExternal)
                if (!loaded) {
                    loaded = true
                    observer.emit('loaded')
                }

                if (required.length>0)
                    details.push( this.loadDetailsOfLoad(required) )
            }

            const outcome = await settleWithLimit(sources, 1, processOne)
            outcome.forEach( o => {
                if (o.status==='rejected')
                    this.logger.logEvent({message:'could not process route list load', error:o.reason?.message})
            })
            await Promise.all(details)
        }
        catch(err) {
            this.logger.logEvent({message:'could not process route list load', error:err?.message})
        }

        // a load that is requested from a `done` listener must start a new load, not get this (finishing) observer
        if (this.fullLoad===job)
            delete this.fullLoad

        if (!job.stopped)
            observer.emit('done')

        await sleep(1)
        observer.stop()
        if (this.loadObserver===observer)
            delete this.loadObserver
    }

    protected async processSource(job:LoadJob, res:Array<PromiseSettledResult<Array<RouteApiDescription>>>, isExternal:boolean):Promise<LoadDetailsTargets> {
        const loadDetailRequired: LoadDetailsTargets = []

        const descriptions = res.flatMap( p => {
            if (p.status!=='fulfilled') {
                this.logger.logEvent({message: 'could not load route list',reason:p.reason?.message, type:p.reason?.type})
                return []
            }
            return p.value
        })

        // one route after the other: the checks depend on what was processed before
        const outcome = await settleWithLimit(descriptions, 1, async descr => {
            if (job.stopped || !this.shouldProcess(job,descr,isExternal))
                return
            await this.processRouteFromApi(descr,loadDetailRequired)
        })

        // keep what was processed, the load must still end
        outcome.forEach( o => {
            if (o.status==='rejected')
                this.logger.logEvent({message:'could not process route list load', error:o.reason?.message})
        })
        return loadDetailRequired
    }

    /** Routes of an external server are skipped if the server was removed meanwhile, or if the route was already loaded */
    protected shouldProcess(job:LoadJob, descr:RouteApiDescription, isExternal:boolean):boolean {
        if (!isExternal)
            return true
        return this.isServerCurrent(job,descr.apiServer) && !this.processed.includes(descr.id)
    }

    protected async loadDetailsOfLoad(items:LoadDetailsTargets):Promise<void> {
        try {
            await this.loadDetails(items,true)
        }
        catch(err) {
            this.logger.logEvent({message:'could not load route details', error:err?.message})
        }
    }

    private async processRouteFromApi(descr,items) {
        let description;
        // a placeholder that was created from a paired computer's catalog is not a route of this device: the official route replaces it
        const stored = this.getDescriptionFromDB(descr.routeId??descr.id)
        const existing = stored?.linkShared ? undefined : stored
        const alreadyProcessed = this.processed.includes(descr.routeId??descr.id)

        if (alreadyProcessed)
            return

        // a route can only be updated by the source it belongs to: a server must never replace a route of Incyclist
        // (or of another server), whatever version it claims for it
        if (existing && getOwner(existing)!==getOwner(descr)) {
            this.processed.push(existing.id)
            this.logger.logEvent({message:'route skipped, it belongs to another source',id:existing.id,source:descr.apiServer,owner:existing.apiServer})
            return
        }

        if (ExistingAndNotUpdated(existing, descr)) {
            this.processed.push(existing.id)
            const details = await this.getDetailsFromDB(existing.id)
            if (details) {
                return
            }
            description = existing
            this.logger.logEvent({message:'route details missing',id:description.id,title:description.title})                
            
        }
        else {
            description = this.buildRouteInfo(descr)
            if (!description) {
                this.logger.logEvent({message:'invalid route',descr})
                return
            }
                    
            this.processed.push(descr.id)
            if (!existing) {
                this.logger.logEvent({message:'route added',id:description.id,title:description.title,ts:description.tsImported})
                
                description.tsImported = Date.now()
            }
            else {
                description.tsImported = existing.tsImported
                items.push({route:new Route(description),added:false})
                this.logger.logEvent({message:'route updated',id:description.id,title:description.title,from:existing.version, to:description.version,ts:Date.now(), tsImported:description.tsImported})                
            }
        }


        this.emitAndPrepareLoadDetails(description,items,existing);

    }


    private emitAndPrepareLoadDetails(description: any,items,existing) {

        
        const route = new Route(description);
        const isComplete = this.isCompleted(route);

        if (isComplete) {
            this.verifyRouteHash(route);
        }

        if (!existing) {
            this.emitRouteAdded(route)
            items.push({route,added:true})
            if (isComplete) {
                this.save(route,false).catch( err=>{ this.logger.logEvent({message:'could not save route', id:route.description.id, error:err.message}) })
            }


        }
        else {
            this.save(route,true).catch( err=>{ this.logger.logEvent({message:'could not save route', id:route.description.id, error:err.message}) })
            if (!isComplete)
                items.push({route,added:false})
        }
    }

    protected getDescriptionFromDB(id:string) {
        const db = new RoutesDbLoader()
        return db.getDescription(id)

    }
    protected async getDetailsFromDB(id:string):Promise<RouteApiDetail> {

        const db = new RoutesDbLoader()        
        return await db.getDetails(id)

    }

    async save(route:Route,enforcedWriteDetails:boolean=false):Promise<void> {
        const db = new RoutesDbLoader()
        await db.save(route,enforcedWriteDetails)
    }


    protected isCompleted(route:Route):boolean {
        const descr = route.description

        if (descr.hasVideo) {
            return valid(descr.points) && ( valid(descr.videoUrl) || (descr.requiresDownload && valid(descr.downloadUrl)))
        }
        else {
            return valid(descr.points)
        }
    }

    protected isPreviewMissing(route:Route) {
        const descr = route.description
        return descr?.hasVideo && !descr?.previewUrl
    }

    protected async loadDetailsFromRepo( items:LoadDetailsTargets):Promise<LoadDetailsTargets>{
        // all missing should be loaded from server
        const promises = items.map ( i => this.getDetailsFromDB (i.route.description.id).then( details => { addDetails(i.route,details)}) )

        const res = await Promise.allSettled(promises) 

        const {failed} = await this.processLoadDetailsResult(res, items, false);
        return failed
        
    }


    async loadDetails( items:LoadDetailsTargets, enforced:boolean=false) {

        try {
            const isUnique = (v,i,a)=> {
                return a.findIndex( item => item.route.description.id===v.route.description.id)===i
            }
            items = items.filter( (v,i,a)=>isUnique(v,i,a) )
        }
        catch(err) {
            this.logger.logEvent({ message: 'error', fn:'loadDetails#unique',error: err.message, stack: err.stack })
        }
        // first try to load details from repo
        
        const failed = enforced ? items : await this.loadDetailsFromRepo(items)


        // all missing should be loaded from server - bounded, so a fresh catalog does not start
        // every transfer at once
        const res = await settleWithLimit(failed, ROUTE_DETAILS_CONCURRENCY, i => this.getDetails(i.route))

        await this.processLoadDetailsResult(res, items, true);

    }

    private async processLoadDetailsResult(res: PromiseSettledResult<void>[],items: LoadDetailsTargets, save?:boolean):Promise<{success:LoadDetailsTargets,  failed: LoadDetailsTargets}> {
        const success:LoadDetailsTargets = []
        const failed: LoadDetailsTargets = []

        res.forEach((pr, idx) => {
            if (pr.status === 'fulfilled') success.push(items[idx]);
            else failed.push(items[idx]);
        });

        for (const element of success) {
            const item = element
//        success.forEach(item => {
            this.emitRouteEvents(true,item.route)


            await this.verifyCountry(item.route);
            this.verifyRouteHash(item.route)

            if (save)
                this.save(item.route, true).catch( err=>{ this.logger.logEvent({message:'could not save route', id:item.route?.description?.id, error:err.message}) });

        //});
        }

        return {success,failed}
    }

    protected async getDetails(route:Route):Promise<void> {


        let api = this.api;
        if (route.description.apiServer) {
            api = this.getIncyclistRoutesApi().create(route.description.apiServer)
        }
        const details = await api.getRouteDetails(route.description.legacyId||route.description.id)
        addDetails(route,details)

            
    }

    protected buildRouteInfo( descr:RouteApiDescription, isLocal?:boolean): RouteInfo {
        const { id,routeId,title,localizedTitle,country,distance,elevation, category,provider, video, requiresDownload,points,previewUrl,downloadUrl,routeHash,version,isDeleted,apiServer} = descr
        
        const data:RouteInfo = { title,localizedTitle,country,distance,elevation,provider,category,previewUrl,requiresDownload,downloadUrl,routeHash,version,isDeleted}

        data.hasVideo = false;
        data.hasGpx = false;
        data.isLocal = isLocal||false
        data.id = routeId || id
        data.legacyId = routeId? id: undefined


        this.updateRouteCountry(data,{descr})
        this.updateRouteTitle(data,{descr})

        if (points) data.hasGpx = true;

        if (category?.toLowerCase()==='demo') 
            data.isDemo = true;

        if (video) {
            data.hasVideo = true;
            if (video.format) data.videoFormat = video.format
            if (video.url && !data.videoUrl) data.videoUrl = video.url            
        }
        if (apiServer) {
            data.apiServer = apiServer
            data.source =  pascalCase(apiServer)
        }

        return data;
    }

    @Injectable
    protected getIncyclistRoutesApi() {
        return useIncyclistRoutesApi()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getRouteServerStatus() {
        return useRouteServerStatus()
    }



 
}

