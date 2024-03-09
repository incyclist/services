import { AppChannel } from "../appInfo"

export type ApiClientInitProps = {
    uuid: string, 
    apiKey:string, 
    version:string,
    appVersion:string
    requestLog?:boolean,
    channel?: AppChannel
}