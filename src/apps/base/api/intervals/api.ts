import { Observer } from "../../../../base/types/observer"
import { valid } from "../../../../utils/valid"
import { AppApiBase } from "../base"
import { EventLogger} from 'gd-eventlog'
import { AxiosResponse } from "axios"
import { IntervalsAthlete, IntervalsConfig, IntervalsUploadProps, IntervalsUploadRequest, IntervalsUploadResponse, IntervalsUploadResult } from "./types"

const API_BASE_URL = 'https://intervals.icu/api/v1'

/**
 * Represents a client implementation of a subset of the Intervals.icu v1 API
 * 
 * It only contains the subset of the APIs that are required by Incyclist
 * 
 * @example
 * // Create a new instance of IntervalsApi
 * const api = new IntervalsApi();
 * 
 * // Authenticate the user
 * api.init( { 
 *  accessToken: 'your access token',
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

export class IntervalsApi extends AppApiBase{

    protected config : IntervalsConfig
    protected logger: EventLogger
    protected observer: Observer

    constructor() {
        super()
        this.logger = new EventLogger('IntervalsApi')
        this.observer = new Observer()
    }

    init( config:IntervalsConfig):Observer {
        this.config  = config
        return this.observer
    }

    update( config: Partial<IntervalsConfig>) {
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
     * @param {IntervalsUploadProps} [props] - Additional upload properties.
     * @returns {Promise<IntervalsUploadResult>} Indicates if the upload was successful.
     * @throws {Error} Throws an error if not authenticated or any other error occured
     */
    async upload(fileName:string, props?:IntervalsUploadProps):Promise<IntervalsUploadResult> { 

        await this.verifyAuthentication()

        const request: IntervalsUploadRequest = {
            file: { type:'file', fileName},
            name: props?.name,
            description: props?.description                ,
            externalId:props.externalId

        } 
        return await this.createUpload(request)

    }


    /**
     * returns the profile information of the authenticated user
     * 
     * @returns {Promise<IntervalsAthlete>} Profile information of the logged in user
     * @throws {Error} Throws an error if not authenticated or any other error occured
     */
    async getLoggedInAthlete():Promise<IntervalsAthlete> {
        const response =  await this.get( '/athlete/0/profile')
        return response.data?.athlete

    }




    protected async verifyAuthentication() {
        if (!this.isAuthenticated())
            throw new Error('not authenticated')
    }


    protected async createUpload(request: IntervalsUploadRequest):Promise<IntervalsUploadResult> {
       
        const reqOpts = {
            headers: {
                Authorization: 'Bearer ' + this.config.accessToken
            }
        }
        
        let url = `/athlete/0/activities${this.getUploadParams(request)}`

        const form =await this.createForm(url,{file:request.file},reqOpts)
        const response = await this.postForm(form)
        
        if (response.data && !response.error && !response.data.error) {
            const result:IntervalsUploadResponse= response.data
            return {
                externalId: request.externalId,
                intervalsId: result.id
            }
        }
        else {            
            const result:IntervalsUploadResponse= response.data
            if (result?.error)
                throw new Error( result.error)

            throw new Error( response.error?.response?.data?.error?? response.error?.response?.message?? response.error.message??`HTTP error ${response.status}`)
        }

    }
    

    protected async get(url:string, config?:object):Promise<AxiosResponse> {
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
    protected getUploadParams(request:IntervalsUploadRequest):string {
            
        const params:Array<string> = []
        if (request.name)
            params.push(`name=${request.name}`)
        if (request.description)
            params.push(`description=${request.description}`)

        if (params.length===0)
            return ''

        return '?'+params.join('&')
    }

    
    protected getBaseUrl() {
        try {
            return this.getUserSettings().get('INTERVALS_API',API_BASE_URL)
        }
        catch {
            return API_BASE_URL
        }
    }


}