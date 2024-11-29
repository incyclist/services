import { ActivityDetails } from "../base";

export interface Credentials {
    username?: string;
    password?: string
}


export interface VeloHeroAuth extends Credentials {
    id?: string;
    authKey?: string;
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

export interface IActivityUpload {
    init():boolean;
    isConnected():boolean
    isConnecting():boolean
    disconnect():void
    upload(activity: ActivityDetails, format?:string):Promise<boolean>
    getUrl(id:string):string
}
