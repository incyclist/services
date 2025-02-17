import { getBindings } from "../../api";
import { Injectable, Singleton } from "../../base/decorators";
import { valid } from "../../utils/valid";
import { StravaApi, StravaConfig } from "../base/api";
import { ConnectedAppService } from "../base/app";
import { StravaCredentials } from "./types";

@Singleton
export class StravaAppConnection extends ConnectedAppService<StravaCredentials> {
    protected config: StravaConfig
    protected api: StravaApi
    protected tokenUpdateHandler = this.updateConfig.bind(this)

    constructor() {
        super('StravaAppConnection','strava')
    }

    async connect( credentials:StravaCredentials):Promise<boolean> {

        this.ensureInitialized()

        this.logEvent({message:'Connect with Strava'})

        try {
            const isConnected = this.isConnected()
            const config = this.buildConfigFromCredentials(credentials)

            if (isConnected) {                
                this.getApi().update(config)
            }
            else {
                this.initApi(config)
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
     * Indicates whether a connection attempt to the Strava API is currently in progress.
     *
     * @returns {boolean} Always returns false as connections to Strava API are handled outside of the StravaUpload service.
     */
    isConnecting() {
        return false
    }


    disconnect():void {
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


    isConnected(): boolean {
        if (!this.isInitialized) {
            this.init()
        }

        return (valid(this.config))      
    }

    getCredentials():StravaCredentials {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.strava',null)        
        }
        catch {
            return null
        }   
    }

    getApi() {
        if (!this.api)
            this.api = new StravaApi()
        return this.api
    }


    protected initAuth():boolean {
        let isInitialized = false;

        try {
            const auth = this.getCredentials();
            const clientId = this.getSecret('STRAVA_CLIENT_ID');
            const clientSecret = this.getSecret('STRAVA_CLIENT_SECRET');


            if (clientId && clientSecret && auth) {
                this.logEvent({ message: 'Strava init done', hasCredentials: true });
                this.config = this.buildConfigFromCredentials(auth)
                this.initApi(this.config);
            }
            else {
                this.logEvent({ message: 'Strava init done', hasCredentials: false });
            }
            isInitialized = true;
        }
        catch (err) {
            this.logEvent({ message: 'error', error: err.message, fn: 'init', stack: err.stack });
            isInitialized = false;
            delete this.config;
        }

        return isInitialized

    }

    protected updateConfig(config:StravaConfig) {
        const {accessToken, refreshToken,expiration} = config
        this.config = {...this.config,accessToken, refreshToken,expiration}
        this.saveCredentials()
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
                expiration: this.config.expiration?.toISOString()
            })

        }
        catch(err) {
            this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logEvent({message:'Strava Save Credentials done'})
    }



    protected getSecret(key:string):string {
        return this.getSecretBindings()?.getSecret(key)
    }

    protected buildConfigFromCredentials(credentials: StravaCredentials) {
        return {
            clientId: this.getSecret('STRAVA_CLIENT_ID'),
            clientSecret: this.getSecret('STRAVA_CLIENT_SECRET'),
            accessToken: credentials?.accesstoken,
            refreshToken: credentials?.refreshtoken,
            expiration: credentials?.expiration ? new Date(credentials.expiration) : undefined
        };
    }


    protected initApi(config:StravaConfig) {
        const observer = this.getApi().init(config);
        observer.on('token.updated', this.tokenUpdateHandler);
    }


    @Injectable
    // istanbul ignore next
    protected getSecretBindings() {
        return getBindings()?.secret
    }



}