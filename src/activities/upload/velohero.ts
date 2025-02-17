import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { ActivityDetails } from "../base";
import { IActivityUpload } from "./types";
import { ActivityUploadFactory } from "./factory";
import { VeloHeroAppConnection } from "../../apps/velohero/VeloHeroAppConnection";
import { Injectable } from "../../base/decorators";


/**
 * Service for uploading activities to VeloHero.
 */
@Singleton
export class VeloHeroUpload extends IncyclistService implements IActivityUpload{

    protected connection = new VeloHeroAppConnection()
    protected isInitialized

    constructor() {
        super('VeloHeroUpload')
        this.isInitialized = false
        this.init()
    }

    /**
     * Initializes the VeloHero service
     * 
     * It will try to load the credentials from the user settings and setups event listeners
     * 
     * @returns true if the initialization is successful
     */
    init():boolean {
        if (this.isInitialized)
            return true
        this.isInitialized =  this.getVeloHeroAppConnection().init()        
        return this.isInitialized
    }

    /**
     * Indicates whether the user has connected his Incyclist account to Strava API 
     *
     *
     * @returns {boolean} True if the user has stored a connection to Strava API.
     */
    isConnected():boolean {
        return this.getVeloHeroAppConnection().isConnected()
    }


    /**
     * Uploads the activity to VeloHero.
     * 
     * It will not attempt to upload the file and populate the links property in the activity with information of the uploaded file
     * The links property will be populated with the activity_id and the url and with an error if the upload failed
     * 
     * If the user has not connected with VeloHero this will be skipped (not logged)
     * If the upload is attempted on a non initialized service this will be skipped (and logged)
     * 
     * 
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity. 
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format:string='TCX'):Promise<boolean> {
        try {
            
            const ok =this.ensureInitialized()
            if (!ok) {
                this.logEvent({message:'VeloHero Upload skipped', reason:'not initialized'})

                return false;
            }

            if (!this.isConnected()) {
                return false
            }

            const lcFormat = format.toLowerCase()
            const ucFormat = format.toUpperCase()
            this.logEvent({message:'VeloHero Upload', format:ucFormat})

            if (!activity.links)
                activity.links  = {}


            const {username,password} = this.getVeloHeroAppConnection().getCredentials()            
            const fileName =  activity[`${lcFormat}FileName`];
            const res = await this.getApi().upload(fileName,{username,password})

            this.logEvent({message:'VeloHero Upload success',...res})
            
            activity.links.velohero = {
                activity_id: res.id,
                url: res['url-show']??this.getUrl(res.id)
            }

            return true;

        }
        catch(err) {
            this.logEvent({message:'VeloHero Upload failure', error: err.message})
            activity.links.velohero = {
                error: err.message
            }
            return false

        }
    }

    /**
     * Constructs the URL for a VeloHero workout based on the provided ID.
     *
     * @param {string} id - The unique identifier of the workout.
     * @returns {string} The URL for viewing the workout on VeloHero.
     */
    getUrl(id: string): string {
        return `https://app.velohero.com/workouts/show/${id}`
    }


    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }

    @Injectable
    // istanbul ignore next
    protected getVeloHeroAppConnection() {
        return this.connection
    }

    protected getApi() {
        return this.getVeloHeroAppConnection().getApi()
    }
    

    
}

const factory = new ActivityUploadFactory()
factory.add('velohero',new VeloHeroUpload())
