import { IncyclistCapability } from "incyclist-devices"
import { PAIRING_CAPABILITY_ROLES, derivePairingStatus, getPairingGuidanceText, getPairingRowLabelId, PairingStatusInput } from "./guidance"
import { isControlSelected } from "./model"

const base: PairingStatusInput = {
    canScan: true,
    initialising: false,
    searching: false,
    canStartRide: false,
}

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

describe('isControlSelected', () => {
    it('is false when there is no control capability', () => {
        expect(isControlSelected(undefined)).toBe(false)
    })

    it('is false when no udid is selected', () => {
        expect(isControlSelected({ selected: undefined })).toBe(false)
    })

    it('is true when a udid is selected, regardless of connect state', () => {
        expect(isControlSelected({ selected: 'trainer-1' })).toBe(true)
    })
})

describe('derivePairingStatus', () => {
    it('returns S1 when no interface can scan, even if a device is ready', () => {
        expect(derivePairingStatus({ ...base, canScan: false, canStartRide: true })).toBe('S1')
    })

    it('returns S2 when the row is ready', () => {
        expect(derivePairingStatus({ ...base, canStartRide: true, readyDeviceName: 'Trainer' })).toBe('S2')
    })

    it('returns S3 when a device is connecting', () => {
        expect(derivePairingStatus({ ...base, connectingDeviceName: 'Neo', connectingIsTrainer: true })).toBe('S3')
    })

    it('returns S4 when the page is initialising', () => {
        expect(derivePairingStatus({ ...base, initialising: true })).toBe('S4')
    })

    it('returns S5 while searching with nothing found', () => {
        expect(derivePairingStatus({ ...base, searching: true })).toBe('S5')
    })

    it('returns S5 as the idle default', () => {
        expect(derivePairingStatus(base)).toBe('S5')
    })

    it('ranks S1 above S2', () => {
        expect(derivePairingStatus({ ...base, canScan: false, canStartRide: true, connectingDeviceName: 'X' })).toBe('S1')
    })

    it('ranks S2 above S3', () => {
        expect(derivePairingStatus({ ...base, canStartRide: true, connectingDeviceName: 'X' })).toBe('S2')
    })

    it('ranks S3 above S4', () => {
        expect(derivePairingStatus({ ...base, connectingDeviceName: 'X', initialising: true })).toBe('S3')
    })
})

describe('getPairingGuidanceText', () => {
    it('S1 desktop names both interfaces and links to connections', () => {
        expect(getPairingGuidanceText('S1', { platform: 'desktop' })).toEqual({
            text: "Can't search: Bluetooth and ANT+ are both unavailable.",
            link: 'Check connections',
        })
    })

    it('S1 mobile full and short variants', () => {
        expect(getPairingGuidanceText('S1', { platform: 'mobile' }, 'full')).toEqual({
            text: "Can't search: Bluetooth is off.",
            link: 'Bluetooth settings',
        })
        expect(getPairingGuidanceText('S1', { platform: 'mobile' }, 'short')).toEqual({
            text: 'Bluetooth is off.',
            link: 'Settings',
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

    it('never emits a link for S4, S5 or row labels', () => {
        for (const id of ['S4', 'S5', 'row-required', 'row-ready', 'row-optional'] as const)
            expect(getPairingGuidanceText(id).link).toBeUndefined()
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
