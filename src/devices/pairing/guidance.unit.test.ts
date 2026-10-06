import { IncyclistCapability } from "incyclist-devices"
import {
    PAIRING_CAPABILITY_ROLES, PairingInterfaceState, PairingStatusInput,
    canScanWithInterfaces, derivePairingStatus, getPairingGuidanceText, getPairingRowLabelId, getUnavailableInterfaces
} from "./guidance"

const up = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: true, available: true })
const down = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: true, available: false })
const off = (id: PairingInterfaceState['id']): PairingInterfaceState => ({ id, enabled: false, available: false })

const base: PairingStatusInput = {
    interfaces: [up('ant'), up('ble')],
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
    it('a scan is possible when any enabled interface is available', () => {
        expect(canScanWithInterfaces([down('ant'), up('serial')])).toBe(true)
    })

    it('a disabled interface never counts as scanning', () => {
        expect(canScanWithInterfaces([off('ant'), down('ble')])).toBe(false)
    })

    it('lists only enabled interfaces that are unavailable', () => {
        expect(getUnavailableInterfaces([down('ant'), off('serial'), up('ble'), down('wifi')])).toEqual(['ant', 'wifi'])
    })
})

describe('derivePairingStatus', () => {
    it('returns S1 when no enabled interface is available, even if a device is ready', () => {
        expect(derivePairingStatus({ ...base, interfaces: [down('ant'), down('ble')], canStartRide: true })).toBe('S1')
    })

    it('returns S1 when every interface is disabled', () => {
        expect(derivePairingStatus({ ...base, interfaces: [off('ant'), off('ble')] })).toBe('S1')
    })

    it('does not return S1 when only one of several interfaces is down', () => {
        expect(derivePairingStatus({ ...base, interfaces: [down('ant'), up('ble')] })).toBe('S5')
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
        expect(derivePairingStatus({ ...base, interfaces: [down('ble')], canStartRide: true, connectingDeviceName: 'X' })).toBe('S1')
    })

    it('ranks S2 above S3', () => {
        expect(derivePairingStatus({ ...base, canStartRide: true, connectingDeviceName: 'X' })).toBe('S2')
    })

    it('ranks S3 above S4', () => {
        expect(derivePairingStatus({ ...base, connectingDeviceName: 'X', initialising: true })).toBe('S3')
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
            expect(getPairingGuidanceText('S1', { platform: 'desktop', unavailable: ['serial'] }).text)
                .toBe("Can't search: Serial unavailable.")
        })

        it('desktop with three or more unavailable interfaces lists them all', () => {
            expect(getPairingGuidanceText('S1', { platform: 'desktop', unavailable: ['ant', 'serial', 'tcpip'] }).text)
                .toBe("Can't search: ANT+, Serial and TCP/IP unavailable.")
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

        it('mobile with only Wi-Fi off uses the generic settings link', () => {
            expect(getPairingGuidanceText('S1', { platform: 'mobile', unavailable: ['wifi'] }).link).toBe('Settings')
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
