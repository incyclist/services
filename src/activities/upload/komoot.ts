import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { ActivityDetails } from "../base";
import { IActivityUpload } from "./types";
import { Injectable } from "../../base/decorators/Injection";
import { ActivityUploadFactory } from "./factory";
import { KomootAppConnection } from "../../apps/komoot";
import { getBindings } from "../../api";
import { KomootUploadFormat } from "../../apps";

/**
 * Represents a service that can be used by Incyclist to upload an activity to Komoot
 * using Komoot API
 * 
 * @example
 * // Create a new instance of KomootApi
 * const komoot = new KomootUpload()
 * komoot.upload(activity,'fit')
 * 
 * @class
 * @public
 */


@Singleton
export class KomootUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized
    protected connection = new KomootAppConnection()

    constructor() {
        super('KomootUpload')
        this.isInitialized = false
        this.init()
    }

    init():boolean {
        if (this.isInitialized)
            return true
        this.isInitialized =  this.getKomootAppConnection().init()        
        return this.isInitialized
    }


    /**
     * Indicates whether the user has connected his Incyclist account to Komoot API 
     *
     *
     * @returns {boolean} True if the user has stored a connection to Komoot API.
     */
    isConnected():boolean {
        return this.getKomootAppConnection().isConnected()
    }

    /**
     * Uploads an activity to Komoot.
     * 
     * If the activity is uploaded successfully, the links property of the activity is updated with the activity_id and the url.
     * If the upload fails because Komoot reports that this activity already exists, the links property is updated with the activity_id and the url provided by Komoot.
     * If the upload fails on any other error, the links property is updated with the error message.
     * 
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity. 
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format:string='FIT'):Promise<boolean> {
        try {
            
            const ok =this.ensureInitialized()
            if (!ok) {
                this.logEvent({message:'Komoot Upload skipped', reason:'not initialized'})

                return false;
            }

            if (!this.isConnected())
                return false; 

            const lcFormat = format.toLowerCase()
            const ucFormat = format.toUpperCase()
            const uploadFormat = this.getKomootFormat(lcFormat)
            const sport = 'racebike'
            

            this.logEvent({message:'Komoot Upload', requestedFormat:ucFormat, uploadFormat })
            if (!activity.links)
                activity.links  = {}

            const fileName =  activity[`${uploadFormat}FileName`];
            if (!fileName) {
                throw new Error(`data not exported to ${uploadFormat.toUpperCase()}`)
            }
            const data = await this.readFile(fileName)
            if (!data) {
                throw new Error(`file could not be read: ${fileName}`)
            }
           

            const res = await this.getApi().uploadTour(Buffer.from(data),uploadFormat,sport,activity.title)
            this.logEvent({message:'Komoot Upload success', activityId: res.id})

            activity.links.komoot = {
                activity_id: res.id.toString(),
                url: this.getUrl(res.id.toString())
            }
            return true;

        }
        catch(err) {
                this.logEvent({message:'Komoot Upload failure', error: err.message})
                activity.links.komoot = {
                    error: err.message
                }
            return false

        }
    }

    /**
     * Returns the URL for the given activity id on Komoot.
     *
     * @param {string} activityId - The Komoot activity id.
     * @returns {string} The URL of the activity on Komoot.
     */
    getUrl(activityId:string):string {
        return `https://www.komoot.com/tour/${activityId}`
    }

    protected getKomootFormat(format:string):KomootUploadFormat {
        switch (format.toLowerCase()) {
            case 'tcx':  // not supported, we fallback to 'fit'
                return 'fit'
            case 'fit':
                return 'fit'
            case 'gpx':
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

    protected async readFile(fileName:string) {
        try {
            const fs = this.getFS()
            const exists = await fs.existsFile(fileName)
            if (!exists)
                return null

            const content = await fs.readFile(fileName)
            return content||null
        }
        catch(err) {
            this.logError(err,'readFile')
        } 
    }

    
    @Injectable
    // istanbul ignore next
    protected getKomootAppConnection() {
        return this.connection
    }

    protected getApi() {
        return this.getKomootAppConnection().getApi()
    }

    protected getFS() {
        return getBindings().fs
    }

    
}

const factory = new ActivityUploadFactory()
factory.add('komoot',new KomootUpload())
