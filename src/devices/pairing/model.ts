import { DeviceData, DeviceSettings, IncyclistCapability } from "incyclist-devices"
import { EnrichedInterfaceSetting } from "../access"
import { AdapterRideInfo, RideServiceCheckFilter } from "../ride"


export interface DevicePairingData {
    udid:string,
    name:string,
    interface:string,
    connectState?:string,
    value?:number,
    unit?:string
    selected:boolean
}

export interface CapabilityData {
    capability: IncyclistCapability,
    value?: number,
    unit?: string,
    connectState?: DevicePairingStatus,   
    deviceName:string
    deviceNames: string
    selected:string
    disabled:boolean
    interface:string
    devices:Array<DevicePairingData>
}




export interface PairingData {
    udid: string,
    data: Array<CapabilityData>
}

export interface PairingProps {
    filter?: RideServiceCheckFilter,
    enforcedScan?: boolean
}

export interface PairingInfo {
    promiseCheck?: Promise<boolean>,
    promiseStart?: Promise<boolean>,
    promiseScan?:Promise<DeviceSettings[]>
    props:PairingProps
    data?:Array< {udid:string, data:DeviceData, ts:number}>
}

export interface PairingState {
    capabilities?: Array<CapabilityData>
    interfaces?: Array<EnrichedInterfaceSetting>
    canStartRide?:boolean    
    adapters?: Array<AdapterRideInfo>
}

export interface DeviceSelectState {
    capability:IncyclistCapability
    devices:Array<DevicePairingData>
}



export interface PairingSettings {
    onStateChanged?: (newState:PairingState)=>void
    onDeviceSelectStateChanged?:(newState:DeviceSelectState)=>void
    capabilityForScan?: IncyclistCapability
}



export type DevicePairingStatus = 'connecting'|'connected'|'failed'|'waiting'|'paused'