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
export type PairingPlatform = 'desktop' | 'mobile'

export interface PairingInterfaceState {
    id: PairingInterfaceId
    enabled: boolean
    available: boolean
    permissionDenied?: boolean
}

const INTERFACE_LABELS: Record<PairingInterfaceId, string> = {
    ant: 'ANT+',
    ble: 'Bluetooth',
    serial: 'Serial',
    tcpip: 'TCP/IP',
    wifi: 'Wi-Fi',
}

const DESKTOP_SEARCH_INTERFACES: ReadonlyArray<PairingInterfaceId> = ['ble', 'ant']

const searchInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform) =>
    platform === 'desktop'
        ? interfaces.filter(i => DESKTOP_SEARCH_INTERFACES.includes(i.id))
        : interfaces

export const canScanWithInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform): boolean =>
    searchInterfaces(interfaces, platform).some(i => i.enabled && i.available)

export const getUnavailableInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform): PairingInterfaceId[] =>
    searchInterfaces(interfaces, platform).filter(i => i.enabled && !i.available).map(i => i.id)

export type PairingHint = 'bluetooth-permission' | 'bluetooth-off' | 'wifi-off' | 'ant'

export interface PairingHintInput {
    platform: PairingPlatform
    interfaces: ReadonlyArray<PairingInterfaceState>
    anyDeviceSelected: boolean
}

const isBrokenInterface = (interfaces: ReadonlyArray<PairingInterfaceState>, id: PairingInterfaceId): PairingInterfaceState | undefined =>
    interfaces.find(i => i.id === id && i.enabled && !i.available)

/**
 * First-use hint for a partially failing interface. Only applies while no device is selected.
 * Disabled interfaces never trigger a hint; desktop Bluetooth, serial and TCP stay silent.
 */
export const getPairingHint = (input: PairingHintInput): PairingHint | undefined => {
    if (input.anyDeviceSelected) return undefined

    if (input.platform === 'mobile') {
        const ble = isBrokenInterface(input.interfaces, 'ble')
        if (ble) return ble.permissionDenied ? 'bluetooth-permission' : 'bluetooth-off'
        if (isBrokenInterface(input.interfaces, 'wifi')) return 'wifi-off'
        return undefined
    }

    if (isBrokenInterface(input.interfaces, 'ant')) return 'ant'
    return undefined
}

export type PairingStatusId = 'S1' | 'S1b' | 'S2' | 'S3' | 'S4' | 'S5'

export interface PairingStatusInput extends PairingHintInput {
    initialising: boolean
    searching: boolean
    canStartRide: boolean
    readyDeviceName?: string
    connectingDeviceName?: string
    connectingIsTrainer?: boolean
}

/**
 * Priority: S1 > S2 > S3 > S4 > S1b > S5. S4 sits above S1b so the first-use hint never shows
 * while the page is initialising. The 2 s hold after S4 is applied by the caller.
 */
export const derivePairingStatus = (input: PairingStatusInput): PairingStatusId => {
    if (!canScanWithInterfaces(input.interfaces, input.platform)) return 'S1'
    if (input.canStartRide) return 'S2'
    if (input.connectingDeviceName) return 'S3'
    if (input.initialising) return 'S4'
    if (getPairingHint(input)) return 'S1b'
    return 'S5'
}

export type PairingTextVariant = 'full' | 'short'

export interface PairingGuidanceParams {
    platform?: PairingPlatform
    unavailable?: ReadonlyArray<PairingInterfaceId>
    bluetoothDenied?: boolean
    hint?: PairingHint
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
    if (params.platform === 'mobile' && params.bluetoothDenied)
        return isShort
            ? { text: 'Bluetooth not allowed.', link: 'Settings' }
            : { text: "Can't search: Bluetooth is not allowed.", link: 'Open settings' }

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

const getHintText = (hint: PairingHint, isShort: boolean): PairingGuidanceText => {
    switch (hint) {
        case 'bluetooth-permission':
            return isShort
                ? { text: 'Bluetooth not allowed.', link: 'Settings' }
                : { text: "Incyclist isn't allowed to use Bluetooth, so most trainers won't show up.", link: 'Open settings' }
        case 'bluetooth-off':
            return isShort
                ? { text: 'Bluetooth is off.', link: 'Settings' }
                : { text: "Bluetooth is off, so most trainers won't show up.", link: 'Bluetooth settings' }
        case 'wifi-off':
            return isShort
                ? { text: 'Wi-Fi is off · needed for Wi-Fi trainers' }
                : { text: 'Wi-Fi is off. If your trainer connects over Wi-Fi, turn Wi-Fi on.' }
        case 'ant':
            return { text: 'ANT+ stick not found. If you use one, plug it in, try another USB port, or close other apps that use it.' }
    }
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

        case 'S1b':
            return getHintText(params.hint!, isShort)

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
