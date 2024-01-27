import { getBindings } from "../../../api";
import { Card, CardList } from "../../../base/cardlist";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { useUserSettings } from "../../../settings";
import { sleep } from "../../../utils/sleep";
import { RouteApiDetail } from "../../base/api/types";
import { Route } from "../../base/model/route";
import { RouteInfo, RoutePoint  } from "../../base/types";
import { BaseCard } from "./base";
import { RouteCardType } from "./types";
import { AppStatus } from "../../base/types";
import { getRouteList, useRouteList } from "../service";
import { RouteStartSettings } from "../types";
import { RoutesDbLoader } from "../loaders/db";
import { valid } from "../../../utils/valid";
import { waitNextTick } from "../../../utils";
import { DownloadObserver } from "../../download/types";
import { RouteDownloadService } from "../../download/service";
import { getLocalizedData } from "../../base/utils/localization";
import { EventLogger } from "gd-eventlog";
import { getPosition} from "../../base/utils/route";


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
    convertProgress?:number,
    loopOverwrite?: boolean,
    nextOverwrite?:boolean
}

export type RouteSettings = StartSettings & RouteStartSettings

export type RouteCardProps = {
    settings:RouteSettings,
    showLoopOverwrite:boolean,
    showNextOverwrite:boolean
}


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
    protected logger:EventLogger

    constructor(route:Route, props?:{list?: CardList<Route>} ) {
        super()
        const {list} = props||{};

        this.route = route
        this.list = list
        this.deleteable = false;

        const descr = this.getRouteDescription()

        this.ready = !descr.hasVideo || (descr.hasVideo && descr.previewUrl!==undefined)
        this.initialized = false;
        this.logger = new EventLogger('RouteCard')

    }

    canStart(status:AppStatus) {
        try {
            const {isOnline} = status
            const route = this.route.description

            if (!route.hasVideo || !route.isLocal || route.videoUrl.startsWith('http')) 
                return isOnline

            if (route.requiresDownload )
                return route.isLocal && isOnline 

            return true;
        }
        catch(err) {
            this.logError(err, 'canStart')
            return false
        }
    }

    getRepo() {
        return new RoutesDbLoader()
    }
    setList(list:CardList<Route>) {
        this.list = list
    }

    verify() {
        try {
            if (this.previewMissing())
                this.createPreview()
        }
        catch(err) {
            this.logError(err,'verify')
        }
    }

    previewMissing() {
        try {
            const descr = this.getRouteDescription()
            return descr.hasVideo && !valid(descr.previewUrl)
        }
        catch(err) {
            this.logError(err,'previewMissing')
        }
    }

    setInitialized(init:boolean) {
        try {
            const prev=this.initialized
            this.initialized= init
            if (init && !prev)
                this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'setInitialized')
        }
    
    }

    setVisible(visible: boolean): void {
        try {
            const prev = this.visible
            this.visible = visible
            if (visible!==prev)
                this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'setVisible')
        }
    
    }

    reset() {
        try {
            super.reset()
            this.cardObserver.reset()
        }
        catch(err) {
            this.logError(err,'reset')
        }

    }

    getData(): Route { return this.route}
    setData(data: Route) { 
        try {
            const old = this.route
            this.route = data
            if (this.ready && this.getRouteDescription().previewUrl===undefined ) {
                this.getRouteDescription().previewUrl = old.description.previewUrl
            }
        }
        catch(err) {
            this.logError(err,'setData')
        }

    }

    getRouteDescription(): RouteInfo {         
        return this.route?.description||{}        
    }

    getRouteData(): RouteApiDetail {return this.route?.details}

    getCardType(): RouteCardType {
        return 'Route';
    }

    getTitle() {
        try {
            const descr = this.getRouteDescription()|| {}
            return getLocalizedData(descr)?.title
        }
        catch(err) {
            this.logError(err,'getTitle')
        }

    }

    getDisplayProperties(): SummaryCardDisplayProps {
        try {
            const descr = this.getRouteDescription()

            let {points} = descr
            if (points && !Array.isArray(points)) {
                points = undefined
            }

            const loading = this.deleteObserver!==undefined
            return {...descr, initialized:this.initialized, loaded:true,ready:true,state:'loaded',visible:this.visible,
                    canDelete:this.canDelete(), points, loading, title:this.getTitle(),
                    observer:this.cardObserver}
        }
        catch(err) {
            this.logError(err,'getDisplayProperties')
        }
        
    }

    getMarkers(settings?:RouteSettings):Array<RoutePoint> {
        const markers = []
        try {
            const startSettings = settings || this.getSettings()
            const startDistance = startSettings.startPos||0
            const startPos = getPosition(this.route, {distance:startDistance,nearest:true})
            markers.push(startPos)
        }
        catch(err) {
            this.logError(err,'getMarkers')            
        }
        return markers


    }

    getId(): string {
        return this.route?.description?.id
    }

    enableDelete(enabled:boolean=true) {
        this.deleteable = enabled
    }

    canDelete() {
        return this.deleteable
    }



    openSettings():RouteCardProps {

        const settings =this.getSettings();
        let showLoopOverwrite, showNextOverwrite

        try {
            showLoopOverwrite = this.route?.description?.isLoop
            showNextOverwrite = valid(this.route?.description?.next) 

            if (showNextOverwrite) {
                const card = getRouteList().getCard(this.route?.description?.next)
                const route = card?.getData()
                if (!route || (route.description.requiresDownload && !route.description.isDownloaded)) {
                    showNextOverwrite = false
                }
            }
        }
        catch(err) {
            this.logError(err,'openSettings')
        }
        return {settings,showLoopOverwrite,showNextOverwrite}

    }

    changeSettings(props:RouteSettings) {
        try {
            this.startSettings = {...props}

            // update User Settings
            const userSettings = useUserSettings()
            const key = this.buildSettingsKey();
            userSettings.set(key,props,true)

        }
        catch(err) {
            this.logError(err,'changeSettings')
        }
            
    }

    async save():Promise<void> {
        try {
            return await this.getRepo().save(this.route)        
        }
        catch(err) {
            this.logError(err,'save')
        }
        
    }

    delete():PromiseObserver<boolean> {
        try {
            // already deleting
            if (this.deleteObserver)
                return this.deleteObserver

            this.deleteObserver = new PromiseObserver< boolean> ( this._delete() )
            return this.deleteObserver
        }
        catch(err) {
            this.logError(err,'delete')
        }

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
        try {
            const service = getRouteList()

            service.select( this.route)
            service.setStartSettings({type:this.getCardType(), ...this.startSettings})

            this.route.description.tsLastStart = Date.now()
            this.updateRoute(this.route)
        }
        catch(err) {
            this.logError(err,'start')
        }
    }

    cancel() {
        // nothing todo - UI needs to close the window
    }

    addWorkout() {
        // TODO
    }

    getCurrentDownload():Observer {
        return this.downloadObserver;
    }
    getVideoDir():string {
        try {
            const settings = useUserSettings()

            const videoDir = settings.get('videos.directory',null)
            if (videoDir)
                return videoDir
        }
        catch(err) {
            this.logError(err,'getVideoDir')
        }
    
    }
    setVideoDir(dir:string):void {
        try {
            const settings = useUserSettings()
            settings.set('videos.directory',dir)
        }
        catch(err) {
            this.logError(err,'setVideoDir')
        }

    }

    download(): Observer {
        try {        
            getRouteList().logEvent({message:'download started', route:this.route?.description?.title})

            if (!this.downloadObserver) {           
                const dl = new RouteDownloadService()
                this.downloadObserver = dl.download(this.route)
                this.downloadObserver
                    .on('done', this.onDownloadCompleted.bind(this))
                    .on('error', this.onDownloadError.bind(this))
            }
        }
        catch(err) {
            this.logError(err,'download')
        }
        return this.downloadObserver;
    }

    stopDownload() {
        try {
            getRouteList().logEvent({message:'download stopped', route:this.route?.description?.title})
            this.getCurrentDownload()?.stop()
            
            waitNextTick().then( ()=>{ delete this.downloadObserver})
        }
        catch(err) {
            this.logError(err,'stopDownload')
        }
        
    }

    protected async onDownloadCompleted( url:string) {
        try {
            getRouteList().logEvent({message:'download completed', route:this.route?.description?.title})

            // save original video URL, in case we delete at a later point in time
            if (!this.route.description.downloadUrl) {
                this.route.description.downloadUrl = this.route.description.videoUrl
            }
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
        catch(err) {
            this.logError(err,'onDownloadComplete')
        }
    }

    protected onDownloadError(err:Error) {        
        try {
            getRouteList().logEvent({message:'download error', error:err.message, route:this.route?.description?.title})

            waitNextTick().then( ()=>{ delete this.downloadObserver})
        }
        catch(err) {
            this.logError(err,'onDownloadError')
        }

    }

    getCurrentConversion():Observer {
        return this.convertObserver;
    }

    convert(): Observer {
        try {
            if (this.convertObserver)
                return this.convertObserver;

            
            const video = getBindings().video
            const route = this.getRouteDescription()
            this.convertObserver = new ConvertObserver()

            video.convert(route.videoUrl,{enforceSlow:true})
                .then( observer=> { this.monitorConversion(route, observer);})
                .catch( err => { this.handleConversionError(err)})

            process.nextTick( ()=>{this.convertObserver.emit('started') })
        }
        catch(err) {
            this.logError(err,'convert')
        }

        return this.convertObserver
    }

    stopConversion() {
        try {
            if (!this.convertObserver)
                return
            this.convertObserver.stop()        
            this.convertObserver.emit('done');
            setTimeout( ()=>{ this.convertObserver=undefined}, 200)
        }
        catch(err) {
            this.logError(err,'stopConversion')
        }

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
        try {
            this.route = route
            this.save()
            this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'updateRoute')
        }

    }

    protected buildSettingsKey(legacy=false) {
        const type = this.route.description.hasVideo ? 'video' : 'followRoute';
        const id = legacy ? this.route.description.legacyId : this.route.description.id;
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
        descr.videoUrl = descr.downloadUrl;        
        descr.tsImported = null
        this.route.details.video.file = undefined
        this.route.details.video.url = descr.downloadUrl


        if (this.downloadObserver) {
            this.downloadObserver.stop()
            process.nextTick( ()=>{delete this.downloadObserver})
        }

        await this.save();
        this.emitUpdate()

    }

    protected async deleteRoute():Promise<void> {
        await this.getRepo().delete(this.route)        
    }

    protected logError( err:Error, fn:string) {
        this.logger.logEvent({message:'error', error:err.message, fn, stack:err.stack})
    }
    
    protected getSettings() {
        this.startSettings = { startPos: 0, realityFactor: 100, type: this.getCardType() };

        try {
            // read vaues from User Settings
            let migrate = false;

            const legacy = this.buildSettingsKey(true);
            const legacySettings = useUserSettings().get(legacy, null);
            if (legacySettings) {
                this.startSettings = legacySettings;
                migrate = true;
            }


            const key = this.buildSettingsKey();
            const startSettings = useUserSettings().get(key, null);
            if (startSettings) {
                this.startSettings = startSettings;
            }


            if (migrate) {
                // TODO: uncomment next line, once feature toggle NEW_ROUTES_UI has been removed
                //useUserSettings().set(legacy,null)
                useUserSettings().set(key, this.startSettings);

            }
        }
        catch (err) {
            this.logError(err, 'getSettings');
        }
        return this.startSettings
    }

}
