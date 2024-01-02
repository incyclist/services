
export type OSInfo = {
    platform: string
    arch: string
    release:string
}

export interface IAppInfo {
    getOS():OSInfo
    getAppVersion():string
    getAppDir():string
    getSourceDir():string
    getTempDir():string
    isApp():boolean
}