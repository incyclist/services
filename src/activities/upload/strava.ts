import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { ActivityDetails } from "../base";
import { valid } from "../../utils/valid";
import { DuplicateError, StravaApi, StravaConfig, StravaFormat } from "../../apps/base/api/strava";
import { getBindings } from "../../api";
import { IActivityUpload } from "./types";



@Singleton
export class StravaUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized
    protected api: StravaApi
    protected config: StravaConfig
    protected _isConnecting

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
                this.logger.logEvent( {message:'Strava init done', hasCredentials:true})            
                this.config = {
                    clientId, clientSecret,
                    accessToken: auth.accesstoken,
                    refreshToken: auth.refreshtoken,
                    expiration: new Date(auth.expiration)
                }
                const observer = this.getApi().init(this.config)

                observer.on('token.updated',this.updateConfig.bind(this) )
            }
            else {
                this.logger.logEvent( {message:'Strava init done', hasCredentials:false})            
            }
            this.isInitialized = true;           

        }
        catch(err) {
            this.logger.logEvent({message:'error', error:err.message, fn:'init',stack:err.stack})
            this.isInitialized = false;
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

        if (!this.isInitialized) {
            this.init()
        }

        this.logger.logEvent({message:'Connect with Strava'})

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
                const observer = this.getApi().init(this.config)
                observer.on('token.updated',this.updateConfig.bind(this) )
            }
            this.saveCredentials()
            this.logger.logEvent({message:'Connect with strava success'})           
            return true
            
        }
        catch(err) {
            this.logger.logEvent({message:'Connect with Strava failed',error: err.message})
            throw err
        }

    }

    disconnect() {
        if (!this.isInitialized) {
            this.init()
        }
        try {
            this.getUserSettings().set('user.auth.strava',null)   
            this.config = undefined
            this.getApi().init(undefined)
        }
        catch(err) {
            this.logError(err,'disconnect')
        }
    }



    async upload(activity: ActivityDetails, format:string='TCX'):Promise<boolean> {
        try {
            
            if (!this.isInitialized) {
                const ok =this.init()
                if (!ok)
                    return false;
            }

            if (!this.isConnected())
                return false; 

            this.logger.logEvent({message:'Strava Upload', format})

            const fileName =  activity[`${format}FileName`];
            const res = await this.getApi().upload(fileName,{
                name: activity.title,
                description: '',
                format: this.getStravaFormat(format)                
            })
            this.logger.logEvent({message:'Strava Upload success', activityId: res.stravaId})
            return true;

        }
        catch(err) {
            if (err instanceof DuplicateError) {
                this.logger.logEvent({message:'Strava Upload failure', error: 'duplicate', activityId:err.stravaId})
            }
            else {
                this.logger.logEvent({message:'Strava Upload failure', error: err.message})
            }
            return false

        }
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



    protected getCredentials() {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.strava',null)        
        }
        catch {
            return null
        }
    }

    protected saveCredentials():void {
        this.logger.logEvent({message:'Strava Save Credentials'})

        
        try {

            if (!this.isConnected()) {
                this.getUserSettings().set('user.auth.strava',null)
                return;    
            }
            
            this.getUserSettings().set('user.auth.strava',{
                accesstoken: this.config.accessToken,
                refreshtoken: this.config.refreshToken,
                expiration: this.config.expiration.toISOString()
            })

        }
        catch(err) {
            this.logger.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logger.logEvent({message:'Strava Save Credentials done'})
    }

    protected updateConfig(config:StravaConfig) {
        const {accessToken, refreshToken,expiration} = config
        this.config = {...this.config,accessToken, refreshToken,expiration}
        this.saveCredentials()
    }

    
    // istanbul ignore next
    protected getSecret(key:string):string {
        return getBindings()?.secret?.getSecret(key)
    }

    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }

    protected getApi() {
        if (!this.api)
            this.api = new StravaApi()
        return this.api
    }

    
}