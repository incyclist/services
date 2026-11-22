/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { RideDisplayService } from './service'
import { StartContentInfo } from '../base'

const OC = expect.objectContaining

describe('RideDisplayService - start overlay', () => {
    let service: any
    let mode: any
    let devices: any
    let settings: Record<string, unknown>
    let rideCompleted: boolean
    let content: StartContentInfo | undefined
    let overlayProps: Record<string, unknown>
    let logs: any[]

    const trainer = { udid: 'T', name: 'Trainer', isControl: true, capabilities: [], isStarted: false }
    const hrm = { udid: 'H', name: 'HRM', isControl: false, capabilities: [], isStarted: false }
    const cadence = { udid: 'C', name: 'Cadence', isControl: false, capabilities: [], isStarted: false }

    const flush = () => jest.advanceTimersByTimeAsync(0)
    const props = () => service.getStartOverlayProps()
    const row = (udid: string) => props().devices.find((d: any) => d.udid === udid)
    const logged = (message: string) => logs.filter(l => l.message === message)

    const requestStart = (...infos: any[]) => devices.emit('start-request', infos)
    const deviceOK = (udid: string) => devices.emit('start-success', { udid })
    const deviceError = (udid: string) => devices.emit('start-error', { udid })
    const refresh = () => mode.emit('state-update')

    beforeEach(() => {
        jest.useFakeTimers()
        rideCompleted = true
        content = undefined
        overlayProps = {}
        settings = {}
        logs = []

        devices = Object.assign(new EventEmitter(), {
            start: jest.fn().mockResolvedValue(true),
            startRetry: jest.fn().mockResolvedValue(true),
            retryStartDevice: jest.fn().mockResolvedValue(true),
            cancelStart: jest.fn().mockResolvedValue(true),
            pause: jest.fn(),
        })
        mode = Object.assign(new EventEmitter(), {
            isStartRideCompleted: jest.fn(() => rideCompleted),
            getStartOverlayProps: jest.fn(() => overlayProps),
            getStartContentInfo: jest.fn(() => content),
            getLogProps: jest.fn(() => ({ mode: 'follow-route' })),
            onStartDevicesReady: jest.fn(),
            start: jest.fn(),
            stop: jest.fn().mockResolvedValue(undefined),
            onStarted: jest.fn(),
        })

        Inject('UserSettings', { get: jest.fn((k: string, d: unknown) => settings[k] ?? d) })
        Inject('ActivityRide', { getActivity: jest.fn().mockReturnValue({ id: 'a' }), stop: jest.fn().mockResolvedValue(undefined) })
        Inject('DeviceRide', devices)
        Inject('RouteList', { getSelected: jest.fn(), getStartSettings: jest.fn().mockReturnValue({}) })
        Inject('PairingVisitTracker', { onRideStarted: jest.fn() })

        service = new RideDisplayService()
        service.observer = new Observer()
        service.displayService = mode
        service.getRideModeService = jest.fn(() => mode)
        service.getRideType = jest.fn(() => 'GPX')
        service.getDeviceStartProps = jest.fn(() => ({}))
        service.getCoaches = jest.fn(() => ({ startRide: jest.fn().mockResolvedValue(undefined), stopRide: jest.fn().mockResolvedValue(undefined) }))
        service.getBike = jest.fn()
        service.getBikeInterface = jest.fn()
        service.createActivity = jest.fn()
        service.initWorkout = jest.fn()
        service.updateActivityWorkout = jest.fn()
        service.disableScreensaver = jest.fn()
        service.startListeningForDeviceData = jest.fn()
        service.logEvent = jest.fn((e: any) => { logs.push(e) })
        service.logError = jest.fn()
    })

    afterEach(() => {
        service.clearStartTimers()
        jest.useRealTimers()
        Inject('UserSettings', null)
        Inject('ActivityRide', null)
        Inject('DeviceRide', null)
        Inject('RouteList', null)
        Inject('PairingVisitTracker', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('phases', () => {
        test('starts in the devices phase', () => {
            service.start()
            requestStart(trainer, hrm)

            expect(props()).toEqual(OC({ startPhase: 'devices', startSlow: false }))
            expect(logged('start phase entered')).toEqual([OC({ startPhase: 'devices', startElapsedMs: 0, mode: 'follow-route' })])
        })

        test('Workout: no content row, goes from devices straight to ready', async () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(400)

            expect(props().startContent).toBeUndefined()
            expect(props()).toEqual(OC({ startPhase: 'ready', readyToStart: true }))
            expect(props().startReadyInfo).toEqual({ pendingSensors: ['HRM'], notConnectedSensors: [], viewFallback: false })
        })

        test.each([
            ['GPX map', { kind: 'map', label: 'Map', state: 'loading' }],
            ['GPX satellite', { kind: 'satellite', label: 'Satellite View', state: 'loading' }],
            ['Street View', { kind: 'streetview', label: 'Street View', state: 'loading' }],
            ['Free Ride options', { kind: 'map', label: 'Map', state: 'loading' }],
            ['Video', { kind: 'video', label: 'Video', state: 'loading' }],
            ['AVI converting', { kind: 'video', label: 'Video', state: 'loading', progress: { convertPct: 20, convertSeconds: 10 } }],
        ])('%s: content phase while the content loads, then ready once it is loaded', async (_name, info) => {
            content = info as StartContentInfo
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(400)

            expect(props()).toEqual(OC({ startPhase: 'content', startContent: info, readyToStart: false }))
            expect(props().startReadyInfo).toBeUndefined()

            rideCompleted = true
            content = { ...info, state: 'ready' } as StartContentInfo
            refresh()
            await jest.advanceTimersByTimeAsync(400)

            expect(props()).toEqual(OC({ startPhase: 'ready', startContent: OC({ state: 'ready' }), readyToStart: true }))
        })

        test('a phase change is only reported after 400ms', async () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')

            await jest.advanceTimersByTimeAsync(399)
            expect(props().startPhase).toBe('devices')

            await jest.advanceTimersByTimeAsync(1)
            expect(props().startPhase).toBe('content')
            expect(logged('start phase entered').map(l => l.startPhase)).toEqual(['devices', 'content'])
        })

        test('the timer that reports a phase emits a state update', async () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            const updates = jest.fn()
            service.observer.on('state-update', updates)
            deviceOK('T')
            updates.mockClear()

            await jest.advanceTimersByTimeAsync(400)

            expect(updates).toHaveBeenCalled()
        })

        test('no ready phase for a sensor that connects within 400ms; Start stays available', async () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            expect(props().readyToStart).toBe(true)

            await jest.advanceTimersByTimeAsync(399)
            deviceOK('H')

            expect(service.getState()).toBe('Started')
            expect(logged('start phase entered').map(l => l.startPhase)).toEqual(['devices'])
            expect(jest.getTimerCount()).toBe(0)
        })

        test('a phase that does not hold is not reported', async () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(300)
            rideCompleted = true
            deviceError('H')
            await jest.advanceTimersByTimeAsync(500)

            expect(logged('start phase entered').map(l => l.startPhase)).toEqual(['devices', 'ready'])
        })

        test('ready info lists sensors that are not connected, and the Street View fallback', async () => {
            overlayProps = { viewState: 'unavailable' }
            service.start()
            requestStart(trainer, hrm, cadence)
            deviceOK('T')
            deviceError('H')
            await jest.advanceTimersByTimeAsync(400)

            expect(props().startReadyInfo).toEqual({ pendingSensors: ['Cadence'], notConnectedSensors: ['HRM'], viewFallback: true })
        })
    })

    describe('slow detection', () => {
        test('devices: slow after 10s with the trainer still starting', async () => {
            service.start()
            requestStart(trainer)

            await jest.advanceTimersByTimeAsync(9999)
            expect(props().startSlow).toBe(false)

            await jest.advanceTimersByTimeAsync(1)
            expect(props().startSlow).toBe(true)
            expect(logged('start slow shown')).toEqual([OC({ startPhase: 'devices', slowCause: 'devices', startElapsedMs: 10000 })])
        })

        test('the slow event is logged once per phase', async () => {
            service.start()
            requestStart(trainer)
            await jest.advanceTimersByTimeAsync(12000)
            refresh()

            expect(logged('start slow shown')).toHaveLength(1)
        })

        test('the threshold can be overridden by the START_SLOW_THRESHOLD setting', async () => {
            settings.START_SLOW_THRESHOLD = 3000
            service.start()
            requestStart(trainer)

            await jest.advanceTimersByTimeAsync(2999)
            expect(props().startSlow).toBe(false)
            await jest.advanceTimersByTimeAsync(1)
            expect(props().startSlow).toBe(true)
        })

        test('devices: an upload in progress is not slow', async () => {
            service.start()
            requestStart(trainer)
            devices.emit('start-update', { udid: 'T' }, 1, 10)

            await jest.advanceTimersByTimeAsync(11000)

            expect(props().startSlow).toBe(false)
            expect(row('T')).toEqual(OC({ startState: 'uploading', canRetry: false }))
        })

        test('devices: a slow sensor does not make the phase slow', async () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(11000)

            expect(props().startSlow).toBe(false)
            expect(row('H')).toEqual(OC({ slow: true, canRetry: true, canIgnore: true }))
        })

        test('content: slow 10s after the content phase was entered', async () => {
            rideCompleted = false
            content = { kind: 'map', label: 'Map', state: 'loading' }
            service.start()
            requestStart(trainer)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(400)
            expect(props().startPhase).toBe('content')

            await jest.advanceTimersByTimeAsync(9999)
            expect(props().startSlow).toBe(false)
            await jest.advanceTimersByTimeAsync(1)

            expect(props().startSlow).toBe(true)
            expect(logged('start slow shown')).toEqual([OC({ startPhase: 'content', slowCause: 'content' })])
        })

        test('content: Street View is slow as soon as it reports slow, without a timer of its own', () => {
            rideCompleted = false
            content = { kind: 'streetview', label: 'Street View', state: 'loading' }
            overlayProps = { viewState: 'slow' }
            service.start()
            requestStart(trainer)
            deviceOK('T')
            service.reportedPhase = 'content'
            refresh()

            expect(props().startSlow).toBe(true)
            expect(logged('start slow shown')).toEqual([OC({ slowCause: 'streetview' })])
        })

        describe('AVI conversion', () => {
            const convert = (pct: number, seconds: number) => {
                content = { kind: 'video', label: 'Video', state: 'loading', progress: { convertPct: pct, convertSeconds: seconds } }
                refresh()
            }

            beforeEach(async () => {
                rideCompleted = false
                convert(0, 0)
                service.start()
                requestStart(trainer)
                deviceOK('T')
                await jest.advanceTimersByTimeAsync(400)
            })

            test('advancing progress is not slow, however long it takes', async () => {
                for (let i = 1; i <= 8; i++) {
                    await jest.advanceTimersByTimeAsync(5000)
                    convert(i * 5, i * 10)
                }
                expect(props().startSlow).toBe(false)
                expect(logged('start slow shown')).toHaveLength(0)
            })

            test('a stall of 10s is slow, and progress ends it', async () => {
                convert(10, 20)
                await jest.advanceTimersByTimeAsync(9999)
                expect(props().startSlow).toBe(false)

                await jest.advanceTimersByTimeAsync(1)
                expect(props().startSlow).toBe(true)
                expect(logged('start slow shown')).toEqual([OC({ slowCause: 'convert-stall' })])

                convert(11, 22)
                expect(props().startSlow).toBe(false)
            })
        })

        test('ready: never slow', async () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(30000)

            expect(props()).toEqual(OC({ startPhase: 'ready', startSlow: false }))
        })

        test('all timers are cleared when the start completes', async () => {
            service.start()
            requestStart(trainer, hrm)
            expect(jest.getTimerCount()).toBeGreaterThan(0)
            deviceOK('T')
            deviceOK('H')

            expect(service.getState()).toBe('Started')
            expect(jest.getTimerCount()).toBe(0)
        })

        test('all timers are cleared when the ride is cancelled', async () => {
            service.start()
            requestStart(trainer, hrm)

            await service.cancelStart()

            expect(jest.getTimerCount()).toBe(0)
        })
    })

    describe('device rows', () => {
        const setup = (d: any, attempt?: { slow: boolean }, ignored = false) => {
            service.deviceInfo = [d]
            if (attempt) service.deviceAttempts.set(d.udid, attempt)
            if (ignored) service.ignoredDevices.set(d.udid, 0)
            return service.getDeviceStartFields(d)
        }
        const ctrl = (status: string, stateText?: string) => ({ udid: 'T', name: 'T', isControl: true, status, stateText, capabilities: [] })
        const sens = (status: string) => ({ udid: 'H', name: 'H', isControl: false, status, capabilities: [] })

        test.each([
            ['starting', ctrl('Starting'), false, 'starting', false, false],
            ['slow', ctrl('Starting'), true, 'starting', true, false],
            ['slow, uploading', ctrl('Starting', 'uploading (1%)'), true, 'uploading', false, false],
            ['started', ctrl('Started'), false, 'started', false, false],
            ['error', ctrl('Error'), false, 'failed', false, false],
        ])('trainer %s', (_n, d, slow, startState, canRetry, canIgnore) => {
            expect(setup(d, { slow })).toEqual(OC({ startState, canRetry, canIgnore }))
        })

        test.each([
            ['starting', sens('Starting'), false, false, 'starting', false, false],
            ['slow', sens('Starting'), true, false, 'starting', true, true],
            ['started', sens('Started'), true, false, 'started', false, false],
            ['error', sens('Error'), false, false, 'not-connected', true, true],
            ['ignored, still starting', sens('Starting'), true, true, 'ignored', true, false],
            ['ignored, error', sens('Error'), false, true, 'ignored', true, false],
            ['ignored, but connected', sens('Started'), false, true, 'started', false, false],
        ])('sensor %s', (_n, d, slow, ignored, startState, canRetry, canIgnore) => {
            expect(setup(d, { slow }, ignored)).toEqual(OC({ startState, canRetry, canIgnore }))
        })
    })

    describe('retryStartDevice', () => {
        beforeEach(async () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            deviceError('H')
        })

        test('restarts only that device and keeps the other rows', () => {
            service.retryStartDevice('H')

            expect(devices.retryStartDevice).toHaveBeenCalledWith('H', {})
            expect(devices.startRetry).not.toHaveBeenCalled()
            expect(row('H')).toEqual(OC({ status: 'Starting', startState: 'starting', slow: false, canRetry: false }))
            expect(row('T').status).toBe('Started')
        })

        test('the 10s of the device start again', async () => {
            await jest.advanceTimersByTimeAsync(5000)
            service.retryStartDevice('H')
            await jest.advanceTimersByTimeAsync(9999)
            expect(row('H').slow).toBe(false)

            await jest.advanceTimersByTimeAsync(1)
            expect(row('H')).toEqual(OC({ slow: true, canRetry: true, canIgnore: true }))
        })

        test('logs the click', () => {
            service.retryStartDevice('H')

            expect(logged('button clicked')).toEqual([OC({
                overlay: 'start overlay', button: 'Retry device', device: 'HRM', deviceRole: 'sensor',
                deviceStartState: 'not-connected', startPhase: expect.any(String), eventSource: 'user'
            })])
        })

        test('Retry on an ignored sensor waits for it again', () => {
            rideCompleted = false
            service.ignoreStartDevice('H')
            service.retryStartDevice('H')

            expect(row('H').startState).toBe('starting')
            expect(service.ignoredDevices.size).toBe(0)
        })

        test('is ignored when the ride is not starting', () => {
            service.state = 'Active'
            service.retryStartDevice('H')

            expect(devices.retryStartDevice).not.toHaveBeenCalled()
        })

        test('an error of the device service does not escape', async () => {
            devices.retryStartDevice.mockRejectedValue(new Error('x'))
            service.logError = jest.fn()

            service.retryStartDevice('H')
            await flush()

            expect(service.logError).toHaveBeenCalledWith(expect.any(Error), 'retryStartDevice')
        })
    })

    describe('ignoreStartDevice', () => {
        test('closes the overlay if the sensor was the last thing the start waited for', () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')

            service.ignoreStartDevice('H')

            expect(service.getState()).toBe('Started')
            expect(logged('Start success')[0]).toEqual(OC({ ignoredSensors: 1, missingSensors: 0, startTrigger: 'auto', deviceRetries: 0 }))
            expect(logged('button clicked')).toEqual([OC({ button: 'Ignore device', deviceRole: 'sensor' })])
        })

        test('does not close the overlay while the content or the trainer are not ready', () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')

            service.ignoreStartDevice('H')

            expect(service.getState()).toBe('Starting')
            expect(row('H')).toEqual(OC({ startState: 'ignored', canIgnore: false, canRetry: true }))
        })

        test('never ignores the trainer', () => {
            service.start()
            requestStart(trainer, hrm)

            service.ignoreStartDevice('T')

            expect(service.ignoredDevices.size).toBe(0)
        })

        test('an ignored sensor that connects flips to started, and is logged', async () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            service.ignoreStartDevice('H')
            await jest.advanceTimersByTimeAsync(2500)

            deviceOK('H')

            expect(row('H').startState).toBe('started')
            expect(logged('ignored sensor connected')).toEqual([{ message: 'ignored sensor connected', device: 'HRM', ignoredForMs: 2500, afterStart: false }])
        })

        test('an ignored sensor that connects after the overlay was closed is logged', () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            service.ignoreStartDevice('H')

            deviceOK('H')

            expect(logged('ignored sensor connected')).toEqual([OC({ afterStart: true })])
        })

        test('the Start button is not counted as an automatic close', () => {
            service.start()
            requestStart(trainer, hrm, cadence)
            deviceOK('T')
            service.ignoreStartDevice('H')

            service.startWithMissingSensors()

            expect(logged('Start success')[0]).toEqual(OC({ startTrigger: 'start-button', ignoredSensors: 1, missingSensors: 1 }))
        })
    })

    describe('retryStart', () => {
        test('keeps the rows of devices that are already started', () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            deviceOK('H')
            // the trainer failed afterwards
            service.deviceInfo.find((d: any) => d.udid === 'T').status = 'Error'
            service.retryStart()

            requestStart(trainer, { ...hrm, isStarted: true })

            expect(row('H').status).toBe('Started')
            expect(row('T').status).toBe('Starting')
        })

        test('only the request that follows the retry keeps started devices', () => {
            service.start()
            service.retryStart()
            requestStart(trainer, { ...hrm, isStarted: true })
            requestStart(trainer, { ...hrm, isStarted: true })

            expect(row('H').status).toBe('Starting')
        })

        test('a new start shows all devices as starting', () => {
            service.start()
            requestStart(trainer, { ...hrm, isStarted: true })

            expect(row('H').status).toBe('Starting')
        })

        test('the ignored sensors are kept', () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            service.ignoreStartDevice('H')
            service.retryStart()

            expect(service.ignoredDevices.has('H')).toBe(true)
        })
    })

    describe('cancelStart', () => {
        test('stops devices that are being retried', async () => {
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            service.retryStartDevice('H')

            await service.cancelStart()

            expect(devices.cancelStart).toHaveBeenCalled()
            expect(logged('start ride cancel')[0]).toEqual(OC({ startPhase: 'devices', deviceRetries: 1, slowShown: false, startElapsedMs: expect.any(Number) }))
        })

        test('does not wait longer than 5s for the devices to stop', async () => {
            devices.cancelStart.mockReturnValue(new Promise(() => { /* never settles */ }))
            service.start()
            requestStart(trainer, hrm)
            service.retryStartDevice('H')

            let done = false
            service.cancelStart().then(() => { done = true })
            await jest.advanceTimersByTimeAsync(4999)
            expect(done).toBe(false)

            await jest.advanceTimersByTimeAsync(1)
            expect(done).toBe(true)
        })

        test('does not touch the device service if no device was retried', async () => {
            service.start()
            requestStart(trainer, hrm)

            await service.cancelStart()

            expect(devices.cancelStart).not.toHaveBeenCalled()
        })
    })

    describe('log payload types', () => {
        test('the new fields have one type each', async () => {
            rideCompleted = false
            service.start()
            requestStart(trainer, hrm)
            deviceOK('T')
            await jest.advanceTimersByTimeAsync(10500)
            service.onStartCompleted()

            const phase = logged('start phase entered')[0]
            expect(typeof phase.startPhase).toBe('string')
            expect(typeof phase.startElapsedMs).toBe('number')

            const slow = logged('start slow shown')[0]
            expect([typeof slow.startPhase, typeof slow.slowCause, typeof slow.startElapsedMs]).toEqual(['string', 'string', 'number'])

            const success = logged('Start success')[0]
            expect(['startElapsedMs', 'ignoredSensors', 'missingSensors', 'deviceRetries'].map(k => typeof success[k])).toEqual(['number', 'number', 'number', 'number'])
            expect(['startTrigger'].map(k => typeof success[k])).toEqual(['string'])
            expect(['slowShown'].map(k => typeof success[k])).toEqual(['boolean'])
        })
    })
})
