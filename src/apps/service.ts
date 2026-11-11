import { ActivityUploadFactory } from "../activities/upload";
import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { useUserSettings } from "../settings";
import { StravaAppConnection } from "./base";
import { AppCredentials } from "./base/types";
import { IntervalsAppConnection } from "./intervals/IntervalsAppConnection";
import { KomootAppConnection } from "./komoot";
import { AppDefinition, AppsOperation, IConnectedApp } from "./types";

@Singleton
export class AppsService extends IncyclistService   {

    protected readonly serviceMap: Array<AppDefinition> = [
        { name:'Strava', key:'strava', iconUrl: 'https://static.cdnlogo.com/logos/s/42/strava-wordmark.svg', connection: new StravaAppConnection()},
        { name:'Komoot', key:'komoot', iconUrl:'https://www.komoot.com/assets/4d8ae313eec53e6e.svg', connection: new KomootAppConnection() },
        { name:'Intervals.icu', key:'intervals',iconUrl: 'images/intervals.png', connection:new IntervalsAppConnection() },
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

        const success = await entry.connection.connect(credentials)
        if (!this.hasSettings(app))
            this.storeInitialSettings(app)

        this.emit('connected',app,success)
        return success
        
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
        this.emit('disconnected',app)

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

        if (!this.hasSettings(app))
            this.storeInitialSettings(app)


        const supported = this.getAppOperationSettings(app)
        const config = supported.find( oc=> oc.operation===operation)
        return config?.enabled
    }

    getAppOperationSettings(app:string) {
        const connectedApp = this.getAppConnection(app)
        if (!connectedApp) return []

        const supported = connectedApp.getSupportedOperations()
        const defaults = connectedApp.getDefaultOperations()
        const operations = []

        supported.forEach( operation=> {
            const enabled = this.getSettings(`preferences.${app}.${operation}.enabled`,defaults.includes(operation))
            operations.push( {operation, enabled})
        })
        return operations
    }

    getConnectedServices(operation:AppsOperation):Array<AppDefinition> {
        const available = this.getAvailableServices(operation)

        if (operation === 'ActivityUpload') {
            const factory = this.getActivityUploadFactory()

            const uploaders = available.map( a => factory.get(a))
            const connected = uploaders.map( (u,idx) => ({connected:u?.isConnected(), key:available[idx]}) )
                .filter( s => s.connected)
            const enabled = connected    
                .filter( s => factory.isUploadEnabled(s.key))

            return this.serviceMap.filter( s => enabled.find( c => c.key===s.key))
        }
        else if (operation === 'WorkoutDownload') {
            return this.serviceMap.filter( s => available.includes(s.key) && s.connection.isConnected())

        }
        return []
    }

    getAvailableServices(operation:AppsOperation):Array<string> {
        const serviceIds  = this.getServiceIDs()
        const supported = []
        serviceIds.forEach( serviceKey => {
            if ( this.getAppConnection(serviceKey)?.getSupportedOperations().includes(operation)) {
                supported.push(serviceKey)
            }
        })
        return supported
    }

    getName( key:string ) {
        const found = this.serviceMap.find( r=>r.key===key )
        return found ? found.name : key
    }
    getKey( name:string ) {
        const found = this.serviceMap.find( r=>r.name===name )
        return found ? found.key : name
    }

    protected hasSettings(app:string) {         
        const settings = this.getUserSettings().getValue(`preferences.${app}`,null)
        return settings!==null
    }

    protected storeInitialSettings(app:string) {
        if (this.hasSettings(app))
            return

        const connection = this.getAppConnection(app)
        if (!connection)
            return

        const supported = connection.getSupportedOperations()
        const defaults = connection.getDefaultOperations()

        for (const operation of supported) {
            const isDefault = defaults.includes(operation)
            this.getUserSettings().set(`preferences.${app}.${operation}.enabled`,isDefault)
        }
    }


    protected getServiceIDs():Array<string> {
        return this.serviceMap.map( m=>m.key)
    }
    protected getAppConnections():Array<IConnectedApp> {
        return this.serviceMap.map( m=>m.connection)
    }
    protected getAppConnection(serviceKey:string):IConnectedApp|undefined {
        return this.serviceMap.find( m=> serviceKey===m.key)?.connection
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