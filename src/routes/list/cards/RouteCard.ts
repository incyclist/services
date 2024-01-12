import { getBindings } from "../../../api";
import { Card, CardList } from "../../../base/cardlist";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { useUserSettings } from "../../../settings";
import { sleep } from "../../../utils/sleep";
import { RouteApiDetail } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { RouteInfo  } from "../../base/types";
import { BaseCard } from "./base";
import { AppStatus, RouteCardType } from "./types";
import { getRouteList, useRouteList } from "../service";
import { RouteStartSettings } from "../types";
import { RoutesDbLoader } from "../loaders/db";
import { valid } from "../../../utils/valid";
import { waitNextTick } from "../../../utils";
import { DownloadObserver } from "../../download/types";
import { RouteDownloadService } from "../../download/service";


export interface SummaryCardDisplayProps extends RouteInfo{
    loaded:boolean
    ready:boolean
    state:string
    visible:boolean
    canDelete:boolean
    observer:Observer
    initialized:boolean;
    loading?:boolean
}

export interface DetailCardDisplayProps  {
    
}

export interface StartSettings {
    segment?:string
    startPos:number,
    endPos?:number,
    realityFactor:number,
    downloadProgress?:number,
    convertProgress?:number
}

export type RouteSettings = StartSettings & RouteStartSettings



class ConvertObserver extends Observer {  

    protected conversion:Observer
    constructor() {
        super()
    }

    setConversion(conversion:Observer) {
        this.conversion = conversion
    }

    stop() {
        if (this.conversion)
            this.conversion.stop()
    }

}

export class RouteCard extends BaseCard implements Card<Route> {

    protected downloadObserver: DownloadObserver;
    protected convertObserver: ConvertObserver;
    protected route: Route
    protected list:CardList<Route> 
    protected deleteable:boolean
    protected startSettings:RouteSettings
    protected cardObserver = new Observer()
    protected deleteObserver: PromiseObserver<boolean>
    protected ready:boolean

    constructor(route:Route, props?:{list?: CardList<Route>} ) {
        super()
        const {list} = props||{};

        this.route = route
        this.list = list
        this.deleteable = false;

        const descr = this.getRouteDescription()

        this.ready = !descr.hasVideo || (descr.hasVideo && descr.previewUrl!==undefined)
        this.initialized = false;

    }

    canStart(status:AppStatus) {
        const {isOnline} = status
        const route = this.route.description

        if (!route.hasVideo || !route.isLocal || route.videoUrl.startsWith('http')) 
            return isOnline

        if (route.requiresDownload )
            return route.isLocal && isOnline 

        return true;
    }

    getRepo() {
        return new RoutesDbLoader()
    }

    verify() {
        if (this.previewMissing())
            this.createPreview()
    }

    previewMissing() {
        const descr = this.getRouteDescription()
        return descr.hasVideo && !valid(descr.previewUrl)
    }

    setInitialized(init:boolean) {
        const prev=this.initialized
        this.initialized= init
        if (init && !prev)
            this.emitUpdate()
    }

    setVisible(visible: boolean): void {
        const prev = this.visible
        this.visible = visible
        if (visible!==prev)
            this.emitUpdate()
    }

    reset() {
        super.reset()
        this.cardObserver.reset()
    }

    getData(): Route { return this.route}
    setData(data: Route) { 
        const old = this.route
        this.route = data
        if (this.ready && this.getRouteDescription().previewUrl===undefined ) {
            this.getRouteDescription().previewUrl = old.description.previewUrl
        }

    }

    getRouteDescription(): RouteInfo { return this.route?.description}
    getRouteData(): RouteApiDetail {return this.route?.details}
    
    getCardType(): RouteCardType {
        return 'Route';
    }

    getDisplayProperties(): SummaryCardDisplayProps {
        let {points} = this.route.description
        if (points && !Array.isArray(points)) {
            points = undefined
        }

        const loading = this.deleteObserver!==undefined
        return {...this.route.description, initialized:this.initialized, loaded:true,ready:true,state:'loaded',visible:this.visible,canDelete:this.canDelete(),observer:this.cardObserver, points, loading}

    }
    getId(): string {
        return this.route.description.id
    }

    enableDelete(enabled=true) {
        this.deleteable = enabled
    }

    canDelete() {
        return this.deleteable
    }


    openSettings():RouteSettings {
        // read vaues from User Settings
        const defaultSettings = {startPos:0, realityFactor:100}        
        const key = this.buildSettingsKey();
        this.startSettings = useUserSettings().get(key,defaultSettings )

        return this.startSettings
    }

    changeSettings(props:RouteSettings) {
        this.startSettings = props

        // update User Settings
        const userSettings = useUserSettings()
        const key = this.buildSettingsKey();
        userSettings.set(key,props,true)
    }

    async save():Promise<void> {
        this.getRepo().save(this.route)        
    }

    delete():PromiseObserver<boolean> {
        // already deleting
        if (this.deleteObserver)
            return this.deleteObserver

        this.deleteObserver = new PromiseObserver< boolean> ( this._delete() )
        return this.deleteObserver
    }

    protected async _delete():Promise<boolean> {

        // let the caller of delete() consume an intialize the observer first
        await waitNextTick()
        let deleted:boolean = false

        try {

            this.deleteObserver.emit('started')
            this.emitUpdate()

            if ( this.list.getId()==='myRoutes') {
                const route:RouteInfo = this.getRouteDescription()

                if (route.isDownloaded) {
                    await this.resetDownload()
                    this.deleteFromUIList()
                    this.enableDelete(false)
                    getRouteList().addCardAgain(this)
                    // TODO: Do we also need to remove the file?
                   
                    return true
                }
                else if (!route.isLocal) {
                    await this.markDeleted()    
                }
                else {
                    await this.deleteRoute()
                } 
                    

            }
            else {
                await this.markDeleted()
            }

            
            // remove from list in UI
            this.deleteFromUIList();
    
            // delete route related user settings
            this.deleteRouteUserSettings();


            getRouteList().emitLists('updated');
            deleted =true;   
        }
        catch(err) {
            deleted =  false
        }
        finally {
            this.deleteObserver.emit('done',deleted)
            waitNextTick().then( ()=> { 
                delete this.deleteObserver
                this.emitUpdate()
            })

        }

        

        return deleted

    }



    start() {
        const service = getRouteList()

        service.select( this.route)
        service.setStartSettings({type:this.getCardType(), ...this.startSettings})

        this.route.description.tsLastStart = Date.now()
        this.updateRoute(this.route)
    }

    cancel() {

    }

    addWorkout() {

    }

    getCurrentDownload():Observer {
        return this.downloadObserver;
    }
    getVideoDir():string {
        const settings = useUserSettings()

        const videoDir = settings.get('videos.directory',null)
        if (videoDir)
            return videoDir
    }
    setVideoDir(dir:string):void {
        const settings = useUserSettings()
        settings.set('videos.directory',dir)
    }

    download(): Observer {
        getRouteList().logEvent({message:'download started', route:this.route?.description?.title})

        if (!this.downloadObserver) {           
            const dl = new RouteDownloadService()
            this.downloadObserver = dl.download(this.route)
            this.downloadObserver
                .on('done', this.onDownloadCompleted.bind(this))
                .on('error', this.onDownloadError.bind(this))
        }
        return this.downloadObserver;
    }

    stopDownload() {
        getRouteList().logEvent({message:'download stopped', route:this.route?.description?.title})
        this.getCurrentDownload()?.stop()
        
        waitNextTick().then( ()=>{ delete this.downloadObserver})
    }

    async onDownloadCompleted( url:string) {
        getRouteList().logEvent({message:'download completed', route:this.route?.description?.title})

        this.route.description.videoUrl = url;
        this.route.description.isDownloaded = true;
        this.route.description.tsImported = Date.now()

        this.route.details.video.file = undefined
        this.route.details.video.url = url;
        
        this.updateRoute( this.route)
        waitNextTick().then( ()=>{ delete this.downloadObserver})

        if (this.list.getId()!=='myRoutes') {
            this.list.remove(this)
            this.list = undefined
            getRouteList().addCardAgain(this)
        }
    }

    onDownloadError(err:Error) {        
        getRouteList().logEvent({message:'download error', error:err.message, route:this.route?.description?.title})

        waitNextTick().then( ()=>{ delete this.downloadObserver})
    }

    getCurrentConversion():Observer {
        return this.convertObserver;
    }

    convert(): Observer {
        if (this.convertObserver)
            return this.convertObserver;

        
        const video = getBindings().video
        const route = this.getRouteDescription()
        this.convertObserver = new ConvertObserver()

        video.convert(route.videoUrl,{enforceSlow:true})
            .then( observer=> { this.monitorConversion(route, observer);})
            .catch( err => { this.handleConversionError(err)})

        process.nextTick( ()=>{this.convertObserver.emit('started') })
        return this.convertObserver
    }

    stopConversion() {
        if (!this.convertObserver)
            return
        this.convertObserver.stop()        
        this.convertObserver.emit('done');
        setTimeout( ()=>{ this.convertObserver=undefined}, 200)
    }

    protected monitorConversion(route: RouteInfo, observer: Observer) {
        this.convertObserver.setConversion(observer)
        getRouteList().logEvent({ message: 'video conversion started', url: route.videoUrl });

        observer.on('conversion.progress', (progress) => {
            getRouteList().logEvent({ message: 'video conversion progress', progress });
            this.convertObserver.emit('progress', progress.percent || progress.completed);
        });

        observer.on('conversion.done', (url: string) => {
            getRouteList().logEvent({ message: 'video conversion completed', url });
            this.finishConversion({ url });
            this.convertObserver.emit('done');
        });
        observer.on('conversion.error', (error: Error) => {
            getRouteList().logEvent({ message: 'video conversion error', error: error.message });
            this.convertObserver.emit('error', error);
            this.finishConversion({ error });
        });
    }

    protected handleConversionError(err:Error) {
        
        process.nextTick( ()=> {
            this.convertObserver.emit('error', err);
            this.finishConversion({ error:err });
        })

        
    }

    protected async finishConversion( result:{error?:Error,url?:string } ) {
        const {url} = result

        if (url) {
            const description = this.getRouteDescription()
            const details = this.getRouteData()

            if (url.startsWith('file:'))
                url.replace('file:','video:')

            description.videoUrl = url;
            description.videoFormat = 'mp4'

            details.video.file = undefined
            details.video.url = url;
            details.video.format = 'mp4'

            await this.save();
        }
        await sleep(200)
        delete this.convertObserver


    }

    protected emitUpdate() {
        if (this.cardObserver)
            this.cardObserver.emit('update', this.getDisplayProperties())
    }

    updateRoute(route:Route) {
        this.route = route
        this.save()
        this.emitUpdate()
    }

    protected buildSettingsKey() {
        const type = this.route.description.hasVideo ? 'video' : 'followRoute';
        const id = this.route.description.id;
        const key = `routeSelection.${type}.prevSetting.${id}`;
        return key;
    }

    protected async createPreview() {    
        
        const descr = this.getRouteDescription()
        await useRouteList().createPreview( descr )
        this.ready = true;
        this.updateRoute(this.route)
        
    }

    protected deleteRouteUserSettings() {
        const key = this.buildSettingsKey();
        useUserSettings().set(key, null);
    }

    protected deleteFromUIList() {
        if (this.list) {
            this.list.remove(this);
        }
    }

    protected async markDeleted():Promise<void> {
        const descr = this.getRouteDescription()
        descr.isDeleted = true

        await this.save();
        this.emitUpdate()
    }

    protected async resetDownload():Promise<void> {
        const descr = this.getRouteDescription()
        descr.isDownloaded = false

        await this.save();
        this.emitUpdate()

    }

    protected async deleteRoute():Promise<void> {
        await this.getRepo().delete(this.route)        
    }

    



}
