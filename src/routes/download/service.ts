import { getBindings } from "../../api";
import { IncyclistService } from "../../base/service";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { Route } from "../base/model/route";
import { RoutesApiLoader } from "../list/loaders/api";
import { RoutesDbLoader } from "../list/loaders/db";
import { DownloadObserver } from "./types";


export class RouteDownloadService extends IncyclistService {

    protected downloads: Array< {route:Route,observer:DownloadObserver }>
    protected progressLogTs: Record<string,number>

    constructor() {
        super('Routes')
        this.progressLogTs = {}
        this.downloads = []
    }

    getRepo() {
        return new RoutesDbLoader()
    }

    getRoutesApi() {
        return new RoutesApiLoader()
    }

    download( route:Route): DownloadObserver {
        const running = this.getObserver(route)
        if (running) {
            return running
        }

        const observer = new DownloadObserver( this._download(route) )
        this.downloads.push( {route,observer})
        
        return observer
    }

    stopDownload( route:Route) {
        const idx= this.downloads.findIndex( d=> d.route.description.id ===route.description.id)
        if (idx===-1)
            return;

        const info = this.downloads[idx]
        info.observer.stop()

        this.downloads.splice(idx,1)
    }

    protected getObserver(route:Route) {
        const info= this.downloads.find( d=> d.route.description.id ===route.description.id)
        return info?.observer
    }

    protected async _download(route:Route):Promise<void> {
        // Let's make sure that the observer already has been passed
        await waitNextTick()

        const observer = this.getObserver(route)
        
        try {
            const videoDir = await this.waitForVideoDir(observer)
            this.downloadRoute(route,videoDir,observer)
        }
        catch(err) {
            observer.emit('error',err)
        }
   }

    protected waitForVideoDir(observer:DownloadObserver) {
        
        const settings = useUserSettings()

        const videoDir = settings.get('videos.directory',null)
        if (!videoDir) {
            const reqId = Date.now().toString()
            const settingsObserver = settings.requestNotifyOnChange( reqId,'videos.directory' )
            
            // request user to configure 
            observer?.emit('videoDir.unknown')

            return new Promise( done=> {
                
                settingsObserver.on('changed', (dir) => {
                    observer?.emit('videoDir.ok')
                    settings.stopNotifyOnChange(reqId)
                    done(dir)                
                })
    
            })
    
        }

        return videoDir
    }

    protected async downloadRoute(route:Route, targetDir:string, observer:DownloadObserver):Promise<void> {

        let url;
        try {
            url = route?.description?.downloadUrl || route?.description?.videoUrl

            if (!url) {
                url = this.restoreFromRepo(route)
            }
            if (!url) {
                observer.emit('error', new Error('download not supported'))
                return;
            }
            
            const {id,title} = route.description;

            const {path,downloadManager} = getBindings()
            if (!path || !downloadManager) {
                observer.emit('error', new Error('download not supported'))
                return;
            }

            const info = path.parse( url)
            if (!info) {
                const logInfo = {...route.description}
                delete logInfo.points
                this.logEvent({message:'no URL specified',logInfo})
                observer.emit('error', new Error('no URL specified'))
                return;
            }
            const file = path.join( targetDir, info.base)
            const session = downloadManager.createSession(url,file)

            observer.setSession(session)
            const onError = (err) => { 
                this.logEvent({message:'download failed ',title, id,url,reason:err.message })
                observer.emit('error', err)
            }

            const onProgress = (pct,speed,bytes)=> { this.onDownloadProgress(id,observer,pct,speed,bytes)}

            this.logEvent({message:'start download',title, id,url})
            session.on('started', ()=>{observer.emit('started') })
            session.on('close', ()=> { /*console.log('~~~ CLOSE') */ })
            session.on('progress', onProgress)
            session.on('error', onError)
            session.once('done', ()=>{ 
                this.logEvent({message:'download finished ',title, id,url})
                observer.emit('done', `video:///${file}`)
            })    
            session.start()
        }
        catch(err) {
            this.logError(err,'downloadRoute',{url})
            observer.emit('error',err)
        }        


    }

    protected async restoreFromRepo(route:Route) {
        
        await this.getRoutesApi().loadDetails([{route, added:false}],true)

        await waitNextTick()



        const descr = this.getRepo().getDescription(route.description.id)
        return descr?.downloadUrl || descr?.videoUrl


    }

    protected onDownloadProgress(id:string, observer:DownloadObserver, pct,speed,downloaded) {
        const prev = this.progressLogTs[id]||0
        const ts = Date.now()
        if (ts-prev>1000) {
            this.logEvent({message:'download progress', pctComplete:pct, downloaded, downloadSpeed: speed})                                            
            this.progressLogTs[id] = ts
        }
        observer.emit('progress',Number(pct))
    }
}