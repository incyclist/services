import { EventLogger } from "gd-eventlog";
import { ActivityStreamEntry, StravaApi, StravaConfig, SummaryActivity } from "../../../apps";
import { Observer } from "../../../base/types";
import { Route } from "../../base/model/route";
import { RouteInfo, RoutePoint } from "../../base/types";
import { Loader, MinimalDescription } from "./types";
import EventEmitter from "events";
import { waitNextTick } from "../../../utils";
import { calculateDistance } from "../../../utils/geo";
import { useUserSettings } from "../../../settings";
import { Injectable } from "../../../base/decorators";
import { getBindings } from "../../../api";
import { StravaAuth } from "../../../activities";
import { valid } from "../../../utils/valid";

interface Activity extends SummaryActivity, MinimalDescription {}

export class StravaActivityLoader extends Loader< Activity >  {

    protected loadObserver: Observer
    protected api:StravaApi
    protected logger: EventLogger
    protected internalEmitter: EventEmitter
    protected config: StravaConfig
    protected isInitialized: boolean
    protected tokenUpdateHandler = this.updateConfig.bind(this)


    constructor () {
        super()
        this.api = new StravaApi()
        this.logger = new EventLogger('StravaActivityLoader')
        this.internalEmitter = new EventEmitter()        
    }


    /**
     * Initializes the StravaUpload service.
     *
     * This method checks if the service is already initialized, and if so, returns true.
     * 
     * It ensures that the UserSettings service is initialized before proceeding. 
     * The method attempts to retrieve the Strava client ID, client secret, and authentication credentials. 
     * If all required credentials are available, it sets up the configuration and initializes the Strava API.
     * Logs messages indicating whether the initialization succeeded and if credentials were found.
     * If an error occurs during initialization, it logs the error and resets the initialization state.
     *
     */
    init():void {

        // in order to support lazy initialization, we cannot assume that UserSettings was already initialized
        if (!this.getUserSettings().isInitialized)
            return

        try {
            const clientId = this.getSecret('STRAVA_CLIENT_ID')
            const clientSecret = this.getSecret('STRAVA_CLIENT_SECRET')           
            const auth = this.getCredentials()


            if (clientId && clientSecret && auth) {           
                this.config = {
                    clientId, clientSecret,
                    accessToken: auth.accesstoken,
                    refreshToken: auth.refreshtoken,
                    expiration: new Date(auth.expiration)
                }
                
                this.initApi(this.config);
            }
            this.isInitialized = true
        }
        catch(err) {
            delete this.config
        }
    }    

    /**
     * Indicates whether the user has connected his Incyclist account to Strava API 
     *
     *
     * @returns {boolean} True if the user has stored a connection to Strava API.
     */
    isConnected() {
        if (!this.isInitialized) {
            this.init()
        }

        return (valid(this.config))
    }


    load(): Observer {
        // no concurrent loads
        if (this.loadObserver) {
            return this.loadObserver
        }

        this.init()

        if (! this.getApi().isAuthenticated()) {
            return;
        }

        let stopRequested = false
        this.internalEmitter.once('stop',()=>{
            stopRequested = true;
        })

        const load = async ()=>{
            // load in chunks of 50
            let page=1
            let done = false
            
            const {filters} = {filters:{}} //this.getFilters()
            while (!stopRequested && !done) {

                const res = await this.getApi().getLoggedInAthleteActivities( {page,per_page:50, ...filters})
                done = (!Array.isArray(res) || res.length===0)

                console.log('#Strava loaded',res)

                if (Array.isArray(res)) {                        
                    const filtered= res.filter( a=> a.sport_type==='Ride'||a.sport_type==='VirtualRide'|| a.sport_type==='EBikeRide' || a.sport_type==='MountainBikeRide' )
                    filtered.forEach( strava => {
                        const details = this.buildRouteInfo(strava)
                        this.loadObserver.emit('loaded', details)
                    })
                    page++;
                }
            }

            this.loadObserver.emit('done')
            await waitNextTick()        
            this.loadObserver.stop()
            delete this.loadObserver        
        }

        this.loadObserver = new Observer()
        load()
        return  this.loadObserver

        
    }
    stopLoad(): void {
        this.internalEmitter.emit('stop')
        delete this.loadObserver
    }


    async save(route: Route): Promise<void> {
        // we are not saving to strava
    }

    async loadDetails(route:Route,allreadyAdded?:boolean):Promise<void> {
        const id = this.getStravaId(route)
        const stravaDetail = await this.getApi().getActivityStream(id,['latlng','altitude','grade_smooth'])

        if ( Array.isArray(stravaDetail)) {
            const points:Array<RoutePoint> = []

            this.buildRoutePoints(stravaDetail, points);
            
            await this.updateRoute(points, route);
        }
        else if ( stravaDetail.error) {
            this.logger.logEvent( {message:'could not load route details', id, reason:stravaDetail.error})
        }
    }

    private async updateRoute(points: RoutePoint[], route: Route) {
        if (!points?.length)
            return;

        console.log('# strava: udapte Route',points)
        
        const last = points[points.length - 1];
        const first = points[0];
        const totalDistance = last.routeDistance;
        const totalElevation = last.elevationGain;
        const descr = route.description;

        if (descr.distance !== totalDistance) descr.distance = totalDistance;
        if (descr.elevation !== totalElevation) descr.elevation = totalElevation;
        if (calculateDistance(first.lat, first.lng, last.lat, last.lng) < 50) descr.isLoop = true;

        route.addDetails( {
            id: descr.id,
            title: descr.title,
            points,
            country: descr.country,
            elevation: descr.elevation,
            category: descr.category,
        });


        if (!descr.country)   {
            await route.updateCountryFromPoints();
        }

        descr.points = points
    }

    protected getStravaId(route:Route):number {
        const idStr = route.description.id
        if (!idStr.startsWith('Strava:'))
            return;        
        return  Number(idStr.split(':')[1])

    }

    protected buildRoutePoints(stravaDetail: ActivityStreamEntry[], points: RoutePoint[]) {


        const distances = stravaDetail.find(sd => sd.type === 'distance')?.data
        const latlng = stravaDetail.find(sd => sd.type === 'latlng')?.data
        const altitudes = stravaDetail.find(sd => sd.type === 'altitude')?.data
        const slopes = stravaDetail.find(sd => sd.type === 'grade_smooth')?.data


        console.log('# strava: build Points', JSON.stringify(stravaDetail),  distances,latlng, altitudes, slopes)

        const num = latlng?.length;
        if (!num)
            return;

        for (let i = 0; i < num; i++) {

            const distance = i === 0 ? 0 : distances[i]-distances[i-1]
            const gain = i > 0 ? points[i - 1].slope / 100 * distance : 0;
            const getElevationGain = () => gain > 0 ? points[i - 1].elevationGain + gain : points[i - 1].elevationGain;

            const point: RoutePoint = {
                lat: latlng[i][0], lng: latlng[i][1],
                slope: slopes[i],
                elevation: i == 0 ? altitudes?.[i]??0 : points[i - 1].elevation + gain,
                elevationGain: i == 0 ? 0 : getElevationGain(),
                distance ,
                routeDistance: distances[i]-distances[0]
            };
            points.push(point);
        }
    }

    protected buildRouteInfo(strava: SummaryActivity): RouteInfo {
        const info:RouteInfo = {
            hasGpx:true,
            hasVideo:false,
            id: 'Strava:'+strava.id,
            title: strava.name,
            elevation: strava.total_elevation_gain,
            distance: strava.distance, 
            category: 'personal',
        }
        return info
        
    }

    protected getFilters() {

        const after = Date.now()/1000-365*24*60*60
        const filters = { after}
        const maxEntries = 100
        return {filters,maxEntries}
    }

    protected initApi(config:StravaConfig) {
        const observer = this.getApi().init(config);
        observer.on('token.updated', this.tokenUpdateHandler);
    }

    protected saveCredentials(config?:StravaConfig):void {

        if (config)
            this.config = config
        
        try {

            if (!this.isConnected()) {
                this.getUserSettings().set('user.auth.strava',null)
                return;    
            }

            this.getUserSettings().set('user.auth.strava',{
                accesstoken: this.config.accessToken,
                refreshtoken: this.config.refreshToken,
                expiration: this.config.expiration.toISOString()
            })

        }
        catch(err) {
            //this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

    }

    protected updateConfig(config:StravaConfig) {
        const {accessToken, refreshToken,expiration} = config
        this.config = {...this.config,accessToken, refreshToken,expiration}
        this.saveCredentials()
    }    

    protected getCredentials():StravaAuth {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.strava',null)        
        }
        catch {
            return null
        }
    }

    protected getSecret(key:string):string {
        return this.getSecretBindings()?.getSecret(key)
    }

    @Injectable
    // istanbul ignore next
    protected getApi() {
        if (!this.api)
            this.api = new StravaApi()
        return this.api
    }


    @Injectable
    // istanbul ignore next
    getSecretBindings() {
        return getBindings()?.secret
    }


    @Injectable
    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }


}