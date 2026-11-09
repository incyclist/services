/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { DevicePairingService } from './service'

// Pending conflicts after the rider changed a selection somewhere else, a conflict whose slots
// changed before it was answered, and the conflict step of a pick in the Resistance list. The
// configuration service is real; ride and access are fakes.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]
const { Control, Power, Speed, Cadence } = IncyclistCapability

class FakeRide extends EventEmitter {
    startAdapters = jest.fn().mockResolvedValue(true)
    stop = jest.fn().mockResolvedValue(true)
    stopDevices = jest.fn().mockResolvedValue(undefined)
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

describe('DevicePairingService - conflicts and later selection changes', () => {

    let configuration: DeviceConfigurationService
    let pairing: DevicePairingService
    let logEvent: jest.SpyInstance

    const detect = (settings: Record<string, unknown>): string => {
        (pairing as any).onDeviceDetected(settings)
        return configuration.getUdid(settings as any) as string
    }

    const events = (message: string) => logEvent.mock.calls.map(([e]) => e).filter((e: any) => e?.message === message)
    const selectedOf = (capability: IncyclistCapability) => configuration.getConfiguredSelection(capability)
    const rowsOf = (index = 0) => pairing.getPendingConflicts()[index]?.conflicts.map(c => c.capability).sort()

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

    afterEach(async () => {
        await pairing.stop([], true)
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

    describe('reevaluatePendingConflicts()', () => {

        // the power meter found first holds Power (Cadence switched off); the trainer is found next
        const powerMeterThenTrainer = (opts: { speed: boolean } = { speed: false }) => {
            configuration.disableCapability(Cadence)
            if (!opts.speed)
                configuration.disableCapability(Speed)
            const pwr = detect(PowerMeter('1'))
            const trainer = detect(Trainer('2'))
            return { pwr, trainer }
        }

        test('a conflict the rider settled by picking the found device in that slot goes, logged as superseded', async () => {
            const { trainer } = powerMeterThenTrainer()
            expect(rowsOf()).toEqual([Power])

            await pairing.selectDevice(Power, trainer, false)
            pairing.reevaluatePendingConflicts([Power])

            expect(pairing.getPendingConflicts()).toEqual([])
            expect(events('device select conflict resolved')).toEqual([
                expect.objectContaining({ origin: 'detection', resolution: 'superseded', replacedCount: 0, conflictCount: 1 })
            ])
            expect(events('device select conflict stale')).toEqual([])
        })

        test('with two rows, settling one keeps the other', async () => {
            const { pwr, trainer } = powerMeterThenTrainer({ speed: true })
            expect(rowsOf()).toEqual([Power, Speed].sort())

            await pairing.selectDevice(Power, trainer, false)
            pairing.reevaluatePendingConflicts([Power])

            const [conflict] = pairing.getPendingConflicts()
            expect(conflict.conflicts).toEqual([{ capability: Speed, currentName: configuration.getAdapter(pwr)?.getUniqueName() ?? expect.any(String) }])
            expect(events('device select conflict resolved')).toEqual([])
        })

        test('a slot the rider switched off drops out', () => {
            powerMeterThenTrainer({ speed: true })

            configuration.disableCapability(Power)
            pairing.reevaluatePendingConflicts([Power])

            expect(rowsOf()).toEqual([Speed])
        })

        test('a slot that became empty drops out and is not filled from the conflict', async () => {
            const { pwr } = powerMeterThenTrainer({ speed: true })

            await pairing.deleteDevice(Power, pwr)
            pairing.reevaluatePendingConflicts([Power])

            expect(rowsOf()).toEqual([Speed])
            expect(selectedOf(Power)).toBeFalsy()
        })

        test('a row still held by a different device stays, with that device\'s name', async () => {
            powerMeterThenTrainer()
            const other = configuration.add(PowerMeter('3'))

            await pairing.selectDevice(Power, other, false)
            pairing.reevaluatePendingConflicts([Power])

            const [conflict] = pairing.getPendingConflicts()
            expect(conflict.conflicts.map(c => c.capability)).toEqual([Power])
            expect(conflict.conflicts[0].currentName).toBe(configuration.getAdapter(other)?.getUniqueName())
        })

        test('never adds a row: a slot the entry doesn\'t list stays out of it', async () => {
            powerMeterThenTrainer()
            const other = configuration.add(PowerMeter('3'))
            configuration.disableCapability(Speed, false)

            await pairing.selectDevice(Speed, other, false)
            pairing.reevaluatePendingConflicts([Speed])
            pairing.reevaluatePendingConflicts()

            expect(rowsOf()).toEqual([Power])
        })

        test('an entry that doesn\'t list a changed capability is left alone', () => {
            const { trainer } = powerMeterThenTrainer()
            configuration.select(trainer, Power)  // settled, but not reported as changed

            pairing.reevaluatePendingConflicts([Speed])

            expect(rowsOf()).toEqual([Power])
        })

        test('without a list of changes, every entry is checked', () => {
            const { trainer } = powerMeterThenTrainer()
            configuration.select(trainer, Power)

            pairing.reevaluatePendingConflicts()

            expect(pairing.getPendingConflicts()).toEqual([])
        })

        test('only removes the entry it settled: the others keep their place in the queue', async () => {
            configuration.disableCapability(Cadence)
            configuration.disableCapability(Speed)
            detect(Trainer('1'))
            detect(PowerMeter('2'))
            const pwr3 = detect(PowerMeter('3'))
            detect(PowerMeter('4'))
            const ids = pairing.getPendingConflicts().map(c => c.id)
            expect(ids).toHaveLength(3)

            await pairing.selectDevice(Power, pwr3, false)
            pairing.reevaluatePendingConflicts([Power])

            expect(pairing.getPendingConflicts().map(c => c.id)).toEqual([ids[0], ids[2]])
        })
    })

    describe('a conflict answered after its slots changed', () => {

        test('the rows that changed are left alone and the commit is logged as stale', async () => {
            detect(Trainer('1'))
            const pwr = detect(PowerMeter('2'))
            const [conflict] = pairing.getPendingConflicts()
            configuration.disableCapability(Power)

            await pairing.resolveConflict(conflict.id, [Power, Speed])

            expect(selectedOf(Power)).not.toBe(pwr)
            expect(selectedOf(Speed)).toBe(pwr)
            expect(events('device select conflict stale')).toEqual([expect.objectContaining({ origin: 'detection', conflictCount: 1 })])
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ resolution: 'done', replacedCount: 1 })])
        })

        test('nothing is stale when no slot changed', async () => {
            detect(Trainer('1'))
            detect(PowerMeter('2'))
            const [conflict] = pairing.getPendingConflicts()

            await pairing.resolveConflict(conflict.id, [Power])

            expect(events('device select conflict stale')).toEqual([])
        })
    })

    describe('a pick in the Resistance list', () => {

        // a power meter holds Power, Speed and Cadence; the rider picks the trainer for Resistance
        const prepare = () => {
            const pwr = detect(PowerMeter('1'))
            const trainer = configuration.add(Trainer('2'))
            configuration.unselect(Control)
            return { pwr, trainer }
        }

        test('that takes slots held by another device starts the conflict step, logged as shown from a manual pick', () => {
            const { trainer } = prepare()

            const conflict = pairing.startManualConflict(Control, trainer)

            expect(conflict).toMatchObject({ origin: 'manual', filled: [] })
            expect(conflict!.conflicts.map(c => c.capability).sort()).toEqual([Cadence, Power, Speed].sort())
            expect(events('device select conflict shown')).toEqual([
                expect.objectContaining({ origin: 'manual', conflictCount: 3, queued: 0 })
            ])
            expect(selectedOf(Control)).toBeFalsy()
            expect(pairing.getPendingConflicts()).toEqual([])
        })

        test('without conflicts there is no step and nothing is logged', () => {
            const trainer = configuration.add(Trainer('2'))
            configuration.unselect(Control)

            expect(pairing.startManualConflict(Control, trainer)).toBeUndefined()
            expect(events('device select conflict shown')).toEqual([])
        })

        test('Done selects the device, replaces only what the rider chose, and is logged', async () => {
            const { pwr, trainer } = prepare()
            const conflict = pairing.startManualConflict(Control, trainer)!

            await pairing.commitManualConflict(conflict.id, [Speed])

            expect(selectedOf(Control)).toBe(trainer)
            expect(selectedOf(Speed)).toBe(trainer)
            expect(selectedOf(Power)).toBe(pwr)
            expect(selectedOf(Cadence)).toBe(pwr)
            expect(events('device select conflict resolved')).toEqual([
                expect.objectContaining({ origin: 'manual', resolution: 'done', replacedCount: 1, conflictCount: 3 })
            ])
        })

        test('closing the step another way still selects the device, with the choices made so far', async () => {
            const { pwr, trainer } = prepare()
            const conflict = pairing.startManualConflict(Control, trainer)!

            await pairing.commitManualConflict(conflict.id, [], 'dismissed')

            expect(selectedOf(Control)).toBe(trainer)
            expect(selectedOf(Power)).toBe(pwr)
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ origin: 'manual', resolution: 'dismissed', replacedCount: 0 })])
        })

        test('a slot that changed while the step was open is left alone and logged as stale', async () => {
            const { trainer } = prepare()
            const conflict = pairing.startManualConflict(Control, trainer)!
            configuration.disableCapability(Power)

            await pairing.commitManualConflict(conflict.id, [Power])

            expect(selectedOf(Power)).not.toBe(trainer)
            expect(events('device select conflict stale')).toEqual([expect.objectContaining({ origin: 'manual', conflictCount: 1 })])
        })

        test('an unknown step does nothing', async () => {
            await pairing.commitManualConflict('unknown', [Power])
            expect(events('device select conflict resolved')).toEqual([])
        })
    })
})
