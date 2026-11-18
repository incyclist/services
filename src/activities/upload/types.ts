import { ActivityDetails } from "../base";

export interface Credentials {
    username?: string;
    password?: string
}


export interface StravaAuth  {
    accesstoken?: string;
    refreshtoken?: string;    
    expiration?: string    
}

export type UploaderInfo = {
    service: string;
    uploader: IActivityUpload
}

export type ActivityUploadResult = {
    service: string,
    success?: boolean
    error?: string    
}

/** The file formats that can be uploaded to TrainerDay */
export type TrainerDayFormat = 'tcx' | 'fit'

export interface IActivityUpload {
    init():boolean;
    isConnected():boolean
    upload(activity: ActivityDetails, format?:string):Promise<boolean>
    getUrl(id:string):string
}
