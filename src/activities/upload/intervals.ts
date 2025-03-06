import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { ActivityDetails } from "../base";
import { IActivityUpload } from "./types";
import { Injectable } from "../../base/decorators/Injection";
import { ActivityUploadFactory } from "./factory";
import { IntervalsAppConnection } from "../../apps/intervals/IntervalsAppConnection";
import { IntervalsFormat } from "../../apps";

/**
 * Represents a service that can be used by Incyclist to upload an activity to Intervals.icu
 * using Intervals.icu API
 * 
 * @example
 * // Create a new instance of StravaApi
 * const intervals = new IntervalsUpload()
 * intervals.upload(activity,'tcx)
 * 
 * @class
 * @public
 */


@Singleton
export class IntervalsUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized
    protected connection = new IntervalsAppConnection()

    constructor() {
        super('IntervalsUpload')
        this.isInitialized = false
        this.init()
    }

    init():boolean {
        if (this.isInitialized)
            return true
        this.isInitialized =  this.getIntervalsAppConnection().init()        
        return this.isInitialized
    }


    /**
     * Indicates whether the user has connected his Incyclist account to Strava API 
     *
     *
     * @returns {boolean} True if the user has stored a connection to Strava API.
     */
    isConnected():boolean {
        return this.getIntervalsAppConnection().isConnected()
    }

    /**
     * Uploads an activity to Intervals.icu.
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
                this.logEvent({message:'Intervals.icu Upload skipped', reason:'not initialized'})

                return false;
            }

            if (!this.isConnected())
                return false; 

            const lcFormat = format.toLowerCase()
            const ucFormat = format.toUpperCase()

            this.logEvent({message:'Intervals.icu Upload', format:ucFormat})
            if (!activity.links)
                activity.links  = {}

            const fileName =  activity[`${lcFormat}FileName`];
            const res = await this.getApi().upload(fileName,{
                name: activity.title,
                description: '',
                format: this.getIntervalsFormat(format)                
            })
            this.logEvent({message:'Intervals.icu Upload success', activityId: res.intervalsId})

            activity.links.intervals = {
                activity_id: res.intervalsId,
                url: this.getUrl(res.intervalsId)
            }
            return true;

        }
        catch(err) {
            this.logEvent({message:'Intervals.icu Upload failure', error: err.message})
            activity.links.intervals = {
                error: err.message
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
        return `https://intervals.icu/activities/${activityId}`
    }

    protected getIntervalsFormat(format:string):IntervalsFormat {
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
    protected getIntervalsAppConnection() {
        return this.connection
    }

    protected getApi() {
        return this.getIntervalsAppConnection().getApi()
    }

    
}

const factory = new ActivityUploadFactory()
factory.add('intervals',new IntervalsUpload())
