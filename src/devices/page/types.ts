import type { DevicePairingStatus } from "../pairing/model"

export type PageState    =  'Idle' | 'Scanning' | 'Pairing' | 'Done' | 'Closed' 
export type SelectState  =  'Closed' | 'Waiting' | 'Active' 
export type TInterface   = 'ble'|'wifi'

export type PairingDisplayProps = {
    title: string|undefined
    capabilities?: {
        top: Array<CapabilityDisplayProps>
        bottom: Array<CapabilityDisplayProps>
        rowLabels?: { top: PairingRowLabelProps, bottom: PairingRowLabelProps }
    }
    interfaces?: Array<InterfaceDisplayProps>
    buttons?: PairingButtonProps
    deviceSelection? :DeviceSelectionProps
    
    showInterfaceSettings: TInterface|undefined
    showExit?: boolean,
    onExit?:()=>void

}

export type DeviceSelectionProps = {
    capability: TIncyclistCapability
    devices: Array<DeviceSelectionItemProps>
    disabled: boolean,
    isScanning: boolean
    changeForAll: boolean
    canSelectAll: boolean
    onClose: (enabled:boolean)=>void    
}

export type TConnectState = 'failed' | 'connected' | 'connecting'
export type DeviceSelectionItemProps = {
    connectState?: TConnectState
    isSelected: boolean
    deviceName: string
    value: number,
    interface: string,
    onClick?: (addAll?:boolean)=>void
    onDelete?: ()=>void
}

export type CapabilityDisplayProps = {
    title: string
    capability: TIncyclistCapability
    deviceName: string|undefined
    interface?: string,
    connectState?: DevicePairingStatus,
    value?: string
    unit?: string
    disabled?: boolean
    role?: 'required' | 'optional'
    helpText?: { full: string, short: string }
    emptyFooter?: string
    onClick: (item:CapabilityDisplayProps)=>void
    onUnselect?
}

export type PairingRowLabelProps = { text: string, subtext?: string }

export type InterfaceDisplayState ='disabled'|'scanning'|'idle'|'error'
export type InterfaceDisplayProps = {
    name:string
    state: InterfaceDisplayState
    error?: string
    onClick:()=>void
}

export type InterfaceSettingsDisplayProps = {
    state?: InterfaceDisplayState
    error?: string
    enabled: boolean
}

export type NextPageAction = { nextPage:string}

export type ClickAction = void | NextPageAction

type ButtonProps = {
    label: string,
    primary: boolean,
    onClick:()=>Promise<ClickAction>
}
export type PairingButtonProps = Array<ButtonProps>

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type DeviceListDisplayProps = {}


export type TIncyclistCapability = 'power' | 'speed' | 'cadence' | 'heartrate' | 'control' | 'app_control'
export type TDisplayCapability ='resistance'|'power'|'heartrate'|'cadence'|'speed'|'controller'

export type PairingExitVia = 'ok' | 'skip' | 'simulate' | 'cancel' | 'app_exit'
export type PreviousVisitOutcome =
    | 'none'
    | 'ready'
    | 'skip-then-ride'
    | 'skip-no-ride'
    | 'simulate'
    | 'app-exit-ready'
    | 'app-exit-not-ready'

export interface PairingVisitLast {
    visitId: string
    sessionId: string
    openedAt: number
    backgroundMs: number
    backgroundedAt?: number
    forRide: boolean
    canStartRide: boolean
    visitIndexToday: number
    firstEverVisit: boolean
    previousVisitOutcome: PreviousVisitOutcome
    previousVisitAgeMs?: number
    closed: boolean
    via?: PairingExitVia
    inferred?: boolean
    closedAt?: number
    rideAfter?: 'device' | 'simulate'
}

export interface PairingVisitRecord {
    date: string
    countToday: number
    firstEverPending: boolean
    last?: PairingVisitLast
}

export interface PairingVisitStore {
    get(): PairingVisitRecord | undefined
    set(record: PairingVisitRecord): void
}

export interface PairingVisitTrackerDeps {
    store: PairingVisitStore
    sessionId: string
    platform: 'desktop' | 'mobile'
    now: () => number
    today: () => string
    log: (message: string, fields: Record<string, unknown>) => void
}
