import { Singleton } from "../../base/types";
import { ActivityDetails } from "../base";
import { IActivityUpload, UploaderInfo } from "./types";

@Singleton
export class ActivityUploadFactory {

    protected uploaders: Array<UploaderInfo>

    constructor() {
        this.uploaders = []
    }

    /**
     * Adds a new activity uploader to the factory.
     * If the service already exists, its uploader is replaced.
     * @param {string} service - The service of the uploader.
     * @param {IActivityUpload} uploader - The uploader to add.
     */
    add( service:string, uploader: IActivityUpload) {
        const existing = this.uploaders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            this.uploaders.push({service,uploader})
        else 
            this.uploaders[existing] = {service,uploader}
    }

    /**
     * Uploads the activity to all connected services.
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity. 
     * @returns {Promise<Array<{string,boolean,error:string}>>} - An array of objects with the following properties:
     * - service: The name of the service.
     * - success: True if the upload was successful, false otherwise.
     * - error: The error message if the upload failed.
     */
    async upload(activity:ActivityDetails, format:string='TCX'):Promise<Array<{string,boolean}>> {
        const uploads = []

        this.uploaders.forEach( ui=> {

            const {service,uploader} = ui
            
            if (uploader.isConnected()) {
                const promise = uploader.upload(activity,format)
                    .then(success=> ({service,success}))
                    .catch(err => ({service,success:false,error:err.message}))
                uploads.push({service,promise,status:undefined})
            }
        })

        if (uploads.length>0) {
            const asResult = await Promise.allSettled<Array<{string,boolean}>>(uploads.map(us=>us.promise))

            const result = asResult.map( asr => asr.status === 'fulfilled' ? asr.value : null).filter( r => r!==null)
            return result
        }
        else return []
    }

}