import { Observer } from "../../../base/types/observer";
import { getBindings } from "../../../api";
import { waitNextTick } from "../../../utils";
import { valid } from "../../../utils/valid";
import { RouteApiDescription, RouteApiDetail } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { buildFileUrl, buildVideoUrl } from "../../base/parsers/utils";
import { RouteInfo } from "../../base/types";
import { getRouteHash } from "../../base/utils/route";

// A well-formed `video://` URL has at most 3 slashes after the scheme
// (`video:///abs/path` or `video://./rel/path`). 4+ slashes indicates the
// malformed URL produced by the historic download-completion bug, where an
// already-absolute path was appended to a hardcoded 3-slash prefix.
const MALFORMED_VIDEO_URL = /^video:\/{4,}/

/**
 * Given a persisted `video:` URL, returns the corrected form, or `undefined`
 * if no correction is needed — the single shared place that decides whether a
 * persisted `video.url` needs correcting, used both by the legacy-migration
 * path (`Loader.verifyVideoUrl()` below) and the normal hot load path
 * (`RoutesDbLoader.getDetails()`).
 *
 * Two independent things get corrected, platform-aware:
 * - Malformed slash count (4+ slashes after the scheme, from the historic
 *   download-completion bug) is always corrected down to a well-formed count,
 *   on every platform.
 * - `video:` is a desktop-only convention — Electron registers a real custom
 *   protocol handler for it (see `RLVDisplayService.cleanupUrl()`, which keeps
 *   flipping `video:`/`file:` at render time on desktop). Mobile has no such
 *   handler, so on mobile the scheme itself is corrected all the way to
 *   `file:` — not left as a (possibly now well-formed) `video:` URL.
 *   (`resolveNativeVideoSrc.ts` in `mobile` still does this same swap at
 *   render time too, as a last line of defense — this is the primary,
 *   data-layer fix, not a replacement for it.)
 *
 * Both corrections happen in a single pass on mobile - a malformed 4-slash
 * `video:` URL there ends up as a well-formed `file:` URL directly, rather
 * than a well-formed `video:` URL a user might see for one app load before a
 * second correction pass fixes the scheme.
 */
export const correctVideoUrl = (url?: string, isMobile: boolean = false): string | undefined => {
    if (!url?.startsWith('video:'))
        return undefined

    const malformed = MALFORMED_VIDEO_URL.test(url)

    // Desktop (and any other non-mobile platform): only the malformed case
    // needs correcting - an already-correct video:// URL is left alone.
    if (!malformed && !isMobile)
        return undefined

    // Malformed URLs always look like 'video:' + the historic hardcoded
    // 3-slash prefix + the original (already-absolute) path, e.g.
    // 'video:////storage/x.mp4' from 'video:///' + '/storage/x.mp4'.
    // Well-formed URLs are just 'video:' + the base 2-slash separator + the
    // path. Either way, stripping down to the raw path lets us rebuild it
    // correctly for whichever scheme the target platform needs.
    const rawPath = malformed
        ? url.replace(/^video:\/{3}/, '')
        : url.replace(/^video:\/{2}/, '')

    return isMobile ? buildFileUrl(rawPath) : buildVideoUrl(rawPath)
}

export interface RouteInfoDBEntry extends RouteInfo {
    pointsEncoded?:string
}

export interface RouteDBApiDescription extends RouteApiDescription {
    type: 'video'|'gpx',
    legacyId?:string,
    originalName?:string
}

export interface MinimalDescription {
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

    // matches RouteCard.isMobile() / RLVDisplayService.isMobile()
    /* istanbul ignore next */
    protected isMobile():boolean {
        return getBindings()?.appInfo?.getChannel()==='mobile'
    }

    protected verifyRouteHash(route:Route):boolean {
        const {description,details} = route

        const prev = description.routeHash

        if (description.points && !description.routeHash) {
            if (details?.routeHash) {
                description.routeHash = details.routeHash
                return true;
            }

            const data:RouteApiDetail = details || { id:description.id,title:description.title,points:description.points}
            description.routeHash = getRouteHash( data) 
            return description.routeHash!==prev
        }

    }

    protected verifyVideoUrl(route:Route):boolean {
        const descr = route.description
        let updated = false

        if (!descr.hasVideo)
            return;

        if (descr.videoUrl) {
            const details = route.details

            const corrected = correctVideoUrl(details.video.url, this.isMobile())
            if (corrected) {
                details.video.url = corrected
                updated = true;
            }

            if (details.video.url.startsWith('video:') && !descr.isDownloaded && !descr.isLocal) {
                descr.isDownloaded = true;
                updated = true;
            }


            if (details.video.url && descr.videoUrl!==details.video.url) {
                descr.videoUrl=details.video.url
                return true;
            }
        }

        return updated;
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

        const prefix = this.getCountryPrefix(data.title)
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
        const prefix = this.getCountryPrefix(data.title)
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

    protected emitRouteEvents(isUpdated: boolean, route: Route) {
        if (isUpdated) {
            this.emitRouteUpdate(route);
        }
        else {
            this.emitRouteAdded(route);

        }
    }




}

export type LoadDetailsTargets = Array<{
    route: Route;
    added: boolean;
}>;

