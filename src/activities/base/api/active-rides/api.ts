import { AxiosInstance } from "axios";
import { Singleton } from "../../../../base/types";
import { trimTrailingChars } from "../../../../utils";
import { useUserSettings } from "../../../../settings";
import { Injectable } from "../../../../base/decorators";
import { IncyclistRestApiClient } from "../../../../api";
import { ActiveRideEntry } from "../../../active-rides/types";
import { ActiveRideQuery } from "./types";


const DEFAULT_DOMAIN = 'incyclist.com'

@Singleton
export class IncyclistActiveRidesApi { 
    protected api: AxiosInstance

    async getAll(params?:ActiveRideQuery): Promise<ActiveRideEntry[]> {

        try {
            const baseUrl = this.getBaseUrl()
            const apiCall = params? this.getApi().get(`${baseUrl}/`, {params}) : this.getApi().get(`${baseUrl}/`)
            const response =  await apiCall

            if (response.status!==200)
                return []

            return response.data?.activeRides??[]
        }
        catch {
            return []
        }
    }

    async getByRouteHash( hash:string) {
        return this.getAll( {routeHash:hash})
    }

    async getById( id:string):Promise<ActiveRideEntry> {
        try {
            const baseUrl = this.getBaseUrl()
            const response =  await this.getApi().get(`${baseUrl}/${id}`)
            if (response.status!==200)
                return null

            return response.data
        }
        catch {
            return null
        }
    }

    async getBySessionId( sessionId:string) {
        const list = await this.getAll( {sessionId})
        return list.filter( e=> e.sessionId===sessionId)
        
    }

    protected getApi():AxiosInstance {
        if (!this.api) {
            this.api = IncyclistRestApiClient.getClient(true)
            return this.api
        }
        return this.api
    }

    protected getBaseUrl():string {        

        let baseUrl
        try {
            const domain = this.getUserSettings().get('DOMAIN',DEFAULT_DOMAIN)
            const defaultUrl = `https://dlws.${domain}/api/v1/active-rides`
            baseUrl = this.getUserSettings().get('ACTIVE_RIDES_API',defaultUrl)
        }
        catch {
            const domain = DEFAULT_DOMAIN
            baseUrl = `https://dlws.${domain}/api/v1/active-rides`
        }

        return trimTrailingChars(baseUrl,'/')
    }

    @Injectable
    getUserSettings() {
        return useUserSettings()
    }
    

}