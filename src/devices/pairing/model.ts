import { DeviceData, DeviceSettings, IncyclistCapability, IncyclistDeviceAdapter } from "incyclist-devices"
import { EnrichedInterfaceSetting } from "../access"
import { RideServiceCheckFilter } from "../ride"
import { AdapterInfo, ExclusionReason, ExclusionScope, IncyclistDeviceSettings } from "../configuration"


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
    /**
     * Set only while the device named by `selected` is itself excluded from the effective
     * selection (e.g. riding on a fallback device while the trainer isn't available); `selected`
     * keeps the raw, persisted udid regardless. Cleared automatically the moment `selected`
     * changes - never describes some other, previously-selected device.
     */
    excluded?: { reason: ExclusionReason, scope: ExclusionScope }
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

/**
 * What picking `udid` would do to every capability it supports other than the one it's being
 * picked for: `filled` slots are currently empty, `unchanged` already hold this same device, and
 * `conflicts` hold a different device (`currentName` is for display only, never logged).
 */
export interface SelectionImpact {
    filled: IncyclistCapability[]
    unchanged: IncyclistCapability[]
    conflicts: Array<{ capability: IncyclistCapability, currentName: string }>
}

/**
 * `true` keeps today's meaning (overwrite every capability the device supports) and `false`
 * means this slot only. The object form fills whatever is empty at commit time and replaces only
 * the capabilities named in `replace`; a capability that's `disabled` or on this device's session
 * delete list is skipped either way, not filled and not replaced.
 */
export type SelectDeviceMode = boolean | { others: 'fill-empty', replace: IncyclistCapability[] }

/**
 * A device that wants slots already held by a different device. Nothing is replaced until the
 * rider answers: until then, the current selection is kept and readiness is computed on it.
 *
 * `deviceName` and `conflicts[].currentName` are for display only and are never logged.
 */
export interface SelectionConflict {
    /** stable for this device and detection, opaque to the UI */
    id: string
    origin: 'detection' | 'manual'
    deviceName: string
    /** empty slots that were already filled with this device */
    filled: IncyclistCapability[]
    conflicts: Array<{ capability: IncyclistCapability, currentName: string }>
}

/** How a conflict ended without being answered: the rider dismissed it, or left the page. */
export type ConflictDismissal = 'dismissed' | 'left_page'



export interface PairingSettings {
    onStateChanged?: (newState:PairingState)=>void
    onDeviceSelectStateChanged?:(newState:DeviceSelectState)=>void
    capabilityForScan?: IncyclistCapability
}



export type DevicePairingStatus = 'connecting'|'connected'|'failed'|'waiting'|'paused'