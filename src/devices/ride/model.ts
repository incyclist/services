import { DeviceProperties } from "incyclist-devices/lib/types/device";
import { AdapterInfo, ExtendedIncyclistCapability } from "../configuration";

export interface AdapterRideInfo extends AdapterInfo {
    isStarted: boolean
    tsLastData?: number
    isHealthy?: boolean
    ivToCheck?: NodeJS.Timeout

}

export interface AdapterStateInfo {
    udid: string,
    name:string,
    isControl:boolean,
    capabilities:Array<ExtendedIncyclistCapability>
    isStarted:boolean
}



export interface RideServiceDeviceProperties extends DeviceProperties {
    forceErgMode?: boolean
    startPos?: number,
    realityFactor?:number,
    rideMode?:string
    route?
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

