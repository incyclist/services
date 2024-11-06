import { getBindings } from "../api/bindings"
import { IncyclistUpdatesApi } from "./api"
import semver from 'semver'

export const checkForAppUpdates = async () => {

    const {appInfo} = getBindings()

    // istanbul ignore next
    if (!appInfo) {
        return null
    }
    const os = appInfo.getOS()
    const appVersion = appInfo.getAppVersion()

    if (os.platform!=='darwin' && os.platform!=='linux')
        return null
    
    const api = new IncyclistUpdatesApi()
    const latest = await api.getLatestAppVersion(os.platform)

    if (!latest?.version) 
        return null;

    if (semver.gt(latest.version,appVersion)) {
        return latest
    }
    return null

}