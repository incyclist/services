
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
    session:string

    /**
     * Capability signalled by the native app (mobile), e.g. 'local-link'. Optional and synchronous:
     * an app or binary that does not implement it supports no native capability.
     */
    hasNativeFeature?(name: string): boolean
}