/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { PairingPageStateMachine } from '../page/mobile/statemachine'
import { DevicePairingService } from './service'

/**
 * Characterization of DevicePairingService when the Pairing page is left and entered again while work of
 * the previous visit is still running. 'page' is the mobile mode (driven by the page state machine),
 * 'direct' is the desktop mode (the service runs its own loop).
 *
 * Leaving stops scans and keeps a running attempt, re-entering adopts it; nothing new starts after a leave.
 *
 * The fakes below do not model what the real ride service does with a cancelled start: they only
 * count calls. Assertions are therefore about which calls the pairing service makes, not about the
 * hardware result.
 */

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

const wait = (ms: number) => new Promise(done => setTimeout(done, ms))

class FakeRide extends EventEmitter {
    awake = new Set<string>()
    started = new Map<string, string[]>()
    inFlight = 0

    startAdapters = jest.fn(async (adapters: Array<{ udid: string, capabilities: string[] }>) => {
        this.inFlight++
        await wait(1000).finally(() => { this.inFlight-- })
        adapters.forEach(ai => {
            if (this.awake.has(ai.udid)) {
                this.started.set(ai.udid, [...ai.capabilities])
                this.emit('pair-success', ai.udid)
            }
            else {
                this.started.delete(ai.udid)
                this.emit('pair-error', ai.udid)
            }
        })
        return true
    })
    stop = jest.fn(async () => { this.started.clear(); return true })
    stopDevices = jest.fn(async (udids: string[]) => { udids.forEach(udid => this.started.delete(udid)) })
    getStartedCapabilities = jest.fn((udid: string) => this.started.get(udid))
    cancelStart = jest.fn().mockResolvedValue(true)
    dropPendingStart = jest.fn()
    lazyInit = jest.fn().mockResolvedValue(true)
    waitForPreviousStartToFinish = jest.fn().mockResolvedValue(true)
    onData = jest.fn()
}

class FakeAccess extends EventEmitter {
    scan = jest.fn(async () => { await wait(60000); return [] })
    stopScan = jest.fn().mockResolvedValue(true)
    enrichWithAccessState = jest.fn((ifs: any[]) => (ifs ?? []).map(i => ({ ...i, state: 'connected', isScanning: false })))
    enableInterface = jest.fn().mockResolvedValue(true)
    disableInterface = jest.fn().mockResolvedValue(true)
}

type Mode = 'direct' | 'page'

const createConfiguration = () => {
    const configuration = new DeviceConfigurationService()
    configuration.settings = {
        devices: [],
        capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false })),
        interfaces: [{ name: 'ble', enabled: true }],
    }
    configuration.adapters = {}
    configuration.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)
    return configuration
}

const setup = (mode: Mode, configuration: DeviceConfigurationService) => {
    const ride = new FakeRide()
    const access = new FakeAccess()

    Object.keys(configuration.adapters).forEach(udid => {
        const adapter = configuration.adapters[udid] as any
        jest.spyOn(adapter, 'isStarted').mockImplementation(() => ride.started.has(udid))
        jest.spyOn(adapter, 'isStopped').mockImplementation(() => !ride.started.has(udid))
        jest.spyOn(adapter, 'stop').mockImplementation(async () => { ride.started.delete(udid); return true })
    })

    const pairing = new DevicePairingService({ configuration, access, ride } as any)
    pairing.usage = mode

    Inject('DevicePairing', pairing)
    Inject('DeviceConfiguration', configuration)

    let sm: PairingPageStateMachine | undefined

    // opens a visit: the state machine (page mode only) first, then the service
    const enter = async () => {
        if (mode === 'page') {
            sm = new PairingPageStateMachine()
            sm.start(jest.fn())
        }
        await pairing.start(jest.fn())
    }

    // leaves through Skip: what the page service does on closePage()
    const leave = async () => {
        sm?.stop()
        await pairing.stop()
    }

    const attemptsFor = (udid: string) =>
        ride.startAdapters.mock.calls.filter(([adapters]) => adapters.some((ai: any) => ai.udid === udid)).length

    const isPairing = () => (pairing as any).isPairing() as boolean

    const teardown = async () => {
        sm?.stop()
        await pairing.stop([], true)
        pairing.removeAllListeners()
        pairing.reset()
        configuration.removeAllListeners()
        configuration.reset()
        Inject('DevicePairing', null)
        Inject('DeviceConfiguration', null)
    }

    return { ride, access, pairing, enter, leave, attemptsFor, isPairing, teardown }
}

describe('DevicePairingService: leaving and re-entering the Pairing page', () => {

    let env: ReturnType<typeof setup>
    let configuration: DeviceConfigurationService

    beforeEach(() => {
        jest.useFakeTimers()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})
        configuration = createConfiguration()
    })

    afterEach(async () => {
        await env?.teardown()
        jest.clearAllTimers()
        jest.useRealTimers()
        AdapterFactory.reset()
        Inject('UserSettings', null)
        Inject('AppState', null)
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    describe('page mode (mobile)', () => {

        // trainer configured and awake, the attempt (1 s) is still running
        const withAttemptInFlight = async () => {
            const trainer = configuration.add(Trainer('1'))
            env = setup('page', configuration)
            env.ride.awake.add(trainer)
            await env.enter()
            await jest.advanceTimersByTimeAsync(100)
            expect(env.ride.inFlight).toBe(1)
            return trainer
        }

        // no devices: the machine scans
        const withScanInFlight = async () => {
            env = setup('page', configuration)
            await env.enter()
            await jest.advanceTimersByTimeAsync(100)
            expect(env.access.scan).toHaveBeenCalledTimes(1)
        }

        test('today: leaving does not cancel an attempt that is already running', async () => {
            const trainer = await withAttemptInFlight()

            await env.leave()
            await jest.advanceTimersByTimeAsync(2000)

            expect(env.ride.cancelStart).not.toHaveBeenCalled()
            expect(env.ride.started.has(trainer)).toBe(true)
        })

        test('the service keeps its record of an attempt that is still running', async () => {
            await withAttemptInFlight()

            await env.leave()

            expect(env.ride.inFlight).toBe(1)
            expect(env.isPairing()).toBe(true)
        })

        test('re-entering while the old attempt is running adopts it, no second attempt', async () => {
            const trainer = await withAttemptInFlight()
            await env.leave()

            await env.enter()
            await jest.advanceTimersByTimeAsync(100)

            expect(env.attemptsFor(trainer)).toBe(1)
        })

        test('leaving stops a scan that is running', async () => {
            await withScanInFlight()

            await env.leave()

            expect(env.access.stopScan).toHaveBeenCalled()
        })

        test('getActivity() reports a running attempt with its id, and nothing once it has finished', async () => {
            await withAttemptInFlight()

            expect(env.pairing.getActivity().pairing).toMatchObject({ attemptId: expect.any(Number) })

            await jest.advanceTimersByTimeAsync(2000)

            expect(env.pairing.getActivity().pairing).toBeUndefined()
        })

        test('the attempt finishing after the leave does not clear the record of the attempt that followed it', async () => {
            const trainer = await withAttemptInFlight()
            await env.leave()
            await env.enter()
            await jest.advanceTimersByTimeAsync(100)
            const id = env.pairing.getActivity().pairing?.attemptId

            await jest.advanceTimersByTimeAsync(1200)

            // the adopted attempt is the same one and finished once; no second attempt was needed
            expect(id).toBeDefined()
            expect(env.attemptsFor(trainer)).toBe(1)
        })

        test('a scan that is still preparing when the page is left never starts', async () => {
            env = setup('page', configuration)
            await env.enter()
            await jest.advanceTimersByTimeAsync(10)
            await env.pairing.stopScanning()
            env.access.scan.mockClear()

            const starting = env.pairing.startScanning([], { deviceList: true } as any)
            await env.leave()
            await starting
            await jest.advanceTimersByTimeAsync(100)

            expect(env.access.scan).not.toHaveBeenCalled()
            expect(env.pairing.isScanning()).toBe(false)
        })

        test('OK hand-off: prepareStart() keeps the record of an attempt that is still running', async () => {
            await withAttemptInFlight()

            await env.pairing.prepareStart()

            expect(env.isPairing()).toBe(true)
            expect(env.ride.cancelStart).not.toHaveBeenCalled()
        })

        test('prepareStart() stops a running scan', async () => {
            await withScanInFlight()

            await env.pairing.prepareStart()

            expect(env.access.stopScan).toHaveBeenCalled()
        })
    })

    describe('direct mode (desktop)', () => {

        const withAttemptInFlight = async () => {
            const trainer = configuration.add(Trainer('1'))
            env = setup('direct', configuration)
            env.ride.awake.add(trainer)
            await env.enter()
            await jest.advanceTimersByTimeAsync(100)
            expect(env.ride.inFlight).toBe(1)
            return trainer
        }

        test('leaving does not cancel an attempt that is running', async () => {
            await withAttemptInFlight()

            await env.leave()

            expect(env.ride.cancelStart).not.toHaveBeenCalled()
        })

        // The fake ride does not stop a running attempt when cancelStart() is called, so whether a cancelled
        // desktop attempt leaves a clean or a half-started device is NOT covered here (open item Q7: needs
        // tests against real adapters). This only pins that re-entering after a leave ends with a paired trainer.
        test('today: re-entering after a leave ends with the trainer connected and pairing settled', async () => {
            const trainer = await withAttemptInFlight()
            await env.leave()
            await jest.advanceTimersByTimeAsync(5000)

            await env.enter()
            await jest.advanceTimersByTimeAsync(5000)

            expect(env.ride.started.has(trainer)).toBe(true)
            expect(env.pairing.isPairingSettled()).toBe(true)
        })

        test('OK hand-off: prepareStart() keeps the record of an attempt that is still running', async () => {
            await withAttemptInFlight()

            await env.pairing.prepareStart()

            expect(env.isPairing()).toBe(true)
            expect(env.ride.cancelStart).not.toHaveBeenCalled()
        })
    })

    describe('resetReadyToStart', () => {

        const info = { controlName: 'trainer', controlAdapterStarted: false, controlAdapterStopped: true }

        test('withdraws the confirmation and logs it once', () => {
            env = setup('page', configuration)
            const log = jest.spyOn(env.pairing, 'logEvent')
            env.pairing.setReadyToStart()

            expect(env.pairing.resetReadyToStart(info)).toBe(true)
            expect(env.pairing.isReadyToStart()).toBe(false)
            expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'ready to start reset', ...info }))
        })

        test('does nothing and does not log when the device was not confirmed', () => {
            env = setup('page', configuration)
            const log = jest.spyOn(env.pairing, 'logEvent')

            expect(env.pairing.resetReadyToStart(info)).toBe(false)
            expect(log).not.toHaveBeenCalled()
        })
    })
})
