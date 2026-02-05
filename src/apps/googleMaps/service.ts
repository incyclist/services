import { getBindings } from "../../api";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";

const MAPS_API_URL = 'https://updates.incyclist.com/api/v1/maps'// 'https://maps.googleapis.com/maps/api/js'


@Singleton
export class GoogleMapsService extends IncyclistService {

    api: any // representation of the Google Maps API


    constructor() {
        super('GoogleMaps')
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

        if (developmentMode)
             return personalKey??'development'


        return personalKey //?? appKey
    }

    hasPersonalApiKey() {
        const settings = this.getUserSettings()

        const personalKey = settings.get('GOOGLE_MAPS_API_KEY',undefined)
        return personalKey!==undefined
    }

    onPersonalApiKeySet() {
        this.emit('reload')
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


}

export const useGoogleMaps = ()=> new GoogleMapsService()
