/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { DevicePairingService } from './service'

// Devices found by a scan: empty slots are filled straight away and logged; a device that's
// newly known for a slot held by a different device raises a conflict, and nothing is replaced
// until the rider answers. The configuration service is real; ride and access are fakes.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]
const TRAINER_SHARED = [IncyclistCapability.Cadence, IncyclistCapability.Power, IncyclistCapability.Speed].sort()

class FakeRide extends EventEmitter {
    startAdapters = jest.fn().mockResolvedValue(true)
    stop = jest.fn().mockResolvedValue(true)
    cancelStart = jest.fn().mockResolvedValue(true)
    lazyInit = jest.fn().mockResolvedValue(true)
    waitForPreviousStartToFinish = jest.fn().mockResolvedValue(true)
    onData = jest.fn()
}

class FakeAccess extends EventEmitter {
    scan = jest.fn().mockResolvedValue([])
    stopScan = jest.fn().mockResolvedValue(true)
    enrichWithAccessState = jest.fn((ifs: any[]) => (ifs ?? []).map(i => ({ ...i, state: 'connected', isScanning: false })))
}

describe('DevicePairingService - devices found by a scan', () => {

    let configuration: DeviceConfigurationService
    let pairing: DevicePairingService
    let logEvent: jest.SpyInstance

    const detect = (settings: Record<string, unknown>): string => {
        (pairing as any).onDeviceDetected(settings)
        return configuration.getUdid(settings as any) as string
    }

    const events = (message: string) => logEvent.mock.calls.map(([e]) => e).filter((e: any) => e?.message === message)
    const selectedOf = (capability: IncyclistCapability) => configuration.getConfiguredSelection(capability)

    beforeEach(async () => {
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})

        configuration = new DeviceConfigurationService()
        configuration.settings = {
            devices: [],
            capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false })),
            interfaces: [{ name: 'ble', enabled: true }],
        }
        configuration.adapters = {}
        configuration.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)
        Inject('DeviceConfiguration', configuration)

        pairing = new DevicePairingService({ configuration, access: new FakeAccess(), ride: new FakeRide() } as any)
        pairing.usage = 'page'
        await (pairing as any).loadConfiguration()
        ;(pairing as any).initConfigHandlers()
        logEvent = jest.spyOn(pairing as any, 'logEvent')

        pairing.setVisitOpen(true)
    })

    afterEach(() => {
        pairing.removeAllListeners()
        pairing.reset()
        configuration.removeAllListeners()
        configuration.reset()
        Inject('DeviceConfiguration', null)
        AdapterFactory.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    describe('empty slots', () => {

        test('a power meter fills the empty Power, Speed and Cadence slots on its own', () => {
            const pwr = detect(PowerMeter('1'))

            expect(selectedOf(IncyclistCapability.Power)).toBe(pwr)
            expect(selectedOf(IncyclistCapability.Speed)).toBe(pwr)
            expect(selectedOf(IncyclistCapability.Cadence)).toBe(pwr)
        })

        test('each fill is logged as "device auto selected" with capability, rule and visitOpen', () => {
            detect(PowerMeter('1'))

            const logged = events('device auto selected')
            expect(logged.map((e: any) => e.capability).sort()).toEqual(TRAINER_SHARED)
            logged.forEach((e: any) => {
                expect(e).toMatchObject({ rule: 'new-rule', visitOpen: true })
                expect(Object.keys(e).sort()).toEqual(['capability', 'message', 'rule', 'ts', 'visitOpen'])
            })
        })

        test('a trainer\'s fills are logged with rule "control"', () => {
            detect(Trainer('1'))

            const logged = events('device auto selected')
            expect(logged.map((e: any) => e.capability)).toContain(IncyclistCapability.Control)
            logged.forEach((e: any) => expect(e.rule).toBe('control'))
        })

        test('visitOpen is false when no visit is open', () => {
            pairing.setVisitOpen(false)
            detect(PowerMeter('1'))

            events('device auto selected').forEach((e: any) => expect(e.visitOpen).toBe(false))
        })
    })

    describe('conflicts', () => {

        test('a newly detected trainer meeting a power meter in Power/Speed/Cadence raises a conflict and replaces nothing', () => {
            const pwr = detect(PowerMeter('1'))
            const onConflict = jest.fn()
            pairing.on('selection-conflict', onConflict)

            const trainer = detect(Trainer('2'))

            expect(selectedOf(IncyclistCapability.Control)).toBe(trainer)
            expect(selectedOf(IncyclistCapability.Power)).toBe(pwr)
            expect(selectedOf(IncyclistCapability.Speed)).toBe(pwr)
            expect(selectedOf(IncyclistCapability.Cadence)).toBe(pwr)

            expect(onConflict).toHaveBeenCalledTimes(1)
            const conflict = onConflict.mock.calls[0][0]
            expect(conflict).toMatchObject({ origin: 'detection', filled: [IncyclistCapability.Control] })
            expect(conflict.conflicts.map((c: any) => c.capability).sort()).toEqual(TRAINER_SHARED)
            expect(pairing.getPendingConflicts()).toEqual([conflict])
        })

        test('the reverse also raises one: a newly detected power meter meeting a trainer in Power', () => {
            const trainer = detect(Trainer('1'))
            detect(PowerMeter('2'))

            const [conflict] = pairing.getPendingConflicts()
            expect(conflict.conflicts.map(c => c.capability).sort()).toEqual(TRAINER_SHARED)
            expect(conflict.filled).toEqual([])
            expect(selectedOf(IncyclistCapability.Power)).toBe(trainer)
        })

        test('re-detecting a device that is already known never raises a conflict', () => {
            detect(Trainer('1'))
            detect(PowerMeter('2'))
            pairing.dismissConflict(pairing.getPendingConflicts()[0].id)

            detect(PowerMeter('2'))
            detect(Trainer('1'))

            expect(pairing.getPendingConflicts()).toEqual([])
            expect(events('device select conflict shown')).toHaveLength(1)
        })

        test('a switched-off slot is not part of a conflict', () => {
            detect(Trainer('1'))
            configuration.disableCapability(IncyclistCapability.Power)

            detect(PowerMeter('2'))

            const [conflict] = pairing.getPendingConflicts()
            expect(conflict.conflicts.map(c => c.capability)).not.toContain(IncyclistCapability.Power)
        })

        test('readiness keeps using the current selection while a conflict is pending', () => {
            detect(PowerMeter('1'))
            const before = configuration.getSelectedDevices()

            detect(Trainer('2'))

            const after = configuration.getSelectedDevices()
            expect(after.filter(d => d.capability !== IncyclistCapability.Control)).toEqual(
                before.filter(d => d.capability !== IncyclistCapability.Control))
        })

        test('the queue keeps one entry per device, oldest first', () => {
            detect(Trainer('1'))
            detect(PowerMeter('2'))
            detect(PowerMeter('3'))

            const pending = pairing.getPendingConflicts()
            expect(pending).toHaveLength(2)
            expect(pending[0].id).not.toBe(pending[1].id)
        })

        test('"device select conflict shown" carries capability names and counts only', () => {
            detect(Trainer('1'))
            detect(PowerMeter('2'))
            detect(PowerMeter('3'))

            const shown = events('device select conflict shown')
            expect(shown).toHaveLength(2)
            expect(shown[0]).toMatchObject({ origin: 'detection', conflictCount: 3, queued: 0 })
            expect(shown[1]).toMatchObject({ queued: 1 })
            expect(shown[0].conflictCapabilities.split(',').sort()).toEqual(TRAINER_SHARED)
            expect(JSON.stringify(shown)).not.toMatch(/trainer-|pwr-/)
        })

        test('with no visit open, a conflict is not queued: the current selection is kept and logged as left_page', () => {
            pairing.setVisitOpen(false)
            detect(Trainer('1'))
            detect(PowerMeter('2'))

            expect(pairing.getPendingConflicts()).toEqual([])
            expect(events('device select conflict shown')).toHaveLength(1)
            expect(events('device select conflict resolved')).toEqual([
                expect.objectContaining({ origin: 'detection', resolution: 'left_page', replacedCount: 0, conflictCount: 3 })
            ])
        })
    })

    describe('closing the visit', () => {

        test('every pending conflict is resolved as left_page and nothing is replaced', () => {
            const trainer = detect(Trainer('1'))
            detect(PowerMeter('2'))
            detect(PowerMeter('3'))

            pairing.setVisitOpen(false)

            expect(pairing.getPendingConflicts()).toEqual([])
            const resolved = events('device select conflict resolved')
            expect(resolved).toHaveLength(2)
            resolved.forEach((e: any) => expect(e).toMatchObject({ origin: 'detection', resolution: 'left_page', replacedCount: 0 }))
            expect(selectedOf(IncyclistCapability.Power)).toBe(trainer)
        })

        test('closing twice does not log them twice', () => {
            detect(Trainer('1'))
            detect(PowerMeter('2'))

            pairing.setVisitOpen(false)
            pairing.setVisitOpen(false)

            expect(events('device select conflict resolved')).toHaveLength(1)
        })
    })

    describe('resolveConflict()', () => {

        test('replaces only the listed capabilities and keeps the others', async () => {
            const trainer = detect(Trainer('1'))
            const pwr = detect(PowerMeter('2'))
            const [conflict] = pairing.getPendingConflicts()

            await pairing.resolveConflict(conflict.id, [IncyclistCapability.Power])

            expect(selectedOf(IncyclistCapability.Power)).toBe(pwr)
            expect(selectedOf(IncyclistCapability.Speed)).toBe(trainer)
            expect(selectedOf(IncyclistCapability.Cadence)).toBe(trainer)
            expect(pairing.getPendingConflicts()).toEqual([])
            expect(events('device select conflict resolved')).toEqual([
                expect.objectContaining({ origin: 'detection', resolution: 'done', replacedCount: 1, conflictCount: 3 })
            ])
        })

        test('with nothing listed, keeps everything', async () => {
            const trainer = detect(Trainer('1'))
            detect(PowerMeter('2'))
            const [conflict] = pairing.getPendingConflicts()

            await pairing.resolveConflict(conflict.id, [])

            expect(selectedOf(IncyclistCapability.Power)).toBe(trainer)
            expect(events('device select conflict resolved')[0]).toMatchObject({ resolution: 'done', replacedCount: 0 })
        })

        test('a row whose slot changed since the conflict was raised is left alone', async () => {
            detect(Trainer('1'))
            const pwr = detect(PowerMeter('2'))
            const [conflict] = pairing.getPendingConflicts()
            configuration.disableCapability(IncyclistCapability.Power) // the rider switched Power off meanwhile

            await pairing.resolveConflict(conflict.id, [IncyclistCapability.Power])

            expect(selectedOf(IncyclistCapability.Power)).not.toBe(pwr)
            expect(events('device select conflict resolved')[0]).toMatchObject({ replacedCount: 0 })
        })

        test('an unknown id does nothing', async () => {
            await pairing.resolveConflict('unknown', [IncyclistCapability.Power])
            expect(events('device select conflict resolved')).toEqual([])
        })
    })

    describe('dismissConflict()', () => {

        test('keeps the current selection and logs the dismissal', () => {
            const trainer = detect(Trainer('1'))
            detect(PowerMeter('2'))
            const [conflict] = pairing.getPendingConflicts()

            pairing.dismissConflict(conflict.id, 'dismissed')

            expect(selectedOf(IncyclistCapability.Power)).toBe(trainer)
            expect(pairing.getPendingConflicts()).toEqual([])
            expect(events('device select conflict resolved')).toEqual([
                expect.objectContaining({ origin: 'detection', resolution: 'dismissed', replacedCount: 0, conflictCount: 3 })
            ])
        })
    })
})
