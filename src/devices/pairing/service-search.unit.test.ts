/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { PairingPageStateMachine } from '../page/mobile/statemachine'
import { DevicePairingService } from './service'

// The Pairing page's search for devices, in both pairing modes ('direct' runs DevicePairingService's
// own loop, 'page' is driven by the mobile page state machine). A search runs once, ends when it's
// complete, when its time is up or when the rider stops it, and nothing searches again until the
// rider asks. The configuration service is real; ride and access are fakes.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })
const Hrm = (id: string) => ({ interface: 'ble', name: `hrm-${id}`, address: id, protocol: 'hr' })
const ZwiftPlay = (id: string) => ({ interface: 'ble', name: `zp-${id}`, address: id, protocol: 'zwift-play' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

type Mode = 'direct' | 'page'
const DURATION: Record<Mode, number> = { direct: 60_000, page: 30_000 }

class FakeRide extends EventEmitter {
    started = new Set<any>()
    awake = new Set<any>()

    startAdapters = jest.fn(async (adapters: Array<{ udid: string, adapter: any }>) => {
        await new Promise(done => setTimeout(done, 1000))
        adapters.forEach(ai => {
            this.started.add(ai.adapter)
            this.emit('pair-success', ai.udid)
        })
        return true
    })
    stop = jest.fn().mockResolvedValue(true)
    cancelStart = jest.fn().mockResolvedValue(true)
    lazyInit = jest.fn().mockResolvedValue(true)
    waitForPreviousStartToFinish = jest.fn().mockResolvedValue(true)
    onData = jest.fn()
}

// a scan reports the devices that are awake, a moment after it starts, and runs until its timeout or a stop
class FakeAccess extends EventEmitter {
    awake: Array<Record<string, unknown>> = []
    protected end?: () => void

    scan = jest.fn((_filter: any, props: any = {}) => new Promise(done => {
        const announce = setTimeout(() => { this.awake.forEach(s => this.emit('device', s)) }, 500)
        const finish = () => {
            clearTimeout(announce)
            clearTimeout(timeout)
            this.end = undefined
            done([])
        }
        const timeout = setTimeout(finish, props.timeout ?? 30_000)
        this.end = finish
    }))
    stopScan = jest.fn(async () => { this.end?.(); return true })
    enrichWithAccessState = jest.fn((ifs: any[]) => (ifs ?? []).map(i => ({ ...i, state: 'connected', isScanning: false })))
    enableInterface = jest.fn().mockResolvedValue(true)
    disableInterface = jest.fn().mockResolvedValue(true)
}

const setup = (mode: Mode, props: { visitOpen?: boolean } = {}) => {
    const { visitOpen = true } = props

    const configuration = new DeviceConfigurationService()
    configuration.settings = {
        devices: [],
        capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false })),
        interfaces: [{ name: 'ble', enabled: true }],
    }
    configuration.adapters = {}
    configuration.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)

    const ride = new FakeRide()
    const access = new FakeAccess()

    // every adapter the configuration creates is controlled by the fakes: started only by the ride service
    const create = (configuration as any).getAdapterFromSetting.bind(configuration)
    jest.spyOn(configuration as any, 'getAdapterFromSetting').mockImplementation((settings: any) => {
        const adapter = create(settings)
        if (adapter) {
            jest.spyOn(adapter, 'isStarted').mockImplementation(() => ride.started.has(adapter))
            jest.spyOn(adapter, 'isStopped').mockImplementation(() => !ride.started.has(adapter))
            jest.spyOn(adapter, 'stop').mockImplementation(async () => { ride.started.delete(adapter); return true })
            jest.spyOn(adapter, 'onScanStart').mockImplementation(() => {})
        }
        return adapter
    })

    const pairing = new DevicePairingService({ configuration, access, ride } as any)
    pairing.usage = mode

    Inject('DevicePairing', pairing)
    Inject('DeviceConfiguration', configuration)

    let sm: PairingPageStateMachine | undefined
    if (mode === 'page') {
        sm = new PairingPageStateMachine()
        sm.start(jest.fn())
    }

    const logEvent = jest.spyOn(pairing as any, 'logEvent')
    const events = (message: string) => logEvent.mock.calls.map(([e]) => e).filter((e: any) => e?.message === message)

    const start = async () => {
        if (visitOpen)
            pairing.setVisitOpen(true)
        await pairing.start(jest.fn())
    }

    const capability = (c: IncyclistCapability) => pairing.getState().capabilities?.find(cd => cd.capability === c)

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

    return { configuration, ride, access, pairing, sm, events, start, capability, teardown }
}

describe.each<Mode>(['direct', 'page'])('DevicePairingService - the Pairing page search, usage:%s', (mode) => {

    let env: ReturnType<typeof setup>
    const duration = DURATION[mode]

    beforeEach(() => {
        jest.useFakeTimers()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})
        env = setup(mode)
    })

    afterEach(async () => {
        await env.teardown()
        jest.clearAllTimers()
        jest.useRealTimers()
        AdapterFactory.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    describe('a search that finds nothing', () => {

        test('runs for the search time, then ends and does not search again by itself', async () => {
            await env.start()
            await jest.advanceTimersByTimeAsync(duration - 2_000)
            expect(env.pairing.getSearchStatus()).toMatchObject({ running: true, index: 1 })

            await jest.advanceTimersByTimeAsync(5_000)
            const scans = env.access.scan.mock.calls.length
            await jest.advanceTimersByTimeAsync(3 * duration)

            expect(env.pairing.getSearchStatus()).toMatchObject({ running: false, ended: true, canSearchAgain: true, rideCapableFound: false })
            expect(env.access.scan.mock.calls.length).toBe(scans)
            expect(env.events('pairing search ended')).toEqual([expect.objectContaining({ via: 'time', searchIndex: 1, trainerFound: false })])
        })

        test('the scan lasts the search time on every interface', async () => {
            await env.start()
            await jest.advanceTimersByTimeAsync(100)

            const [, props] = env.access.scan.mock.calls[0]
            expect(props).toMatchObject({ timeout: duration, timeoutAllInterfaces: true })
        })
    })

    describe('a search that finds a power meter but no trainer', () => {

        test('keeps searching after the power meter made the ride ready, and is ready once the search ends', async () => {
            env.access.awake.push(PowerMeter('1'))
            await env.start()

            await jest.advanceTimersByTimeAsync(duration / 2)
            expect(env.pairing.getSearchStatus()).toMatchObject({ running: true, rideCapableFound: true })

            await jest.advanceTimersByTimeAsync(duration)
            expect(env.pairing.getSearchStatus()).toMatchObject({ ended: true, rideCapableFound: true, trainerFound: false, canSearchAgain: true })
            expect(env.pairing.getState().canStartRide).toBe(true)
        })

        test('a trainer that wakes during the search is still found', async () => {
            env.access.awake.push(PowerMeter('1'))
            await env.start()
            await jest.advanceTimersByTimeAsync(duration / 2)

            env.access.awake.push(Trainer('2'))
            // a new scan of the same search (if one starts) or a re-detection picks it up; the fake
            // announces devices at scan start, so start one by interrupting the running scan
            await env.access.stopScan()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.capability(IncyclistCapability.Control)?.selected).toBeDefined()
            expect(env.pairing.getSearchStatus().trainerFound).toBe(true)
        })

        test('Stop searching is offered only once the power meter has been found for 2 s', async () => {
            env.access.awake.push(PowerMeter('1'))
            await env.start()

            await jest.advanceTimersByTimeAsync(1_000)
            expect(env.pairing.getSearchStatus()).toMatchObject({ rideCapableFound: true, canStop: false })

            await jest.advanceTimersByTimeAsync(2_000)
            expect(env.pairing.getSearchStatus().canStop).toBe(true)
        })

        test('stopping the search ends it at once and keeps the power meter', async () => {
            env.access.awake.push(PowerMeter('1'))
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)

            env.pairing.stopSearch()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.pairing.getSearchStatus()).toMatchObject({ ended: true, canSearchAgain: true })
            expect(env.capability(IncyclistCapability.Power)?.selected).toBeDefined()
            expect(env.pairing.getState().canStartRide).toBe(true)
            expect(env.events('pairing search ended')).toEqual([expect.objectContaining({ via: 'rider_stop' })])
        })
    })

    describe('completion', () => {

        test('a trainer and a heart-rate monitor complete the search early', async () => {
            env.access.awake.push(Trainer('1'), Hrm('2'))
            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.pairing.getSearchStatus()).toMatchObject({ ended: true, trainerFound: true, canSearchAgain: false, canStop: false })
            expect(env.events('pairing search ended')).toEqual([expect.objectContaining({ via: 'complete', missingCapabilities: '' })])
        })

        test('a switched-off slot counts as filled', async () => {
            env.configuration.disableCapability(IncyclistCapability.HeartRate)
            env.access.awake.push(Trainer('1'))
            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.events('pairing search ended')).toEqual([expect.objectContaining({ via: 'complete' })])
        })

        test('a missing controller never keeps the search running', async () => {
            env.access.awake.push(Trainer('1'), Hrm('2'))
            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.capability(IncyclistCapability.AppControl)?.selected).toBeUndefined()
            expect(env.pairing.getSearchStatus().ended).toBe(true)
        })

        test('a controller alone does not complete it and is not something to ride with', async () => {
            env.access.awake.push(ZwiftPlay('1'))
            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.pairing.getSearchStatus()).toMatchObject({ running: true, rideCapableFound: false })
        })

        test('"pairing search ended" carries scalar fields only', async () => {
            env.access.awake.push(Trainer('1'), Hrm('2'))
            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            const [event] = env.events('pairing search ended') as any[]
            expect(Object.keys(event).sort()).toEqual(['durationMs', 'foundCapabilities', 'message', 'missingCapabilities', 'platform', 'searchIndex', 'trainerFound', 'ts', 'via'])
            expect(typeof event.durationMs).toBe('number')
            expect(event.platform).toBe(mode === 'page' ? 'mobile' : 'desktop')
            expect(event.foundCapabilities.split(',')).toEqual(expect.arrayContaining([IncyclistCapability.Control, IncyclistCapability.HeartRate]))
        })
    })

    describe('Search again', () => {

        const endWithPowerMeter = async () => {
            env.access.awake.push(PowerMeter('1'))
            await env.start()
            await jest.advanceTimersByTimeAsync(duration + 10_000)
            expect(env.pairing.getSearchStatus().ended).toBe(true)
        }

        test('starts a second search that ends like the first', async () => {
            await env.start()
            await jest.advanceTimersByTimeAsync(duration + 5_000)
            const scans = env.access.scan.mock.calls.length

            env.pairing.searchAgain()
            await jest.advanceTimersByTimeAsync(1_000)
            expect(env.pairing.getSearchStatus()).toMatchObject({ running: true, index: 2 })
            expect(env.access.scan.mock.calls.length).toBeGreaterThan(scans)

            await jest.advanceTimersByTimeAsync(duration + 5_000)
            expect(env.pairing.getSearchStatus()).toMatchObject({ ended: true, index: 2 })
            expect(env.events('pairing search again')).toEqual([expect.objectContaining({ fromState: 'nothing_found', searchIndex: 2 })])
        })

        test('starts a search even though the found power meter already makes the ride ready', async () => {
            await endWithPowerMeter()

            env.pairing.searchAgain()
            await jest.advanceTimersByTimeAsync(1_000)

            expect(env.pairing.getSearchStatus().running).toBe(true)
            expect(env.events('pairing search again')).toEqual([expect.objectContaining({ fromState: 'ready_without_trainer' })])
        })

        test('the connected power meter keeps showing as connected while the search runs', async () => {
            await endWithPowerMeter()
            const pwr = env.capability(IncyclistCapability.Power)
            expect(pwr?.connectState).toBe('connected')

            const shown: string[] = []
            env.pairing.searchAgain()
            for (let i = 0; i < duration / 1000; i++) {
                await jest.advanceTimersByTimeAsync(1_000)
                if (env.pairing.getSearchStatus().running)
                    shown.push(env.capability(IncyclistCapability.Power)?.connectState as string)
            }

            expect(shown.length).toBeGreaterThan(0)
            expect(new Set(shown)).toEqual(new Set(['connected']))
        })

        test('after the search, the power meter it stopped is started again before the ride is ready', async () => {
            await endWithPowerMeter()
            const adapter = env.configuration.getAdapter(env.capability(IncyclistCapability.Power)?.selected as string) as any

            env.pairing.searchAgain()
            await jest.advanceTimersByTimeAsync(2_000)
            expect(adapter.isStarted()).toBe(false) // the search stopped it

            await jest.advanceTimersByTimeAsync(duration + 10_000)
            expect(env.pairing.getSearchStatus().ended).toBe(true)
            expect(adapter.isStarted()).toBe(true)
            expect(env.pairing.getState().canStartRide).toBe(true)
        })

        test('is ignored while a search is running', async () => {
            await env.start()
            await jest.advanceTimersByTimeAsync(1_000)

            env.pairing.searchAgain()

            expect(env.pairing.getSearchStatus().index).toBe(1)
            expect(env.events('pairing search again')).toEqual([])
        })
    })

    describe('leaving the page', () => {

        test('ends a running search as left_page', async () => {
            await env.start()
            await jest.advanceTimersByTimeAsync(2_000)

            env.pairing.setVisitOpen(false)

            expect(env.events('pairing search ended')).toEqual([expect.objectContaining({ via: 'left_page' })])
        })

        test('a new visit gets a new automatic search; opening the same visit again does not', async () => {
            await env.start()
            await jest.advanceTimersByTimeAsync(duration + 5_000)

            env.pairing.setVisitOpen(true)
            expect(env.pairing.getSearchStatus().ended).toBe(true)

            env.pairing.setVisitOpen(false)
            env.pairing.setVisitOpen(true)
            expect(env.pairing.getSearchStatus()).toMatchObject({ ended: false, index: 0 })
        })
    })
})

describe.each<Mode>(['direct', 'page'])('DevicePairingService - no Pairing page visit open, usage:%s', (mode) => {

    let env: ReturnType<typeof setup>

    beforeEach(() => {
        jest.useFakeTimers()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})
        env = setup(mode, { visitOpen: false })
    })

    afterEach(async () => {
        await env.teardown()
        jest.clearAllTimers()
        jest.useRealTimers()
        AdapterFactory.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    test('scanning repeats as before and no search is tracked', async () => {
        await env.start()
        await jest.advanceTimersByTimeAsync(100_000)

        expect(env.access.scan.mock.calls.length).toBeGreaterThan(2)
        expect(env.pairing.getSearchStatus()).toMatchObject({ running: false, ended: false, index: 0 })
        expect(env.events('pairing search ended')).toEqual([])
    })
})
