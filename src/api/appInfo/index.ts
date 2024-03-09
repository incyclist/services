
export type OSInfo = {
    platform: string
    arch: string
    release:string
}


export type AppChannel = 'desktop' | 'mobile' | 'web' | 'tv' | 'backend'


export interface IAppInfo {
    getOS():OSInfo
    getAppVersion():string
    getUIVersion():string
    getAppDir():string
    getSourceDir():string
    getTempDir():string
    isApp():boolean
    getChannel():AppChannel
}