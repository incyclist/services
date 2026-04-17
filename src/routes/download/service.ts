import { getBindings } from "../../api";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { Route } from "../base/model/route";
import { RoutesApiLoader } from "../list/loaders/api";
import { RoutesDbLoader } from "../list/loaders/db";
import { DownloadObserver } from "./types";

@Singleton
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

    getActiveDownloads(): Array<{route: Route, observer: DownloadObserver}> {
        return this.downloads
    }    

    download( route:Route): DownloadObserver {
        const running = this.getObserver(route)
        if (running) {
            return running
        }

        const observer = new DownloadObserver( this._download(route) )
        this.downloads.push( {route,observer})
        this.emit('download-started', route, observer)
        
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

    protected async deleteIncompleteFile(route:Route, videoDir:string) {
        const {file} = await this.getDownloadFileName(route,videoDir)
        if (file) {
            try {
                const fs = getBindings().fs
                fs?.unlink(file)
            }
            catch(err:any) {
                this.logError(err, 'deleteIncompleteFile')
            }

        }
    }

    protected getObserver(route:Route) {
        const info= this.downloads.find( d=> d.route.description.id ===route.description.id)
        return info?.observer
    }

    protected async _download(route:Route):Promise<void> {
        // Let's make sure that the observer already has been passed
        await waitNextTick()

        const observer = this.getObserver(route)
        if (!observer)
            return;

        
        try {
            const videoDir = await this.waitForVideoDir(observer)
            if (videoDir) {
                observer.once( 'stopped',()=>{

                    this.deleteIncompleteFile(route,videoDir)
                })
                this.downloadRoute(route,videoDir,observer)
            }    
            else {
                this.logEvent( {message:'could not start download', reason:'video dir not specified'})
            }
        }
        catch(err) {
            observer.emit('error',err)
        }
   }

    protected waitForVideoDir(observer:DownloadObserver):Promise<string|undefined> {

        if (this.isMobile()) {
            this.logEvent({message:'setting fixed video dir on mobile'})
            try {
                const videoDir = this.getBindings()?.downloadManager?.getVideoDir?.()
                this.logEvent({message:'video dir set', videoDir})
                return Promise.resolve(videoDir)
            }
            catch {}
        } 

        const settings = useUserSettings()

        const videoDir = settings.get('videos.directory',null)
        if (!videoDir) {
            const reqId = Date.now().toString()
            const settingsObserver = settings.requestNotifyOnChange( reqId,'videos.directory' )
            
            // request user to configure 
            observer?.emit('videoDir.unknown')

            return new Promise( done=> {
                
                settingsObserver.on('changed', (dir:string) => {
                    observer?.emit('videoDir.ok')
                    settings.stopNotifyOnChange(reqId)
                    done(dir)                
                })
    
            })
    
        }

        return videoDir
    }

    protected async getDownloadFileName(route:Route,targetDir:string): Promise<{file?:string, url?:string,error?:string}> {
        let url:string|undefined, file:string, error
        try {
            const {path} = getBindings()
            url = route?.description?.downloadUrl || route?.description?.videoUrl

            if (!url) {
                url = await this.restoreFromRepo(route)
            }
            if (!url || !path) {
                return {error:'download not supported'};
            }

            const info = path.parse( url)
            if (!info) {
                const logInfo = {...route.description}
                delete logInfo.points
                this.logEvent({message:'no URL specified',logInfo})                
                return {error:'no URL specified'};
            }
            file = path.join( targetDir, info.base)
        }
        catch {
            return {}
        }
        return {file,url}

    }
 
    protected async downloadRoute(route:Route, targetDir:string, observer:DownloadObserver):Promise<void> {

        let urlLog
        try {

            const {file,url,error} = await this.getDownloadFileName(route,targetDir)
            urlLog =url;
            if (!file||error||!url) {
                observer.emit('error', new Error(error??'download not supported'))
                return;
            }
            
            const {id,title} = route.description;

            const {downloadManager} = this.getBindings()
            if (!downloadManager) {
                observer.emit('error', new Error('download not supported'))
                return;
            }
            const session = downloadManager.createSession(url,file)
            if (!session) {
                observer.emit('error', new Error(error??'download not supported'))
                return;
            }  

            observer.setSession(session)
            const onError = (err:any) => { 
                this.logEvent({message:'download failed ',title, id,url,reason:err.message })
                observer.emit('error', err)
            }

            const onProgress = (pct:number,speed:number,bytes:number)=> { this.onDownloadProgress(id!,observer,pct,speed,bytes)}

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
        catch(err:any) {
            this.logError(err,'downloadRoute',{url:urlLog})
            observer.emit('error',err)
        }        


    }

    protected async restoreFromRepo(route:Route) {
        
        if (!route?.description?.id)
            return;

        await this.getRoutesApi().loadDetails([{route, added:false}],true)

        await waitNextTick()



        const descr = this.getRepo().getDescription(route.description.id)
        return descr?.downloadUrl || descr?.videoUrl


    }

    protected onDownloadProgress(id:string, observer:DownloadObserver, pct:number|string,speed:number|string,downloaded:number|string) {

        // don't log on mobile devices, as the binding already does it
        if (!this.isMobile()) {
            const prev = this.progressLogTs[id]||0
            const ts = Date.now()
            if (ts-prev>5000) {
                this.logEvent({message:'download progress', pctComplete:pct, downloaded, downloadSpeed: speed})                                            
                this.progressLogTs[id] = ts
            }

        }

        // emit progress event
        observer.emit('progress',Number(pct))
    }

    protected isMobile() {
        return this.getBindings()?.appInfo?.getChannel()==='mobile'
    }

    @Injectable
    protected getBindings() {
        return getBindings()

    }
}

export const useRouteDownload = () => new RouteDownloadService()