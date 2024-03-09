import {EventLogger} from 'gd-eventlog'
import { AxiosInstance } from "axios";
import { IncyclistRestApiClient, RestApiClient } from '../../../api';
import { useUserSettings } from '../../../settings';
import { Singleton } from '../../../base/types';
import { DEFAULT_WORKOUT_API, WORKOUT_API } from './consts';
import { Plan, Workout } from '../model/Workout';

@Singleton
export class IncyclistWorkoutsApi { 

    protected logger: EventLogger
    protected api: AxiosInstance

    constructor() {
        this.logger = new EventLogger('WorkoutsApi')
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


    protected getBaseUrl():string {
        
        return useUserSettings().get(WORKOUT_API,DEFAULT_WORKOUT_API)
    }


    async getWorkouts():Promise<Array<Workout|Plan>> {
        try {
            const res = await this._get( '/' )              
            return res.data;           
        }
        catch(err) {
            return undefined
        }

    }

    async getWorkout(id:string):Promise<Workout|Plan> {
        try {
            const res = await this._get( `/${id}` )              
            return res.data;           
        }
        catch(err) {
            return undefined
        }
        
    }

    async reload() {
        try {
            this._get( `/reload` )                   
        }
        catch(err) {
            this.logError(err,'reload')
            return undefined
        }

    }

    protected async _get(url:string, ...args) {
        const api = this.getApi()
        const baseUrl = this.getBaseUrl()
        const request = baseUrl+url
        console.log(request)

        return await api.get( request, ...args )       
    }


}




