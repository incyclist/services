import { IncyclistCapability } from "incyclist-devices"

export type PairingRole = 'required' | 'optional'

export interface PairingCapabilityRole {
    capability: IncyclistCapability
    role: PairingRole
    descriptor: string
}

export const PAIRING_CAPABILITY_ROLES: ReadonlyArray<PairingCapabilityRole> = [
    { capability: IncyclistCapability.Control,    role: 'required', descriptor: 'control' },
    { capability: IncyclistCapability.Power,      role: 'required', descriptor: 'power' },
    { capability: IncyclistCapability.Speed,      role: 'required', descriptor: 'speed' },
    { capability: IncyclistCapability.HeartRate,  role: 'optional', descriptor: 'heartrate' },
    { capability: IncyclistCapability.Cadence,    role: 'optional', descriptor: 'cadence' },
    { capability: IncyclistCapability.AppControl, role: 'optional', descriptor: 'app_control' },
]

export type PairingInterfaceId = 'ant' | 'ble' | 'serial' | 'tcpip' | 'wifi'

export interface PairingInterfaceState {
    id: PairingInterfaceId
    enabled: boolean
    available: boolean
}

const INTERFACE_LABELS: Record<PairingInterfaceId, string> = {
    ant: 'ANT+',
    ble: 'Bluetooth',
    serial: 'Serial',
    tcpip: 'TCP/IP',
    wifi: 'Wi-Fi',
}

export const canScanWithInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>): boolean =>
    interfaces.some(i => i.enabled && i.available)

export const getUnavailableInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>): PairingInterfaceId[] =>
    interfaces.filter(i => i.enabled && !i.available).map(i => i.id)

export type PairingStatusId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'

export interface PairingStatusInput {
    interfaces: ReadonlyArray<PairingInterfaceState>
    initialising: boolean
    searching: boolean
    canStartRide: boolean
    readyDeviceName?: string
    connectingDeviceName?: string
    connectingIsTrainer?: boolean
}

/**
 * Priority order: S1 > S2 > S3 > S4 > S5. S5 is the default while the page is idle or searching.
 */
export const derivePairingStatus = (input: PairingStatusInput): PairingStatusId => {
    if (!canScanWithInterfaces(input.interfaces)) return 'S1'
    if (input.canStartRide) return 'S2'
    if (input.connectingDeviceName) return 'S3'
    if (input.initialising) return 'S4'
    return 'S5'
}

export type PairingTextVariant = 'full' | 'short'

export interface PairingGuidanceParams {
    platform?: 'desktop' | 'mobile'
    unavailable?: ReadonlyArray<PairingInterfaceId>
    rideMode?: boolean
    deviceName?: string
    isTrainer?: boolean
}

export type PairingGuidanceId = PairingStatusId | 'row-required' | 'row-required-trainer' | 'row-ready' | 'row-optional'

export interface PairingGuidanceText {
    text: string
    link?: string
    subtext?: string
}

const formatList = (names: string[]): string => {
    if (names.length <= 1) return names.join('')
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const getNoSearchText = (params: PairingGuidanceParams, isShort: boolean): PairingGuidanceText => {
    const names = (params.unavailable ?? []).map(id => INTERFACE_LABELS[id])

    if (params.platform === 'mobile') {
        const list = formatList(names)
        const verb = names.length > 1 ? 'are' : 'is'
        const link = names.length === 1 && names[0] === INTERFACE_LABELS.ble ? 'Bluetooth settings' : 'Settings'
        if (isShort) return { text: `${list} ${verb} off.`, link: 'Settings' }
        return { text: `Can't search: ${list} ${verb} off.`, link }
    }

    const list = formatList(names)
    if (names.length === 2) return { text: `Can't search: ${list} are both unavailable.`, link: 'Check connections' }
    return { text: `Can't search: ${list} unavailable.`, link: 'Check connections' }
}

export const getPairingGuidanceText = (
    id: PairingGuidanceId,
    params: PairingGuidanceParams = {},
    variant: PairingTextVariant = 'full'
): PairingGuidanceText => {
    const isShort = variant === 'short'
    const device = params.deviceName ?? ''

    switch (id) {
        case 'S1':
            return getNoSearchText(params, isShort)

        case 'S2': {
            if (isShort) return { text: `Ready to ride with ${device}.` }
            const tail = `You can add optional sensors, or press ${params.rideMode ? 'Start' : 'OK'}.`
            return { text: `Ready to ride with ${device}. ${tail}` }
        }

        case 'S3':
            if (params.isTrainer)
                return { text: isShort ? `Connecting to ${device}…` : `Connecting to your trainer ${device}…` }
            return { text: `Connecting to ${device}…` }

        case 'S4':
            return { text: 'Getting ready to search…' }

        case 'S5':
            return isShort
                ? { text: 'Searching… Pedal to wake your trainer.' }
                : { text: 'Searching for devices… Tip: pedal a few strokes to wake up your trainer.' }

        case 'row-required':
            return { text: 'TO RIDE', subtext: 'connect any one' }
        case 'row-required-trainer':
            return { text: 'TO RIDE', subtext: 'connecting to your trainer' }
        case 'row-ready':
            return { text: '✓ READY TO RIDE' }
        case 'row-optional':
            return { text: 'OPTIONAL', subtext: 'extras, not needed' }
    }
}

export const getPairingRowLabelId = (trainerSelected: boolean): PairingGuidanceId =>
    trainerSelected ? 'row-required-trainer' : 'row-required'
