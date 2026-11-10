import {
    canScanWithInterfaces,
    derivePairingStatus,
    getPairingGuidanceText,
    getPairingHint,
    getUnavailableInterfaces,
    PairingInterfaceId,
    PairingInterfaceState,
    PairingHint,
    PairingPlatform,
    PairingStatusId,
    PairingStatusTrainerPhase,
    PairingTrainerRetry
} from './guidance'
import { ActivatableCapability, isCapabilityActive } from './capability'

export type PairingStatusDot = 'red' | 'green' | 'amber'

export interface PairingStatusDisplayProps {
    id: PairingStatusId
    text: string
    shortText: string
    /** `text`/`shortText` without a tip that doesn't apply while something nearby (e.g. an open
     * helper panel) already covers it - falls back to `text`/`shortText` where there's no tip to drop */
    stateOnlyText: string
    shortStateOnlyText: string
    link?: string
    shortLink?: string
    dot: PairingStatusDot
}

/**
 * The per-capability input the status line needs. Readiness is only ever decided through
 * {@link isCapabilityActive}, so the fields it reads come from {@link ActivatableCapability}
 * rather than being declared again here.
 */
export type PairingStatusCapability = ActivatableCapability & {
    capability: string
    deviceName?: string
    connectState?: string
}

export interface PairingStatusSource {
    platform: PairingPlatform
    interfaces: ReadonlyArray<PairingInterfaceState>
    capabilities: ReadonlyArray<PairingStatusCapability>
    canStartRide: boolean
    loading: boolean
    rideMode: boolean
    /** the page's search has ended and found nothing to ride with */
    searchEndedWithNothing?: boolean
    /** a search is running, something to ride with was found, and it's still looking for `missing` */
    stillLooking?: boolean
    /** the capabilities the running search is still looking for */
    missing?: ReadonlyArray<string>
    /** the page's search has ended without a trainer */
    searchEndedWithoutTrainer?: boolean
    /** where the configured trainer's connection attempt stands; only set while a trainer is configured */
    trainerPhase?: PairingStatusTrainerPhase
    /** the rider's own attempt to reach the trainer (S7a/S7b), only shown while it can't be reached */
    trainerRetry?: PairingTrainerRetry
    /** when the first-use partial outage started to hold, once the page had finished getting ready */
    partialOutageSince?: number
    /** the current time, for the partial-outage hold; defaults to now */
    now?: number
    /** the ride falls back to `fallbackCapability` because the trainer isn't available */
    fallbackActive?: boolean
    /** the trainer connected while the fallback was active */
    fallbackReverted?: boolean
    fallbackCapability?: 'power' | 'speed'
    /** the page has been searching for longer than the help threshold */
    helperThresholdReached?: boolean
}

const REQUIRED_CAPABILITIES = ['control', 'power', 'speed']

export const toPairingInterfaceStates = (
    interfaces: ReadonlyArray<{ name: string, enabled?: boolean, state?: string }>
): PairingInterfaceState[] =>
    interfaces.map(i => ({
        id: i.name as PairingInterfaceId,
        enabled: i.enabled !== false,
        available: i.state !== 'disconnected' && i.state !== 'unavailable',
    }))

const DOT_BY_STATUS: Partial<Record<PairingStatusId, PairingStatusDot>> = {
    S1: 'red', S2: 'green', S2b: 'green', S2c: 'green', S2d: 'green', S2e: 'green'
}

// the order the tiles are shown in, which is also the order the missing sensors are named in
const TILE_ORDER = ['control', 'power', 'speed', 'heartrate', 'cadence']

// the best device found to ride with, whether or not it's connected yet: trainer > power meter > speed sensor
const getFoundRideDeviceName = (src: PairingStatusSource): string | undefined =>
    REQUIRED_CAPABILITIES
        .map(name => src.capabilities.find(c => c.capability === name))
        .find(c => Boolean(c?.selected) && !c?.disabled)?.deviceName

const statusDot = (id: PairingStatusId): PairingStatusDot => DOT_BY_STATUS[id] ?? 'amber'

// a switched-off tile that still names its device (it has a switch to turn it back on), as the tile shows it
const isSwitchedOffWithDevice = (c: PairingStatusCapability | undefined): boolean =>
    c?.disabled === true && Boolean(c.deviceName)

interface CapabilitySummary {
    trainer?: PairingStatusCapability
    ready?: PairingStatusCapability
    connecting?: PairingStatusCapability
    anyDeviceSelected: boolean
    allRequiredSwitchedOff: boolean
    switchedOffCanToggle: boolean
}

const summarizeCapabilities = (capabilities: ReadonlyArray<PairingStatusCapability>): CapabilitySummary => {
    const required = REQUIRED_CAPABILITIES.map(name => capabilities.find(c => c.capability === name))
    return {
        trainer: required[0],
        ready: required.find(c => isCapabilityActive(c) && c.connectState === 'connected'),
        connecting: capabilities.find(c => isCapabilityActive(c) && c.connectState === 'connecting'),
        anyDeviceSelected: capabilities.some(c => isCapabilityActive(c)),
        allRequiredSwitchedOff: required.every(c => c?.disabled === true),
        switchedOffCanToggle: required.some(isSwitchedOffWithDevice),
    }
}

const getStatusDeviceName = (id: PairingStatusId, src: PairingStatusSource, caps: CapabilitySummary): string | undefined => {
    if (id === 'S2w')
        return getFoundRideDeviceName(src)
    if (id !== 'S3')
        return caps.ready?.deviceName
    // while the configured trainer's attempt runs, S3 is about the trainer, even between its retries
    return src.trainerPhase === 'connecting' ? caps.trainer?.deviceName : caps.connecting?.deviceName
}

/**
 * The first-use partial outage the status line would hint at right now, before any hold is applied:
 * none while the page is getting ready, while nothing at all can search, or once any device is selected.
 *
 * @param src the page's pairing state
 * @returns the hint, or `undefined` if there's nothing to hint at
 */
export const getPartialOutageHint = (src: PairingStatusSource): PairingHint | undefined => {
    if (src.loading || !canScanWithInterfaces(src.interfaces, src.platform))
        return undefined
    const anyDeviceSelected = src.capabilities.some(c => isCapabilityActive(c))
    return getPairingHint({ platform: src.platform, interfaces: src.interfaces, anyDeviceSelected })
}

/**
 * The status line for the Pairing page: its state, both text variants with their links, and the dot.
 *
 * @param src the page's pairing state, plus the guidance state (trainer phase, partial outage) it tracks
 * @returns the status line's display props
 */
export const getPairingStatusDisplay = (src: PairingStatusSource): PairingStatusDisplayProps => {
    const caps = summarizeCapabilities(src.capabilities)

    const derived = derivePairingStatus({
        platform: src.platform,
        interfaces: src.interfaces,
        anyDeviceSelected: caps.anyDeviceSelected,
        initialising: src.loading,
        searching: false,
        canStartRide: src.canStartRide,
        readyDeviceName: caps.ready?.deviceName,
        connectingDeviceName: caps.connecting?.deviceName,
        connectingIsTrainer: caps.connecting?.capability === 'control',
        searchEndedWithNothing: src.searchEndedWithNothing,
        stillLooking: src.stillLooking,
        searchEndedWithoutTrainer: src.searchEndedWithoutTrainer,
        trainerPhase: src.trainerPhase,
        trainerRetry: src.trainerRetry,
        trainerName: caps.trainer?.deviceName,
        allRequiredSwitchedOff: caps.allRequiredSwitchedOff,
        resistanceSwitchedOff: isSwitchedOffWithDevice(caps.trainer),
        fallbackActive: src.fallbackActive,
        fallbackReverted: src.fallbackReverted,
        helperThresholdReached: src.helperThresholdReached,
        partialOutageSince: src.partialOutageSince,
        now: src.now,
    })

    // before the interfaces' first connect attempt has finished they all look broken, so nothing
    // more specific is said while the page is getting ready
    const id: PairingStatusId = src.loading ? 'S4' : derived

    const params = {
        platform: src.platform,
        unavailable: getUnavailableInterfaces(src.interfaces, src.platform),
        hint: getPairingHint({ platform: src.platform, interfaces: src.interfaces, anyDeviceSelected: caps.anyDeviceSelected }),
        deviceName: getStatusDeviceName(id, src, caps),
        isTrainer: src.trainerPhase === 'connecting' || caps.connecting?.capability === 'control',
        rideMode: src.rideMode,
        missing: TILE_ORDER.filter(c => src.missing?.includes(c)),
        trainerName: caps.trainer?.deviceName,
        switchedOffCanToggle: caps.switchedOffCanToggle,
        fallbackCapability: src.fallbackCapability,
    }
    const full = getPairingGuidanceText(id, params, 'full')
    const short = getPairingGuidanceText(id, params, 'short')

    return {
        id,
        text: full.text,
        shortText: short.text,
        stateOnlyText: full.stateOnlyText ?? full.text,
        shortStateOnlyText: short.stateOnlyText ?? short.text,
        link: full.link,
        shortLink: short.link,
        dot: statusDot(id),
    }
}
