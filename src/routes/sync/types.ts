import { Observer } from "../../base/types"
import { Route } from "../base/model/route";

export type RouteSyncInfo = {
    service: string, 
    syncProvider: IRouteSyncProvider 
}

export interface IRouteSyncProvider {
    sync(): Observer
    isConnected():boolean;
    loadDetails(route:Route):Promise<Route>
}

