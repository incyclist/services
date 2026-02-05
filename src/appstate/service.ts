import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { useUserSettings } from "../settings";
import { AppFeatures, FeatureToggle } from "./types";

/**
 * This service is responsible for managing the application state.
 *
 * The service supports two types of state:
 * - persisted state: this type of state is stored in the user settings and will be persisted across app restarts.
 * - unpersisted state: this type of state is only tracked within the current session.
 *
 * Persisted state can be managed using `setPersistedState` and `getPersistedState` methods.
 * Unpersisted state can be managed using `setState` and `getState` methods.
 *
 * @class
 * @public
 * @noInheritDoc
 */
@Singleton
export class AppStateService extends IncyclistService {

    protected state: Record<string,any> = {}
    protected appFeatures: AppFeatures

    constructor() {
        super('AppState')
    }
    
    public hasFeature( feature:FeatureToggle) {
        return this.getSetting( feature, false)
    }


    public setAppFeatures( features:AppFeatures) {
        this.appFeatures = features
    }
    public getAppFeatures():AppFeatures {
        return this.appFeatures
    }

    /**
     * Retrieves the persisted state associated with the given key.
     *
     * @param key - The key for which to retrieve the persisted state.
     * @returns The value associated with the key, or undefined if not found.
     */

    public getPersistedState(key:string):any {
        return this.getSetting(`state.${key}`,undefined)
    }
    /**
     * Stores the given value under the given key in the user settings.
     * This data will be persisted across app restarts.
     * @param key - The key under which to store the value.
     * @param value - The value to store.
     */
    public setPersistedState(key:string,value:any) {
        try {
            this.getUserSettings().set(`state.${key}`,value)
        }
        catch {}

    }
    /**
     * Retrieves the state associated with the given key.
     * This data is NOT persisted across app restarts.
     * @param key - The key for which to retrieve the state.
     * @returns The value associated with the key, or undefined if not found.
     */
    public getState(key:string):any {
        return this.state[key]   
    }

    /**
     * Stores the given value under the given key in the state.
     * This data is NOT persisted across app restarts.
     * @param key - The key under which to store the value.
     * @param value - The value to store.
     *      If null is given, the key will be deleted from the state.
     */
    public setState(key:string,value:any) {
        if (value===null) {
            delete this.state[key]
            return
        }
        this.state[key] = value
    }


    protected getSetting(key:string, def:any) {
        try {
            return this.getUserSettings().get(key, def)
        } catch {
            return def
        }        
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }
}

export const useAppState = () => new AppStateService()