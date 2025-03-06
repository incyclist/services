import { getBindings } from "../../api";
import { Injectable, Singleton } from "../../base/decorators";
import { valid } from "../../utils/valid";
import { IntervalsApi, IntervalsConfig } from "../base/api";
import { ConnectedAppService } from "../base/app";
import { IntervalsCredentials } from "./types";

@Singleton
export class IntervalsAppConnection extends ConnectedAppService<IntervalsCredentials> {
    protected config: IntervalsConfig
    protected api: IntervalsApi
    

    constructor() {
        super('IntervalsAppConnection','intervals')
    }

    async connect( credentials:IntervalsCredentials):Promise<boolean> {

        this.ensureInitialized()

        this.logEvent({message:'Connect with Intervals.icu'})

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

            this.logEvent({message:'Connect with Intervals.icu success'})           
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
     * Indicates whether a connection attempt to the Intervals.icu API is currently in progress.
     *
     * @returns {boolean} Always returns false as connections to Intervals.icu API are handled outside of the Intervals.icu service.
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

        // for some reason, this.config sometimes was deleted, this block is double-checking in that situatin
        if (this.getApi().isAuthenticated() && !this.config) {
            this.initAuth()
        }

        return ( valid(this.config))      
    }

    getCredentials():IntervalsCredentials {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.intervals',null)        
        }
        catch {
            return null
        }   
    }

    getApi() {
        if (!this.api)
            this.api = new IntervalsApi()
        return this.api
    }


    protected initAuth():boolean {
        let isInitialized = false;

        try {
            const auth = this.getCredentials();
            if (auth) {
                this.logEvent({ message: 'Intervals.icu init done', hasCredentials: true });
                this.config = this.buildConfigFromCredentials(auth)
                this.initApi(this.config);
            }
            else {
                this.logEvent({ message: 'Intervals.icu init done', hasCredentials: false });
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

    protected updateConfig(config:IntervalsConfig) {
        const {accessToken} = config
        this.config = {...this.config,accessToken}
        this.saveCredentials()
    }

    protected saveCredentials(config?:IntervalsConfig):void {
        if (config)
            this.config = config
        
        try {

            if (!this.isConnected()) {
                this.logEvent({message:'Intervals.icu Delete Credentials'})            
                this.getUserSettings().set('user.auth.intervals',null)
                return;    
            }

            this.logEvent({message:'Intervals.icu Save Credentials'})            
            this.getUserSettings().set('user.auth.intervals',{
                accesstoken: this.config.accessToken
            })

        }
        catch(err) {
            this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logEvent({message:'Intervals.icu Save Credentials done'})
    }



    protected getSecret(key:string):string {
        return this.getSecretBindings()?.getSecret(key)
    }

    protected buildConfigFromCredentials(credentials: IntervalsCredentials) {
        return {
            accessToken: credentials?.accesstoken
        };
    }


    protected initApi(config:IntervalsConfig) {
        this.getApi().init(config);        
    }


    @Injectable
    // istanbul ignore next
    protected getSecretBindings() {
        return getBindings()?.secret
    }



}