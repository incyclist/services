import { Observer, PromiseObserver } from "../../../base/types/observer";
import IncyclistRoutesApi from "../../base/api";
import { RouteApiDescription, RouteApiDetail } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RoutesDbLoader } from "./db";
import { Loader } from "./types";
import { LoadDetailsTargets } from "./types";

const valid = (v) => (v!==undefined && v!==null)

export class RoutesApiLoader extends Loader<RouteApiDescription> {

    protected api: IncyclistRoutesApi
    protected loadObserver: Observer
    protected saveObserver: PromiseObserver<void>

    constructor () {
        super()
        this.api = IncyclistRoutesApi.getInstance()        
    }


    load():Observer {
        // no concurrent loads
        if (this.loadObserver)
            return this.loadObserver

        const enrichApi = (v:RouteApiDescription,type)=> ({type, ...v })
        const api = [
            this.api.getRouteDescriptions({type:'gpx'}).then( v=> v.map(e=>enrichApi(e,'gpx'))) ,
            this.api.getRouteDescriptions({type:'video'}).then( v=> v.map(e=>enrichApi(e,'video')))
        ]

        this.loadObserver = new Observer()

        Promise.allSettled( api).then (async res => {

            // join lists
            const items: Array<{route:Route, added:boolean}> = []

            // for loop as we have asyncs here
            for ( let i=0; i<res.length;i++) {
                const p = res[i]

                if (p.status==='fulfilled') {  
                    for (let j=0;j<p.value.length;j++) {
                        const descr = p.value[j]

                    
                        let description;

                        const existing = this.getDescriptionFromDB(descr.routeId||descr.id)
                        const {isDeleted=false} = descr

                        if (existing 
                              && ((existing.version||0)>=(descr.version||0)) 
                              && (!isDeleted || (isDeleted && existing.isDownloaded))
                            ) {

                            const details = await this.getDetailsFromDB(existing.id)
                            if (details) {
                                continue;
                            }
                            description = existing
                            
                        }
                        else {
                            description = this.buildRouteInfo(descr)
                        }

                        if (!description) {
                            continue
                        }


                        
                        const route = new Route( description)

                        const isComplete = this.isCompleted(route)
                        
                        if (isComplete) {
                            this.verifyRouteHash(route)
                            this.emitRouteAdded(route)
                        }

                        if (!existing) {
                            items.push({route,added:isComplete})
                        }
                        else {
                            this.save(route,true)
                        }

                    }
                }
            }

            await this.loadDetails(items)
            
            //delete this.loadObserver
        });

        return this.loadObserver
        
    }

    stopLoad() {
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
            return valid(descr.points) && ( valid(descr.videoUrl)) || (descr.requiresDownload && valid(descr.downloadUrl))
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
        const promises = items.map ( i => this.getDetailsFromDB (i.route.description.id).then( details => { this.addDetails(i.route,details)}) )

        const res = await Promise.allSettled(promises) 

        const {failed} = this.processLoadDetailsResult(res, items, false);
        return failed
        
    }


    async loadDetails( items:LoadDetailsTargets) {


        // first try to load details from repo
        const failed = await this.loadDetailsFromRepo(items)


        // all missing should be loaded from server
        const promises = failed.map ( i => this.getDetails(i.route) )

        const res = await Promise.allSettled(promises) 

        this.processLoadDetailsResult(res, items, true);

    }

    private processLoadDetailsResult(res: PromiseSettledResult<void>[],items: LoadDetailsTargets, save?:boolean):{success:LoadDetailsTargets,  failed: LoadDetailsTargets} {
        const success:LoadDetailsTargets = []
        const failed: LoadDetailsTargets = []

        res.forEach((pr, idx) => {
            if (pr.status === 'fulfilled') success.push(items[idx]);
            else failed.push(items[idx]);
        });

        success.forEach(item => {
            if (item.added)
                this.emitRouteUpdate(item.route);

            else
                this.emitRouteAdded(item.route);


            this.verifyCountry(item.route);
            this.verifyRouteHash(item.route)

            if (save)
                this.save(item.route, true);

        });

        return {success,failed}
    }

    protected async getDetails(route:Route):Promise<void> {

        const details = await this.api.getRouteDetails(route.description.legacyId||route.description.id)
        this.addDetails(route,details)

            
    }

    protected buildRouteInfo( descr:RouteApiDescription, isLocal?:boolean): RouteInfo {
        const { id,routeId,title,localizedTitle,country,distance,elevation, category,provider, video, points,previewUrl,routeHash,version,isDeleted} = descr
        
        const data:RouteInfo = { title,localizedTitle,country,distance,elevation,provider,category,previewUrl,routeHash,version,isDeleted}

        data.hasVideo = false;
        data.hasGpx = false;
        data.isLocal = isLocal||false
        data.id = routeId || id
        data.legacyId = routeId? id: undefined


        this.updateRouteCountry(data,{descr})
        this.updateRouteTitle(data,{descr})
        // Todo: previewImg (could be generated from video/streetview)

        if (points) data.hasGpx = true;

        if (category?.toLowerCase()==='demo') 
            data.isDemo = true;

        if (video) {
            data.hasVideo = true;
            if (video.format) data.videoFormat = video.format
            if (video.url && !data.videoUrl) data.videoUrl = video.url            
        }

        return data;
    }

 
}