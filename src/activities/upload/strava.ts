import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { ActivityDetails } from "../base";
import { DuplicateError, StravaApi, StravaConfig, StravaFormat } from "../../apps/base/api/strava";
import { IActivityUpload, StravaAuth } from "./types";
import { Injectable } from "../../base/decorators/Injection";
import { ActivityUploadFactory } from "./factory";
import { StravaAppConnection } from "../../apps/strava/StravaAppConnection";

/**
 * Represents a service that can be used by Incyclist to upload an activity to Strava
 * using Strava API
 * 
 * @example
 * // Create a new instance of StravaApi
 * const strava = new StravaUpload()
 * strava.upload(activity,'tcx)
 * 
 * @class
 * @public
 */


@Singleton
export class StravaUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized
    protected connection = new StravaAppConnection()

    constructor() {
        super('StravaUpload')
        this.isInitialized = false
        this.init()
    }

    init():boolean {
        if (this.isInitialized)
            return true
        this.isInitialized =  this.getStravaAppConnection().init()        
        return this.isInitialized
    }


    /**
     * Indicates whether the user has connected his Incyclist account to Strava API 
     *
     *
     * @returns {boolean} True if the user has stored a connection to Strava API.
     */
    isConnected():boolean {
        return this.getStravaAppConnection().isConnected()
    }

    /**
     * Uploads an activity to Strava.
     * 
     * If the activity is uploaded successfully, the links property of the activity is updated with the activity_id and the url.
     * If the upload fails because Strava reports that this activity already exists, the links property is updated with the activity_id and the url provided by Strava.
     * If the upload fails on any other error, the links property is updated with the error message.
     * 
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity. 
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format:string='TCX'):Promise<boolean> {
        try {
            
            const ok =this.ensureInitialized()
            if (!ok) {
                this.logEvent({message:'Strava Upload skipped', reason:'not initialized'})

                return false;
            }

            if (!this.isConnected())
                return false; 

            const lcFormat = format.toLowerCase()
            const ucFormat = format.toUpperCase()

            this.logEvent({message:'Strava Upload', format:ucFormat})
            if (!activity.links)
                activity.links  = {}

            const fileName =  activity[`${lcFormat}FileName`];
            const res = await this.getApi().upload(fileName,{
                name: activity.title,
                description: '',
                format: this.getStravaFormat(format)                
            })
            this.logEvent({message:'Strava Upload success', activityId: res.stravaId})

            activity.links.strava = {
                activity_id: res.stravaId,
                url: this.getUrl(res.stravaId)
            }
            return true;

        }
        catch(err) {
            if (err instanceof DuplicateError) {
                this.logEvent({message:'Strava Upload failure', error: 'duplicate', activityId:err.stravaId})
                activity.links.strava = {
                    activity_id: err.stravaId,
                    url: this.getUrl(err.stravaId)
                }
    
            }
            else {
                this.logEvent({message:'Strava Upload failure', error: err.message})
                activity.links.strava = {
                    error: err.message
                }
            }
            return false

        }
    }

    /**
     * Returns the URL for the given activity id on Strava.
     *
     * @param {string} activityId - The Strava activity id.
     * @returns {string} The URL of the activity on Strava.
     */
    getUrl(activityId:string):string {
        return `https://www.strava.com/activities/${activityId}`
    }

    protected getStravaFormat(format:string):StravaFormat {
        switch (format.toLowerCase()) {
            case 'tcx':
                return 'tcx'
            case 'fit':
                return 'fit'
            case 'gox':
                return 'gpx'
            default:
                return null;
        
        }   
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }

    
    @Injectable
    // istanbul ignore next
    protected getStravaAppConnection() {
        return this.connection
    }

    protected getApi() {
        return this.getStravaAppConnection().getApi()
    }

    
}

const factory = new ActivityUploadFactory()
factory.add('strava',new StravaUpload())
