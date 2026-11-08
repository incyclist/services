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

// Desktop's S1 ("can't search") has two different questions to answer, and they don't share one
// interface set:
// - can anything actually scan? Wi-Fi (DirectConnect) genuinely does, and on non-Windows it's
//   always on (invisible to the rider, see DeviceConfigurationService) - so it must count here, or
//   S1 falsely claims nothing can search while Wi-Fi devices are still being found.
// - what do we *name* in the message? Wi-Fi stays out of that: the rider has no control the app
//   can point them to, so a broken/off Wi-Fi is silent, exactly like desktop Bluetooth, serial and
//   TCP failures (ux.md 6, "Silent").
const DESKTOP_SCAN_INTERFACES = new Set<PairingInterfaceId>(['ble', 'ant', 'wifi'])
const DESKTOP_NAMED_INTERFACES = new Set<PairingInterfaceId>(['ble', 'ant'])

const scanInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform) =>
    platform === 'desktop'
        ? interfaces.filter(i => DESKTOP_SCAN_INTERFACES.has(i.id))
        : interfaces

const namedInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform) =>
    platform === 'desktop'
        ? interfaces.filter(i => DESKTOP_NAMED_INTERFACES.has(i.id))
        : interfaces

export const canScanWithInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform): boolean =>
    scanInterfaces(interfaces, platform).some(i => i.enabled && i.available)

export const getUnavailableInterfaces = (interfaces: ReadonlyArray<PairingInterfaceState>, platform: PairingPlatform): PairingInterfaceId[] =>
    namedInterfaces(interfaces, platform).filter(i => i.enabled && !i.available).map(i => i.id)

// a Wi-Fi-off hint on mobile is left out until it's confirmed on a device that the mobile Wi-Fi
// interface really reports itself unavailable while Wi-Fi is off
export type PairingHint = 'bluetooth-permission' | 'bluetooth-off' | 'ant'

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
        return undefined
    }

    if (isBrokenInterface(input.interfaces, 'ant')) return 'ant'
    return undefined
}

/**
 * The status line's states:
 * - S1 nothing can search, S1b a partial outage on first use;
 * - S2 ready, with its variants S2b (riding on the fallback), S2c (the trainer came back while on the
 *   fallback), S2d (ready while Resistance is switched off), S2e (ready, search found no trainer) and
 *   S2w (found something, the search is still looking for more);
 * - S3 connecting, S4 getting ready, S5 searching, S6 still searching after the help threshold;
 * - S7 the configured trainer can't be reached, S8 every required capability is switched off;
 * - S9 the search finished and found nothing.
 */
export type PairingStatusId = 'S1' | 'S1b' | 'S2' | 'S2b' | 'S2c' | 'S2d' | 'S2e' | 'S2w' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9'

/** How long a partial outage has to hold, after the page has finished getting ready, before S1b shows. */
export const PARTIAL_OUTAGE_DEBOUNCE_MS = 2000

/** Where the configured trainer's connection attempt stands (see the Pairing page guidance). */
export type PairingStatusTrainerPhase = 'connecting' | 'connected' | 'unavailable'

export interface PairingStatusInput extends PairingHintInput {
    initialising: boolean
    searching: boolean
    canStartRide: boolean
    readyDeviceName?: string
    connectingDeviceName?: string
    connectingIsTrainer?: boolean
    /** the page's search has ended and found nothing to ride with */
    searchEndedWithNothing?: boolean
    /** a search is running, something to ride with was found, and the search is still looking for more */
    stillLooking?: boolean
    /** the page's search has ended without a trainer (the ready text then says so) */
    searchEndedWithoutTrainer?: boolean
    /** only set while a trainer is configured */
    trainerPhase?: PairingStatusTrainerPhase
    /** the configured trainer's name, for display only */
    trainerName?: string
    /** Resistance, Power and Speed are all switched off */
    allRequiredSwitchedOff?: boolean
    /** Resistance is switched off with its trainer still remembered */
    resistanceSwitchedOff?: boolean
    /** the ride falls back to a power meter or speed sensor because the trainer isn't available */
    fallbackActive?: boolean
    /** the trainer connected while the fallback was active, and the page says so for a moment */
    fallbackReverted?: boolean
    /** the page has been searching for longer than the help threshold */
    helperThresholdReached?: boolean
    /** when the partial-outage condition started to hold, once the page had finished getting ready */
    partialOutageSince?: number
    /** the current time, for the partial-outage hold; defaults to now */
    now?: number
}

const getReadyStatus = (input: PairingStatusInput): PairingStatusId => {
    if (input.fallbackReverted) return 'S2c'
    if (input.fallbackActive) return 'S2b'
    if (input.resistanceSwitchedOff) return 'S2d'
    if (input.searchEndedWithoutTrainer) return 'S2e'
    return 'S2'
}

const isPartialOutageShown = (input: PairingStatusInput): boolean => {
    if (input.partialOutageSince === undefined || !getPairingHint(input))
        return false
    const now = input.now ?? Date.now()
    return now - input.partialOutageSince >= PARTIAL_OUTAGE_DEBOUNCE_MS
}

// the trainer's own states: S3 while its attempt runs, S7 once it can't be reached. While it can't be
// reached, nothing connecting - the trainer's own retries or any other device - brings S3 back.
const getTrainerStatus = (input: PairingStatusInput): PairingStatusId | undefined => {
    if (input.trainerPhase === 'connecting') return 'S3'
    if (input.trainerPhase === 'unavailable') return 'S7'
    if (input.connectingDeviceName) return 'S3'
    return undefined
}

const getSearchingStatus = (input: PairingStatusInput): PairingStatusId => {
    if (input.initialising) return 'S4'
    if (input.searchEndedWithNothing) return 'S9'
    return input.helperThresholdReached ? 'S6' : 'S5'
}

/**
 * Priority: S1 > S2w > S2 (S2c > S2b > S2d > S2e > S2) > S8 > S3/S7 > S1b > S4 > S9 > S6/S5.
 * - S3 shows while the configured trainer is still connecting, or for any connecting device without a
 *   configured trainer; once the trainer can't be reached, S7 holds instead.
 * - S1b needs the partial outage to have held for {@link PARTIAL_OUTAGE_DEBOUNCE_MS}; the caller
 *   keeps `partialOutageSince` and re-evaluates once that time has passed.
 */
export const derivePairingStatus = (input: PairingStatusInput): PairingStatusId => {
    if (!canScanWithInterfaces(input.interfaces, input.platform)) return 'S1'
    if (input.stillLooking) return 'S2w'
    if (input.canStartRide) return getReadyStatus(input)
    if (input.allRequiredSwitchedOff) return 'S8'

    const trainerStatus = getTrainerStatus(input)
    if (trainerStatus) return trainerStatus

    if (isPartialOutageShown(input)) return 'S1b'
    return getSearchingStatus(input)
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
    /** S2w: the capabilities the search is still looking for, in tile order */
    missing?: ReadonlyArray<string>
    /** S3 for the configured trainer, S7: the trainer's name */
    trainerName?: string
    /** S8: at least one of the switched-off capabilities still remembers its device, so it has a switch */
    switchedOffCanToggle?: boolean
    /** S2b: what the ride falls back to */
    fallbackCapability?: 'power' | 'speed'
}

export type PairingGuidanceId = PairingStatusId | 'row-required' | 'row-required-trainer' | 'row-ready' | 'row-optional'
    | 'row-searching-trainer' | 'row-searching-found'

export interface PairingGuidanceText {
    text: string
    link?: string
    subtext?: string
}

const formatList = (names: string[]): string => {
    if (names.length <= 1) return names.join('')
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
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

const SENSOR_NAMES: Record<string, string> = {
    heartrate: 'heart-rate monitor',
    cadence: 'cadence sensor',
    speed: 'speed sensor',
    power: 'power meter',
}

// names the most important thing still missing: the trainer, else the one sensor, else "other sensors"
const getStillLookingText = (device: string, missing: ReadonlyArray<string>, isShort: boolean): PairingGuidanceText => {
    if (missing.includes('control'))
        return isShort
            ? { text: `Found ${device}. Looking for a trainer…` }
            : { text: `Found ${device}. Still looking for a smart trainer: if you have one, pedal a few strokes to wake it up. No trainer? Stop searching.` }

    const sensors = missing.filter(c => SENSOR_NAMES[c] !== undefined).map(c => SENSOR_NAMES[c])
    if (sensors.length === 1)
        return isShort
            ? { text: `Found ${device}. Looking for a ${sensors[0]}…` }
            : { text: `Found ${device}. Still looking for a ${sensors[0]}. Don't have one? Stop searching.` }

    return isShort
        ? { text: `Found ${device}. Looking for other sensors…` }
        : { text: `Found ${device}. Still looking for other sensors, like a ${sensors[0] ?? SENSOR_NAMES.heartrate}. No more sensors? Stop searching.` }
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
        case 'ant':
            return { text: 'ANT+ stick not found. If you use one, plug it in, try another USB port, or close other apps that use it.' }
    }
}

const getReadyText = (device: string, rideMode: boolean | undefined, isShort: boolean): PairingGuidanceText => {
    if (isShort) return { text: `Ready to ride with ${device}.` }
    const tail = `You can add optional sensors, or press ${rideMode ? 'Start' : 'OK'}.`
    return { text: `Ready to ride with ${device}. ${tail}` }
}

const getReadyWithoutTrainerText = (device: string, isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: `Ready with ${device}. No trainer found.` }
        : { text: `Ready to ride with ${device}. No smart trainer found. Have one? Wake it up, then search again.` }

const getConnectingText = (device: string, isTrainer: boolean | undefined, isShort: boolean): PairingGuidanceText => {
    if (isTrainer)
        return { text: isShort ? `Connecting to ${device}…` : `Connecting to your trainer ${device}…` }
    return { text: `Connecting to ${device}…` }
}

const getReadyWithoutResistanceText = (device: string, isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: `Ready with ${device}. No resistance control.` }
        : { text: `Ready to ride with ${device}, without resistance control (Resistance is switched off).` }

const getFallbackText = (capability: PairingGuidanceParams['fallbackCapability'], isShort: boolean): PairingGuidanceText => {
    const sensor = capability === 'speed' ? SENSOR_NAMES.speed : SENSOR_NAMES.power
    return isShort
        ? { text: `Ready with ${sensor}. No resistance control.` }
        : { text: `Ready to ride with your ${sensor}, without resistance control, until you next open Devices.` }
}

const getFallbackRevertedText = (isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: 'Trainer connected. Resistance control is on.' }
        : { text: 'Your trainer connected. Resistance control is back on.' }

const getTrainerUnreachableText = (trainer: string, isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: `Can't reach ${trainer}. Pedal to wake it`, link: 'Not available?' }
        : { text: `Can't reach your trainer ${trainer}. Pedal a few strokes to wake it up.`, link: 'Not available today?' }

const getAllSwitchedOffText = (canToggle: boolean | undefined, isShort: boolean): PairingGuidanceText => {
    if (isShort)
        return { text: canToggle ? 'To ride: all switched off. Switch one on.' : 'To ride: all switched off. Tap one to choose.' }
    const remedy = canToggle ? 'Switch one back on to ride.' : 'Tap one to choose a device.'
    return { text: `Resistance, Power and Speed are all switched off. ${remedy}` }
}

const getStillSearchingText = (isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: 'Still searching', link: 'Need help?' }
        : { text: 'Still searching…', link: "Can't find your trainer?" }

const getSearchingText = (isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: 'Searching… Pedal to wake your trainer.' }
        : { text: 'Searching for devices… Tip: pedal a few strokes to wake up your trainer.' }

const getSearchEndedText = (isShort: boolean): PairingGuidanceText =>
    isShort
        ? { text: 'Nothing found. Wake it, then search again.' }
        : { text: 'Search finished, nothing found. Wake your trainer or sensor (pedal a few strokes or press a button), then search again.' }

const getRowLabelText = (id: PairingGuidanceId): PairingGuidanceText | undefined => {
    switch (id) {
        case 'row-required':
            return { text: 'TO RIDE', subtext: 'connect any one' }
        case 'row-required-trainer':
            return { text: 'TO RIDE', subtext: 'connecting to your trainer' }
        case 'row-ready':
            return { text: '✓ READY TO RIDE' }
        case 'row-optional':
            return { text: 'OPTIONAL', subtext: 'extras, not needed' }
        case 'row-searching-trainer':
            return { text: 'TO RIDE', subtext: 'still looking for a trainer' }
        case 'row-searching-found':
            return { text: 'TO RIDE', subtext: 'trainer found' }
        default:
            return undefined
    }
}

export const getPairingGuidanceText = (
    id: PairingGuidanceId,
    params: PairingGuidanceParams = {},
    variant: PairingTextVariant = 'full'
): PairingGuidanceText => {
    const rowLabel = getRowLabelText(id)
    if (rowLabel) return rowLabel

    const isShort = variant === 'short'
    const device = params.deviceName ?? ''

    switch (id as PairingStatusId) {
        case 'S1':
            return getNoSearchText(params, isShort)
        case 'S1b':
            return getHintText(params.hint!, isShort)
        case 'S2':
            return getReadyText(device, params.rideMode, isShort)
        case 'S2b':
            return getFallbackText(params.fallbackCapability, isShort)
        case 'S2c':
            return getFallbackRevertedText(isShort)
        case 'S2d':
            return getReadyWithoutResistanceText(device, isShort)
        case 'S2e':
            return getReadyWithoutTrainerText(device, isShort)
        case 'S2w':
            return getStillLookingText(device, params.missing ?? [], isShort)
        case 'S3':
            return getConnectingText(device, params.isTrainer, isShort)
        case 'S4':
            return { text: 'Getting ready to search…' }
        case 'S5':
            return getSearchingText(isShort)
        case 'S6':
            return getStillSearchingText(isShort)
        case 'S7':
            return getTrainerUnreachableText(params.trainerName ?? '', isShort)
        case 'S8':
            return getAllSwitchedOffText(params.switchedOffCanToggle, isShort)
        case 'S9':
            return getSearchEndedText(isShort)
    }
}

/**
 * The label of the ride row. While a search is still looking for more devices (`stillLooking`), it
 * says whether the trainer has been found; otherwise it follows whether a trainer is selected.
 */
export const getPairingRowLabelId = (trainerSelected: boolean, stillLooking: boolean = false): PairingGuidanceId => {
    if (stillLooking)
        return trainerSelected ? 'row-searching-found' : 'row-searching-trainer'
    return trainerSelected ? 'row-required-trainer' : 'row-required'
}

export const getCapabilityHelpText = (capability: string, variant: PairingTextVariant = 'full'): string | undefined => {
    const isShort = variant === 'short'
    switch (capability) {
        case 'control': return 'Smart trainer'
        case 'power': return 'Power meter'
        case 'speed': return 'Speed sensor'
        case 'heartrate': return 'Heart-rate monitor'
        case 'cadence': return 'Cadence sensor'
        case 'app_control': return isShort ? 'Remote buttons' : 'Remote buttons, e.g. Zwift Play'
        default: return undefined
    }
}

export const getEmptyTileFooterText = (role: PairingRole): string =>
    role === 'required' ? 'Searching…' : 'Optional'
