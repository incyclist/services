import IncyclistRoutesApi from ".";
import { Injectable, Singleton } from "../../../base/decorators";
import { useUserSettings } from "../../../settings";
import { IIncyclistRoutesApi } from "./types";

@Singleton
export class IncyclistRoutesApiFactory {

    protected apis:Map<string,IIncyclistRoutesApi> = new Map<string,IIncyclistRoutesApi>()

    create(key:string='default'):IIncyclistRoutesApi {
        if (this.apis.has(key))
            return this.apis.get(key)

        const ROUTE_API = this.getUserSettings().getValue('ROUTE_API',undefined)
        if (key==='default' && ROUTE_API===undefined) {
            const api = new IncyclistRoutesApi()
            this.apis.set('default',api)
            return api
        }
        else if (key==='default' && ROUTE_API!==undefined) {
            const api = new IncyclistRoutesApi(ROUTE_API)
            this.apis.set('default',api)
            return api
        }
        else {
            const api = new IncyclistRoutesApi(`routes.servers.${key}`)
            this.apis.set('default',api)
            return api
        }

    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }


}

export const useIncyclistRoutesApi = ()=>new IncyclistRoutesApiFactory()