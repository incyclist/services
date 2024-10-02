import { useUserSettings } from "../../settings"
import { RouteInfo } from "../base/types"
import { RoutesRepoUpdates } from "./types"


const DURATION_2_WEEKS = 1000*60*60*24*14
const DURATION_30_SECONDS = 1000*30

export const updateRepoStats = (ts?:number):void => {
    const settings = useUserSettings()
    const updates = settings.get('repo.routesUpdates',{}) as unknown as RoutesRepoUpdates
    if (updates.current)
        updates.prev = updates.current
    else 
        updates.initial = ts ? ts : Date.now()
    if (ts)
        updates.initial = ts
    updates.current = Date.now()
    settings.set('repo.routesUpdates',updates)
}

export const getRepoUpdates = ():RoutesRepoUpdates => {
    const settings = useUserSettings()
    const updates = settings.get('repo.routesUpdates',{}) as unknown as RoutesRepoUpdates
    return updates
}

export  const checkIsNew = (descr: RouteInfo):boolean => {
    let isNew = false;
    const repoUpdates = getRepoUpdates();

    if (descr.tsImported===repoUpdates.initial)
        return false
    if (repoUpdates.prev) {
        if (!descr.isLocal && !descr.tsLastStart && (descr.tsImported - repoUpdates.initial) > DURATION_30_SECONDS && Date.now() - descr.tsImported < DURATION_2_WEEKS) {
            isNew = true;
        }
    }
    return isNew;
}

