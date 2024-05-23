import { sleep } from "incyclist-devices/lib/utils/utils"
import { Observer } from "../../../../base/types/observer"
import { valid } from "../../../../utils/valid"
import { AppApiBase } from "../base"
import { DuplicateError, StravaConfig, StravaRefreshTokenResponse, StravaUploadProps, StravaUploadRequest, StravaUploadResponse, StravaUploadResult } from "./types"
import { EventLogger} from 'gd-eventlog'
import { AxiosResponse } from "axios"

const API_BASE_URL = 'https://www.strava.com/api/v3'
const OAUTH_URL = 'https://www.strava.com/oauth'

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

export class StravaApi extends AppApiBase{

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

        if (!this.isAuthenticated())
            throw new Error('not authenticated')

        await this.verifyToken()

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


    async getLoggedInAthlete() {
        const response =  await this.get( '/athlete')
        return response.data

    }


    protected async verifyToken() {
        if (!this.isTokenStillValid()) {
            try {
                await this.refreshToken()
            }
            catch (err) {
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

    protected async waitForUploadResponse(response: StravaUploadResponse):Promise<StravaUploadResult> {
        let data = response

        while ( data.status!=='Your activity is ready.' && !data.error) {        
            await sleep(1000)
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
            throw new Error( response.error?.response?.data?.error|| response.error?.response?.message || response.error.message||`HTTP error ${response.status}`)
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
        const regex = new RegExp("duplicate of <a href='/activities/([0-9]+)'")
        const res = regex.exec(errMessage)
        if (res?.length>1)
            return res[1]
    }

    
    protected async refreshToken():Promise<void> {
        this.logger.logEvent({message: 'Strava refresh Token start'});

        try {

            const response = await this.getApi().request( {
                method:'post',
                url: this.getOauthBaseUrl()+'/token',
                data: {
                    grant_type : 'refresh_token',
                    refresh_token : this.config.refreshToken,
                    client_secret: this.config.clientSecret,
                    client_id : this.config.clientId
                }
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
                errorStr = `HTTP error ${response.status}: ${response.statusText}`
            }
                
            this.logger.logEvent({message: 'Strava refresh Token result',status:'error',error:errorStr});
        }
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

    protected getBaseUrl() {
        try {
            return this.getUserSettings().get('STRAVA_API',API_BASE_URL)
        }
        catch {
            return API_BASE_URL
        }
    }


}