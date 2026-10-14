/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'
import { Inject } from '../../base/decorators'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../configuration'
import { PairingPageStateMachine } from '../page/mobile/statemachine'
import { isCapabilityActive } from './capability'
import { DevicePairingService } from './service'

// Pairing with a device excluded as "not available", in both pairing modes: 'direct' runs
// DevicePairingService's own loop, 'page' is driven by the mobile page state machine.
// The configuration service is real; the ride and access services are fakes that decide which
// devices answer a connection attempt or a scan.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })
const FALLBACK = { reason: 'not-available', scope: 'until-next-pairing' } as const

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

const wait = (ms: number) => new Promise(done => setTimeout(done, ms))

class FakeRide extends EventEmitter {
    awake = new Set<string>()
    started = new Set<string>()

    startAdapters = jest.fn(async (adapters: Array<{ udid: string }>) => {
        await wait(1000)
        adapters.forEach(ai => {
            if (this.awake.has(ai.udid)) {
                this.started.add(ai.udid)
                this.emit('pair-success', ai.udid)
            }
            else {
                this.emit('pair-error', ai.udid)
            }
        })
        return true
    })
    stop = jest.fn().mockResolvedValue(true)
    cancelStart = jest.fn().mockResolvedValue(true)
    lazyInit = jest.fn().mockResolvedValue(true)
    waitForPreviousStartToFinish = jest.fn().mockResolvedValue(true)
    onData = jest.fn()
}

class FakeAccess extends EventEmitter {
    // devices a scan reports, by settings
    announced: Array<Record<string, unknown>> = []

    scan = jest.fn(async () => {
        await wait(1000)
        this.announced.forEach(settings => this.emit('device', settings))
        await wait(5000)
        return []
    })
    stopScan = jest.fn().mockResolvedValue(true)
    enrichWithAccessState = jest.fn((ifs: any[]) => (ifs ?? []).map(i => ({ ...i, state: 'connected', isScanning: false })))
    enableInterface = jest.fn().mockResolvedValue(true)
    disableInterface = jest.fn().mockResolvedValue(true)
}

type Mode = 'direct' | 'page'

const setup = (mode: Mode) => {
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

    const trainer = configuration.add(Trainer('1'))
    const powerMeter = configuration.add(PowerMeter('2'))
    configuration.select(powerMeter, IncyclistCapability.Power)

    // the fakes decide whether an adapter counts as started
    const adapterFor = (udid: string) => {
        const adapter = configuration.adapters[udid] as any
        jest.spyOn(adapter, 'isStarted').mockImplementation(() => ride.started.has(udid))
        jest.spyOn(adapter, 'isStopped').mockImplementation(() => !ride.started.has(udid))
        jest.spyOn(adapter, 'stop').mockImplementation(async () => { ride.started.delete(udid); return true })
        return adapter
    }
    const trainerAdapter = adapterFor(trainer)
    adapterFor(powerMeter)

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
    const reverted = () => logEvent.mock.calls.filter(([e]: any) => e?.message === 'pairing fallback reverted')

    const isLive = () => {
        const p = pairing as any
        if (p.isPairing() || pairing.isScanning())
            return true
        return !(pairing.getState().capabilities ?? []).some(c => isCapabilityActive(c) && c.connectState === 'waiting')
    }

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

    return { configuration, ride, access, pairing, trainer, powerMeter, trainerAdapter, start, attemptsFor, reverted, isLive, teardown, sm }
}

describe.each<Mode>(['direct', 'page'])('DevicePairingService with exclusions, usage:%s', (mode) => {

    let env: ReturnType<typeof setup>

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

    // the rider chose to ride on the power meter while the page is open
    const openVisitWithFallback = () => {
        env.pairing.setVisitOpen(true)
        env.configuration.excludeDevice(env.trainer, FALLBACK)
        env.ride.awake.add(env.powerMeter)
    }

    describe('auto-revert', () => {

        test('while a visit is open, the excluded trainer keeps being tried even though the ride is ready', async () => {
            openVisitWithFallback()

            await env.start()
            await jest.advanceTimersByTimeAsync(10_000)

            expect(env.pairing.getState().canStartRide).toBe(true)
            expect(env.attemptsFor(env.trainer)).toBeGreaterThan(1)
        })

        test('when the excluded trainer connects while a visit is open, it is taken back into use', async () => {
            openVisitWithFallback()
            const onReverted = jest.fn()
            env.pairing.on('exclusion-reverted', onReverted)

            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)
            expect(env.configuration.getExclusions()).not.toHaveLength(0)

            env.ride.awake.add(env.trainer)
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.configuration.getExclusions()).toHaveLength(0)
            expect(env.configuration.getSelected(IncyclistCapability.Control)).toBe(env.trainerAdapter)
            expect(onReverted).toHaveBeenCalledTimes(1)
            expect(onReverted.mock.calls[0][0]).toMatchObject({ udid: env.trainer })
            expect([...onReverted.mock.calls[0][0].capabilities].sort()).toEqual(
                [IncyclistCapability.Cadence, IncyclistCapability.Control, IncyclistCapability.Speed].sort())
        })

        test('the revert is logged once, with numeric timings only', async () => {
            openVisitWithFallback()
            env.ride.awake.add(env.trainer)

            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            const calls = env.reverted()
            expect(calls).toHaveLength(1)
            const [event] = calls[0] as any
            // 'ts' is added by the logger itself
            expect(Object.keys(event).sort()).toEqual(['message', 'msSinceFallback', 'msSinceOpen', 'ts'])
            expect(typeof event.msSinceOpen).toBe('number')
            expect(typeof event.msSinceFallback).toBe('number')
        })

        test('after the revert, the trainer is no longer retried as an excluded device', async () => {
            openVisitWithFallback()
            env.ride.awake.add(env.trainer)

            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)
            const attempts = env.attemptsFor(env.trainer)

            await jest.advanceTimersByTimeAsync(10_000)

            expect(env.pairing.isPairingSettled()).toBe(true)
            expect(env.attemptsFor(env.trainer)).toBe(attempts)
        })

        test('an excluded trainer reported by a scan, with no fallback device connected, is taken back into use', async () => {
            env.pairing.setVisitOpen(true)
            env.configuration.excludeDevice(env.trainer, FALLBACK)
            env.configuration.disableCapability(IncyclistCapability.Power) // no fallback device either
            env.access.announced.push(Trainer('1'))

            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.access.scan).toHaveBeenCalled()
            expect(env.configuration.getExclusions()).toHaveLength(0)
            expect(env.reverted()).toHaveLength(1)
        })
    })

    describe('no visit open', () => {

        test('the excluded trainer is not tried again once the ride is ready', async () => {
            env.configuration.excludeDevice(env.trainer, FALLBACK)
            env.ride.awake.add(env.powerMeter)

            await env.start()
            await jest.advanceTimersByTimeAsync(15_000)

            expect(env.pairing.getState().canStartRide).toBe(true)
            // only the first attempt, made before the ride was ready, included it
            expect(env.attemptsFor(env.trainer)).toBe(1)
        })

        test('a trainer that connects while pairing is active is not taken back into use: the gate is the visit, not pairing', async () => {
            env.configuration.excludeDevice(env.trainer, FALLBACK)
            env.ride.awake.add(env.powerMeter)
            env.ride.awake.add(env.trainer)

            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)

            expect(env.ride.started.has(env.trainer)).toBe(true)
            expect(env.configuration.getExclusions().map(e => e.udid)).toContain(env.trainer)
            expect(env.reverted()).toHaveLength(0)
        })

        test('closing the visit stops the extra attempts', async () => {
            openVisitWithFallback()

            await env.start()
            await jest.advanceTimersByTimeAsync(5_000)
            env.pairing.setVisitOpen(false)
            await jest.advanceTimersByTimeAsync(5_000)
            const attempts = env.attemptsFor(env.trainer)

            await jest.advanceTimersByTimeAsync(15_000)

            expect(env.attemptsFor(env.trainer)).toBe(attempts)
        })
    })

    describe('liveness', () => {

        // after the sequence, within bounded time, either a pairing/scan is running or no active
        // capability is left waiting
        const settle = async () => {
            await jest.advanceTimersByTimeAsync(20_000)
        }

        // restart() sleeps internally, so it only finishes while fake time advances
        const restart = async () => {
            const restarting = (env.pairing as any).restart()
            await settle()
            await restarting
        }

        test('after a restart', async () => {
            openVisitWithFallback()
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)

            await restart()
            await settle()

            expect(env.isLive()).toBe(true)
        })

        test('after unselecting the fallback device', async () => {
            openVisitWithFallback()
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)

            await env.pairing.unselectDevices(IncyclistCapability.Power)
            await settle()

            expect(env.isLive()).toBe(true)
        })

        test('after switching the fallback device off and on again', async () => {
            openVisitWithFallback()
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)

            await env.pairing.unselectDevices(IncyclistCapability.Power)
            await jest.advanceTimersByTimeAsync(3_000)
            env.pairing.useCapability(IncyclistCapability.Power)
            await settle()

            expect(env.isLive()).toBe(true)
        })

        test('after an interface toggle', async () => {
            openVisitWithFallback()
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)

            await env.pairing.changeInterfaceSettings('ble', { name: 'ble', enabled: false })
            await jest.advanceTimersByTimeAsync(3_000)
            await env.pairing.changeInterfaceSettings('ble', { name: 'ble', enabled: true })
            await settle()

            expect(env.isLive()).toBe(true)
        })

        test('with the trainer excluded and nothing else configured', async () => {
            env.pairing.setVisitOpen(true)
            env.configuration.excludeDevice(env.trainer, FALLBACK)
            env.configuration.disableCapability(IncyclistCapability.Power)
            await env.start()

            await restart()
            await settle()

            expect(env.isLive()).toBe(true)
        })
    })

    describe('prepareStart()', () => {

        test('stops a connection attempt still running for the excluded trainer', async () => {
            openVisitWithFallback()
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)
            env.pairing.setVisitOpen(false)
            env.trainerAdapter.stop.mockClear()

            await env.pairing.prepareStart()

            expect(env.trainerAdapter.stop).toHaveBeenCalled()
        })

        test('leaves an excluded device alone if it is still used for a capability that is not excluded', async () => {
            // only Resistance is excluded: the trainer still serves Speed and Cadence
            env.pairing.setVisitOpen(true)
            env.configuration.excludeCapability(IncyclistCapability.Control, FALLBACK)
            env.ride.awake.add(env.powerMeter)
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)
            env.pairing.setVisitOpen(false)
            env.trainerAdapter.stop.mockClear()

            await env.pairing.prepareStart()

            expect(env.trainerAdapter.stop).not.toHaveBeenCalled()
        })

        test('keeps the exclusion for the ride', async () => {
            openVisitWithFallback()
            await env.start()
            await jest.advanceTimersByTimeAsync(3_000)
            env.pairing.setVisitOpen(false)

            await env.pairing.prepareStart()

            expect(env.configuration.getExclusions().map(e => e.udid)).toContain(env.trainer)
            expect(env.configuration.getSelected(IncyclistCapability.Control)).toBeUndefined()
        })
    })
})

describe('DevicePairingService.setVisitOpen()', () => {

    let configuration: DeviceConfigurationService
    let pairing: DevicePairingService
    let trainer: string

    beforeEach(() => {
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})
        configuration = new DeviceConfigurationService()
        configuration.settings = {
            devices: [],
            capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false })),
        }
        configuration.adapters = {}
        configuration.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)
        trainer = configuration.add(Trainer('1'))
        pairing = new DevicePairingService({ configuration, access: new FakeAccess(), ride: new FakeRide() } as any)
    })

    afterEach(() => {
        pairing.reset()
        configuration.reset()
        AdapterFactory.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    test('opening a visit clears exclusions that last until the next visit', () => {
        configuration.excludeDevice(trainer, FALLBACK)

        pairing.setVisitOpen(true)

        expect(configuration.getExclusions()).toHaveLength(0)
    })

    test('opening a visit keeps exclusions that last for the app session', () => {
        configuration.excludeCapability(IncyclistCapability.Control, { reason: 'user', scope: 'app-session' })

        pairing.setVisitOpen(true)

        expect(configuration.getExclusions()).toHaveLength(1)
    })

    test('opening again while a visit is already open clears again, with no error', () => {
        pairing.setVisitOpen(true)
        configuration.excludeDevice(trainer, FALLBACK)

        expect(() => pairing.setVisitOpen(true)).not.toThrow()
        expect(configuration.getExclusions()).toHaveLength(0)
    })

    test('closing a visit keeps the exclusions', () => {
        pairing.setVisitOpen(true)
        configuration.excludeDevice(trainer, FALLBACK)

        pairing.setVisitOpen(false)

        expect(configuration.getExclusions()).not.toHaveLength(0)
    })
})
