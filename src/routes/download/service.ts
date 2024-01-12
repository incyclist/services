import { getBindings } from "../../api";
import { IncyclistService } from "../../base/service";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { Route } from "../base/model/route";
import { DownloadObserver } from "./types";


export class RouteDownloadService extends IncyclistService {

    protected downloads: Array< {route:Route,observer:DownloadObserver }>
    protected progressLogTs: Record<string,number>

    constructor() {
        super('Routes')
        this.progressLogTs = {}
        this.downloads = []
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
        const videoDir = await this.waitForVideoDir(observer)
        this.downloadRoute(route,videoDir,observer)
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

        const url = route.description.downloadUrl || route.description.videoUrl
        const {id,title} = route.description;

        const {path,downloadManager} = getBindings()
        if (!path || !downloadManager) {
            observer.emit('error', new Error('download not supported'))
            return;
        }

        const info = path.parse( url)
        const file = path.join( targetDir, info.base)
        const session = downloadManager.createSession(url,file)

        observer.setSession(session)
        
        this.logEvent({message:'start download',title, id,url})
        session.on('started', ()=>{observer.emit('started') })
        session.on('close', ()=> { console.log('~~~ CLOSE')})
        session.on('progress', (pct,speed,bytes)=> { this.onDownloadProgress(id,observer,pct,speed,bytes)})
        
        session.on('error', observer.emit.bind(observer) )
        session.once('done', ()=>{ 
            this.logEvent({message:'download finished ',title, id,url})
            observer.emit('done', `video:///${file}`)
        })    
        session.start()
        


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