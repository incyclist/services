/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { PairingPageStateMachine } from '../page/mobile/statemachine'
import { DevicePairingService } from './service'

// What a single pairing attempt starts and stops, in both pairing modes: 'direct' runs
// DevicePairingService's own loop, 'page' is driven by the mobile page state machine.
// The configuration service is real; the ride and access services are fakes that decide which
// devices answer a connection attempt.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })
const HeartRate = (id: string) => ({ interface: 'ble', name: `hrm-${id}`, address: id, protocol: 'hr' })
const FALLBACK = { reason: 'not-available', scope: 'until-next-pairing' } as const

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

const wait = (ms: number) => new Promise(done => setTimeout(done, ms))

class FakeRide extends EventEmitter {
    awake = new Set<string>()
    started = new Map<string, string[]>()

    startAdapters = jest.fn(async (adapters: Array<{ udid: string, capabilities: string[] }>) => {
        await wait(1000)
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
    scan = jest.fn(async () => { await wait(6000); return [] })
    stopScan = jest.fn().mockResolvedValue(true)
    enrichWithAccessState = jest.fn((ifs: any[]) => (ifs ?? []).map(i => ({ ...i, state: 'connected', isScanning: false })))
    enableInterface = jest.fn().mockResolvedValue(true)
    disableInterface = jest.fn().mockResolvedValue(true)
}

type Mode = 'direct' | 'page'

const setup = (mode: Mode, configuration: DeviceConfigurationService) => {
    const ride = new FakeRide()
    const access = new FakeAccess()

    // the fakes decide whether an adapter counts as started
    const adapterFor = (udid: string) => {
        const adapter = configuration.adapters[udid] as any
        jest.spyOn(adapter, 'isStarted').mockImplementation(() => ride.started.has(udid))
        jest.spyOn(adapter, 'isStopped').mockImplementation(() => !ride.started.has(udid))
        jest.spyOn(adapter, 'stop').mockImplementation(async () => { ride.started.delete(udid); return true })
        return adapter
    }
    Object.keys(configuration.adapters).forEach(adapterFor)

    const pairing = new DevicePairingService({ configuration, access, ride } as any)
    pairing.usage = mode

    Inject('DevicePairing', pairing)
    Inject('DeviceConfiguration', configuration)

    let sm: PairingPageStateMachine | undefined
    if (mode === 'page') {
        sm = new PairingPageStateMachine()
        sm.start(jest.fn())
    }

    const start = async () => { await pairing.start(jest.fn()) }

    const attemptsFor = (udid: string) =>
        ride.startAdapters.mock.calls.filter(([adapters]) => adapters.some((ai: any) => ai.udid === udid)).length

    const logEvent = jest.spyOn(pairing as any, 'logEvent')
    const logged = (message: string) => logEvent.mock.calls.filter(([e]: any) => e?.message === message)

    // was the device stopped by the pairing service (full stop or a stop of just this device)?
    const stopsOf = (udid: string) =>
        ride.stop.mock.calls.length + ride.stopDevices.mock.calls.filter(([udids]) => udids.includes(udid)).length

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

    return { ride, access, pairing, start, attemptsFor, logged, stopsOf, teardown, sm }
}

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

describe.each<Mode>(['direct', 'page'])('DevicePairingService attempts, usage:%s', (mode) => {

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

    describe('a rejected attempt', () => {

        test('is followed by a new attempt, and the trainer connects', async () => {
            const trainer = configuration.add(Trainer('1'))
            env = setup(mode, configuration)
            env.ride.awake.add(trainer)
            env.ride.startAdapters.mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'getCapabilities')"))

            await env.start()
            await jest.advanceTimersByTimeAsync(8_000)

            expect(env.attemptsFor(trainer)).toBeGreaterThanOrEqual(2)
            expect(env.ride.started.has(trainer)).toBe(true)
            expect(env.pairing.isPairingSettled()).toBe(true)
        })
    })

    describe('already connected devices', () => {

        test('a connected trainer is neither stopped nor started again while another device keeps failing', async () => {
            const trainer = configuration.add(Trainer('1'))
            const hrm = configuration.add(HeartRate('3'))
            env = setup(mode, configuration)
            env.ride.awake.add(trainer)

            await env.start()
            await jest.advanceTimersByTimeAsync(15_000)

            // page mode keeps retrying the heart rate monitor (direct mode stops once the ride is ready) ...
            if (mode === 'page')
                expect(env.attemptsFor(hrm)).toBeGreaterThanOrEqual(3)
            // ... but the trainer was started once and never stopped
            expect(env.attemptsFor(trainer)).toBe(1)
            expect(env.stopsOf(trainer)).toBe(0)
            expect(env.ride.started.has(trainer)).toBe(true)
        })

        test('a connected power meter stays connected while an excluded trainer keeps being retried', async () => {
            const trainer = configuration.add(Trainer('1'))
            const powerMeter = configuration.add(PowerMeter('2'))
            configuration.select(powerMeter, IncyclistCapability.Power)
            env = setup(mode, configuration)
            env.pairing.setVisitOpen(true)
            configuration.excludeDevice(trainer, FALLBACK)
            env.ride.awake.add(powerMeter)

            await env.start()
            await jest.advanceTimersByTimeAsync(15_000)

            expect(env.attemptsFor(trainer)).toBeGreaterThanOrEqual(3)
            expect(env.attemptsFor(powerMeter)).toBe(1)
            expect(env.stopsOf(powerMeter)).toBe(0)
            expect(env.ride.started.has(powerMeter)).toBe(true)
        })

        test('a failed device of the attempt is stopped, the connected one is not', async () => {
            const trainer = configuration.add(Trainer('1'))
            const hrm = configuration.add(HeartRate('3'))
            env = setup(mode, configuration)
            env.ride.awake.add(trainer)

            await env.start()
            await jest.advanceTimersByTimeAsync(6_000)

            expect(env.ride.stop).not.toHaveBeenCalled()
            expect(env.ride.stopDevices).toHaveBeenCalledWith([hrm])
        })
    })

    describe('an attempt that never settles', () => {

        const HUNG = 'pairing attempt hung'
        const never = () => new Promise<boolean>(() => { /* never settles */ })

        // the time of the latest connection attempt, so the tests can step to just before / after its limit
        let attemptAt: number | undefined
        const hangAttempts = (times?: number) => {
            attemptAt = undefined
            const impl = () => { attemptAt = Date.now(); return never() }
            if (times === undefined)
                env.ride.startAdapters.mockImplementation(impl)
            else for (let i = 0; i < times; i++)
                env.ride.startAdapters.mockImplementationOnce(impl)
        }
        const advanceTo = async (msAfterAttempt: number) => {
            // the first attempt may not have started yet
            for (let i = 0; i < 100 && attemptAt === undefined; i++)
                await jest.advanceTimersByTimeAsync(100)
            await jest.advanceTimersByTimeAsync(Math.max(0, (attemptAt ?? 0) + msAfterAttempt - Date.now()))
        }

        test('a BLE attempt is dropped 45 s after it started, and the next attempt connects the trainer', async () => {
            const trainer = configuration.add(Trainer('1'))
            env = setup(mode, configuration)
            env.ride.awake.add(trainer)
            hangAttempts(1)

            await env.start()
            await advanceTo(44_999)
            expect(env.logged(HUNG)).toHaveLength(0)
            expect(env.ride.dropPendingStart).not.toHaveBeenCalled()

            await advanceTo(45_000)
            expect(env.logged(HUNG)).toHaveLength(1)
            expect(env.ride.dropPendingStart).toHaveBeenCalledTimes(1)

            await jest.advanceTimersByTimeAsync(8_000)
            expect(env.attemptsFor(trainer)).toBeGreaterThanOrEqual(2)
            expect(env.ride.started.has(trainer)).toBe(true)
            expect(env.pairing.isPairingSettled()).toBe(true)
        })

        test('an attempt with no BLE device is dropped 25 s after it started', async () => {
            configuration.settings.interfaces.push({ name: 'ant', enabled: true })
            const trainer = configuration.add({ interface: 'ant', deviceID: '2606', profile: 'FE' } as any)
            env = setup(mode, configuration)
            env.ride.awake.add(trainer)
            hangAttempts(1)

            await env.start()
            await advanceTo(24_999)
            expect(env.logged(HUNG)).toHaveLength(0)

            await advanceTo(25_000)
            expect(env.logged(HUNG)).toHaveLength(1)
            expect(env.ride.dropPendingStart).toHaveBeenCalledTimes(1)
        })

        test('is logged with the interfaces that did not connect, the attempt duration and the platform', async () => {
            configuration.add(Trainer('1'))
            env = setup(mode, configuration)
            hangAttempts(1)

            await env.start()
            await advanceTo(45_000)

            const event: any = env.logged(HUNG)[0][0]
            // 'ts' is added by the logger itself
            expect(Object.keys(event).sort()).toEqual(['attemptMs', 'hungInterfaces', 'message', 'platform', 'ts'])
            expect(event.hungInterfaces).toBe('ble')
            expect(event.attemptMs).toBe(45_000)
            expect(event.platform).toBe(mode === 'page' ? 'mobile' : 'desktop')
        })

        test('is logged once per visit, however often attempts hang in it', async () => {
            configuration.add(Trainer('1'))
            env = setup(mode, configuration)
            env.pairing.setVisitOpen(true)
            hangAttempts()

            await env.start()
            await advanceTo(45_000)
            // the page is opened again while its visit is still open
            env.pairing.setVisitOpen(true)
            await jest.advanceTimersByTimeAsync(10_000)
            await advanceTo(45_000)

            expect(env.ride.dropPendingStart).toHaveBeenCalledTimes(2)
            expect(env.logged(HUNG)).toHaveLength(1)

            // a new visit logs it again
            env.pairing.setVisitOpen(false)
            env.pairing.setVisitOpen(true)
            await jest.advanceTimersByTimeAsync(10_000)
            await advanceTo(45_000)

            expect(env.logged(HUNG)).toHaveLength(2)
        })

        test('a dropped attempt that settles later does not end the attempt that followed it', async () => {
            configuration.add(Trainer('1'))
            env = setup(mode, configuration)
            let settleDropped: (ok: boolean) => void = () => { }
            env.ride.startAdapters.mockImplementationOnce(() => new Promise<boolean>(done => { settleDropped = done }))
            hangAttempts()

            await env.start()
            await jest.advanceTimersByTimeAsync(45_000 + 10_000)
            const attempts = env.ride.startAdapters.mock.calls.length
            expect(attempts).toBe(2)

            settleDropped(false)
            await jest.advanceTimersByTimeAsync(10_000)

            // still the second attempt: no new one was started, and it wasn't stopped
            expect(env.ride.startAdapters.mock.calls.length).toBe(attempts)
            expect((env.pairing as any).isPairing()).toBe(true)
            expect(env.ride.stopDevices).not.toHaveBeenCalled()
        })
    })
})

// direct mode stops attempting once the ride is ready, so only page mode retries here
describe('DevicePairingService attempts, usage:page, a capability added to a connected device', () => {

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
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    test('the connected device is started again for the additional capability', async () => {
        const powerMeter = configuration.add(PowerMeter('2'))
        const hrm = configuration.add(HeartRate('3'))
        configuration.unselect(IncyclistCapability.Cadence)
        env = setup('page', configuration)
        env.ride.awake.add(powerMeter)

        await env.start()
        await jest.advanceTimersByTimeAsync(6_000)
        const attempts = env.attemptsFor(powerMeter)
        expect(attempts).toBe(1)
        expect(env.ride.started.get(powerMeter)).not.toContain(IncyclistCapability.Cadence)

        configuration.select(powerMeter, IncyclistCapability.Cadence)
        await jest.advanceTimersByTimeAsync(6_000)

        expect(env.attemptsFor(hrm)).toBeGreaterThanOrEqual(3)
        expect(env.attemptsFor(powerMeter)).toBe(attempts + 1)
        expect(env.ride.started.get(powerMeter)).toContain(IncyclistCapability.Cadence)
    })
})

describe.each<Mode>(['direct', 'page'])('DevicePairingService with a stored device this build cannot create, usage:%s', (mode) => {

    const TRAINER = 'trainer-udid'
    const CONTROLLER = 'controller-udid'
    let env: ReturnType<typeof setup>
    let configuration: DeviceConfigurationService

    beforeEach(async () => {
        jest.useFakeTimers()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})

        const stored: Record<string, any> = {
            devices: [
                { udid: TRAINER, settings: Trainer('1') },
                { udid: CONTROLLER, settings: { interface: 'wifi', protocol: 'openbikecontrol', name: 'BikeControl', address: '10.0.0.2' } },
            ],
            capabilities: [
                { capability: IncyclistCapability.Control, selected: TRAINER, devices: [TRAINER] },
                { capability: IncyclistCapability.Power, selected: TRAINER, devices: [TRAINER] },
                { capability: IncyclistCapability.Speed, selected: TRAINER, devices: [TRAINER] },
                { capability: IncyclistCapability.Cadence, selected: TRAINER, devices: [TRAINER] },
                { capability: IncyclistCapability.HeartRate, selected: undefined, devices: [] },
                { capability: IncyclistCapability.AppControl, selected: CONTROLLER, devices: [CONTROLLER] },
            ],
            interfaces: [{ name: 'ble', enabled: true }, { name: 'wifi', enabled: true }],
        }
        Inject('UserSettings', {
            init: jest.fn(),
            set: jest.fn((key: string, value: any) => { stored[key] = value }),
            get: jest.fn((key: string, defVal: any) => stored[key] ?? defVal),
            getValue: jest.fn((_key: string, defVal: any) => defVal),
            save: jest.fn(),
        })
        Inject('AppState', { getAppFeatures: () => ({ interfaces: '*', ble: '*' }), getChannel: () => 'mobile' })

        configuration = new DeviceConfigurationService()
        await configuration.init()
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

    test('pairing settles once the trainer connects, with no further attempt', async () => {
        env = setup(mode, configuration)
        env.ride.awake.add(TRAINER)

        await env.start()
        await jest.advanceTimersByTimeAsync(10_000)

        expect(env.pairing.isPairingSettled()).toBe(true)
        expect(env.logged('Start Pairing')).toHaveLength(1)
        expect(env.ride.stop).not.toHaveBeenCalled()
        if (mode === 'page')
            expect(env.sm?.state).toBe('Done')
    })
})
