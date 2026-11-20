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
import { pascalCase } from "../../../utils";
import { useRouteServerStatus } from "../../servers/status";

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

export class RoutesApiLoader extends Loader<RouteApiDescription> {

    protected api: IIncyclistRoutesApi
    protected saveObserver: PromiseObserver<void>
    protected logger: EventLogger
    protected processed: Array<string> = []

    constructor () {
        super()
        this.api = this.getIncyclistRoutesApi().create() 
        this.logger = new EventLogger('RoutesApi')
    }


    load():Observer {
        this.processed = []

        // no concurrent loads
        if (this.loadObserver)
            return this.loadObserver

        // run two async REST queries in parallel
        const enrichApi = (v:RouteApiDescription,type)=> ({type, ...v })
                
        const api = [
            this.api.getRouteDescriptions({type:'gpx'},true).then( v=> v.map(e=>enrichApi(e,'gpx'))).catch(error => {throw new ApiError(error,'gpx')}) ,
            this.api.getRouteDescriptions({type:'video'},true).then( v=> v.map(e=>enrichApi(e,'video'))).catch(error => {throw new ApiError(error,'video')}) ,
        ]


        this.loadObserver = new Observer()

        // When both queries have completed ( either successfully or failed) then process the result
        // but ths method should return immediatly (not waiting for the result of the query)
        Promise.allSettled( api).then (async res => {
            await this.onLoadDone(api,res)
        }).catch( err=>{ this.logger.logEvent({message:'could not process route list load', error:err.message}) });


        const external = this.getExternalRouteServers()
        const promises = []
        if (external.length) {
            
            for (const {key, api:externalApi} of external) {
                // promises.push(
                //     externalApi.getRouteDescriptions({type:'gpx'},true).then( v=> v.map(e=>enrichApi(e,'gpx'))).catch(error => {throw new ApiError(error,'gpx')}) 
                // )
                promises.push( this.loadVideoRoutesFromServer(key,externalApi,enrichApi) )
            }

            Promise.allSettled( promises).then (async res => {
                await this.onLoadDone(api,res,true)
            }).catch( err=>{ this.logger.logEvent({message:'could not process route list load', error:err.message}) });

        }



        return this.loadObserver
        
    }

    protected getExternalRouteServers():Array<{key:string, api:IIncyclistRoutesApi}> {
        const externalConfig:Record<string,string> = this.getUserSettings().getValue('routes.servers',null)
        
        const apis = []
        if (!externalConfig)
            return apis

        Object.keys(externalConfig).forEach(key=> {
            const baseUrl = externalConfig[key]

            this.logger.logEvent({message:'adding external route server', key, url:baseUrl})

            const api = this.getIncyclistRoutesApi().create(key) 
            apis.push({key,api})
        })
        return apis


    }

    /**
     * Loads the video route descriptions of one external route server and records the outcome (in memory only)
     * so that the settings can show the status of each server.
     */
    protected async loadVideoRoutesFromServer(key:string, api:IIncyclistRoutesApi, enrichApi:(v:RouteApiDescription,type:string)=>RouteApiDescription):Promise<Array<RouteApiDescription>> {
        const status = this.getRouteServerStatus()
        status.setLoading(key)

        try {
            const descriptions = await api.getRouteDescriptions({type:'video'},true)
            if (!Array.isArray(descriptions))
                throw new TypeError('route server did not return a list')

            status.setResult(key, { status: descriptions.length>0 ? 'ok':'empty', routeCount:descriptions.length })
            return descriptions.map(e=>enrichApi(e,'video'))
        }
        catch(error) {
            status.setResult(key, { status:'unreachable', routeCount:0 })
            throw new ApiError(error,'video')
        }
    }

    /**
     * Loads the routes of a single external route server (e.g. right after it was added), without waiting for
     * (or repeating) a full load. If a load is currently running, this load starts as soon as that one is done.
     *
     * The returned observer emits the same events as load()
     */
    loadServer(key:string):Observer {
        const observer = new Observer()

        const run = ()=> {
            this.processed = []
            this.loadObserver = observer

            const enrichApi = (v:RouteApiDescription,type)=> ({type, ...v })
            const api = this.getIncyclistRoutesApi().create(key)
            const promises = [ this.loadVideoRoutesFromServer(key,api,enrichApi) ]
            Promise.allSettled(promises).then( async res => {
                await this.onLoadDone(undefined,res,true)
            }).catch( err=>{ this.logger.logEvent({message:'could not process route server load', key, error:err.message}) });
        }

        if (this.loadObserver) {
            const running = this.loadObserver
            let started = false
            const start = ()=> {
                if (started)
                    return
                started = true
                run()
            }
            running.once('done',start)
            running.once('stopped',start)
        }
        else {
            run()
        }

        return observer
    }

    private async onLoadDone(api,res,isExternal=false) {

        // another load (e.g. of a single server) might start while this one is finishing
        const observer = this.loadObserver

        // join lists
        const loadDetailRequired: Array<{route:Route, added:boolean}> = []

        // for loop as we have asyncs here
        for ( let i=0; i<res.length;i++) {
            const p = res[i]

            if (p.status!=='fulfilled') {                   
                this.logger.logEvent({message: 'could not load route list',reason:p.reason?.message, type:p.reason?.type})
                continue;
            }

            for (let j=0;j<p.value.length;j++) {
                if (isExternal && this.processed.includes(p.value[j].id))
                    continue;
                await this.processRouteFromApi(p.value[j],loadDetailRequired)
            }
            
        }
        observer?.emit('loaded')

        if (loadDetailRequired.length>0) {            
            await this.loadDetails(loadDetailRequired,true)
        }

        observer?.emit('done')

        await sleep(1)        
        observer?.stop()
        if (this.loadObserver===observer)
            delete this.loadObserver        
        
    }

    private async processRouteFromApi(descr,items) {
        let description;
        const existing = this.getDescriptionFromDB(descr.routeId??descr.id)
        const alreadyProcessed = this.processed.includes(descr.routeId??descr.id)

        if (alreadyProcessed)
            return

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

    stopLoad() {
        this.loadObserver?.stop()
        delete this.loadObserver
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

