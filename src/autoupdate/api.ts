import { Singleton } from "../base/types";
import { AxiosInstance } from "axios";
import { IncyclistRestApiClient } from "../api";
import { useUserSettings } from "../settings";
import { IncyclistService } from "../base/service";

const UPDATE_SERVER_URL = 'UPDATE_SERVER_URL'
const DEFAULT_UPDATE_SERVER_URL = 'https://updates.incyclist.com';
const INCYCLIST_URL = 'https://incyclist.com'

type VersionInfo = {
    version: string,
    path: string,
    url?:string    
    downloadUrl?:string
}

@Singleton
export class IncyclistUpdatesApi extends IncyclistService{ 

    protected api: AxiosInstance

    constructor() {
        super('UpdatesApi')        
    }

    async getLatestAppVersion(platform:string):Promise<VersionInfo> {
        this.logEvent( {message:'getLatestAppVersion'})
        try {
            if (platform==='darwin') {
                return await this.getLatestMacAppVersion()
            }
            if (platform==='linux') {
                return await this.getLatestLinuxAppVersion()
            }
            if (platform.startsWith('win')) {
                return await this.getLatestWindowsAppVersion()
            }            
            this.logEvent({message:'error',fn:'getLatestAppVersion',error:'unknown platform',platform})
            
        }
        catch(err) {
            this.logError(err,'getLatestAppVersion',{platform})
            
        }
    }

    protected getApi():AxiosInstance {
        if (!this.api) {
            this.api = IncyclistRestApiClient.getClient(true)
            return this.api
        }
        return this.api
    }


    protected getBaseUrl():string {
        
        const base:string = useUserSettings().get(UPDATE_SERVER_URL ,DEFAULT_UPDATE_SERVER_URL )
        return base;
    }

    protected async _get(url:string, ...args) {
        const api = this.getApi()
        const baseUrl = this.getBaseUrl()
                
        return await api.get( baseUrl+url, ...args )       
    }


    protected async getLatestMacAppVersion():Promise<VersionInfo>{
        try {
            const res = await this._get('/download/app/latest/mac/latest-mac' )
        
            // istanbul ignore next
            if (!res)
                return;

            const version = res.data?.version
            const path = res.data?.path
            const downloadUrl = `${this.getBaseUrl()}/download/app/latest/mac/${path}`
            const url = INCYCLIST_URL

            return {version,path,url,downloadUrl}
        }
        catch (err) {
            if (err.message!=='Network Error') {
                this.logError(err,'getLatestMacAppVersion')
            }
        }

    }

    protected async getLatestLinuxAppVersion():Promise<VersionInfo>{
        try {
        
            const res = await this._get('/download/app/latest/linux/x64/latest-linux.yml' ) 
            // istanbul ignore next
            if (!res)
                return;

            const versionMatch = /version: (.*)/.exec(res.data)
            const version = versionMatch?.length===2 ? versionMatch[1] : undefined

            const pathMatch = /path: (.*)/.exec(res.data)
            const path = pathMatch?.length===2 ? pathMatch[1] : undefined
            const downloadUrl = `${this.getBaseUrl()}/download/app/latest/linux/x64/${path}`
            const url = INCYCLIST_URL

            return {version,path,url,downloadUrl}
        }
        catch (err) {
            if (err.message!=='Network Error') {
                this.logError(err,'getLatestLinuxAppVersion')
            }
        }


    }
    protected async getLatestWindowsAppVersion():Promise<VersionInfo>{
        try {
            const res = await this._get('/download/app/latest/win64/RELEASE' ) 
            // istanbul ignore next
            if (!res)
                return;

        
            const lines = res.data.split('\n')
            if (!lines?.length)
                return;
            
            const final = lines[lines.length-1]
            const versionMatch = /.* incyclist-(.*)-full.nupkg/.exec(final)
            const version = versionMatch?.length===2 ? versionMatch[1] : undefined

            const path = `incyclist-${version}-setup.exe`
            const downloadUrl = `${this.getBaseUrl()}/download/app/latest/win64/${path}`
            const url = INCYCLIST_URL

            return {version,path,url,downloadUrl}
        }
        catch (err) {
            if (err.message!=='Network Error') {
                this.logError(err,'getLatestWindowsAppVersion')
            }
        }
    }


}

