/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { DevicePairingService } from './service'

// A rider deleting a device from one capability is a saved, deliberate choice: it should survive
// closing and reopening the Pairing page (not just last until then), it should stop that device
// from being auto-reselected into the same capability on a later redetection, and it should never
// stand in the way of the rider deliberately picking the device again - directly, or through a
// conflict step's "Use" choice.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]
const { Control, Cadence } = IncyclistCapability

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

describe('DevicePairingService - a per-capability delete', () => {

    let configuration: DeviceConfigurationService
    let pairing: DevicePairingService

    const detect = (settings: Record<string, unknown>): string => {
        (pairing as any).onDeviceDetected(settings)
        return configuration.getUdid(settings as any) as string
    }

    const selectedOf = (capability: IncyclistCapability) => configuration.getConfiguredSelection(capability)
    const stateOf = (capability: IncyclistCapability) => pairing.getState().capabilities.find(c => c.capability === capability)

    const reopenPage = async () => {
        // the page-service level close+reopen: stop() (every ordinary close, not just app exit),
        // then start() again
        await pairing.stop([], false)
        await new Promise<void>(done => pairing.start(() => done()).then(() => done()))
    }

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

    test('survives closing and reopening the page: a later redetection does not restore it', async () => {
        const trainer = detect(Trainer('1'))
        expect(selectedOf(Cadence)).toBe(trainer)

        await pairing.deleteDevice(Cadence, trainer)
        expect(selectedOf(Cadence)).toBeFalsy()

        await reopenPage()
        pairing.setVisitOpen(true)
        detect(Trainer('1'))

        expect(selectedOf(Cadence)).toBeFalsy()
    })

    test('does not block a direct, manual re-pick of the same device', async () => {
        const trainer = detect(Trainer('1'))
        await pairing.deleteDevice(Cadence, trainer)
        expect(selectedOf(Cadence)).toBeFalsy()

        await pairing.selectDevice(Cadence, trainer)

        expect(selectedOf(Cadence)).toBe(trainer)
        const cadence = stateOf(Cadence)
        expect(cadence?.selected).toBe(trainer)
        expect(cadence?.deviceName).toBeTruthy()
    })

    test('a manual re-pick is not undone by a later redetection', async () => {
        const trainer = detect(Trainer('1'))
        await pairing.deleteDevice(Cadence, trainer)
        await pairing.selectDevice(Cadence, trainer)
        expect(selectedOf(Cadence)).toBe(trainer)

        detect(Trainer('1'))

        expect(selectedOf(Cadence)).toBe(trainer)
    })

    test('a conflict step\'s explicit "Use" choice overrides an earlier delete on that row', async () => {
        const trainer = detect(Trainer('1'))
        await pairing.deleteDevice(Cadence, trainer)
        expect(selectedOf(Cadence)).toBeFalsy()

        // a power meter now holds the (now empty) Cadence slot
        const pwr = detect(PowerMeter('2'))
        expect(selectedOf(Cadence)).toBe(pwr)

        // the rider re-picks the trainer for Control, and explicitly chooses "Use" for the Cadence row
        const conflict = pairing.startManualConflict(Control, trainer)!
        expect(conflict.conflicts.map(c => c.capability)).toContain(Cadence)

        await pairing.commitManualConflict(conflict.id, [Cadence])

        expect(selectedOf(Cadence)).toBe(trainer)
    })

    test('deviceName, interface and selected always agree, even right after a redetection races a delete', async () => {
        const trainer = detect(Trainer('1'))
        await pairing.deleteDevice(Cadence, trainer)

        detect(Trainer('1'))

        const cadence = stateOf(Cadence)
        expect(Boolean(cadence?.selected)).toBe(Boolean(cadence?.deviceName))
    })
})
