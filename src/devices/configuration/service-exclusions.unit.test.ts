/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The session exclusion primitive: excludeCapability/excludeDevice/includeCapability/
 * clearExclusions/getExclusions/getConfiguredSelection, and the effective-selection check
 * ("selected, not disabled, not excluded") those add next to the existing `disabled` check in
 * getSelected/getSelectedDevices/getAdapters(true)/getModeSettings/canStartRide.
 *
 * Nothing in the product creates an exclusion yet; these tests call the API directly.
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

describe('DeviceConfigurationService - session exclusions', () => {

    let service: DeviceConfigurationService

    beforeEach(() => {
        service = new DeviceConfigurationService()
        service.settings = {
            devices: [],
            capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false }))
        }
        service.adapters = {}
        service.emitCapabiltyChanged = jest.fn()
        service.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)
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

    describe('excludeCapability / excludeDevice / includeCapability / clearExclusions / getExclusions', () => {

        test('excludeCapability excludes only that capability, bound to its currently selected udid', () => {
            const udid = service.add(Trainer('1'))

            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            const exclusions = service.getExclusions()
            expect(exclusions).toHaveLength(1)
            expect(exclusions[0]).toMatchObject({ capability: IncyclistCapability.Control, udid, reason: 'not-available', scope: 'until-next-pairing', wasConnected: false })
        })

        test('excludeCapability does nothing if nothing is selected for that capability', () => {
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })
            expect(service.getExclusions()).toHaveLength(0)
        })

        test('excludeDevice excludes every capability the device is currently selected for (D3)', () => {
            const udid = service.add(Trainer('1')) // fills Control/Power/Speed/Cadence

            service.excludeDevice(udid, { reason: 'not-available', scope: 'until-next-pairing' })

            const excluded = service.getExclusions().map(e => e.capability).sort()
            expect(excluded).toEqual([IncyclistCapability.Cadence, IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Speed].sort())
        })

        test('excludeDevice does not exclude a capability the device is not selected for', () => {
            const udid = service.add(Trainer('1'))
            service.excludeDevice(udid, { reason: 'not-available', scope: 'until-next-pairing' })

            expect(service.getExclusions().some(e => e.capability === IncyclistCapability.HeartRate)).toBe(false)
        })

        test('includeCapability turns the exclusion back off without touching the persisted selection', () => {
            const udid = service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            service.includeCapability(IncyclistCapability.Control)

            expect(service.getExclusions()).toHaveLength(0)
            expect(service.getConfiguredSelection(IncyclistCapability.Control)).toBe(udid)
        })

        test('clearExclusions() with no filter clears everything', () => {
            const udid = service.add(Trainer('1'))
            service.excludeDevice(udid, { reason: 'not-available', scope: 'until-next-pairing' })

            service.clearExclusions()

            expect(service.getExclusions()).toHaveLength(0)
        })

        test('clearExclusions(filter) only clears matching entries', () => {
            const udid = service.add(Trainer('1'))
            service.excludeDevice(udid, { reason: 'not-available', scope: 'until-next-pairing' })

            service.clearExclusions({ capability: IncyclistCapability.Control })

            const remaining = service.getExclusions().map(e => e.capability)
            expect(remaining).not.toContain(IncyclistCapability.Control)
            expect(remaining).toContain(IncyclistCapability.Power)
        })

        test('excluding the same capability twice replaces, not duplicates, the entry', () => {
            const udid = service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'app-session' })

            const exclusions = service.getExclusions()
            expect(exclusions).toHaveLength(1)
            expect(exclusions[0]).toMatchObject({ udid, scope: 'app-session' })
        })

        test('picking a different device for an excluded capability clears the exclusion (bound to the udid)', () => {
            const first = service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            const second = service.add(Trainer('2'))
            service.select(second, IncyclistCapability.Control)

            expect(service.getExclusions()).toHaveLength(0)
            expect(service.getConfiguredSelection(IncyclistCapability.Control)).toBe(second)
            expect(first).not.toBe(second)
        })

        test('unselecting an excluded capability clears the exclusion', () => {
            service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            service.unselect(IncyclistCapability.Control)

            expect(service.getExclusions()).toHaveLength(0)
        })

        test('getConfiguredSelection returns the raw selected udid regardless of exclusion', () => {
            const udid = service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            expect(service.getConfiguredSelection(IncyclistCapability.Control)).toBe(udid)
        })
    })

    describe('exclusions never touch persisted settings', () => {

        test('raw settings are byte-identical before and after exclude/include', () => {
            service.add(Trainer('1'))
            const before = JSON.stringify(service.settings)

            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })
            expect(JSON.stringify(service.settings)).toBe(before)

            service.includeCapability(IncyclistCapability.Control)
            expect(JSON.stringify(service.settings)).toBe(before)
        })

        test('updateUserSettings() output never contains exclusion data', () => {
            const setSpy = jest.fn()
            service.inject('UserSettings', { set: setSpy, get: jest.fn(), save: jest.fn() } as any)

            service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })
            service.select(service.getConfiguredSelection(IncyclistCapability.Control) as string, IncyclistCapability.Power)

            const payloads = setSpy.mock.calls.map(([, value]) => JSON.stringify(value))
            expect(payloads.some(p => p?.includes('excluded'))).toBe(false)
            expect(payloads.some(p => p?.includes('not-available'))).toBe(false)
        })

        test('"pairing exclusion leaked" fires once on a forced leak, and stays silent otherwise', () => {
            const logEvent = jest.spyOn(service as any, 'logEvent')

            service.add(Trainer('1'))
            service.select(service.add(Trainer('2')), IncyclistCapability.Power) // ordinary update: no leak

            expect(logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'pairing exclusion leaked' }))

            // force the leak the invariant check guards against
            const controlSetting = service.settings.capabilities.find(c => c.capability === IncyclistCapability.Control) as any
            controlSetting.excluded = { reason: 'not-available', scope: 'until-next-pairing' }

            service.select(service.getConfiguredSelection(IncyclistCapability.Power) as string, IncyclistCapability.Power)
            expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ message: 'pairing exclusion leaked' }))

            logEvent.mockClear()
            service.select(service.getConfiguredSelection(IncyclistCapability.Power) as string, IncyclistCapability.Power)
            expect(logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'pairing exclusion leaked' }))
        })
    })

    describe('effective selection ("selected, not disabled, not excluded")', () => {

        test('getSelected(): an excluded trainer gives the same result as no trainer configured', () => {
            service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            expect(service.getSelected(IncyclistCapability.Control)).toBeUndefined()
        })

        test('getSelectedDevices(): omits an excluded capability', () => {
            service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            const list = service.getSelectedDevices()
            expect(list.find(d => d.capability === IncyclistCapability.Control)).toBeUndefined()
        })

        test('getAdapters(true): excludes an excluded capability\'s device', () => {
            const udid = service.add(Trainer('1'))
            service.excludeDevice(udid, { reason: 'not-available', scope: 'until-next-pairing' })

            expect(service.getAdapters(true)).toHaveLength(0)
        })

        test('getModeSettings() default chain skips an excluded Control and falls through to Power', () => {
            const trainerUdid = service.add(Trainer('1'))
            const pwrUdid = service.add(PowerMeter('2'))
            service.select(pwrUdid, IncyclistCapability.Power)
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            const info = service.getModeSettings()
            expect(info?.udid).toBe(pwrUdid)
            expect(info?.udid).not.toBe(trainerUdid)
        })

        test('canStartRide(): excluding the only selected capability gives the same result as no device configured (R1)', () => {
            service.add(Trainer('1'))
            expect(service.canStartRide()).toBe(true)

            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })
            service.excludeCapability(IncyclistCapability.Power, { reason: 'not-available', scope: 'until-next-pairing' })
            service.excludeCapability(IncyclistCapability.Speed, { reason: 'not-available', scope: 'until-next-pairing' })

            expect(service.canStartRide()).toBe(false)
        })

        test('canStartRide(): an unrelated connected Power meter still works once Control is excluded (R1)', () => {
            const trainerUdid = service.add(Trainer('1'))
            service.excludeDevice(trainerUdid, { reason: 'not-available', scope: 'until-next-pairing' })
            expect(service.canStartRide()).toBe(false)

            const pwrUdid = service.add(PowerMeter('2'))
            service.select(pwrUdid, IncyclistCapability.Power)

            expect(service.canStartRide()).toBe(true)
        })
    })

    describe('add() never auto-selects into an excluded slot', () => {

        test('a re-detected trainer does not re-fill an excluded Control slot', () => {
            const udid = service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            service.add(Trainer('1'))

            // the slot is still raw-selected to the same device - exclusion never clears `selected`,
            // and add() only ever looks at raw `selected`/`disabled`, never at exclusions
            expect(service.getConfiguredSelection(IncyclistCapability.Control)).toBe(udid)
            expect(service.getSelected(IncyclistCapability.Control)).toBeUndefined() // still excluded
        })

        test('a different newly detected trainer does not take over an excluded Control slot', () => {
            const first = service.add(Trainer('1'))
            service.excludeCapability(IncyclistCapability.Control, { reason: 'not-available', scope: 'until-next-pairing' })

            service.add(Trainer('2'))

            expect(service.getConfiguredSelection(IncyclistCapability.Control)).toBe(first)
        })
    })
})
