import {
    derivePairingStatus,
    getPairingGuidanceText,
    getUnavailableInterfaces,
    PairingInterfaceId,
    PairingInterfaceState,
    PairingPlatform,
    PairingStatusId
} from './guidance'

export type PairingStatusDot = 'red' | 'green' | 'amber'

export interface PairingStatusDisplayProps {
    id: PairingStatusId
    text: string
    shortText: string
    link?: string
    shortLink?: string
    dot: PairingStatusDot
}

export interface PairingStatusSource {
    platform: PairingPlatform
    interfaces: ReadonlyArray<PairingInterfaceState>
    capabilities: ReadonlyArray<{ capability: string, selected?: string, deviceName?: string, connectState?: string }>
    canStartRide: boolean
    loading: boolean
    rideMode: boolean
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

export const getPairingStatusDisplay = (src: PairingStatusSource): PairingStatusDisplayProps => {
    const find = (name: string) => src.capabilities.find(c => c.capability === name)
    const readyCapability = REQUIRED_CAPABILITIES
        .map(find)
        .find(c => c?.selected && c.connectState === 'connected')
    const connectingCapability = src.capabilities.find(c => c.selected && c.connectState === 'connecting')
    const anyDeviceSelected = src.capabilities.some(c => Boolean(c.selected))

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
    })

    const id = src.loading ? 'S4' : derived === 'S1b' ? 'S5' : derived

    const deviceName = id === 'S3' ? connectingCapability?.deviceName : readyCapability?.deviceName
    const params = {
        platform: src.platform,
        unavailable: getUnavailableInterfaces(src.interfaces, src.platform),
        deviceName,
        isTrainer: connectingCapability?.capability === 'control',
        rideMode: src.rideMode,
    }
    const full = getPairingGuidanceText(id, params, 'full')
    const short = getPairingGuidanceText(id, params, 'short')

    return {
        id,
        text: full.text,
        shortText: short.text,
        link: full.link,
        shortLink: short.link,
        dot: id === 'S1' ? 'red' : id === 'S2' ? 'green' : 'amber',
    }
}
