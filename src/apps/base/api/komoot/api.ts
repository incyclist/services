import { EventLogger } from 'gd-eventlog';
import { valid } from '../../../../utils/valid';
import { AppApiBase } from '../base';
import { KomootAuthConfig, KomootCoordinate, KomootGetTourRequestFilters, KomootGetTourRequestParams, KomootLoginResponse, KomootSportType, KomootTourSummary, KomootUploadFormat } from './types';


const API_BASE_URL = 'https://api.komoot.de/v007'

/**
 * Represents a client implementation of the  Komoot API. 
 * 
 * __Note__: The kommot API is not officially supported and might change/deprecate any time
 * 
 * @example
 * // Create a new instance of KomootApi
 * const api = new KomootApi();
 * 
 * // Authenticate the user
 * api.login('username', 'password','userid)
 *     .then(response => {
 *         console.log('Login successful:', response);
 *     })
 *     .catch(error => {
 *         console.error('Error during login:', error);
 *     });
 * 
 * // Check if the user is authenticated
 * const authenticated = api.isAuthenticated();
 * console.log('Is authenticated:', authenticated);
 * 
 * @class
 * @public
 */
export class KomootApi  extends AppApiBase{

    protected username: string
    protected password: string
    protected userid: string
    protected logger: EventLogger

    constructor() {
        super()
        this.logger = new EventLogger('KomootAPI')
    }

    /**
     * Authenticates the user with Komoot API.
     * @param {string} username - The username.
     * @param {string} password - The password.
     * @param {string} userid - The userid
     * @returns {Promise<KomootLoginReponse>} The login response.
     */
    async login(username:string,password:string,userid:string):Promise<KomootLoginResponse> {
        try {
          
            const response = await this.get('/users/'+userid,{auth:{username,password}} )

            if (response.status>=400 && response.status<500) {
                throw new Error('invalid credentials')
            }
            if (response.status<200 || response.status>=500) {
                throw new Error('server error')
            }

            const {data} = response
            if (data.email!==username) {
                throw new Error('invalid credentials')
            }

            this.setAuth({username,password,userid})

            return {
                authenticated:true,
                id: data.username,
                email: data.email,
                name: data.display_name
            }
        }
        catch(err) {
            let error = err?.response?.message??err?.response?.data?.message??err.message

            if (err?.response?.status>=400 && err?.response?.status<500) {
                error = 'invalid credentials'
            }
            if (err?.response?.status<200 || err?.response?.status>=500) {
                error = 'server error'
            }
           return {authenticated:false, error}
        }
    }

    setAuth( auth:KomootAuthConfig|null):void {
        if (!auth) { 
            delete this.username
            delete this.password
            delete this.userid
            return
        }
        this.username = auth.username
        this.password = auth.password
        this.userid = auth.userid
    }
    

    /**
     * Checks if the user is authenticated.
     * @returns {boolean} Indicates if the user is authenticated.
     */
    isAuthenticated() {
        return valid(this.username) && valid(this.password) && valid(this.userid)
    }


    /**
     * Gets the tours for the authenticated user.
     * @param {KomootGetTourRequestParams} [params] - optional parameters for the search (supported by Komoot).
     * @param {KomootGetTourRequestFilters} [filters] - optional additional filters.
     * @returns {Promise<Array<KomootTourSummary>>} The tours.
     */
    async getTours( params:KomootGetTourRequestParams={}, filters?:KomootGetTourRequestFilters):Promise<Array<KomootTourSummary>> {

        const tsStart = Date.now()
        let args
        try {
        
            const auth = this.getBasicAuthCredentials()

            if (!this.userid) {
                this.logger.logEvent({message:'getTours failed', reason:'invalid credentials' })
                throw new Error('invalid credentials')
            }

            const keys = Object.keys(params??{})
            args = keys.map(key=>`${key}=${params[key]}`).join('&')
            const url = keys.length>0 ? `/users/${this.userid}/tours/?`+args : `/users/${this.userid}/tours/`
        
            const response = await this.get(url,{auth} )
            if (response.status>=400 && response.status<500) {
                this.logger.logEvent({message:'getTours failed',args, reason:'invalid credentials',duration: Date.now()-tsStart  })
                throw new Error('invalid credentials')
            }

            const tours = response.data?._embedded?.tours??[]
            
            const result = this.applyFilter(tours,filters)
            this.logger.logEvent({message:'getTours result', args, tours:result.length,duration: Date.now()-tsStart  })
            return result
        }
        catch(err) {
            this.logger.logEvent({message:'getTours failed', args, reason:err.message,duration: Date.now()-tsStart  })
            throw(err)
        }
    }

    /**
     * Retrieves the coordinates of a tour.
     * @param {number} id - The tour id.
     * @returns {Promise<Array<KomootCoordinate>>} The coordinates of the tour.
     */
    async getTourCoordinates( id:number):Promise<Array<KomootCoordinate>> {
        const tsStart = Date.now()
        try {


            const url = `/tours/${id}/coordinates`
            const auth = this.getBasicAuthCredentials()
        
            const response = await this.get(url,{auth} )
            if (response.status===404) {
                this.logger.logEvent({message:'getTourCoordinates failed', id, reason:'not found',duration: Date.now()-tsStart  })
                throw new Error('not found')
            }
            else if (response.status>=400 && response.status<500) {
                this.logger.logEvent({message:'getTourCoordinates failed', id, reason:'invalid credentials',duration: Date.now()-tsStart  })
                throw new Error('invalid credentials')
            }
            
            const points = response.data?.items??[]
            this.logger.logEvent({message:'getTourCoordinates result', id, points:points.length,duration: Date.now()-tsStart  })
            return points
        }
        catch(err) {
            this.logger.logEvent({message:'getTourCoordinates failed', id, reason:err.message,duration: Date.now()-tsStart  })
            throw(err)
        }

    }


    /**
     * Uploads a completed activity (FIT or GPX) to the user's Komoot account.
     *
     * The file content is sent as the raw request body (not multipart form data), with the
     * format passed as the `data_type` query parameter. The data must already be loaded into
     * memory, so the method works in a browser as well as in Node.
     *
     * @example
     * const data = new Uint8Array(await file.arrayBuffer())
     * const tour = await api.uploadTour(data, 'fit', 'racebike', 'Morning Ride')
     * console.log(`Tour created, id is: ${tour.id}`)
     *
     * @param {Buffer | ArrayBuffer | Uint8Array} data - The binary content of the activity file.
     * @param {KomootUploadFormat} format - The file format of `data`: `'fit'` or `'gpx'`.
     * @param {KomootSportType} sport - The Komoot sport identifier (e.g. `'racebike'`, `'touringbicycle'`, `'mtb'`).
     * @param {string} name - The visible title of the uploaded tour.
     * @returns {Promise<KomootTourSummary>} A summary of the newly created tour.
     * @throws {Error} `'invalid credentials'` if the user is not authenticated, or an
     * `HTTP <status>: <body>` error if Komoot rejects the upload.
     */
    async uploadTour(
        data: Buffer | ArrayBuffer | Uint8Array,
        format: KomootUploadFormat,
        sport: KomootSportType,
        name: string
    ): Promise<KomootTourSummary> {
        const tsStart = Date.now()
        try {
            const auth = this.getBasicAuthCredentials()
            if (!this.userid) {
                this.logger.logEvent({ message: 'uploadTour failed', reason: 'invalid credentials' })
                throw new Error('invalid credentials')
            }

            const contentType = format === 'gpx' ? 'application/gpx+xml' : 'application/octet-stream'
            const params = new URLSearchParams({ data_type: format, sport, name })

            const response = await this.getApi().request({
                method: 'post',
                url: `${this.getBaseUrl()}/tours/?${params.toString()}`,
                auth,
                headers: { 'Content-Type': contentType },
                data,
                validateStatus: () => true   // lets us inspect the body of a 4xx/5xx
            })

            if (response.status >= 400) {
                this.logger.logEvent({
                    message: 'uploadTour failed',
                    status: response.status,
                    body: JSON.stringify(response.data),
                    duration: Date.now() - tsStart
                })
                throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`)
            }

            this.logger.logEvent({ message: 'uploadTour success', id: response.data?.id, duration: Date.now() - tsStart })
            return response.data
        }
        catch (err) {
            this.logger.logEvent({ message: 'uploadTour failed', reason: err.message, duration: Date.now() - tsStart })
            throw err
        }
    }


    protected applyFilter(tours:Array<KomootTourSummary>, filters?:KomootGetTourRequestFilters) {
        if (!filters)
            return tours;

        const sportTypeFilter = filters.sport?.split(',')??[]

        return tours.filter( tour => {
            let valid = true
            if (filters?.sport)
                valid = valid && (sportTypeFilter.includes(tour.sport))
            if (filters?.after)
                valid = valid && (new Date(tour.date).valueOf()>filters.after.valueOf())
            if (filters?.lastUpdateAfter)
                valid = valid && (new Date(tour.changed_at).valueOf()>filters.lastUpdateAfter.valueOf())

            return valid                
        })

    }



    protected getBasicAuthCredentials():{username:string,password:string} {
        const {username,password} = this

        return {username,password}
    }

    protected getBaseUrl() {
        try {
            return this.getUserSettings().get('KOMOOT_API',API_BASE_URL)
        }
        catch {
            return API_BASE_URL
        }
    }


}