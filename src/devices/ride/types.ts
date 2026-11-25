import { DeviceProperties } from "incyclist-devices";
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

/**
 * Adapter level state of the devices at a moment in time (not the state of a ride start).
 * Only primitives, so it can be logged as is.
 */
export interface DeviceSnapshot {
    controlName: string
    controlInterface: string
    isSimulator: boolean
    controlAdapterStarted: boolean
    controlAdapterPaused: boolean
    controlAdapterStopped: boolean
    cntSensors: number
    cntSensorsStarted: number
    // name:started|paused|stopped|idle, joined by ';'
    sensorStates: string
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


/** Options for the restart of a single device while the ride is starting */
export interface DeviceRetryOptions {
    /** stop the adapter before it is started again, even if its previous start has already ended (fresh connection) */
    stopFirst?: boolean
    /** who requested the restart: the rider (default) or the system after a failed start */
    trigger?: 'user' | 'auto'
}

/** Outcome of the restart of a single device while the ride is starting */
export type RetryResult = 'started' | 'failed' | 'stop-timeout' | 'cancelled'
