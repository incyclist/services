import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { ActivityDetails } from "../base";
import { valid } from "../../utils/valid";
import { DuplicateError, StravaApi, StravaConfig, StravaFormat } from "../../apps/base/api/strava";
import { getBindings } from "../../api";
import { IActivityUpload, StravaAuth } from "./types";
import { Injectable } from "../../base/decorators/Injection";

/**
 * Represents a service that can be used by Incyclist to connect an account with Strava API and upload an activity to Strava
 * 
 * 
 * @example
 * // Create a new instance of StravaApi
 * const strava = new StravaUpload()
 * strava.upload(activity,'tcx)
 * 
 * @class
 * @public
 */


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

    /**
     * Initializes the StravaUpload service.
     *
     * This method checks if the service is already initialized, and if so, returns true.
     * 
     * It ensures that the UserSettings service is initialized before proceeding. 
     * The method attempts to retrieve the Strava client ID, client secret, and authentication credentials. 
     * If all required credentials are available, it sets up the configuration and initializes the Strava API.
     * Logs messages indicating whether the initialization succeeded and if credentials were found.
     * If an error occurs during initialization, it logs the error and resets the initialization state.
     *
     * @returns {boolean} True if the initialization is successful, false otherwise.
     */
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


    /**
     * Indicates whether the user has connected his Incyclist account to Strava API 
     *
     *
     * @returns {boolean} True if the user has stored a connection to Strava API.
     */
    isConnected() {
        if (!this.isInitialized) {
            this.init()
        }

        return (valid(this.config))
    }

    /**
     * Indicates whether a connection attempt to the Strava API is currently in progress.
     *
     * @returns {boolean} Always returns false as connections to Strava API are handled outside of the StravaUpload service.
     */
    isConnecting() {
        return false
    }

    /**
     * Connects an Incyclist user with the Strava API using the provided access and refresh tokens.
     *
     * This connection is done by storing the credentials in the UserSettings service and by initializing the Strava API.
     * with the given credentials. 
     * 
     * The method Logs events for connection attempts and successes.
     * 
     * If the App has not yet been initialized, the method will skip the connection process, as it requires 
     * the UserSettings service to store the credentials.
     *
     * @param {string} accessToken - The access token for Strava API authentication.
     * @param {string} refreshToken - The refresh token for Strava API authentication.
     * @param {Date} [expiration] - The optional expiration date of the access token.
     * @returns {Promise<boolean>} Resolves to true if the connection is successful.
     * @throws {Error} Logs and rethrows any errors that occur during the connection process.
     */
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

    /**
     * Disconnects the user from the Strava API by clearing the current configuration
     * and resetting the API state. It also saves the cleared credentials.
     */
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



    /**
     * Uploads an activity to Strava.
     * 
     * If the activity is uploaded successfully, the links property of the activity is updated with the activity_id and the url.
     * If the upload fails because Strava reports that this activity already exists, the links property is updated with the activity_id and the url provided by Strava.
     * If the upload fails on any other error, the links property is updated with the error message.
     * 
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity. 
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
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

    /**
     * Returns the URL for the given activity id on Strava.
     *
     * @param {string} activityId - The Strava activity id.
     * @returns {string} The URL of the activity on Strava.
     */
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