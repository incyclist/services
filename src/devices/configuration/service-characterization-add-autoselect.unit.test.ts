/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pins today's DeviceConfigurationService.add() auto-select behaviour across device types,
 * slot states and newly-known vs. already-known devices, before any change to that logic.
 *
 * Device settings use real adapters via AdapterFactory (not hand-rolled mocks), so each
 * device's actual capability set (Control/Power/Speed/Cadence for a trainer, Power/Speed/
 * Cadence for a power meter, Speed/Cadence for CSC, HeartRate for an HRM, AppControl for a
 * Zwift Play controller) comes from the real `incyclist-devices` adapters.
 *
 * Capabilities are pre-seeded the way `init()` leaves them in production (including
 * `app_control`, which `add()`'s own `initCapabilties()` does not create) so `add()` is
 * exercised exactly as it runs against a real, initialized configuration.
 */
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from "incyclist-devices"
import { DeviceConfigurationService } from "./service"
import { ExtendedIncyclistCapability } from "./model"

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })
const Csc = (id: string) => ({ interface: 'ble', name: `csc-${id}`, address: id, protocol: 'csc' })
const Hrm = (id: string) => ({ interface: 'ble', name: `hrm-${id}`, address: id, protocol: 'hr' })
const ZwiftPlay = (id: string) => ({ interface: 'ble', name: `zp-${id}`, address: id, protocol: 'zwift-play' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

describe('DeviceConfigurationService.add() - baseline auto-select matrix', () => {

    let service: DeviceConfigurationService

    beforeEach(() => {
        service = new DeviceConfigurationService()
        service.settings = {
            devices: [],
            capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false }))
        }
        service.adapters = {}
        service.updateUserSettings = jest.fn()
        service.emitCapabiltyChanged = jest.fn()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})
    })

    afterEach(() => {
        AdapterFactory.reset()
        service.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    const selectedOf = (capability: IncyclistCapability) =>
        service.settings.capabilities.find(c => c.capability === capability)?.selected

    const devicesOf = (capability: IncyclistCapability) =>
        service.settings.capabilities.find(c => c.capability === capability)?.devices

    describe('empty, non-disabled slot - newly known device', () => {

        test('trainer fills Control, Power, Speed and Cadence', () => {
            const udid = service.add(Trainer('1'))

            expect(selectedOf(IncyclistCapability.Control)).toBe(udid)
            expect(selectedOf(IncyclistCapability.Power)).toBe(udid)
            expect(selectedOf(IncyclistCapability.Speed)).toBe(udid)
            expect(selectedOf(IncyclistCapability.Cadence)).toBe(udid)
        })

        test('HRM fills HeartRate', () => {
            const udid = service.add(Hrm('1'))
            expect(selectedOf(IncyclistCapability.HeartRate)).toBe(udid)
        })

        test('power meter does NOT fill empty Power/Speed/Cadence slots (only control-capable devices and heart-rate monitors auto-select today)', () => {
            const udid = service.add(PowerMeter('1'))

            expect(selectedOf(IncyclistCapability.Power)).toBeUndefined()
            expect(selectedOf(IncyclistCapability.Speed)).toBeUndefined()
            expect(selectedOf(IncyclistCapability.Cadence)).toBeUndefined()
            // it is still listed as a known device for those capabilities
            expect(devicesOf(IncyclistCapability.Power)).toContain(udid)
        })

        test('CSC does NOT fill empty Speed/Cadence slots (only control-capable devices and heart-rate monitors auto-select today)', () => {
            const udid = service.add(Csc('1'))

            expect(selectedOf(IncyclistCapability.Speed)).toBeUndefined()
            expect(selectedOf(IncyclistCapability.Cadence)).toBeUndefined()
            expect(devicesOf(IncyclistCapability.Speed)).toContain(udid)
        })

        test('Zwift Play controller does NOT fill empty app_control slot (only control-capable devices and heart-rate monitors auto-select today)', () => {
            const udid = service.add(ZwiftPlay('1'))
            expect(selectedOf(IncyclistCapability.AppControl)).toBeUndefined()
            expect(devicesOf(IncyclistCapability.AppControl)).toContain(udid)
        })
    })

    describe('empty, non-disabled slot - re-detecting an already known device', () => {

        test('trainer re-detected after settings already exist stays selected (idempotent)', () => {
            const udid = service.add(Trainer('1'))
            const second = service.add(Trainer('1'))

            expect(second).toBe(udid)
            expect(selectedOf(IncyclistCapability.Control)).toBe(udid)
        })

        test('power meter re-detected still does NOT fill empty Power slot (only control-capable devices and heart-rate monitors auto-select today)', () => {
            const udid = service.add(PowerMeter('1'))
            service.add(PowerMeter('1'))

            expect(selectedOf(IncyclistCapability.Power)).toBeUndefined()
            expect(devicesOf(IncyclistCapability.Power)).toContain(udid)
        })
    })

    describe('slot occupied by a different device - never overwritten', () => {

        test('a power meter detected after a trainer never replaces the trainer in Power/Speed/Cadence', () => {
            const trainerUdid = service.add(Trainer('1'))
            service.add(PowerMeter('2'))

            expect(selectedOf(IncyclistCapability.Power)).toBe(trainerUdid)
            expect(selectedOf(IncyclistCapability.Speed)).toBe(trainerUdid)
            expect(selectedOf(IncyclistCapability.Cadence)).toBe(trainerUdid)
        })

        test('a trainer detected after a power meter already holds Power never replaces it', () => {
            // today, the power meter never auto-fills Power by itself, so this sets up the
            // occupied slot via a manual select() rather than add()
            const pwrUdid = service.add(PowerMeter('1'))
            service.select(pwrUdid, IncyclistCapability.Power)

            service.add(Trainer('2'))

            expect(selectedOf(IncyclistCapability.Power)).toBe(pwrUdid)
        })

        test('a second trainer never replaces the first trainer\'s Control/Power/Speed/Cadence', () => {
            const first = service.add(Trainer('1'))
            service.add(Trainer('2'))

            expect(selectedOf(IncyclistCapability.Control)).toBe(first)
            expect(selectedOf(IncyclistCapability.Power)).toBe(first)
            expect(selectedOf(IncyclistCapability.Speed)).toBe(first)
            expect(selectedOf(IncyclistCapability.Cadence)).toBe(first)
        })

        test('a Zwift Play controller never replaces another controller already selected for app_control', () => {
            const first = service.add(ZwiftPlay('1'))
            service.select(first, IncyclistCapability.AppControl)

            service.add(ZwiftPlay('2'))

            expect(selectedOf(IncyclistCapability.AppControl)).toBe(first)
        })
    })

    describe('disabled capability with a remembered device - add() never touches it', () => {

        test('a re-detected trainer does not re-select into a disabled Control slot', () => {
            const udid = service.add(Trainer('1'))
            service.disableCapability(IncyclistCapability.Control, true)
            expect(selectedOf(IncyclistCapability.Control)).toBe(udid) // disabling keeps the remembered selection

            service.add(Trainer('1'))

            expect(service.settings.capabilities.find(c => c.capability === IncyclistCapability.Control)?.disabled).toBe(true)
            expect(selectedOf(IncyclistCapability.Control)).toBe(udid)
        })

        test('a different newly detected trainer does not fill a disabled Control slot even though it is now empty-equivalent', () => {
            const first = service.add(Trainer('1'))
            service.disableCapability(IncyclistCapability.Control, true)

            service.add(Trainer('2'))

            expect(selectedOf(IncyclistCapability.Control)).toBe(first)
            expect(service.settings.capabilities.find(c => c.capability === IncyclistCapability.Control)?.disabled).toBe(true)
        })
    })

    describe('disabled capability, nothing remembered (T16b) - add() never fills it', () => {

        test('a trainer detected while Control is disabled with no remembered device stays empty', () => {
            service.disableCapability(IncyclistCapability.Control, true)
            expect(selectedOf(IncyclistCapability.Control)).toBeUndefined()

            service.add(Trainer('1'))

            expect(selectedOf(IncyclistCapability.Control)).toBeUndefined()
            expect(service.settings.capabilities.find(c => c.capability === IncyclistCapability.Control)?.disabled).toBe(true)
        })

        test('an HRM detected while HeartRate is disabled with no remembered device stays empty', () => {
            service.disableCapability(IncyclistCapability.HeartRate, true)

            service.add(Hrm('1'))

            expect(selectedOf(IncyclistCapability.HeartRate)).toBeUndefined()
        })
    })
})
