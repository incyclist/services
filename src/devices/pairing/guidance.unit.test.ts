import { IncyclistCapability } from "incyclist-devices"
import {
    PAIRING_CAPABILITY_ROLES, PARTIAL_OUTAGE_DEBOUNCE_MS, PairingInterfaceState, PairingStatusId, PairingStatusInput, PairingTileStateInput,
    canScanWithInterfaces, derivePairingStatus, getCapabilityHelpText, getEmptyTileFooterText, getPairingGuidanceText, getPairingHint, getPairingRowLabelId,
    getPairingTileState, getUnavailableInterfaces
} from "./guidance"

const up = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: true, available: true })
const down = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: true, available: false })
const off = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: false, available: false })

const mobile: PairingStatusInput = {
    platform: 'mobile',
    interfaces: [up('ble'), up('wifi')],
    anyDeviceSelected: false,
    initialising: false,
    searching: false,
    canStartRide: false,
}

const desktop: PairingStatusInput = {
    platform: 'desktop',
    interfaces: [up('ant'), up('ble'), up('serial'), up('tcpip')],
    anyDeviceSelected: false,
    initialising: false,
    searching: false,
    canStartRide: false,
}

// a partial outage that has held for long enough to be shown
const held = { partialOutageSince: 1000, now: 1000 + PARTIAL_OUTAGE_DEBOUNCE_MS }

describe('PAIRING_CAPABILITY_ROLES', () => {
    it('orders the required row first, then the optional row', () => {
        expect(PAIRING_CAPABILITY_ROLES.map(r => r.capability)).toEqual([
            IncyclistCapability.Control,
            IncyclistCapability.Power,
            IncyclistCapability.Speed,
            IncyclistCapability.HeartRate,
            IncyclistCapability.Cadence,
            IncyclistCapability.AppControl,
        ])
    })

    it('marks Resistance, Power and Speed as required and the rest as optional', () => {
        expect(PAIRING_CAPABILITY_ROLES.map(r => r.role)).toEqual([
            'required', 'required', 'required', 'optional', 'optional', 'optional'
        ])
    })
})

describe('interface helpers', () => {
    it('on mobile, any enabled available interface allows a scan', () => {
        expect(canScanWithInterfaces([down('ble'), up('wifi')], 'mobile')).toBe(true)
    })

    it('on desktop, only Bluetooth or ANT+ allow a scan', () => {
        expect(canScanWithInterfaces([down('ble'), down('ant'), up('serial'), up('tcpip')], 'desktop')).toBe(false)
    })

    it('on desktop, a working ANT+ allows a scan even if Bluetooth is down', () => {
        expect(canScanWithInterfaces([down('ble'), up('ant')], 'desktop')).toBe(true)
    })

    it('a disabled interface never counts as scanning', () => {
        expect(canScanWithInterfaces([off('ble'), down('wifi')], 'mobile')).toBe(false)
    })

    it('on desktop, a working Wi-Fi allows a scan even with ANT+ and Bluetooth both off - Wi-Fi (DirectConnect) genuinely scans and is always on outside Windows', () => {
        expect(canScanWithInterfaces([off('ant'), off('ble'), up('wifi')], 'desktop')).toBe(true)
    })

    it('lists only enabled unavailable interfaces, filtered per platform', () => {
        expect(getUnavailableInterfaces([down('ant'), off('serial'), up('ble'), down('wifi')], 'mobile')).toEqual(['ant', 'wifi'])
        expect(getUnavailableInterfaces([down('ant'), down('serial'), up('ble')], 'desktop')).toEqual(['ant'])
    })

    it('desktop never names Wi-Fi in the unavailable list, even when it is the one that is down - the rider has no control to point them to', () => {
        expect(getUnavailableInterfaces([down('ant'), down('ble'), down('wifi')], 'desktop')).toEqual(['ant', 'ble'])
    })
})

describe('derivePairingStatus', () => {
    it('mobile: returns S1 when no enabled interface is available, even if a device is ready', () => {
        expect(derivePairingStatus({ ...mobile, interfaces: [down('ble'), off('wifi')], canStartRide: true })).toBe('S1')
    })

    it('desktop: returns S1 when Bluetooth and ANT+ are both unavailable, even if serial works', () => {
        expect(derivePairingStatus({ ...desktop, interfaces: [down('ant'), down('ble'), up('serial')] })).toBe('S1')
    })

    it('desktop: does not return S1 when only ANT+ is down, but shows the ANT+ hint on first use', () => {
        expect(derivePairingStatus({ ...desktop, ...held, interfaces: [down('ant'), up('ble')] })).toBe('S1b')
    })

    it('desktop: does not return S1 when ANT+ and Bluetooth are off but Wi-Fi (always on outside Windows) can still scan', () => {
        expect(derivePairingStatus({ ...desktop, interfaces: [off('ant'), off('ble'), up('wifi')] })).toBe('S5')
    })

    it('desktop: a ride made ready via Wi-Fi only (e.g. the simulator) correctly reports S2, not S1', () => {
        expect(derivePairingStatus({ ...desktop, interfaces: [off('ant'), off('ble'), up('wifi')], canStartRide: true })).toBe('S2')
    })

    it('desktop: S1 still fires when Wi-Fi is down too - nothing at all can scan', () => {
        expect(derivePairingStatus({ ...desktop, interfaces: [off('ant'), off('ble'), down('wifi')] })).toBe('S1')
    })

    it('mobile: does not return S1 when only Wi-Fi is available, and shows the Bluetooth hint', () => {
        expect(derivePairingStatus({ ...mobile, ...held, interfaces: [down('ble'), up('wifi')] })).toBe('S1b')
    })

    it('returns S2 when the row is ready', () => {
        expect(derivePairingStatus({ ...mobile, canStartRide: true, readyDeviceName: 'Trainer' })).toBe('S2')
    })

    it('returns S3 when a device is connecting', () => {
        expect(derivePairingStatus({ ...mobile, connectingDeviceName: 'Neo', connectingIsTrainer: true })).toBe('S3')
    })

    it('returns S4 when the page is initialising', () => {
        expect(derivePairingStatus({ ...mobile, initialising: true })).toBe('S4')
    })

    it('returns S5 while searching with nothing found', () => {
        expect(derivePairingStatus({ ...mobile, searching: true })).toBe('S5')
    })

    it('returns S5 as the idle default', () => {
        expect(derivePairingStatus(mobile)).toBe('S5')
    })

    it('ranks S1 above S2', () => {
        expect(derivePairingStatus({ ...mobile, interfaces: [down('ble')], canStartRide: true, connectingDeviceName: 'X' })).toBe('S1')
    })

    it('ranks S2 above S3', () => {
        expect(derivePairingStatus({ ...mobile, canStartRide: true, connectingDeviceName: 'X' })).toBe('S2')
    })

    it('ranks S3 above S4', () => {
        expect(derivePairingStatus({ ...mobile, connectingDeviceName: 'X', initialising: true })).toBe('S3')
    })
})

describe('derivePairingStatus - status priority order', () => {
    // each row holds both neighbouring states' conditions at once; the higher one has to win
    const outage = { ...held, interfaces: [down('ble'), up('wifi')] }
    const ready = { canStartRide: true, readyDeviceName: 'PM' }
    const boundaries: Array<[string, Partial<PairingStatusInput>, PairingStatusId]> = [
        ['S1 over S2', { interfaces: [down('ble'), down('wifi')], ...ready }, 'S1'],
        ['S2 over S8', { ...ready, allRequiredSwitchedOff: true }, 'S2'],
        ['S8 over S3', { allRequiredSwitchedOff: true, connectingDeviceName: 'HRM' }, 'S8'],
        ['S3 over S7 while the trainer is still connecting', { trainerPhase: 'connecting', trainerName: 'Neo', connectingDeviceName: 'Neo' }, 'S3'],
        ['S7 over S3 once the trainer is unavailable', { trainerPhase: 'unavailable', trainerName: 'Neo', connectingDeviceName: 'Neo' }, 'S7'],
        ['S7 over S1b', { ...outage, trainerPhase: 'unavailable', trainerName: 'Neo' }, 'S7'],
        ['S1b over S4', { ...outage, initialising: true }, 'S1b'],
        ['S4 over S5', { initialising: true, searching: true }, 'S4'],
        ['S6 over S5 once the helper threshold is reached', { searching: true, helperThresholdReached: true }, 'S6'],
        // within the ready slot
        ['S2c over S2b', { ...ready, fallbackReverted: true, fallbackActive: true }, 'S2c'],
        ['S2b over S2d', { ...ready, fallbackActive: true, resistanceSwitchedOff: true }, 'S2b'],
        ['S2d over S2e', { ...ready, resistanceSwitchedOff: true, searchEndedWithoutTrainer: true }, 'S2d'],
        ['S2e over S2', { ...ready, searchEndedWithoutTrainer: true }, 'S2e'],
        // the search states
        ['S2w over S2', { ...ready, stillLooking: true }, 'S2w'],
        ['S7 over S9', { trainerPhase: 'unavailable', trainerName: 'Neo', searchEndedWithNothing: true }, 'S7'],
        ['S1b over S9', { ...outage, searchEndedWithNothing: true }, 'S1b'],
        ['S9 over S5', { searchEndedWithNothing: true }, 'S9'],
    ]

    it.each(boundaries)('%s', (_name, input, expected) => {
        expect(derivePairingStatus({ ...mobile, ...input })).toBe(expected)
    })

    it('while the trainer is still connecting, S3 holds even between its connection retries', () => {
        expect(derivePairingStatus({ ...mobile, trainerPhase: 'connecting', trainerName: 'Neo' })).toBe('S3')
    })

    it('S3 for any connecting device without a configured trainer', () => {
        expect(derivePairingStatus({ ...mobile, connectingDeviceName: 'PM' })).toBe('S3')
    })

    it('a connected trainer does not show S7', () => {
        expect(derivePairingStatus({ ...mobile, trainerPhase: 'connected', trainerName: 'Neo' })).toBe('S5')
    })
})

describe('getPairingGuidanceText', () => {
    describe('S1', () => {
        it('desktop with Bluetooth and ANT+ unavailable', () => {
            expect(getPairingGuidanceText('S1', { platform: 'desktop', unavailable: ['ble', 'ant'] })).toEqual({
                text: "Can't search: Bluetooth and ANT+ are both unavailable.",
                link: 'Check connections',
            })
        })

        it('desktop with a single unavailable interface', () => {
            expect(getPairingGuidanceText('S1', { platform: 'desktop', unavailable: ['ant'] }).text)
                .toBe("Can't search: ANT+ unavailable.")
        })

        it('mobile with Bluetooth off links to Bluetooth settings', () => {
            expect(getPairingGuidanceText('S1', { platform: 'mobile', unavailable: ['ble'] }, 'full')).toEqual({
                text: "Can't search: Bluetooth is off.",
                link: 'Bluetooth settings',
            })
        })

        it('mobile with Bluetooth off, short variant', () => {
            expect(getPairingGuidanceText('S1', { platform: 'mobile', unavailable: ['ble'] }, 'short')).toEqual({
                text: 'Bluetooth is off.',
                link: 'Settings',
            })
        })

        it('mobile with Wi-Fi and Bluetooth both off uses plural and generic settings link', () => {
            expect(getPairingGuidanceText('S1', { platform: 'mobile', unavailable: ['ble', 'wifi'] })).toEqual({
                text: "Can't search: Bluetooth and Wi-Fi are off.",
                link: 'Settings',
            })
        })
    })

    it('S2 full offers OK outside ride mode and Start inside it', () => {
        expect(getPairingGuidanceText('S2', { deviceName: 'Neo' }).text)
            .toBe('Ready to ride with Neo. You can add optional sensors, or press OK.')
        expect(getPairingGuidanceText('S2', { deviceName: 'Neo', rideMode: true }).text)
            .toBe('Ready to ride with Neo. You can add optional sensors, or press Start.')
    })

    it('S2 short drops the follow-up sentence', () => {
        expect(getPairingGuidanceText('S2', { deviceName: 'Neo' }, 'short').text)
            .toBe('Ready to ride with Neo.')
    })

    it('S3 names the trainer when the device is the configured trainer', () => {
        expect(getPairingGuidanceText('S3', { deviceName: 'Neo', isTrainer: true }).text)
            .toBe('Connecting to your trainer Neo…')
        expect(getPairingGuidanceText('S3', { deviceName: 'Neo', isTrainer: true }, 'short').text)
            .toBe('Connecting to Neo…')
    })

    it('S3 for another device', () => {
        expect(getPairingGuidanceText('S3', { deviceName: 'HRM' }).text).toBe('Connecting to HRM…')
    })

    it('S4 and S5 copy', () => {
        expect(getPairingGuidanceText('S4').text).toBe('Getting ready to search…')
        expect(getPairingGuidanceText('S5').text)
            .toBe('Searching for devices… Tip: pedal a few strokes to wake up your trainer.')
        expect(getPairingGuidanceText('S5', {}, 'short').text).toBe('Searching… Pedal to wake your trainer.')
    })

    it('row labels carry title and subtext separately', () => {
        expect(getPairingGuidanceText('row-required')).toEqual({ text: 'TO RIDE', subtext: 'connect any one' })
        expect(getPairingGuidanceText('row-required-trainer')).toEqual({ text: 'TO RIDE', subtext: 'connecting to your trainer' })
        expect(getPairingGuidanceText('row-ready')).toEqual({ text: '✓ READY TO RIDE' })
        expect(getPairingGuidanceText('row-optional')).toEqual({ text: 'OPTIONAL', subtext: 'extras, not needed' })
    })

    it('never emits a link for S2 to S5 or row labels', () => {
        for (const id of ['S2', 'S3', 'S4', 'S5', 'row-required', 'row-ready', 'row-optional'] as const)
            expect(getPairingGuidanceText(id).link).toBeUndefined()
    })
})

describe('getPairingGuidanceText - trainer, fallback and switched-off states', () => {
    it('S7 names the trainer and always carries the not-available link', () => {
        expect(getPairingGuidanceText('S7', { trainerName: 'Tacx Flux' })).toEqual({
            text: "Can't reach your trainer Tacx Flux. Pedal a few strokes to wake it up.",
            link: 'Not available today?',
        })
        expect(getPairingGuidanceText('S7', { trainerName: 'Tacx Flux' }, 'short')).toEqual({
            text: "Can't reach Tacx Flux. Pedal to wake it",
            link: 'Not available?',
        })
    })

    it('S8 with at least one switch to turn back on', () => {
        expect(getPairingGuidanceText('S8', { switchedOffCanToggle: true })).toEqual({
            text: 'Resistance, Power and Speed are all switched off. Switch one back on to ride.',
        })
        expect(getPairingGuidanceText('S8', { switchedOffCanToggle: true }, 'short')).toEqual({
            text: 'To ride: all switched off. Switch one on.',
        })
    })

    it('S8 with nothing remembered on any of them', () => {
        expect(getPairingGuidanceText('S8', { switchedOffCanToggle: false })).toEqual({
            text: 'Resistance, Power and Speed are all switched off. Tap one to choose a device.',
        })
        expect(getPairingGuidanceText('S8', { switchedOffCanToggle: false }, 'short')).toEqual({
            text: 'To ride: all switched off. Tap one to choose.',
        })
    })

    it('S2d says resistance is switched off', () => {
        expect(getPairingGuidanceText('S2d', { deviceName: 'Stages Power' })).toEqual({
            text: 'Ready to ride with Stages Power, without resistance control (Resistance is switched off).',
        })
        expect(getPairingGuidanceText('S2d', { deviceName: 'Stages Power' }, 'short')).toEqual({
            text: 'Ready with Stages Power. No resistance control.',
        })
    })

    it('S2b names the kind of device the ride falls back to', () => {
        expect(getPairingGuidanceText('S2b', { fallbackCapability: 'power' }).text)
            .toBe('Ready to ride with your power meter, without resistance control, until you next open Devices.')
        expect(getPairingGuidanceText('S2b', { fallbackCapability: 'power' }, 'short').text)
            .toBe('Ready with power meter. No resistance control.')
        expect(getPairingGuidanceText('S2b', { fallbackCapability: 'speed' }).text)
            .toBe('Ready to ride with your speed sensor, without resistance control, until you next open Devices.')
    })

    it('S2c says resistance control is back', () => {
        expect(getPairingGuidanceText('S2c')).toEqual({ text: 'Your trainer connected. Resistance control is back on.' })
        expect(getPairingGuidanceText('S2c', {}, 'short')).toEqual({ text: 'Trainer connected. Resistance control is on.' })
    })

    it('S6 keeps searching and offers help', () => {
        expect(getPairingGuidanceText('S6')).toEqual({ text: 'Still searching…', link: "Can't find your trainer?" })
        expect(getPairingGuidanceText('S6', {}, 'short')).toEqual({ text: 'Still searching', link: 'Need help?' })
    })
})

describe('getPairingHint (S1b)', () => {
    it('mobile: Bluetooth permission denied', () => {
        const interfaces = [{ id: 'ble' as const, enabled: true, available: false, permissionDenied: true }, up('wifi')]
        expect(getPairingHint({ platform: 'mobile', interfaces, anyDeviceSelected: false })).toBe('bluetooth-permission')
    })

    it('mobile: Bluetooth off while Wi-Fi works', () => {
        expect(getPairingHint({ platform: 'mobile', interfaces: [down('ble'), up('wifi')], anyDeviceSelected: false })).toBe('bluetooth-off')
    })

    it('mobile: Wi-Fi off while Bluetooth works gives no hint, because Wi-Fi-off detection is not verified yet', () => {
        expect(getPairingHint({ platform: 'mobile', interfaces: [up('ble'), down('wifi')], anyDeviceSelected: false })).toBeUndefined()
    })

    it('mobile: a disabled Wi-Fi never triggers a hint', () => {
        expect(getPairingHint({ platform: 'mobile', interfaces: [up('ble'), off('wifi')], anyDeviceSelected: false })).toBeUndefined()
    })

    it('desktop: ANT+ not working', () => {
        expect(getPairingHint({ platform: 'desktop', interfaces: [down('ant'), up('ble')], anyDeviceSelected: false })).toBe('ant')
    })

    it('desktop: Bluetooth, serial and TCP failures stay silent', () => {
        expect(getPairingHint({ platform: 'desktop', interfaces: [down('ble'), down('serial'), down('tcpip'), up('ant')], anyDeviceSelected: false })).toBeUndefined()
    })

    it('no hint once a device is selected', () => {
        expect(getPairingHint({ platform: 'desktop', interfaces: [down('ant')], anyDeviceSelected: true })).toBeUndefined()
    })

    it('derivePairingStatus returns S1b for a hint on first use, once it has held long enough', () => {
        expect(derivePairingStatus({ ...desktop, ...held, interfaces: [down('ant'), up('ble')] })).toBe('S1b')
    })

    it('no S1b before the hint has held long enough', () => {
        const input = { ...desktop, interfaces: [down('ant'), up('ble')] }
        expect(derivePairingStatus(input)).toBe('S5')
        expect(derivePairingStatus({ ...input, partialOutageSince: 1000, now: 1000 + PARTIAL_OUTAGE_DEBOUNCE_MS - 1 })).toBe('S5')
    })

    it('no S1b with any device selected, even once it would have held long enough', () => {
        expect(derivePairingStatus({ ...desktop, ...held, interfaces: [down('ant'), up('ble')], anyDeviceSelected: true })).toBe('S5')
    })

    it('S2 and S3 take precedence over S1b', () => {
        expect(derivePairingStatus({ ...mobile, ...held, interfaces: [down('ble'), up('wifi')], canStartRide: true })).toBe('S2')
        expect(derivePairingStatus({ ...mobile, ...held, interfaces: [down('ble'), up('wifi')], connectingDeviceName: 'X' })).toBe('S3')
    })

    it('S1 still wins when nothing can scan', () => {
        expect(derivePairingStatus({ ...mobile, ...held, interfaces: [down('ble'), down('wifi')] })).toBe('S1')
    })

    it('copy for each hint, full and short', () => {
        expect(getPairingGuidanceText('S1b', { hint: 'bluetooth-permission' }).link).toBe('Open settings')
        expect(getPairingGuidanceText('S1b', { hint: 'bluetooth-permission' }, 'short').text).toBe('Bluetooth not allowed.')
        expect(getPairingGuidanceText('S1b', { hint: 'bluetooth-off' })).toEqual({ text: "Bluetooth is off, so most trainers won't show up.", link: 'Bluetooth settings' })
        expect(getPairingGuidanceText('S1b', { hint: 'ant' }).text)
            .toBe('ANT+ stick not found. If you use one, plug it in, try another USB port, or close other apps that use it.')
        expect(getPairingGuidanceText('S1b', { hint: 'ant' }).link).toBeUndefined()
    })

    it('S1 mobile with Bluetooth denied does not say off', () => {
        expect(getPairingGuidanceText('S1', { platform: 'mobile', bluetoothDenied: true })).toEqual({
            text: "Can't search: Bluetooth is not allowed.",
            link: 'Open settings',
        })
    })
})

describe('getCapabilityHelpText', () => {
    it('gives the what-it-is line for each tile', () => {
        expect(getCapabilityHelpText('control')).toBe('Smart trainer')
        expect(getCapabilityHelpText('power')).toBe('Power meter')
        expect(getCapabilityHelpText('speed')).toBe('Speed sensor')
        expect(getCapabilityHelpText('heartrate')).toBe('Heart-rate monitor')
        expect(getCapabilityHelpText('cadence')).toBe('Cadence sensor')
    })

    it('controller has a longer full line and a short phone line', () => {
        expect(getCapabilityHelpText('app_control', 'full')).toBe('Remote buttons, e.g. Zwift Play')
        expect(getCapabilityHelpText('app_control', 'short')).toBe('Remote buttons')
    })

    it('returns undefined for an unknown capability', () => {
        expect(getCapabilityHelpText('unknown')).toBeUndefined()
    })
})

describe('getEmptyTileFooterText', () => {
    it('required empty tiles say searching', () => {
        expect(getEmptyTileFooterText('required')).toBe('Searching…')
    })

    it('optional empty tiles say optional', () => {
        expect(getEmptyTileFooterText('optional')).toBe('Optional')
    })
})

describe('getPairingTileState', () => {
    type Slot = 'empty' | 'trainer' | 'separate-connecting' | 'separate-connected'
    type Phase = PairingTileStateInput['trainerPhase']

    const TRAINER = 'trainer-1'

    const tile = (capability: string, slot: Slot, phase: Phase, extra: Partial<PairingTileStateInput> = {}): PairingTileStateInput => {
        const role = PAIRING_CAPABILITY_ROLES.find(r => r.capability === capability)?.role
        const trainerUdid = phase === undefined ? undefined : TRAINER
        const base: PairingTileStateInput = { capability, role, trainerPhase: phase, trainerUdid }
        switch (slot) {
            case 'empty': return { ...base, ...extra }
            case 'trainer': return { ...base, selected: TRAINER, connectState: 'connecting', ...extra }
            case 'separate-connecting': return { ...base, selected: 'pm-1', connectState: 'connecting', ...extra }
            case 'separate-connected': return { ...base, selected: 'pm-1', connectState: 'connected', separateSensor: true, ...extra }
        }
    }

    const optionalForNow = { full: 'Optional for now', short: 'Optional for now' }
    const tapToAdd = { full: 'Tap to add', short: 'Tap to add' }
    // the short footer must not repeat the role line ("via your trainer") right above it
    const waitingForTrainer = { full: 'Waiting for trainer', short: 'Waiting…' }
    const trainerWaiting = { full: 'Waiting to connect', short: 'Waiting…' }

    // power and speed tiles: trainer phase × what the tile holds × whether the rider said the trainer isn't available today
    it.each<[Phase, Slot, boolean, ReturnType<typeof getPairingTileState>]>([
        // no trainer: nothing about a trainer, an empty required tile is waited for
        [undefined, 'empty', false, { awaited: true }],
        [undefined, 'separate-connecting', false, { awaited: false }],
        [undefined, 'separate-connected', false, { awaited: false }],
        // the trainer is still connecting: empty tiles keep searching, the tile holding the trainer is plain
        ['connecting', 'empty', false, { awaited: true }],
        ['connecting', 'trainer', false, { awaited: false }],
        ['connecting', 'separate-connecting', false, { awaited: false }],
        ['connecting', 'separate-connected', false, { awaited: false }],
        // the trainer is connected: nothing about a trainer
        ['connected', 'empty', false, { awaited: true }],
        ['connected', 'trainer', false, { awaited: false }],
        ['connected', 'separate-connected', false, { awaited: false }],
        // the trainer can't be reached, before the rider said it isn't available today
        ['unavailable', 'empty', false, { footerText: optionalForNow, awaited: false }],
        ['unavailable', 'trainer', false, { trainerRole: 'via-trainer', roleLabel: 'via your trainer', footerText: waitingForTrainer, awaited: false }],
        ['unavailable', 'separate-connecting', false, { awaited: false }],
        ['unavailable', 'separate-connected', false, { trainerRole: 'separate', awaited: false }],
        // ... and after it, with no separate power meter or speed sensor connected
        ['unavailable', 'empty', true, { footerText: tapToAdd, awaited: true }],
        ['unavailable', 'trainer', true, { trainerRole: 'via-trainer', roleLabel: 'via your trainer', footerText: tapToAdd, awaited: true }],
        ['unavailable', 'separate-connecting', true, { awaited: false }],
        ['unavailable', 'separate-connected', true, { trainerRole: 'separate', awaited: false }],
    ])('power and speed, trainer %s, tile %s, not available today picked: %s', (phase, slot, picked, expected) => {
        expect(getPairingTileState(tile('power', slot, phase, { trainerUnavailablePicked: picked }))).toEqual(expected)
        expect(getPairingTileState(tile('speed', slot, phase, { trainerUnavailablePicked: picked }))).toEqual(expected)
    })

    it('once another power meter or speed sensor is connected, the other tiles are optional again after "not available today"', () => {
        const picked = { trainerUnavailablePicked: true, separateSensor: true }
        expect(getPairingTileState(tile('speed', 'empty', 'unavailable', picked))).toEqual({ footerText: optionalForNow, awaited: false })
        expect(getPairingTileState(tile('speed', 'trainer', 'unavailable', picked)))
            .toEqual({ trainerRole: 'via-trainer', roleLabel: 'via your trainer', footerText: waitingForTrainer, awaited: false })
    })

    it.each<[Phase, boolean, ReturnType<typeof getPairingTileState>]>([
        ['connecting', false, { awaited: true }],
        ['connected', false, { awaited: false }],
        ['unavailable', false, { trainerRole: 'trainer', roleLabel: 'Your trainer', footerText: trainerWaiting, awaited: true }],
        ['unavailable', true, { trainerRole: 'trainer', roleLabel: 'Your trainer', footerText: trainerWaiting, awaited: true }],
    ])('the Resistance tile holding the trainer, trainer %s, not available today picked: %s', (phase, picked, expected) => {
        expect(getPairingTileState(tile('control', 'trainer', phase, { trainerUnavailablePicked: picked }))).toEqual(expected)
    })

    it('an empty Resistance tile is waited for without a trainer', () => {
        expect(getPairingTileState(tile('control', 'empty', undefined))).toEqual({ awaited: true })
    })

    it.each(['heartrate', 'cadence'])('a %s tile holding the trainer waits for it, also after "not available today"', (capability) => {
        const expected = { trainerRole: 'via-trainer', roleLabel: 'via your trainer', footerText: waitingForTrainer, awaited: false }
        expect(getPairingTileState(tile(capability, 'trainer', 'unavailable'))).toEqual(expected)
        expect(getPairingTileState(tile(capability, 'trainer', 'unavailable', { trainerUnavailablePicked: true }))).toEqual(expected)
    })

    it.each(['heartrate', 'cadence', 'app_control'])('an empty or separate %s tile is unchanged while the trainer cannot be reached', (capability) => {
        expect(getPairingTileState(tile(capability, 'empty', 'unavailable', { trainerUnavailablePicked: true }))).toEqual({ awaited: false })
        expect(getPairingTileState(tile(capability, 'separate-connected', 'unavailable'))).toEqual({ awaited: false })
    })

    describe('precedence', () => {
        it.each<[string, Slot]>([
            ['control', 'trainer'], ['power', 'trainer'], ['power', 'empty'], ['speed', 'separate-connected'], ['cadence', 'trainer'],
        ])('a switched-off %s tile (%s) has no trainer state and is not waited for', (capability, slot) => {
            expect(getPairingTileState(tile(capability, slot, 'unavailable', { disabled: true, trainerUnavailablePicked: true }))).toEqual({ awaited: false })
            expect(getPairingTileState(tile(capability, slot, 'connecting', { disabled: true }))).toEqual({ awaited: false })
        })

        it('a switched-off tile without a remembered device has no trainer state and is not waited for', () => {
            expect(getPairingTileState(tile('power', 'empty', 'unavailable', { disabled: true }))).toEqual({ awaited: false })
            expect(getPairingTileState(tile('power', 'empty', undefined, { disabled: true }))).toEqual({ awaited: false })
        })

        it.each<[string, Slot]>([
            ['control', 'trainer'], ['power', 'trainer'], ['power', 'empty'], ['speed', 'separate-connected'], ['heartrate', 'trainer'],
        ])('while nothing can search, a %s tile (%s) has no trainer state and is not waited for', (capability, slot) => {
            expect(getPairingTileState(tile(capability, slot, 'unavailable', { noSearch: true, trainerUnavailablePicked: true }))).toEqual({ awaited: false })
            expect(getPairingTileState(tile(capability, slot, 'connecting', { noSearch: true }))).toEqual({ awaited: false })
            expect(getPairingTileState(tile(capability, slot, undefined, { noSearch: true }))).toEqual({ awaited: false })
        })

        it('nothing is waited for once the row is ready', () => {
            expect(getPairingTileState(tile('power', 'empty', undefined, { canStartRide: true }))).toEqual({ awaited: false })
            expect(getPairingTileState(tile('control', 'trainer', 'unavailable', { canStartRide: true })))
                .toEqual({ trainerRole: 'trainer', roleLabel: 'Your trainer', footerText: trainerWaiting, awaited: false })
        })
    })
})

describe('getPairingRowLabelId', () => {
    it('uses the any-one label when no trainer is selected', () => {
        expect(getPairingRowLabelId(false)).toBe('row-required')
    })

    it('uses the trainer label when a trainer is selected', () => {
        expect(getPairingRowLabelId(true)).toBe('row-required-trainer')
    })
})
