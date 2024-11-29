import { ActivityUploadFactory } from "../activities";
import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { AppDefinition, AppsIntergationSpec, AppsOperation } from "./types";

@Singleton
export class AppsService extends IncyclistService   {

    protected readonly services:AppsIntergationSpec = {
        ActivityUpload: ['strava', 'velohero'],
        WorkoutUpload: [],
        WorkoutDownload: [],
        RouteDownload: []
    }

    protected readonly serviceMap: Array<AppDefinition> = [
        { name:'Strava', key:'strava' },
        { name:'VeloHero', key:'velohero' },
    ]

    constructor() {
        super('AppsService')
    }


    getConnectedServices(operation:AppsOperation):Array<AppDefinition> {
        const available = this.services[operation]

        if (operation === 'ActivityUpload') {
            const uploaders = available.map( a => this.getActivityUploadFactory().get(a))
            const connected = uploaders.map( (u,idx) => ({connected:u?.isConnected(), key:available[idx]}) )
                .filter( s => s.connected)
            return this.serviceMap.filter( s => connected.find( c => c.key===s.key))
        }
        return []
    }

    // istanbul ignore next
    protected getActivityUploadFactory() {
        return this.injected['ActivityUploadFactory']??new ActivityUploadFactory()
    }
}

export const useAppsService = ()=> new AppsService()