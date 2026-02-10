import type { IncyclistCapability } from "incyclist-devices"
import type { DevicePairingStatus } from "../pairing/model"

export type PageState =   'Idle' | 'Scanning' | 'Pairing' | 'Done' | 'Closed' | 'CapabilityScan'

export type PairingDisplayProps = {
    title: string|undefined
    capabilities?: {
        top: Array<CapabilityDisplayProps>
        bottom: Array<CapabilityDisplayProps>
    }
    interfaces?: Array<InterfaceDisplayProps>
    buttons?: PairingButtonProps
    deviceSelection? :DeviceSelectionProps
    showExit?: boolean,
    onExit?:()=>void

}

export type DeviceSelectionProps = {
    capability: TIncyclistCapability
    devices: Array<DeviceSelectionItemProps>
    isScanning: boolean
    changeForAll: boolean
    canSelectAll
    onClose
}

export type TConnectState = 'failed' | 'connected' | 'connecting'
export type DeviceSelectionItemProps = {
    connectState?: TConnectState
    isSelected: boolean
    deviceName: string
    value: number,
    interface: string,
    onClick?
    onDelete?
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
    deviceName: string|undefined
    interface?: string,
    connectState?: DevicePairingStatus,   
    value?: string
    unit?: string
    onClick: ()=>void
    onUnselect? 
}

export type InterfaceDisplayState ='disabled'|'scanning'|'idle'|'error'
export type InterfaceDisplayProps = {
    name:string
    state: InterfaceDisplayState
    error?: string
}

export type NextPageAction = { nextPage:string}

export type ClickAction = void | NextPageAction

type ButtonProps = {
    label: string,
    primary: boolean,
    onClick:()=>Promise<ClickAction>
}
export type PairingButtonProps = Array<ButtonProps>

export type DeviceListDisplayProps = {

}


export type TIncyclistCapability = 'power' | 'speed' | 'cadence' | 'heartrate' | 'control' | 'app_control'
export type TDisplayCapability ='resistance'|'power'|'heartrate'|'cadence'|'speed'|'controller'
