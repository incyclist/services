import IncyclistRoutesApi from "./api";
import { Injectable, Singleton } from "../../../base/decorators";
import { useUserSettings } from "../../../settings";
import { IIncyclistRoutesApi } from "./types";
import { validateRouteServerUrl } from "../../servers/validator";

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
            const baseUrl = this.getUserSettings().getValue(`routes.servers.${key}`,null)
            const api = new IncyclistRoutesApi(baseUrl??key)
            api.setSource(key)

            // servers added in the app have been checked against the address rules. For those, redirects must not
            // lead somewhere the rules would not have accepted. Servers written into the config file keep working as before.
            if (validateRouteServerUrl(baseUrl??key,{allowsLocalHttp:true}).valid)
                api.setRequestOptions({enforceRedirectRules:true})

            this.apis.set(key,api)
            return api
        }

    }

    /**
     * Drops the cached api of a route server, so that the next call to create() reads its (new) url from the settings
     *
     * @param key name of the route server
     */
    invalidate(key:string):void {
        this.apis.delete(key)
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }


}

export const useIncyclistRoutesApi = ()=>new IncyclistRoutesApiFactory()