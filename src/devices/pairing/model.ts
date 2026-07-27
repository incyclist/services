import { DeviceData, DeviceSettings, IncyclistCapability, IncyclistDeviceAdapter } from "incyclist-devices"
import { EnrichedInterfaceSetting } from "../access"
import { RideServiceCheckFilter } from "../ride"
import { AdapterInfo, IncyclistDeviceSettings } from "../configuration"


export interface DevicePairingData {
    udid:string,
    name:string,
    interface:string,
    connectState?:string,
    value?:number,
    unit?:string
    selected:boolean
    interfaceInactive?: boolean

}

export interface CapabilityData {
    capability: IncyclistCapability,
    value?: number,
    unit?: string,
    connectState?: DevicePairingStatus,   
    deviceName:string
    deviceNames: string
    selected?:string
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

export interface PairingState {
    capabilities?: Array<CapabilityData>
    interfaces?: Array<EnrichedInterfaceSetting>
    canStartRide?:boolean    
    adapters?: Array<AdapterInfo>  
}

export interface DeleteListEntry  {
    capability: IncyclistCapability,
    udid: string
    /**
     * Snapshot of the device's settings at the time of deletion. Used to recognize the same
     * physical device on a later rescan even if its udid was regenerated (e.g. after the device
     * was fully purged when its last remaining capability was deleted) - see onDeviceDetected.
     */
    settings?: IncyclistDeviceSettings
}

export interface InternalPairingState extends PairingState {
    initialized: boolean;
    stopRequested?:boolean
    stopped?:boolean
    waiting?:boolean
    deleted: Array<DeleteListEntry>
    scanTo?: NodeJS.Timeout
    tsPrevStart?: number;

    check?: {
        preparing?:number
        promise?:Promise<boolean>
        to?: NodeJS.Timeout
    }
    scan?: {
        preparing?:number
        promise?: Promise<DeviceSettings[]>
        adapters?: Array<{ udid:string,adapter:IncyclistDeviceAdapter, handler}>
    }
    props?:PairingProps
    data?:Array< {udid:string, data:DeviceData, ts:number}>

}



export interface DeviceSelectState {
    capability:IncyclistCapability
    devices:Array<DevicePairingData>
    isScanning?: boolean
}



export interface PairingSettings {
    onStateChanged?: (newState:PairingState)=>void
    onDeviceSelectStateChanged?:(newState:DeviceSelectState)=>void
    capabilityForScan?: IncyclistCapability
}



export type DevicePairingStatus = 'connecting'|'connected'|'failed'|'waiting'|'paused'