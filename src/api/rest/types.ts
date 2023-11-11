
export type AppChannel = 'desktop' | 'mobile' | 'web' | 'tv' | 'backend'

export type ApiClientInitProps = {
    uuid: string, 
    apiKey:string, 
    version:string,
    appVersion:string
    requestLog?:boolean,
    channel?: AppChannel   
}