import { Injectable } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { useUserSettings } from "../../../settings";
import { IConnectedApp } from "../../types";
import { AppCredentials } from "../types";

let instanceCnt = 0


export class ConnectedAppService<C extends AppCredentials> extends IncyclistService implements IConnectedApp {


    protected isInitialized: boolean
    protected id

    constructor(protected service, protected appKey:string) {
        super(service)
        this.id = instanceCnt++
        this.isInitialized = false
        this.init()

    }

    /**
     * Initializes the Connected App service.
     *
     * This method checks if the service is already initialized, and if so, returns true.
     * 
     * It ensures that the UserSettings service is initialized before proceeding. 
     * The method attempts to retrieve the App Credentials. 
     * If all required credentials are available, it sets up the configuration and marks the Connection is initialized.
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

        this.isInitialized = this.initAuth();

        return this.isInitialized
    }    
    


    connect( credentials:C):Promise<boolean> {
        throw new Error('method not implemented')        
    }

    disconnect():void {
        throw new Error('method not implemented')
    }


    isConnected(): boolean {
        throw new Error('method not implemented')        
    }

    getCredentials():C {
        throw new Error('method not implemented')        
    }

    protected initAuth():boolean {
        throw new Error('method not implemented')
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }


    @Injectable
    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }


}