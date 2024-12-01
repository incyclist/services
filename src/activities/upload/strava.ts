import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { ActivityDetails } from "../base";
import { valid } from "../../utils/valid";
import { DuplicateError, StravaApi, StravaConfig, StravaFormat } from "../../apps/base/api/strava";
import { getBindings } from "../../api";
import { IActivityUpload, StravaAuth } from "./types";
import { Injectable } from "../../base/decorators/Injection";



@Singleton
export class StravaUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized
    protected api: StravaApi
    protected config: StravaConfig
    protected _isConnecting

    protected tokenUpdateHandler = this.updateConfig.bind(this)

    constructor() {
        super('StravaUpload')
        this.isInitialized = false

        this.init()
    }

    init():boolean {

        if (this.isInitialized)
            return true

        // in order to support lazy initialization, we cannot assume that UserSettings was already initialized
        if (!this.getUserSettings().isInitialized)
            return false

        try {
            const clientId = this.getSecret('STRAVA_CLIENT_ID')
            const clientSecret = this.getSecret('STRAVA_CLIENT_SECRET')           
            const auth = this.getCredentials()


            if (clientId && clientSecret && auth) {           
                this.logEvent( {message:'Strava init done', hasCredentials:true})            
                this.config = {
                    clientId, clientSecret,
                    accessToken: auth.accesstoken,
                    refreshToken: auth.refreshtoken,
                    expiration: new Date(auth.expiration)
                }
                
                this.initApi(this.config);
            }
            else {
                this.logEvent( {message:'Strava init done', hasCredentials:false})            
            }
            this.isInitialized = true;           



        }
        catch(err) {
            this.logEvent({message:'error', error:err.message, fn:'init',stack:err.stack})
            this.isInitialized = false;
            delete this.config
        }

        return this.isInitialized
    }


    isConnected() {
        if (!this.isInitialized) {
            this.init()
        }

        return (valid(this.config))
    }

    isConnecting() {
        return false
    }

    async connect(accessToken:string, refreshToken:string, expiration?:Date):Promise<boolean> {

        this.ensureInitialized()

        this.logEvent({message:'Connect with Strava'})

        try {
            const isConnected = this.isConnected()
            const config = {
                clientId: this.getSecret('STRAVA_CLIENT_ID'),
                clientSecret: this.getSecret('STRAVA_CLIENT_SECRET'),
                accessToken,refreshToken,expiration
            }

            if (isConnected) {                
                this.getApi().update(config)
            }
            else {
                const observer = this.initApi(config)
                this.saveCredentials(config)
            }

            this.logEvent({message:'Connect with Strava success'})           
            return true
            
        }
        catch(err) {
            // Should never happen, but just in case ...  I will log
            // istanbul ignore next
            this.logError(err,'connect')
            throw err
        }

    }

    disconnect() {
        try {            
            this.config = undefined
            this.saveCredentials()
            this.getApi().init(undefined)
        }
        catch(err) {
            // Should never happen, but just in case ...  I will log
            // istanbul ignore next
            this.logError(err,'disconnect')
        }
    }



    async upload(activity: ActivityDetails, format:string='TCX'):Promise<boolean> {
        try {
            
            const ok =this.ensureInitialized()
            if (!ok) {
                this.logEvent({message:'Strava Upload skipped', reason:'not initialized'})

                return false;
            }

            if (!this.isConnected())
                return false; 

            const lcFormat = format.toLowerCase()
            const ucFormat = format.toUpperCase()

            this.logEvent({message:'Strava Upload', format:ucFormat})
            if (!activity.links)
                activity.links  = {}

            const fileName =  activity[`${lcFormat}FileName`];
            const res = await this.getApi().upload(fileName,{
                name: activity.title,
                description: '',
                format: this.getStravaFormat(format)                
            })
            this.logEvent({message:'Strava Upload success', activityId: res.stravaId})

            activity.links.strava = {
                activity_id: res.stravaId,
                url: this.getUrl(res.stravaId)
            }
            return true;

        }
        catch(err) {
            if (err instanceof DuplicateError) {
                this.logEvent({message:'Strava Upload failure', error: 'duplicate', activityId:err.stravaId})
                activity.links.strava = {
                    activity_id: err.stravaId,
                    url: this.getUrl(err.stravaId)
                }
    
            }
            else {
                this.logEvent({message:'Strava Upload failure', error: err.message})
                activity.links.strava = {
                    error: err.message
                }
            }
            return false

        }
    }

    getUrl(activityId:string):string {
        return `https://www.strava.com/activities/${activityId}`
    }

    protected getStravaFormat(format:string):StravaFormat {
        switch (format.toLowerCase()) {
            case 'tcx':
                return 'tcx'
            case 'fit':
                return 'fit'
            case 'gox':
                return 'gpx'
            default:
                return null;
        
        }   
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }


    protected getCredentials():StravaAuth {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.strava',null)        
        }
        catch {
            return null
        }
    }

    protected saveCredentials(config?:StravaConfig):void {

        if (config)
            this.config = config
        
        try {

            if (!this.isConnected()) {
                this.logEvent({message:'Strava Delete Credentials'})            
                this.getUserSettings().set('user.auth.strava',null)
                return;    
            }

            this.logEvent({message:'Strava Save Credentials'})            
            this.getUserSettings().set('user.auth.strava',{
                accesstoken: this.config.accessToken,
                refreshtoken: this.config.refreshToken,
                expiration: this.config.expiration.toISOString()
            })

        }
        catch(err) {
            this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logEvent({message:'Strava Save Credentials done'})
    }

    protected updateConfig(config:StravaConfig) {
        const {accessToken, refreshToken,expiration} = config
        this.config = {...this.config,accessToken, refreshToken,expiration}
        this.saveCredentials()
    }

    protected initApi(config:StravaConfig) {
        const observer = this.getApi().init(config);
        observer.on('token.updated', this.tokenUpdateHandler);
    }
   
    
    protected getSecret(key:string):string {
        return this.getSecretBindings()?.getSecret(key)
    }

    @Injectable
    // istanbul ignore next
    getSecretBindings() {
        return getBindings()?.secret
    }

    @Injectable
    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }

    
    @Injectable
    // istanbul ignore next
    protected getApi() {
        if (!this.api)
            this.api = new StravaApi()
        return this.api
    }

    
}