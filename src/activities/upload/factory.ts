import { Singleton } from "../../base/types";
import { ActivityDetails } from "../base";
import { IActivityUpload, UploaderInfo } from "./types";

@Singleton
export class ActivityUploadFactory {

    protected uploaders: Array<UploaderInfo>

    constructor() {
        this.uploaders = []
    }

    add( service:string, uploader: IActivityUpload) {
        const existing = this.uploaders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            this.uploaders.push({service,uploader})
        else 
            this.uploaders[existing] = {service,uploader}
    }

    async upload(activity:ActivityDetails, format:string='TCX') {
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
            const result = await Promise.allSettled(uploads.map(us=>us.promise))
        }
        else return []
        

    }

}