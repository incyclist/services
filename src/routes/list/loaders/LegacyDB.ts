import { JSONObject } from "../../../api"
import { Singleton } from "../../../base/types"
import { Observer, PromiseObserver } from "../../../base/types/observer"
import { valid } from "../../../utils/valid"
import { RouteInfo } from "../../base/types"
import { RouteDBApiDescription } from "./types"
import { DBLoader } from "./DBLoader"

@Singleton
export class RoutesLegacyDbLoader extends DBLoader<RouteDBApiDescription>{
    
    protected loadObserver: Observer
    protected saveObserver: PromiseObserver<void>
    

    constructor () {
        super()
        this.routeDescriptions = []        
    }


    async save(): Promise<void> {
        // not required - routes should only be saved from DBLoader
        return;
    } 

    protected getIsLocal(descr:RouteDBApiDescription):boolean {
        const {type,category} = descr
        if (type==='video') {
            return !valid(category) || category==='Imported'
        }
        if (type==='gpx') {
            return category==='personal'
        }        
    }


    protected buildRouteInfo(descr:RouteDBApiDescription):RouteInfo {
        const { id,legacyId,title,localizedTitle,country,distance,elevation, category,provider, video, points,type,routeHash, originalName} = descr
        
        const data:RouteInfo = { id,legacyId,title,localizedTitle,country,distance,elevation,provider,category,routeHash,originalName}

        data.hasVideo = false;
        data.hasGpx = type==='gpx'
        data.isLocal = this.getIsLocal(descr)
        

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

    protected buildRouteDBInfo():RouteDBApiDescription {
        throw new Error('not implemented')
    }

    protected isCompleted(): boolean {
        // ensure that loadDetails is not called and 'route.added' events are emitted
        return true        
    }

    protected checkLegacy(descr:RouteDBApiDescription ):RouteDBApiDescription {
        if (descr.routeId) {
            descr.legacyId = descr.id
            descr.id = descr.routeId
            delete descr.routeId
        }
        return descr
    }

    protected async loadDescriptions():Promise<Array<RouteDBApiDescription>> {

        const add = (data:JSONObject, type:'video'|'gpx') => {
            try {
                const routes = data as unknown as Array<RouteDBApiDescription>                
                return routes.map( r=> {
                    r.type = type;
                    return r
                })
            }
            catch(err) {
                return null;
            }

        }

        const videos = this.getVideosRepo().read('routes').then( data=>add(data,'video'))
        const routes = this.getRoutesRepo().read('routes').then( data=>add(data,'gpx'))

        const descriptions:Array<RouteDBApiDescription> = []

        const res = await Promise.allSettled( [videos,routes]) 
        res.forEach( p => {
            if (p.status==='fulfilled' && p.value) {                   
                const data = p.value.map( d=>this.checkLegacy(d))
                
                descriptions.push( ...data)
            }
        })
       
        return descriptions;
    }

    protected async loadDetails():Promise<void> {
        // Legacy DB is only used to load descriptions
        // details should be loaded via DB Loader
        throw new Error('not implemented')
    }

}
