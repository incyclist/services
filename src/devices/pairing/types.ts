import type { IncyclistCapability } from "incyclist-devices"
import type { DevicePairingStatus } from "./model"

export type PairingDisplayProps = {
    loading: boolean
    title: string|undefined
    capabilties?: {
        top: Array<CapabilityDisplayProps>
        bottom: Array<CapabilityDisplayProps>
    }
    interfaces?: Array<InterfaceDisplayProps>
    buttons?: PairingButtonProps
}

export type CapabilityTitle = {
    title:string
}
export type CapabilityIcon = {
    icon: TDisplayCapability
}

export type CapabilityDisplayProps = {
    header:CapabilityTitle|CapabilityIcon    
    capability: TIncyclistCapability
    deviceName: string
    connectState?: DevicePairingStatus,   
    value: string
    unit: string
    onClick?
    onUnselect? 
}

export type InterfaceDisplayState ='disabled'|'scanning'|'idle'|'error'
export type InterfaceDisplayProps = {
    name:string
    state: InterfaceDisplayState
    error?: string
}

export type PairingButtonProps = {
    showOK: boolean
    showSkip: boolean
    showSimulate: boolean
    showExit: boolean
    primary: 'ok'|'skip'|'simulate'
}

export type DeviceListDisplayProps = {

}


export type TIncyclistCapability = 'power' | 'speed' | 'cadence' | 'heartrate' | 'control' | 'app_control'
export type TDisplayCapability ='resistance'|'power'|'heartrate'|'cadence'|'speed'|'controller'
