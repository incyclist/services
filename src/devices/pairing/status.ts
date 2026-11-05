import {
    derivePairingStatus,
    getPairingGuidanceText,
    getUnavailableInterfaces,
    PairingInterfaceId,
    PairingInterfaceState,
    PairingPlatform,
    PairingStatusId
} from './guidance'
import { ActivatableCapability, isCapabilityActive } from './capability'

export type PairingStatusDot = 'red' | 'green' | 'amber'

export interface PairingStatusDisplayProps {
    id: PairingStatusId
    text: string
    shortText: string
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

const DOT_BY_STATUS: Partial<Record<PairingStatusId, PairingStatusDot>> = { S1: 'red', S2: 'green', S2e: 'green' }

// the order the tiles are shown in, which is also the order the missing sensors are named in
const TILE_ORDER = ['control', 'power', 'speed', 'heartrate', 'cadence']

// the best device found to ride with, whether or not it's connected yet: trainer > power meter > speed sensor
const getFoundRideDeviceName = (src: PairingStatusSource): string | undefined =>
    REQUIRED_CAPABILITIES
        .map(name => src.capabilities.find(c => c.capability === name))
        .find(c => Boolean(c?.selected) && !c?.disabled)?.deviceName

const statusDot = (id: PairingStatusId): PairingStatusDot => DOT_BY_STATUS[id] ?? 'amber'

export const getPairingStatusDisplay = (src: PairingStatusSource): PairingStatusDisplayProps => {
    const find = (name: string) => src.capabilities.find(c => c.capability === name)
    const readyCapability = REQUIRED_CAPABILITIES
        .map(find)
        .find(c => isCapabilityActive(c) && c.connectState === 'connected')
    const connectingCapability = src.capabilities.find(c => isCapabilityActive(c) && c.connectState === 'connecting')
    const anyDeviceSelected = src.capabilities.some(c => isCapabilityActive(c))

    const derived = derivePairingStatus({
        platform: src.platform,
        interfaces: src.interfaces,
        anyDeviceSelected,
        initialising: src.loading,
        searching: false,
        canStartRide: src.canStartRide,
        readyDeviceName: readyCapability?.deviceName,
        connectingDeviceName: connectingCapability?.deviceName,
        connectingIsTrainer: connectingCapability?.capability === 'control',
        searchEndedWithNothing: src.searchEndedWithNothing,
        stillLooking: src.stillLooking,
        searchEndedWithoutTrainer: src.searchEndedWithoutTrainer,
    })

    let id: PairingStatusId = derived === 'S1b' ? 'S5' : derived
    if (src.loading)
        id = 'S4'

    let deviceName = id === 'S3' ? connectingCapability?.deviceName : readyCapability?.deviceName
    if (id === 'S2w')
        deviceName = getFoundRideDeviceName(src)
    const missing = TILE_ORDER.filter(c => src.missing?.includes(c))
    const params = {
        platform: src.platform,
        unavailable: getUnavailableInterfaces(src.interfaces, src.platform),
        deviceName,
        isTrainer: connectingCapability?.capability === 'control',
        rideMode: src.rideMode,
        missing,
    }
    const full = getPairingGuidanceText(id, params, 'full')
    const short = getPairingGuidanceText(id, params, 'short')

    return {
        id,
        text: full.text,
        shortText: short.text,
        link: full.link,
        shortLink: short.link,
        dot: statusDot(id),
    }
}
