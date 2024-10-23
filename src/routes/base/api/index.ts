import {EventLogger} from 'gd-eventlog'
import { RouteApiDescription, RouteApiDetail, RouteDescriptionQuery } from "./types";
import { AxiosInstance } from "axios";
import { DEFAULT_ROUTE_API, NO_CACHE, ROUTE_API } from './consts'
import { IncyclistRestApiClient } from '../../../api';
import { useUserSettings } from '../../../settings';
import { RoutePoint } from '../types';

export default class IncyclistRoutesApi { 

    protected static _instance

    static getInstance():IncyclistRoutesApi{
        if (!IncyclistRoutesApi._instance) 
        IncyclistRoutesApi._instance = new IncyclistRoutesApi()
        
        return IncyclistRoutesApi._instance
    }

    protected logger: EventLogger
    protected api: AxiosInstance

    constructor() {
        this.logger = new EventLogger('RouteListApi')
    }

    protected logError( err:Error, fn:string, logInfo?) {
        const args = logInfo || {}
        this.logger.logEvent( {message:'Error', error:err.message, fn, ...args})
    }

    protected getApi():AxiosInstance {
        if (!this.api) {
            this.api = IncyclistRestApiClient.getClient()
            return this.api
        }
        return this.api
    }


    protected getBaseUrl() {
        
        return useUserSettings().get(ROUTE_API,DEFAULT_ROUTE_API)
    }

    async getRouteDescriptions(query:RouteDescriptionQuery, throws:boolean = false): Promise<Array<RouteApiDescription>> {
        const {type='gpx',category} = query;

        let url  = (type === 'gpx' ) ? `?private=false` : `/?type=${type}`;
        if (category)
            url += "&category=${category}"

        try {
            const res = await this._get( url, NO_CACHE )       
            return res.data;           
        }
        catch(err) {
            if (throws)
                throw(err)

            this.logError(err,'getRouteDescriptions', {query})
            return undefined
        }
    }

    static verify(route) {
        if (route['decoded'] ) {
            route.points =route['decoded']
            delete route['decoded']

            IncyclistRoutesApi.fixMissingRouteDistances(route.points)
        }

    }

    protected static fixMissingRouteDistances(points:Array<RoutePoint>) {
        let routeDistance = 0
        points.forEach( (p)=> {
            if (!p.routeDistance)
                p.routeDistance = routeDistance
            routeDistance = p.routeDistance+p['distance']
        })

    }

    async getRouteDetails( routeId: string): Promise<RouteApiDetail> {

        try {
            const res = await this._get( `/${routeId}` )  
            IncyclistRoutesApi.verify(res.data)
            return res.data;           
        }
        catch(err) {
            this.logError(err,'getRouteDetails', {routeId})
            return undefined
        }
    }

    async getRoutePreview( routeId: string): Promise<string> {

        try {
            const res = await this._get( `/${routeId}/preview` )              
            return res.data?.url;           
        }
        catch(err) {
            return undefined
        }
    }

    async reload():Promise<void> {
        try {
            await this._get( `/reload` )                   
        }
        catch(err) {
            this.logError(err,'reload')
        }

    }

    protected async _get(url:string, ...args) {
        const api = this.getApi()
        const baseUrl = this.getBaseUrl()
        
        return await api.get( baseUrl+url, ...args )       
    }


}




