import { Observer, PromiseObserver } from "../../../base/types/observer";
import IncyclistRoutesApi from "../../base/api";
import { RouteApiDescription } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RoutesDbLoader } from "./db";
import { Loader } from "./types";

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
            res.forEach( p  => { 
                if (p.status==='fulfilled') {  
                    p.value.forEach( descr=> {
                        const description = this.buildRouteInfo(descr)

                        // TODO: check if route is already in list (loaded from file)
                        // If so: only update if it has changed on server 
                        // Also: don't load details for these routes                        
                        const route = new Route( description)

                        const isComplete = this.isCompleted(route)
                        if (isComplete)
                            this.emitRouteAdded(route)
                        items.push({route,added:isComplete})

                    })
                }
            })

            await this.loadDetails(items)
            
            //delete this.loadObserver
        });

        return this.loadObserver
        
    }

    stopLoad() {
        delete this.loadObserver
    }

    async save(route:Route):Promise<void> {
        const db = new RoutesDbLoader()
        await db.save(route)
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

    async loadDetails( items:Array<{route:Route, added:boolean}>) {
        
        const promises = items.map ( i => this.getDetails(i.route) )

        const res = await Promise.allSettled(promises) 

        const success = []
        const failed = []
        res.forEach ( (pr,idx) => {
            if (pr.status==='fulfilled') success.push( items[idx])
            else failed.push(items[idx])
        })

        success.forEach( item => {
            if (item.added)
                this.emitRouteUpdate(item.route)    
            else 
                this.emitRouteAdded(item.route)

            
            this.verifyCountry(item.route)
        })

    }

    protected async getDetails(route:Route):Promise<void> {

        const details = await this.api.getRouteDetails(route.description.id)
        this.addDetails(route,details)

            
    }

    protected buildRouteInfo( descr:RouteApiDescription, isLocal?:boolean): RouteInfo {
        const { id,title,localizedTitle,country,distance,elevation, category,provider, video, points,previewUrl} = descr
        
        const data:RouteInfo = { id,title,localizedTitle,country,distance,elevation,provider,category,previewUrl}

        data.hasVideo = false;
        data.hasGpx = false;
        data.isLocal = isLocal||false

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