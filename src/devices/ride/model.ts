import { DeviceProperties } from "incyclist-devices/lib/types/device";
import { AdapterInfo, ExtendedIncyclistCapability } from "../configuration";
import { Route } from "../../routes/base/model/route";
import { RouteApiDetail } from "../../routes/base/api/types";

export type HealthStatus = 'green' | 'amber' | 'red'

export interface AdapterRideInfo extends AdapterInfo {
    isStarted: boolean
    tsLastData?: number
    isHealthy?: boolean
    isRestarting?: boolean
    dataStatus?: HealthStatus
    ivToCheck?: NodeJS.Timeout
    isControl?: boolean


}

export interface AdapterStateInfo {
    udid: string,
    name:string,
    isControl:boolean,
    capabilities:Array<ExtendedIncyclistCapability>
    isStarted:boolean
}

export interface LegacyRoute {
    get():RouteApiDetail
    isLap():boolean
    getTitle():string
}
export interface RideServiceDeviceProperties extends DeviceProperties {
    forceErgMode?: boolean
    startPos?: number,
    realityFactor?:number,
    rideMode?:string
    route?: Route|LegacyRoute
}

export interface RideServiceCheckFilter {
    interface?: string
    interfaces?: string[]
    udid?: string
}

export interface Point {
    elevation: number,
    distance: number
}

export interface PreparedRoute {
    name: string
    description: string
    programId: number
    type:  string
    totalDistance:number,
    lapMode: boolean,
    minElevation: number,
    maxElevation: number,
    sampleRate:number,
    points: Point[]    
}

