import axios, { AxiosInstance } from 'axios';
import {EventLogger} from 'gd-eventlog'
import  { v4  } from 'uuid';
import { ApiClientInitProps } from './types';

/**
 * REST API CLient 
 * 
 * All Calls to the Incyclist REST API should be made using this class.
 * 
 * It enriches the axios libary with the following features
 *  - Default Headers will be added, to better associate the requests with specific channels,versions and uuids
 *  - Request Authorisation
 *  - optional request logging
 * 
 * 
 * @example
 *  ApiClient.getInstance.init({channel:'desktop', version:'0.6', appVersion:'1.0', API_KEY='<some key>',uuid='123', requestLog:true })
 * 
 *  const client = ApiClient.getClient()
 *  const rides = await client.get('https://incyclist.com/active-rides')
 * 
 * 
 * @noInheritDoc
 * 
 */

export class ApiClient {

    static _instance = null;

    protected axios: AxiosInstance
    protected logger: EventLogger
    protected requests: Array <{
        tid: string,
        ts: number
    }>

    /**
     * Provides access to the ApiClient Instance
     * 
     * @returns ApiClient singleton instance
     */
    static getInstance():ApiClient {
        if ( !ApiClient._instance ) {
            ApiClient._instance = new ApiClient();
        }
        return ApiClient._instance;
    }

    /**
     * Provides access to the axios client object
     * 
     * The axios client object will be used to make the REST calls ( get(), post(), ...)
     * For methods exposed, please have a look at the Axios documentation 
     * 
     * This static method is a soprter alternative call for ApiClient.getInstance().getClient()
     * 
     * @returns client object
     */
    static getClient():AxiosInstance {
        return ApiClient.getInstance().client()
    }

    /**
     * Initialises the Api Client instance
     * 
     * This method needs to be called once in the app before any Api calls can be made against 
     * the Incyclist APIs
     * 
     */
    init( props: ApiClientInitProps):void {
        const { uuid, apiKey, requestLog=true,version,appVersion,channel='desktop'} = props;


        const headers = {
            "X-uuid":uuid, 
            "X-API-Key": apiKey,
            "x-app-channel" : channel,
            "x-app-version" : appVersion,
            "x-react-version" : version
        }
      

        this.axios = axios.create({headers});

        if (requestLog) {
            this.logger = new EventLogger('API')
            this.requests = [];
            this.axios.interceptors.request.use( (req) => this.onRequest(req))
            this.axios.interceptors.response.use( (res) => this.onResponse(res))
        }

    }

    /**
     * Provides access to the axios client object
     * 
     * The axios client object will be used to make the REST calls ( get(), post(), ...)
     * For methods exposed, please have a look at the Axios documentation 
     * 
     * @returns client object
     */
    client():AxiosInstance {
        if (this.axios)
            return this.axios;

        return axios;
    }

    protected onRequest(req) {

        if (!req)
            return;
        try {
            const ts = Date.now()
            const tid = v4()
            req.headers['x-transaction-id'] = tid;
            this.requests.push( {tid,ts } )
    
        }
        catch(err) {
            this.logger.logEvent({message:'error',fn:'onRequest()',error:err.message||err, stack:err.stack})
        }
        return req;
        
    }

    protected onResponse(res) {
        if (!res)
            return;

        try {

            const {config,status} = res||{};        
            const {headers={},url,method,params} = config
            const tid = headers['x-transaction-id']
            if(!tid)
                return res
            
            const idx = this.requests.findIndex( r=> r.tid===tid)
            if (idx!==-1) {
                const tsStart = this.requests[idx].ts
                this.requests.splice(idx,1)
                this.logger.logEvent({message:'api call',method,url,tid, status, duration: Date.now()-tsStart,params})
            }
        }
        catch(err) {
            this.logger.logEvent({message:'error',fn:'onResponse',error:err.message||err, stack:err.stack})
        }
        
        return res;
    }

}