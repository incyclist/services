import { PromiseObserver } from "../../../base/types";
import { useRouteList } from "../../../routes";
import { DisplayExportInfo, DisplayUploadInfo, ActivityUploadStatus } from "../../list";
import { ActivityInfo, DEFAULT_ACTIVITY_TITLE } from "../model";
import { ActivitiesRepository, DB_VERSION } from "../repo";
import { getBindings } from "../../../api";
import { RouteCard, RouteSettings } from "../../../routes/list/cards/RouteCard";
import { OnlineStateMonitoringService, useOnlineStatusMonitoring } from "../../../monitoring";
import { useAppsService } from "../../../apps";

export class Activity implements ActivityInfo{
    
    protected loadingObserver: PromiseObserver<void>

    constructor(protected info:ActivityInfo)  {
        this.info = info

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
        return this.loadingObserver!==null
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
            if (this.details.route?.title) {
                title = this.details.route.title
            }
            else {
                title = this.details.route.name

                const route = useRouteList().getRouteDescription(this.details.route.id)
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

            const file=details[`${type}FileName`] ?? fileName?.replace('.json','.tcx')

            const fs = getBindings().fs
            if (fs.existsSync(file) )
                exports.push({type,file})
            else 
                exports.push({type})
        })

        return exports

    }

    isRouteAvailable() {
        if (!this.details?.route) return false

        if (this.details.routeType==='Free-Ride')
            return false

        return useRouteList().getRouteDescription(this.details.route.id)!==undefined
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
                type:service.key,status
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

    protected save():Promise<void> {
        return this.getRepo().save(this.info)        
    }

    // 

    protected getRepo():ActivitiesRepository {
        return new ActivitiesRepository()            
    }
    protected getAppsService() {
        return useAppsService()
    } 

}