import {EventLogger} from 'gd-eventlog'
import { AxiosInstance } from "axios";
import { IncyclistRestApiClient } from '../../../api';
import { useUserSettings } from '../../../settings';
import { Singleton } from '../../../base/types';
import { DEFAULT_DOMAIN, WORKOUT_API } from './consts';
import { Plan, Workout } from '../model/Workout';
import { Injectable } from '../../../base/decorators';

@Singleton
export class IncyclistWorkoutsApi { 

    protected logger: EventLogger
    protected api: AxiosInstance

    constructor() {
        this.logger = new EventLogger('WorkoutsApi')
    }

    protected logError( err:Error, fn:string, logInfo?) {
        const args = logInfo ?? {}
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
        const domain = this.getSetting('DOMAIN',DEFAULT_DOMAIN)
        const defaultUrl = `https://dlws.${domain}/api/v1/workouts`
        return this.getSetting(WORKOUT_API,defaultUrl)
       
    }


    async getWorkouts():Promise<Array<Workout|Plan>> {
        try {
            const res = await this._get( '/' )              
            return res.data;           
        }
        catch {
            return undefined
        }

    }

    async getWorkout(id:string):Promise<Workout|Plan> {
        try {
            const res = await this._get( `/${id}` )              
            return res.data;           
        }
        catch {
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
        const request = baseUrl+url
        console.log(request)

        return await api.get( request, ...args )       
    }

    protected getSetting(key:string, def:any) {
        try {
            return this.getUserSettings().get(key, def)
        }
        catch {
            return def
        }
    }

    @Injectable
    getUserSettings() {
        return useUserSettings()
    }




}




