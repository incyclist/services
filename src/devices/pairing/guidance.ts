import { IncyclistCapability } from "incyclist-devices"

export type PairingRole = 'required' | 'optional'

export interface PairingCapabilityRole {
    capability: IncyclistCapability
    role: PairingRole
    descriptor: string
}

export const PAIRING_CAPABILITY_ROLES: ReadonlyArray<PairingCapabilityRole> = [
    { capability: IncyclistCapability.Control,   role: 'required', descriptor: 'control' },
    { capability: IncyclistCapability.Power,     role: 'required', descriptor: 'power' },
    { capability: IncyclistCapability.Speed,     role: 'required', descriptor: 'speed' },
    { capability: IncyclistCapability.HeartRate, role: 'optional', descriptor: 'heartrate' },
    { capability: IncyclistCapability.Cadence,   role: 'optional', descriptor: 'cadence' },
    { capability: IncyclistCapability.AppControl, role: 'optional', descriptor: 'app_control' },
]

export type PairingStatusId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'

export interface PairingStatusInput {
    canScan: boolean
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
    if (!input.canScan) return 'S1'
    if (input.canStartRide) return 'S2'
    if (input.connectingDeviceName) return 'S3'
    if (input.initialising) return 'S4'
    return 'S5'
}

export type PairingTextVariant = 'full' | 'short'

export interface PairingGuidanceParams {
    platform?: 'desktop' | 'mobile'
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

export const getPairingGuidanceText = (
    id: PairingGuidanceId,
    params: PairingGuidanceParams = {},
    variant: PairingTextVariant = 'full'
): PairingGuidanceText => {
    const isShort = variant === 'short'
    const device = params.deviceName ?? ''

    switch (id) {
        case 'S1':
            if (params.platform === 'mobile')
                return isShort
                    ? { text: 'Bluetooth is off.', link: 'Settings' }
                    : { text: "Can't search: Bluetooth is off.", link: 'Bluetooth settings' }
            return { text: "Can't search: Bluetooth and ANT+ are both unavailable.", link: 'Check connections' }

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
