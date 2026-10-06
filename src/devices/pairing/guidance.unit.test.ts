import { IncyclistCapability } from "incyclist-devices"
import {
    PAIRING_CAPABILITY_ROLES, PairingInterfaceState, PairingStatusInput,
    canScanWithInterfaces, derivePairingStatus, getPairingGuidanceText, getPairingRowLabelId, getUnavailableInterfaces
} from "./guidance"

const up = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: true, available: true })
const down = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: true, available: false })
const off = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: false, available: false })

const mobile: PairingStatusInput = {
    platform: 'mobile',
    interfaces: [up('ble'), up('wifi')],
    initialising: false,
    searching: false,
    canStartRide: false,
}

const desktop: PairingStatusInput = {
    platform: 'desktop',
    interfaces: [up('ant'), up('ble'), up('serial'), up('tcpip')],
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

    it('lists only enabled unavailable interfaces, filtered per platform', () => {
        expect(getUnavailableInterfaces([down('ant'), off('serial'), up('ble'), down('wifi')], 'mobile')).toEqual(['ant', 'wifi'])
        expect(getUnavailableInterfaces([down('ant'), down('serial'), up('ble')], 'desktop')).toEqual(['ant'])
    })
})

describe('derivePairingStatus', () => {
    it('mobile: returns S1 when no enabled interface is available, even if a device is ready', () => {
        expect(derivePairingStatus({ ...mobile, interfaces: [down('ble'), off('wifi')], canStartRide: true })).toBe('S1')
    })

    it('desktop: returns S1 when Bluetooth and ANT+ are both unavailable, even if serial works', () => {
        expect(derivePairingStatus({ ...desktop, interfaces: [down('ant'), down('ble'), up('serial')] })).toBe('S1')
    })

    it('desktop: does not return S1 when only one of Bluetooth or ANT+ is down', () => {
        expect(derivePairingStatus({ ...desktop, interfaces: [down('ant'), up('ble')] })).toBe('S5')
    })

    it('mobile: does not return S1 when only Wi-Fi is available', () => {
        expect(derivePairingStatus({ ...mobile, interfaces: [down('ble'), up('wifi')] })).toBe('S5')
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

describe('getPairingRowLabelId', () => {
    it('uses the any-one label when no trainer is selected', () => {
        expect(getPairingRowLabelId(false)).toBe('row-required')
    })

    it('uses the trainer label when a trainer is selected', () => {
        expect(getPairingRowLabelId(true)).toBe('row-required-trainer')
    })
})
