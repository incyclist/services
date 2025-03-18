import { Observer, PromiseObserver } from "../../../base/types";
import { useRouteList } from "../../../routes";
import { DisplayExportInfo, DisplayUploadInfo, ActivityUploadStatus } from "../../list";
import { ActivityInfo, DEFAULT_ACTIVITY_TITLE } from "../model";
import { ActivitiesRepository, DB_VERSION } from "../repo";
import { getBindings } from "../../../api";
import { RouteCard, RouteSettings } from "../../../routes/list/cards/RouteCard";
import { OnlineStateMonitoringService, useOnlineStatusMonitoring } from "../../../monitoring";
import { useAppsService } from "../../../apps";
import { Injectable } from "../../../base/decorators/Injection";
import { ActivityConverter } from "../convert";
import { ActivityUploadFactory } from "../../upload";
import { EventLogger } from "gd-eventlog";

export class Activity implements ActivityInfo{
    
    protected loadingObserver: PromiseObserver<void>
    protected currentExports: Record<string,boolean>={}
    protected currentUploads: Record<string,boolean>={}
    protected logger:EventLogger

    constructor(protected info:ActivityInfo)  {
        this.info = info
        this.logger = new EventLogger('Activity')
        const ver = Number(this.info?.details?.version??"0")
        if (ver<Number(DB_VERSION)) { 
            this.getRepo().migrate(this.info)
        }
    }

    get summary() {
        return this.info.summary
    }

    set summary(summary) {
        this.info.summary = summary
    }

    get details() {
        return this.info.details
    }

    set details(details) {
        this.info.details = details
    }

    get id():string {
        return this.info.summary.id
    }

    setLoading(loading:PromiseObserver<void>) {
        this.loadingObserver = loading
        this.loadingObserver.wait().then( ()=>{
            this.loadingObserver = null
        })
    }

    isLoading() {
        return this.loadingObserver!==null && this.loadingObserver!==undefined
    }

    async load():Promise<void> {
        if (!this.loadingObserver)
            return
        return this.loadingObserver.wait()
    }

    isComplete() {
        return !!this.info.details
    }

    

    getTitle():string {
        let title = this.info.summary.title
        if (title===DEFAULT_ACTIVITY_TITLE) {
            if (this.details?.route?.title) {
                title = this.details?.route.title
            }
            else {
                title = this.details?.route.name

                const route = useRouteList().getRouteDescription(this.details?.route?.id)
                if (route) {
                    title = route.title
                }
            }
        }
        return title
    }

    getElevation():number {
        const{version,totalElevation,logs=[]} = this.info.details??{}

        if (version!==undefined)
            return totalElevation

        let elevation = 0
        let prevElevation =0
        logs.forEach( log => {
            if (log.elevation>prevElevation)  
                elevation += log.elevation - prevElevation
            prevElevation = log.elevation
        })

        return elevation
    }

    getExports():Array<DisplayExportInfo> {

        const {fileName} = this.details??{}
        const exports:Array<DisplayExportInfo> = []

        if (fileName)
            exports.push({type:'json',file:fileName})

        const formats = ['tcx','fit']
        formats.forEach( type => {
            const details = this.details??{}

            const file=details[`${type}FileName`] ?? fileName?.replace('.json',`.${type}`)

            const fs = this.getBindings().fs

            if (fs.existsSync(file) )
                exports.push({type,file})
            else 
                exports.push({type,creating:this.isExporting(type)})
        })

        return exports

    }

    markExporting(type:string,exporting:boolean) {
        this.currentExports[type] = exporting
    }
    isExporting(type:string):boolean {
        return this.currentExports[type] 
    }

    async export(type:string,observer?:Observer):Promise<boolean> {

        const format = type.toLowerCase()
        const fs = this.getBindings().fs
        let success = false;
        let error

        if (!this.details) {
            this.logger.logEvent({message:'trying to export activity with no details', activity:this.id})
            return false
        }

        this.markExporting(format,true)
        if (observer) {
            observer.emit('export',{status:'started',format})
        }

        try {
            let data
            const converter = this.getActivityConverter()
            data = await converter.convert(this.details,format)
            
            const fileName = this.details.fileName.replace('.json',`.${format}`)
            await fs.writeFile(fileName, Buffer.from (data ))   
            this.details[`${format}FileName`] = fileName

            await this.save(true)
            success = true
        }
        catch(err) {
            this.logError(err,'export',{activity:this.id,format})
            error = err.message
        }


        this.markExporting(format,false)
        if (observer) {
            observer.emit('export',{status:'done',format,success,error})
        }
        return success
    }

    async upload(connectedApp:string,observer?:Observer):Promise<boolean> {  
        let success = false
        let error
        const factory =  this.getActivityUploadFactory()
        let exports = this.getExports().filter( e => e.type !== 'json')
        let format  = exports.find( e => e.file!==undefined)?.type
        
        this.markUploading(connectedApp,true)
        if (observer) {
            observer.emit('upload',{status:'started',connectedApp})
        }
        // we don't have yet an uploadable formart, so let's export some
        if (!format) {
            const exportPromises = []
            exports.forEach( e => {
                exportPromises.push( this.export(e.type,observer))
            })
            await Promise.allSettled(exportPromises)

            // let's re-check if we now have an uploadable format
            exports = this.getExports().filter( e => e.type !== 'json')
            format  = exports.find( e => e.file!==undefined)?.type
        }
        
        if (format) {
            try {
                const uploader = factory.get(connectedApp)

                
                success = await uploader.upload(this.details, format.toLowerCase())               

                await this.save(true)
            }
            catch(err) {
                this.logError(err,'upload')
            }
        }

        this.markUploading(connectedApp,false)
        if (observer) {
            observer.emit('upload',{status:'done',connectedApp,success,error})
        }
        return success
    }

    markUploading(connectedApp:string,uploading:boolean) {
        this.currentUploads[connectedApp] = uploading
    }
    isUploading(connectedApp:string):boolean {
        return this.currentUploads[connectedApp] 
    }


    isRouteAvailable() {
        if (!this.details?.route) return false

        if (this.details.routeType==='Free-Ride')
            return false

        return this.getRouteList().getRouteDescription(this.details.route.id)!==undefined
    }

    getUploadStatus():Array<DisplayUploadInfo>  {

        const uploads:Array<DisplayUploadInfo> = []

        const services = this.getAppsService().getConnectedServices('ActivityUpload')
        services.forEach( service => {
            let status:ActivityUploadStatus = 'unknown'

            const info = this.details?.links?.[service.key]
            if (info) {
                status =  (info.error || !info.activity_id) ? 'failed' : 'success'
                
            }            

            uploads.push({
                type:service.key,status, url:info?.url,text:service.name, synchronizing:this.isUploading(service.key)
            })    
        })

        return uploads

    }

    canStart() {
        if (!this.details?.route) return false

        if (this.details.routeType==='Free-Ride')
            return false

        if (this.details.routeType==='Video' ) {
            const isOnline = this.getOnlineMonitoring().onlineStatus
            return this.getRouteCard()?.canStart({isOnline})
        }

        return useRouteList().getRouteDescription(this.details.route.id)!==undefined

    }

    /**
     * Retrieves the RouteCard associated with the current activity's route.
     *
     * @returns {RouteCard} The RouteCard object corresponding to the route ID 
     *                      present in the activity details.
     */
    getRouteCard():RouteCard {
        const routes = useRouteList()

        return routes.getCard(this.details.route.id)
    }

    createStartSettings():RouteSettings {

        const {startPos,realityFactor,segment,endPos} = this.details
        const card = this.getRouteCard()
        return {
            startPos,
            segment,
            endPos,
            realityFactor,
            showPrev:true,
            type:card.getCardType()
        }

        
    }



    protected getOnlineMonitoring():OnlineStateMonitoringService {
        return useOnlineStatusMonitoring()
    }

    protected save(withDetails?:boolean):Promise<void> {

        console.log('~~~ SAVE REPO', this.info,withDetails)
        return this.getRepo().save(this.info,withDetails)        
    }

    protected logError(err:Error, fn:string,context?:object) {
        this.logger.logEvent({message:'error', error:err.message, fn, stack:err.stack,...(context??{})})
    }

    // 

    @Injectable
    protected getRepo():ActivitiesRepository {
        return new ActivitiesRepository()            
    }
    @Injectable
    protected getAppsService() {
        return useAppsService()
    } 

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable 
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getActivityConverter() {
        return ActivityConverter
    }

    @Injectable
    protected getActivityUploadFactory() /* istanbul ignore next */ {
        return new ActivityUploadFactory()
    }

}