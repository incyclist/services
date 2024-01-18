import { Observer } from "../../../base/types/observer";
import { waitNextTick } from "../../../utils";
import { valid } from "../../../utils/valid";
import { RouteApiDescription, RouteApiDetail } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { checkIsLoop, getRouteHash } from "../../base/utils/route";

export interface RouteInfoDBEntry extends RouteInfo {
    pointsEncoded?:string
}

export interface RouteDBApiDescription extends RouteApiDescription {
    type: 'video'|'gpx',
    legacyId?:string,
    originalName?:string
}

interface MinimalDescription {
    country?: string
    title?:string
}

export abstract class Loader<T extends MinimalDescription> { 
    protected loadObserver: Observer

    abstract load():Observer 
    abstract stopLoad():void
    abstract save(route:Route):Promise<void>

    protected abstract buildRouteInfo(descr:T):RouteInfo 

    protected isCompleted(route:Route):boolean {
        const descr = route.description

        if (!valid(descr.points))
            return false;

        if (descr.hasVideo) {
            return   valid(descr.videoUrl) || (descr.requiresDownload && valid(descr.downloadUrl))
        }

        return true;
    }

    protected verifyRouteHash(route:Route) {
        const {description,details} = route

        if (description.points && !description.routeHash) {
            if (details?.routeHash) {
                description.routeHash = details.routeHash
                return;
            }

            const data:RouteApiDetail = details || { id:description.id,title:description.title,points:description.points}
            description.routeHash = getRouteHash( data) 
        }

    }

    protected async verifyCountry(route:Route) {
        const updated = await route.updateCountryFromPoints()
        
        if (updated) {                            
            this.emitRouteUpdate(route)    
        }      
    }

    protected getCountryPrefix(title?:string):string|undefined {
        if (!title)
            return

        if (title.match(/^[A-z]{2}[-_].*/g)) {            
            return title.substring(0,2)
        }
    }

    protected updateRouteCountry( data: RouteInfo, route:{ descr?:T}):void {
        const {descr} = route;

        
        if (descr?.country && !data.country) {
            data.country = descr.country
        }
        if (data.country)
            return;

        const prefix = this.getCountryPrefix(data.title) as string
        if (prefix) {
            data.country = prefix.toLowerCase()
            if (data.category)
                return;
        }       
       
    }

    protected updateRouteTitle( data: RouteInfo, route:{ descr?:T}):void{
        const {descr} = route;
        if (descr && !data.title) {
            data.title = descr.title
        }
        const prefix = this.getCountryPrefix(data.title) as string
        if (prefix) {
            data.title = this.removeCountryPrefix(data.title)
        }

    }

    protected removeCountryPrefix(title?:string):string {
        if (!title)
            return

        if (title.match(/^[A-z][A-z][-_].*/g)) {
            return title.substring(3)
        }
        
    }






    protected emitRouteUpdate( route:Route) {
        if (this.loadObserver)
            this.loadObserver.emit('route.updated',route)
    }
    protected emitRouteAdded( route:Route) {
        if (this.loadObserver)
            this.loadObserver.emit('route.added',route)
    }
    protected emitDone() {
        if (this.loadObserver)
            this.loadObserver.emit('done')
        
        waitNextTick().then(()=>{
            this.loadObserver.reset()
            delete this.loadObserver
        })
    }

    protected addDetails(route:Route, details:RouteApiDetail) {
        route.details = details
        route.description.points = details.points
        
        if (route.description.hasVideo) {
            route.description.requiresDownload = valid(details.downloadUrl)
            route.description.downloadUrl = details.downloadUrl
            if (!valid(route.description.videoUrl)) {
                route.description.videoUrl = details.video.url 
            }
            if (!valid(route.description.videoUrl)) {
                route.description.videoUrl = valid(details.video.file) ? 'video:///'+details.video.file : undefined
            }

            if (!valid(route.description.videoFormat)) {
                route.description.videoFormat = details.video.format
            }
            if (!valid(route.description.previewUrl)) {
                route.description.previewUrl = details.previewUrl                
            }
           
            route.description.hasGpx = details.points.find( p=> p.lat && p.lng)!==undefined
            route.description.next = details.video?.next
            

        }

        if (!valid(route.description.routeHash))
            route.description.routeHash = details.routeHash

        route.description.isLoop = checkIsLoop(route.description.points)

    }


}

export type LoadDetailsTargets = Array<{
    route: Route;
    added: boolean;
}>;

