import { getBindings } from "../../api";
import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";

const MAPS_API_URL = 'https://maps.googleapis.com/maps/api/js'

@Singleton
export class GoogleMapsService extends IncyclistService {

    api: any // representation of the Google Maps API


    constructor() {
        super('GoogleMaps')
    }


    setApi(api): void {     
        this.api = api
    }

    getApi(): any {
        return this.api
    }

    async getApiKey(): Promise<string> {
        const settings = this.getUserSettings()

        const personalKey = settings.get('GOOGLE_MAPS_API_KEY',undefined)
        const appKey = this.getSecret('GOOGLE_API_KEY')
        const developmentMode = settings.get('mode', 'production')==='development';

        if (developmentMode)
            return personalKey

        return personalKey ?? appKey
    }

    hasPersonalApiKey() {
        const settings = this.getUserSettings()

        const personalKey = settings.get('GOOGLE_MAPS_API_KEY',undefined)
        return personalKey!==undefined
    }

    onPersonalApiKeySet() {
        this.emit('reload')
    }

    getMapsDownloadUrl () {
        return MAPS_API_URL
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
