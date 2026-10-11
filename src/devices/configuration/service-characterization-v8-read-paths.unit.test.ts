/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pins today's behaviour of DeviceConfigurationService's selection-reading methods
 * (getSelected, getSelectedDevices, getAdapters(true), canStartRide) with and without a
 * disabled capability, before any change to how they treat `disabled`.
 *
 * getModeSettings()'s own disabled handling is covered next to its implementation in
 * service.unit.test.ts, not here.
 */
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from "incyclist-devices"
import { DeviceConfigurationService } from "./service"
import { ExtendedIncyclistCapability } from "./model"

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

describe('DeviceConfigurationService - baseline: selection-reading methods vs. disabled', () => {

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

    describe('getSelected()', () => {

        test('returns the adapter when the capability is not disabled', () => {
            service.add(Trainer('1'))
            expect(service.getSelected(IncyclistCapability.Control)).toBeDefined()
        })

        test('returns undefined when the capability is disabled, even with a remembered device', () => {
            service.add(Trainer('1'))
            service.disableCapability(IncyclistCapability.Control, true)

            expect(service.getSelected(IncyclistCapability.Control)).toBeUndefined()
        })
    })

    describe('getSelectedDevices()', () => {

        test('lists a non-disabled selected capability', () => {
            service.add(Trainer('1'))
            const list = service.getSelectedDevices()
            expect(list.find(d => d.capability === IncyclistCapability.Control)).toBeDefined()
        })

        test('omits a disabled capability, even with a remembered device', () => {
            service.add(Trainer('1'))
            service.disableCapability(IncyclistCapability.Control, true)

            const list = service.getSelectedDevices()
            expect(list.find(d => d.capability === IncyclistCapability.Control)).toBeUndefined()
        })
    })

    describe('getAdapters(true) (onlySelected)', () => {

        test('includes a non-disabled selected device', () => {
            const udid = service.add(Trainer('1'))
            const adapters = service.getAdapters(true)
            expect(adapters.some(a => a.udid === udid)).toBe(true)
        })

        test('excludes a disabled capability\'s device', () => {
            const udid = service.add(Trainer('1'))
            service.disableCapability(IncyclistCapability.Control, true)
            service.disableCapability(IncyclistCapability.Power, true)
            service.disableCapability(IncyclistCapability.Speed, true)
            service.disableCapability(IncyclistCapability.Cadence, true)

            const adapters = service.getAdapters(true)
            expect(adapters.some(a => a.udid === udid)).toBe(false)
        })
    })

    describe('canStartRide()', () => {

        test('true with a non-disabled selected Control device', () => {
            service.add(Trainer('1'))
            expect(service.canStartRide()).toBe(true)
        })

        test('false when the only selected capability (Control) is disabled', () => {
            service.add(Trainer('1'))
            service.disableCapability(IncyclistCapability.Control, true)
            service.disableCapability(IncyclistCapability.Power, true)
            service.disableCapability(IncyclistCapability.Speed, true)

            expect(service.canStartRide()).toBe(false)
        })
    })
})
