import { Observer } from "../../../../base/types/observer"
import { valid } from "../../../../utils/valid"
import { AppApiBase } from "../base"
import { ActivityStreamEntry, DetailedActivity, DuplicateError, getLoggedInAthleteActivitiesProps, GetRoutesByAthleteIdProps, StravaApiErrorResponse, StravaAthleteResponse, StravaConfig, StravaRefreshTokenResponse, StravaRoute, StravaRoutesFilters, StravaRouteType, StravaStreamType, StravaUploadProps, StravaUploadRequest, StravaUploadResponse, StravaUploadResult, SummaryActivity } from "./types"
import { EventLogger} from 'gd-eventlog'
import { AxiosInstance, AxiosResponse } from "axios"
import { sleep } from "../../../../utils/sleep"
import { StringToStravaRouteType } from "./consts"
import { IExternalAppApi } from "../types"

const API_BASE_URL = 'https://www.strava.com/api/v3'
const OAUTH_URL = 'https://www.strava.com/oauth'
const AUTH_SERVER_URL = 'https://auth.incyclist.com'

/**
 * Represents a client implementation of a subset of the Strava v3 API
 * 
 * It only contains the subset of the APIs that are required by Incyclist
 * I decided against using existing APIs, such as the "strava-v3" module, 
 * as this would generate a dependency to the request library, which is deprecated
 * 
 * @example
 * // Create a new instance of StravaApi
 * const api = new StravaApi();
 * 
 * // Authenticate the user
 * api.init( { 
 *  accessToken: 'your access token',
 *  clientId: 'your client ID',
 *  client Secret: 'your client secret'
 *  redirectUri: 'your oauth redirect Uri'
 * 
 * });
 * 
 * // Upload a file
 * const fileName = 'example.csv';
 * api.upload(fileName)
 *     .then( {id} => {
 *        console.log(`File uploaded successfully, id is: ${id}`);
 *     })
 *     .catch(error => {
 *         console.error('Error during file upload:', error);
 *     });
 * 
 * // Check if the user is authenticated
 * const authenticated = api.isAuthenticated();
 * console.log('Is authenticated:', authenticated);
 * 
 * @class
 * @public
 */

export class StravaApi extends AppApiBase implements IExternalAppApi{

    protected config : StravaConfig
    protected logger: EventLogger
    protected observer: Observer

    constructor() {
        super()
        this.logger = new EventLogger('StravaApi')
        this.observer = new Observer()
    }

    init( config:StravaConfig):Observer {
        this.config  = config
        this.observer = this.observer??new Observer()
        return this.observer
    }

    update( config: Partial<StravaConfig>) {
        if (!this.config)
            throw new Error('update not allowed before init')

        this.config   = {...this.config, ...config}
    }

    /**
     * Checks if the user is authenticated.
     * @returns {boolean} Indicates if the user is authenticated.
     */
    isAuthenticated() {
        return valid(this.config?.accessToken) 
    }
    

    /**
     * Uploads a file to Strava
     * @param {string} fileName - The full path of the file to upload.
     * @param {StravaUploadProps} [props] - Additional upload properties.
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     * @throws {Error} Throws an error if not authenticated, the token refresh failed or any other error occured
     */
    async upload(fileName:string, props?:StravaUploadProps):Promise<StravaUploadResult> { 

        await this.verifyAuthentication()

        const request: StravaUploadRequest = {
            file: { type:'file', fileName},
            name: props?.name,
            description: props?.description,
            trainer: props?.trainer ? 'true' : 'false',
            commute: props?.commute ? 'true' : 'false',
            sport_type: props?.activityType ?? 'VirtualRide',

            data_type: props.format,
            external_id: props?.externalId
        } 
        const response = await this.createUpload(request)

        return await this.waitForUploadResponse(response)
    }

    async getLoggedInAthlete():Promise<StravaAthleteResponse|StravaApiErrorResponse<any>> {
        await this.verifyAuthentication()

        try {
            const response =  await this.get( '/athlete' )
            return response.data as StravaAthleteResponse
        }
        catch(err) {
            return {props:{}, error:'getLoggedInAthlete failed: '+err.message}
        }

    }

    async getLoggedInAthleteActivities(props:getLoggedInAthleteActivitiesProps={}) {
        await this.verifyAuthentication()

        try {
            const params = Object.keys(props).map( k => `${k}=${props[k]}`).join('&')
            const response =  await this.get( '/activities?'+params )
            return response.data as Array<SummaryActivity>
        }
        catch(err) {
            return {props, error:'getLoggedInAthleteActivities failed: '+err.message}
        }
    }

    async getLoggedInAthleteRoutes(props:GetRoutesByAthleteIdProps={}, filters?:StravaRoutesFilters):Promise<Array<StravaRoute>|StravaApiErrorResponse<GetRoutesByAthleteIdProps>> {
        await this.verifyAuthentication()

        try {
            const hasParams = Object.keys(props).length>0
            const params = Object.keys(props).map( k => `${k}=${props[k]}`).join('&')

            const url = `/athlete/routes${hasParams?'?'+params:''}` 
            const response =  await this.get( url)
            const all:Array<StravaRoute> = response.data as Array<StravaRoute>            
            
            this.logger.logEvent({message:'getLoggedInAthleteRoutes success', routes:all.length})
            return this.applyFilter(all,filters)
           
        }
        catch(err) {
            return {props, error:'getLoggedInAthleteRoutes failed: '+err.message}
        }
    }

    async getRouteAsGPX(id:string):Promise<string|StravaApiErrorResponse<any>> {
        await this.verifyAuthentication()

        try {
            const response =  await this.get( `/routes/${id}/export_gpx` )
            return response.data as string
        }
        catch(err) {
            return {props:{id}, error:'getRouteAsGPX failed: '+err.message}
        }

    }


    async getActivityById(id:string, include_all_efforts=false) {
        await this.verifyAuthentication()

        try {
            const response =  await this.get( `/activities/${id}?include_all_efforts=${include_all_efforts}` )
            return response.data as DetailedActivity
        }
        catch(err) {
            return {id, error:'getActivityById failed: '+err.message}
        }
    }

    async getActivityStream(id:string, keys:Array<StravaStreamType>=[]) {
        await this.verifyAuthentication()

        try {
            const params =keys.length>0 ? '?keys='+keys.join(',') : ''
            const response =  await this.get( `/activities/${id}/streams`+params )
            return response.data as Array<ActivityStreamEntry>
        }
        catch(err) {
            return {id, error:'getActivityStream failed: '+err.message}
        }
    }

    async getRoutesByAthleteId(id:string,props:GetRoutesByAthleteIdProps={}, filters?:StravaRoutesFilters):Promise<Array<StravaRoute>|StravaApiErrorResponse<GetRoutesByAthleteIdProps>> {
        await this.verifyAuthentication()

        try {
            const hasParams = Object.keys(props).length>0
            const params = Object.keys(props).map( k => `${k}=${props[k]}`).join('&')

            const url = `/athletes/${id}/routes${hasParams?'?'+params:''}` 
            const response =  await this.get( url)
            const all:Array<StravaRoute> = response.data as Array<StravaRoute>            

            return this.applyFilter(all,filters)
            
        }
        catch(err) {
            return {props, error:'getRoutesByAthleteId failed: '+err.message}
        }
    }




    protected async verifyToken() {
        if (!this.isTokenStillValid()) {
            try {
                await this.refreshToken()
            }
            catch  {
                throw new Error('token refresh failed')
            }
        }
    }

    protected isTokenStillValid():boolean {
        if (!this.config?.expiration)
            return false;

        const expiration = this.config.expiration
        return (Date.now()<expiration.valueOf())
    }

    protected async verifyAuthentication() {
        if (!this.isAuthenticated())
            throw new Error('not authenticated')

        await this.verifyToken()
    }

    protected async waitForReady() {
            await sleep(1000)
    }


    protected async waitForUploadResponse(response: StravaUploadResponse):Promise<StravaUploadResult> {
        let data = response

        while ( data.status!=='Your activity is ready.' && !data.error) {        
            await this.waitForReady()
            data = await this.getUploadById(data.id_str)
        }   

        if (data.error) {
            if (data.error.includes('duplicate of')) {
                const err = new DuplicateError( this.getDuplicateActivity(data.error))
                throw err
            }

            throw new Error ('Upload failed, reason:'+ data.error)
        }
        if (data.status==='Your activity is ready.') {
            return {
                stravaId: data.activity_id,
                externalId: data.external_id
            }
        }


    }

    protected async createUpload(request: StravaUploadRequest):Promise<StravaUploadResponse> {
       
        const reqOpts = {
            headers: {
                Authorization: 'Bearer ' + this.config.accessToken
            }
        }
        const form =await this.createForm('/uploads',request,reqOpts)
        const response = await this.postForm(form)
        if (response.data && !response.error) {
            return response.data;
        }
        else {            
            throw new Error( response.error?.response?.data?.error?? response.error?.response?.message ?? response.error.message??`HTTP error ${response.status}`)
        }

    }

    protected async getUploadById(id:string):Promise<StravaUploadResponse> {
        
        try {
            const response =  await this.get( '/uploads/'+id )
            return response.data as StravaUploadResponse
        }
        catch(err) {
            return {id: Number(id), id_str:id, error:'check status failed: '+err.message}
        }
    }

    protected getDuplicateActivity(errMessage) {
        
        const regex = /duplicate of <a href='\/activities\/(\d+)'/
        const res = regex.exec(errMessage)

        if (res?.length>1)
            return res[1]
    }

    
    /**
     * Refreshes the Strava access token.
     *
     * The refresh is performed server-side by `auth-server`'s `POST /strava/refresh`
     * endpoint, which holds the real Strava client secret and calls Strava's own
     * `/oauth/token` on the client's behalf. The client only ever sends the refresh
     * token it already has and receives back a fresh access/refresh token pair -
     * `client_id`/`client_secret` are never read or sent from here (see FIXES_BACKLOG #61).
     */
    protected async refreshToken():Promise<void> {
        this.logger.logEvent({message: 'Strava refresh Token start'});

        let requestData;
        const url = this.getAuthServerUrl()+'/strava/refresh'

        try {
            requestData =  {
                refresh_token : this.config.refreshToken
            }
            const response = await this.getApi().request( {
                method:'post',
                url,
                data:requestData
            })

            this.logger.logEvent({message: 'Strava refresh Token result',status:'success'});

            const data = response.data as StravaRefreshTokenResponse;

            const expiration = new Date( data.expires_at *1000 );
            this.config.accessToken =data.access_token;
            this.config.refreshToken = data.refresh_token;
            this.config.expiration = expiration;

            this.observer.emit('token.updated',this.config)

        }
        catch (err) {
            let errorStr = err.message
            if (err.response) {
                const {response} = err;
                errorStr = `HTTP error ${response.status}: ${response.statusText}, url:${url}, data:${JSON.stringify(requestData)}`
            }

            this.logger.logEvent({message: 'Strava refresh Token result',status:'error',error:errorStr});
        }
    }


    protected applyFilter(routes:Array<StravaRoute>, filters?:StravaRoutesFilters) {
        if (!filters)
            return routes;

        const sportTypeFilter = this.getSportTypeFilter(filters?.sport)

        return routes.filter( route => {
            let valid = true
            if (sportTypeFilter.length>0)
                valid = valid && (sportTypeFilter.includes(route.type))
            if (filters?.after)
                valid = valid && (new Date(route.created_at).valueOf()>filters.after.valueOf())
            if (filters?.lastUpdateAfter)
                valid = valid && (new Date(route.updated_at).valueOf()>filters.lastUpdateAfter.valueOf())

            return valid                
        })

    }

    protected getSportTypeFilter(filterStr:string):Array<StravaRouteType> {
        if (!filterStr)
            return []

        const sportTypeFilter = filterStr?.split(',')??[]

        const transformed: Array<StravaRouteType> = []
        for (const sport of sportTypeFilter) {
            const stravaType = StringToStravaRouteType[sport]
            if (stravaType) {
                transformed.push(stravaType)
            }
        }
        return transformed
    }


    protected async get(url:string, config?:object):Promise<AxiosResponse> {
        await this.verifyToken()

        const props = config??{}
        
        const request = {
            method:'get',
            url: this.getBaseUrl()+url,
            headers: {
                Authorization: 'Bearer ' + this.config.accessToken
            },
            ...props            
        }
        const response =  await this.getApi().request(request )
        return response
    }

    protected getOauthBaseUrl() {
        try {
            return this.getUserSettings().get('STRAVA_OAUTH_URL',OAUTH_URL)
        }
        catch {
            return OAUTH_URL
        }

    }

    protected getAuthServerUrl() {
        try {
            return this.getUserSettings().get('STRAVA_AUTH_SERVER_URL',AUTH_SERVER_URL)
        }
        catch {
            return AUTH_SERVER_URL
        }
    }

    protected getBaseUrl() {
        try {
            return this.getUserSettings().get('STRAVA_API',API_BASE_URL)
        }
        catch {
            return API_BASE_URL
        }
    }

    protected getApi():AxiosInstance {
        return super.getApi(true)
    }


}