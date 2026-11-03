import { getBindings } from "../../api";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";

const MAPS_API_URL = 'https://updates.incyclist.com/api/v1/maps'// 'https://maps.googleapis.com/maps/api/js'


@Singleton
export class GoogleMapsService extends IncyclistService {

    api: any // representation of the Google Maps API

    /** personal key (trimmed, '' = none) that the session was launched with; undefined until first read */
    protected latchedKey: string | undefined


    constructor() {
        super('GoogleMaps')
        
        // some tests might mock UserSettings without setting requestNotifyOnChange
        const observer = this.getUserSettings().requestNotifyOnChange?.('maps','GOOGLE_MAPS_API_KEY')
        observer?.on('changed',this.onPersonalApiKeySet.bind(this))
    }


    setApi(api): void {     
        this.api = api
        this.emit('loaded')
    }

    getApi(): any {
        return this.api
    }

    async waitForApiKey():Promise<boolean> {
        if (this.api)
            return true
    }

    async getApiKey(): Promise<string> {
        const settings = this.getUserSettings()


        const personalKey = settings.getValue('GOOGLE_MAPS_API_KEY',undefined)
        const developmentMode = settings.get('mode', 'production')==='development';

        // the Maps API is loaded with the first key that is requested, so that is the key the
        // session runs on
        this.latchPersonalKey(personalKey)

        if (developmentMode)
             return personalKey??'development'


        return personalKey //?? appKey
    }

    hasPersonalApiKey() {
        const settings = this.getUserSettings()

        const personalKey = settings.get('GOOGLE_MAPS_API_KEY',undefined)
        return personalKey!==undefined
    }

    /**
     * Is a (non-blank) personal API key active in this session, i.e. was it loaded at launch?
     *
     * A key that is saved later only takes effect at the next launch, so it does not count here.
     * Always false on mobile, where the native SDK runs on Incyclist's key.
     * Fails closed: if the settings can not be read, there is no key.
     */
    hasActivePersonalApiKey(): boolean {
        try {
            if (this.isMobile())
                return false

            this.latchPersonalKey(this.readPersonalKey())
            return this.latchedKey !== ''
        }
        catch(err) {
            this.logError(err,'hasActivePersonalApiKey')
            return false
        }
    }

    /**
     * Has a (non-blank) personal API key been saved that differs from the one loaded at launch?
     * Desktop only - it will be used after the next restart.
     */
    isPersonalApiKeyPendingRestart(): boolean {
        try {
            if (this.isMobile())
                return false

            this.latchPersonalKey(this.readPersonalKey())
            const current = this.normalizeKey(this.readPersonalKey())
            return current !== '' && current !== this.latchedKey
        }
        catch(err) {
            this.logError(err,'isPersonalApiKeyPendingRestart')
            return false
        }
    }

    onPersonalApiKeySet() {
        // once the Maps API is loaded, a new key must not trigger a second load
        this.reload()
    }
    hasDevelopmentApiKey() {
        const settings = this.getUserSettings()
        return settings.get('mode', 'production')==='development';        
    }

    getMapsDownloadUrl () {
        const settings = this.getUserSettings()
        const url = settings.getValue('MAPS_API_URL',MAPS_API_URL)
        return url
    }

    reload() {
        if (!this.api) {
            this.emit('reload')
        }
    }

    protected readPersonalKey(): unknown {
        return this.getUserSettings().getValue('GOOGLE_MAPS_API_KEY',undefined)
    }

    protected normalizeKey(key: unknown): string {
        return typeof key === 'string' ? key.trim() : ''
    }

    protected latchPersonalKey(key: unknown): void {
        this.latchedKey ??= this.normalizeKey(key)
    }

    protected isMobile(): boolean {
        return this.getBindings()?.appInfo?.getChannel() === 'mobile'
    }

    protected getSecret(key:string):string {
        return this.getSecretBindings()?.getSecret(key)
    }

    @Injectable
    // istanbul ignore next
    protected getSecretBindings() {
        return getBindings()?.secret
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    // istanbul ignore next
    protected getBindings() {
        return getBindings()
    }


}

export const useGoogleMaps = ()=> new GoogleMapsService()
