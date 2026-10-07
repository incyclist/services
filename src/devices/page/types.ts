import type { DevicePairingStatus } from "../pairing/model"
import type { PairingStatusDisplayProps } from "../pairing/status"
import type { InterfaceState } from "../access"

export type PageState    =  'Idle' | 'Scanning' | 'Pairing' | 'Done' | 'Closed' 
export type SelectState  =  'Closed' | 'Waiting' | 'Active' 
export type TInterface   = 'ble'|'wifi'

export type PairingDisplayProps = {
    title: string|undefined
    readyToStart?: boolean
    status?: PairingStatusDisplayProps
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
    onClose: ()=>void
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
    /** Turns the capability off. Only set on a tile with a selected, enabled device. */
    onUnselect?: ()=>void
    /** Turns a switched-off capability back on, restoring its remembered device with no new scan.
     * Only set on a switched-off tile that still has a remembered device (T16, not T16b). */
    onUse?: ()=>void
}

export type PairingRowLabelProps = { text: string, subtext?: string }

export type InterfaceDisplayState ='disabled'|'scanning'|'idle'|'error'
export type InterfaceDisplayProps = {
    name:string
    state: InterfaceDisplayState
    error?: string
    onClick:()=>void
}

/**
 * Desktop interface tile props: unlike mobile's 4-state mapping, desktop shows the raw
 * `InterfaceState` plus `isScanning`/`enabled`/`protocol`/`port` for every interface
 * (ANT+, BLE, serial, TCP/IP, WiFi), matching today's `web-ui` interface strip.
 */
export type DesktopInterfaceDisplayProps = {
    name: string
    state: InterfaceState
    isScanning: boolean
    enabled: boolean
    protocol?: string
    port?: number|string
    onClick: ()=>void
}

export type DesktopPairingDisplayProps = Omit<PairingDisplayProps,'interfaces'> & {
    interfaces?: Array<DesktopInterfaceDisplayProps>
    labelOK?: string
    labelSkip?: string
    showSimulate?: boolean
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
