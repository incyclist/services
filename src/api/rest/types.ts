import { AppChannel } from "../appInfo"

export type ExternalApiClientInitProps = {
    version:string,
    appVersion:string
    requestLog?:boolean,
    channel?: AppChannel
    platform?: string
}
export type ApiClientInitProps = ExternalApiClientInitProps & {
    uuid: string, 
    apiKey:string, 
}