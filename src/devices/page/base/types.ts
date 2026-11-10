import type { DevicePairingStatus } from "../../pairing/model"
import type { PairingStatusDisplayProps } from "../../pairing/status"
import type { PairingTrainerRole } from "../../pairing/guidance"
import type { PairingHelperReason } from "../../pairing/helper"
import type { PairingCase, PairingHelperPhase, TrainerPhase } from "./guidance/types"

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

    /** no trainer configured, or where the configured trainer's connection attempt stands */
    pairingCase?: PairingCase
    /** where the configured trainer's connection attempt stands; not set without a trainer */
    trainerPhase?: TrainerPhase
    /** the "can't find your trainer" helper; set while a visit is open. Not yet rendered by any consumer. */
    helper?: PairingHelperDisplayProps
    /**
     * A device found by the search wants slots that already hold a different device: render it as a
     * card exactly as given. It's left out while the helper is open or a device list is open (the
     * conflict stays queued and comes back once both are closed), so the UI never needs to check that.
     */
    pendingConflict?: ConflictStepProps
}

/** What the rider chose for one slot of a conflict: keep its current device, or give it to the new one. */
export type ConflictChoice = 'keep' | 'replace'

/** One slot of a conflict. */
export type ConflictStepRowProps = {
    capability: TIncyclistCapability
    /** the slot's tile title, e.g. "Power" */
    capabilityTitle: string
    /** the device the slot holds now */
    currentName: string
    /** 'keep' until the rider picks otherwise */
    choice: ConflictChoice
    keepLabel: string
    replaceLabel: string
}

/**
 * A device that wants slots already held by a different device: the same rows both as the card of a
 * device found by the search and as the second step of a pick in the Resistance list.
 */
export type ConflictStepProps = {
    /** stable for this conflict, opaque to the UI */
    id: string
    origin: 'detection' | 'manual'
    deviceName: string
    title: string
    /** the free slots the device fills, and that nothing changes until the rider chooses; `short` is the phone copy */
    subline: { full: string, short: string }
    rows: Array<ConflictStepRowProps>
    /** how many more conflicts wait behind this one */
    queued: number
    /** what to say about them, e.g. "2 more devices to check"; `short` is the phone copy; not set when none waits */
    queuedText?: { full: string, short: string }
    onChoice: (capability: TIncyclistCapability, choice: ConflictChoice) => void
    /** applies the choices */
    onDone: () => void
    /**
     * Dismissal (a tap outside the dialog, Esc or back): applies the choices made so far, the same as
     * Done. There is no ✕.
     */
    onDismiss: () => void
}

/** One answer in the helper. */
export type PairingHelperReasonProps = {
    id: PairingHelperReason
    label: string
    selected: boolean
    onSelect: ()=>void
}

/** The action under a tip. A prop of its own, so a UI can pin it apart from the tip text. */
export type PairingHelperActionProps = {
    label: string
    /** a line shown above the button */
    note?: string
    onClick: ()=>void
}

export type PairingHelperDisplayProps = {
    phase: PairingHelperPhase
    title: string
    /** shown until an answer is picked */
    subline?: string
    reasons: Array<PairingHelperReasonProps>
    /** the picked answer's tip; `shortText` is the phone copy */
    tip?: { text: string, shortText: string }
    action?: PairingHelperActionProps
    /** the line at the bottom of the panel (desktop and tablet) */
    footer: string
    /** set while `phase` is `resolved` */
    resolvedText?: string
    /** opens the helper on the rider's request, e.g. from the status line's link */
    onOpen: ()=>void
    onDismiss: ()=>void
}

export type DeviceSelectionProps = {
    capability: TIncyclistCapability
    devices: Array<DeviceSelectionItemProps>
    disabled: boolean,
    isScanning: boolean
    /**
     * @deprecated A pick in the Resistance list no longer needs a "for all" switch: call the item's
     * `onClick()` without an argument, and conflicts come as `conflictStep`. Kept until the UIs have
     * migrated.
     */
    changeForAll: boolean
    /**
     * @deprecated See `changeForAll`. Kept until the UIs have migrated.
     */
    canSelectAll: boolean
    /** set after a pick in the Resistance list that takes slots held by a different device */
    conflictStep?: ConflictStepProps
    onClose: ()=>void
}

export type TConnectState = 'failed' | 'connected' | 'connecting'
export type DeviceSelectionItemProps = {
    connectState?: TConnectState
    isSelected: boolean
    deviceName: string
    value: number,
    interface: string,
    /**
     * Picks the device. In the Resistance list, without `addAll` the pick fills the free slots the
     * device supports and asks about the ones held by another device (`conflictStep`); a boolean
     * keeps the deprecated "for all" behaviour.
     */
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
    /**
     * Set on a tile with a device while a search runs and the device was only seen, not started yet
     * ('Found'): show this instead of the connect state. Not set otherwise.
     */
    stateText?: string
    /** How the tile relates to the configured trainer. Only set while the trainer can't be reached. */
    trainerRole?: PairingTrainerRole
    /** A content line that says how the tile relates to the trainer, e.g. "Your trainer". */
    roleLabel?: string
    /** When set, shown as the footer instead of `stateText`, `connectState` or `emptyFooter`. */
    footerText?: { full: string, short: string }
    /** The page is waiting for this tile: show the amber outline. */
    awaited: boolean
    /**
     * A device is there but deliberately not used right now, because the ride falls back to another
     * device while the trainer isn't available: show the tile dimmed, without a switch. On the
     * Resistance tile, `onClick` then takes the trainer back into use instead of opening the list.
     */
    dimmed?: boolean
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

/** Extra `pairing page left` fields from the open page: strings, numbers and booleans only, never identifiers. */
export type PairingVisitExitFieldsProvider = () => Record<string, string | number | boolean>

export interface PairingVisitTrackerDeps {
    store: PairingVisitStore
    sessionId: string
    platform: 'desktop' | 'mobile'
    now: () => number
    today: () => string
    log: (message: string, fields: Record<string, unknown>) => void
}
