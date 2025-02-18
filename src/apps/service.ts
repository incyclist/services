import { ActivityUploadFactory } from "../activities";
import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { useUserSettings } from "../settings";
import { StravaAppConnection } from "./base";
import { AppCredentials } from "./base/types";
import { KomootAppConnection } from "./komoot";
import { AppDefinition, AppsIntergationSpec, AppsOperation } from "./types";
import { VeloHeroAppConnection } from "./velohero/VeloHeroAppConnection";

@Singleton
export class AppsService extends IncyclistService   {

    protected readonly services:AppsIntergationSpec = {
        ActivityUpload: ['strava', 'velohero','intervals.icu'],
        WorkoutUpload: [],
        WorkoutDownload: [],
        ActivityDownload: [/*'strava','komoot'   */ ],
        RouteDownload: [/*'strava' ,*/'komoot']
    }

    protected readonly serviceMap: Array<AppDefinition> = [
        { name:'Strava', key:'strava', iconUrl: 'https://static.cdnlogo.com/logos/s/42/strava-wordmark.svg', connection: new StravaAppConnection()},
        { name:'VeloHero', key:'velohero', iconUrl: 'images/velo-white.png', connection: new VeloHeroAppConnection() },
        { name:'Komoot', key:'komoot', iconUrl:'https://www.komoot.com/assets/4d8ae313eec53e6e.svg', connection: new KomootAppConnection() },
        /*{ name:'Intervals.icu', key:'intervals.icu' },*/
    ]

    constructor() {
        super('AppsService')
    }

    openSettings() {
        try {
            const apps = this.serviceMap.map( as=> this.getAppDisplayProps(as.key))
            return apps
        }
        catch (err) {
            this.logError(err,'openSettings')
            return []
        }
    }

    openAppSettings(app:string) {
        const operations = this.getAppOperationSettings(app)
        const isConnected = this.isConnected(app)

        return {  isConnected, operations}
    }

    async connect(app:string, credentials:AppCredentials):Promise<boolean> {
        const entry = this.serviceMap.find( e=>e.key===app)
        if (!entry?.connection)
            return false
        return await entry.connection.connect(credentials)
        
    }

    isConnected(app:string):boolean {
        const entry = this.serviceMap.find( e=>e.key===app)
        if (!entry?.connection)
            return false
        return entry.connection.isConnected()
    }

    disconnect(app:string):void {
        const entry = this.serviceMap.find( e=>e.key===app)
        if (!entry?.connection)
            return
        entry.connection.disconnect()

    }

    enableOperation(app:string, operation:AppsOperation, enabled:boolean,emit:boolean=false) {
        this.getUserSettings().set(`preferences.${app}.${operation}.enabled`,enabled)

        if(emit) {
            const event = enabled ? 'operation-enabled' : 'operation-disabled'        
            this.emit(event,app,operation)
        }

        return this.getAppOperationSettings(app)
    }

    isEnabled(app:string, operation:AppsOperation):boolean {
        if (!this.isConnected(app))
            return false;

        const supported = this.getAppOperationSettings(app)
        const config = supported.find( oc=> oc.operation===operation)
        return config?.enabled
    }

    getAppOperationSettings(app:string) {
        const serviceIds = Object.keys(this.services)
        const operations = []

        serviceIds.forEach( operation=> {
            if (this.services[operation].includes(app)) {
                const enabled = this.getSettings(`preferences.${app}.${operation}.enabled`,true)
                operations.push( {operation, enabled})
            }
        })
        return operations
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

    getName( key:string ) {
        const found = this.serviceMap.find( r=>r.key===key )
        return found ? found.name : key
    }
    getKey( name:string ) {
        const found = this.serviceMap.find( r=>r.name===name )
        return found ? found.key : name
    }



    protected getAppDisplayProps( key:string) {
        const entry = this.serviceMap.find( e=>e.key===key)

        const {name,iconUrl} = entry
        const isConnected = this.isConnected(key)

        return { name, key, iconUrl, isConnected}

    }

    protected getSettings(key:string, defValue) {
        try {
            return this.getUserSettings().get(key,defValue)
        }
        catch {
            return defValue
        }
    }

    // istanbul ignore next
    @Injectable
    protected getActivityUploadFactory() {
        return new ActivityUploadFactory()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }
}

export const useAppsService = ()=> new AppsService()