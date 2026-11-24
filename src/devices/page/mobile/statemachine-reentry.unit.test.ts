/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { Inject } from '../../../base/decorators'
import { DeviceConfigurationService } from '../../configuration'
import { PairingPageStateMachine } from './statemachine'

/**
 * Characterization of the pairing page state machine around leaving and re-entering the page.
 *
 * Tests named `today:` pin the behaviour as it is now, including behaviour that is wrong.
 * Tests wrapped in `test.failing` describe the intended behaviour and are known defects: they pass
 * (as "expected to fail") as long as the defect exists. When the defect is fixed, jest reports
 * them as failing, and the fixing change flips them to plain `test`.
 */
describe('PairingPage state machine: leave and re-entry', () => {

    let sm: PairingPageStateMachine

    class MockPairingService extends EventEmitter {
        pairingComplete = false
        isPairingSettled() { return this.pairingComplete }
        prepareForRide() { /* nothing to prepare */ }
        startPairing = jest.fn().mockResolvedValue(undefined)
        startScanning = jest.fn().mockResolvedValue(undefined)
        stopPairing = jest.fn().mockResolvedValue(undefined)
        stopScanning = jest.fn().mockResolvedValue(undefined)
        stop = jest.fn().mockResolvedValue(undefined)
    }

    let pairing: MockPairingService
    let configMock: Partial<DeviceConfigurationService>

    // a promise the test resolves by hand
    const deferred = () => {
        let resolve!: () => void
        const promise = new Promise<void>(done => { resolve = done })
        return { promise, resolve }
    }

    const errorLogs = (spy: jest.SpyInstance) => spy.mock.calls.filter(([e]: any) => e?.message === 'error')

    beforeEach(() => {
        jest.useFakeTimers()
        pairing = new MockPairingService()
        configMock = {
            canStartRide: jest.fn().mockReturnValue(true),
            getAdapters: jest.fn().mockReturnValue([]),
        }
        Inject('DevicePairing', pairing)
        Inject('DeviceConfiguration', configMock)
        sm = new PairingPageStateMachine()
    })

    afterEach(() => {
        sm.stop()
        Inject('DevicePairing', null)
        Inject('DeviceConfiguration', null)
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    // brings the machine to 'Pairing' with a startPairing() that stays pending
    const startPairingPending = () => {
        const attempt = deferred()
        pairing.startPairing.mockReturnValueOnce(attempt.promise)
        sm.start(jest.fn())
        sm.onPageReady()
        expect(sm.state).toBe('Pairing')
        return attempt
    }

    // brings the machine to 'Scanning' with a startScanning() that stays pending
    const startScanningPending = () => {
        const scan = deferred()
        ;(configMock.canStartRide as jest.Mock).mockReturnValue(false)
        pairing.startScanning.mockReturnValueOnce(scan.promise)
        sm.start(jest.fn())
        sm.onPageReady()
        expect(sm.state).toBe('Scanning')
        return scan
    }

    describe('stop()', () => {

        test('today: puts the machine in Closed and removes the service handlers', () => {
            sm.start(jest.fn())
            expect(pairing.listenerCount('pairing-done')).toBe(1)

            sm.stop()

            expect(sm.state).toBe('Closed')
            expect(pairing.listenerCount('pairing-done')).toBe(0)
        })

        test('today: the selection state survives stop() (known defect R1)', () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())
            expect(sm.selectState).toBe('Waiting')

            sm.stop()

            expect(sm.selectState).toBe('Waiting')
        })

        test.failing('known defect R1: stop() resets the selection state to Closed', () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())

            sm.stop()

            expect(sm.selectState).toBe('Closed')
        })

        test('today: the selection timeout survives stop() (known defect R1)', () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())

            sm.stop()

            expect((sm as any).selectionTimeout).toBeDefined()
        })

        test.failing('known defect R1: stop() clears the selection timeout', () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())

            sm.stop()

            expect((sm as any).selectionTimeout).toBeUndefined()
        })

        test('the selection timeout firing after stop() starts nothing, as the machine is Closed', async () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())
            sm.stop()
            pairing.startScanning.mockClear()

            await jest.advanceTimersByTimeAsync(5000)

            expect(pairing.startScanning).not.toHaveBeenCalled()
            expect(pairing.stopPairing).not.toHaveBeenCalled()
        })

        test('a retry timer pending at stop() is cleared and does not start work', async () => {
            sm.start(jest.fn())
            sm.onPageReady()
            await (sm as any).pairingPromise
            pairing.emit('pairing-done')            // schedules the 2s retry
            expect(sm.state).toBe('Idle')
            sm.stop()
            pairing.startPairing.mockClear()

            await jest.advanceTimersByTimeAsync(5000)

            expect(pairing.startPairing).not.toHaveBeenCalled()
            expect(sm.state).toBe('Closed')
        })
    })

    describe('continuations of a device selection that was closed before stop()', () => {

        test('today: onDeviceSelectionClosed() continues after stop() and starts a new pairing attempt (known defect R1)', async () => {
            startPairingPending()
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)

            const closing = sm.onDeviceSelectionClosed()     // awaits stopPairing()
            sm.stop()                                        // the rider leaves the page
            expect(sm.state).toBe('Closed')
            stopPairing.resolve()
            await closing

            expect(pairing.startPairing).toHaveBeenCalledTimes(2)
            expect(sm.state).toBe('Pairing')
        })

        test.failing('known defect R1: onDeviceSelectionClosed() does nothing once stop() was called', async () => {
            startPairingPending()
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)

            const closing = sm.onDeviceSelectionClosed()
            sm.stop()
            stopPairing.resolve()
            await closing

            expect(pairing.startPairing).toHaveBeenCalledTimes(1)
            expect(sm.state).toBe('Closed')
        })

        test('today: the selection timeout continuation starts a scan after stop() (known defect R1)', async () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())             // Waiting + 3s timer
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            await jest.advanceTimersByTimeAsync(3000)         // timer fires, awaits stopPairing()

            sm.stop()
            stopPairing.resolve()
            await jest.advanceTimersByTimeAsync(0)

            expect(pairing.startScanning).toHaveBeenCalledTimes(1)
            expect(sm.selectState).toBe('Active')
        })

        test.failing('known defect R1: the selection timeout continuation does nothing once stop() was called', async () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            await jest.advanceTimersByTimeAsync(3000)

            sm.stop()
            stopPairing.resolve()
            await jest.advanceTimersByTimeAsync(0)

            expect(pairing.startScanning).not.toHaveBeenCalled()
            expect(sm.selectState).toBe('Closed')
        })
    })

    describe('start() after a stale continuation (the production error E1)', () => {

        const leaveWithStaleContinuation = async () => {
            startPairingPending()
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            const closing = sm.onDeviceSelectionClosed()
            sm.stop()
            stopPairing.resolve()
            await closing
        }

        test('today: start() logs "State machine in illegal state Pairing" and does not register handlers', async () => {
            await leaveWithStaleContinuation()
            const logSpy = jest.spyOn((sm as any).logger, 'logEvent')

            sm.start(jest.fn())

            const errors = errorLogs(logSpy)
            expect(errors).toHaveLength(1)
            expect(errors[0][0].error).toBe('State machine in illegal state Pairing')
            expect(pairing.listenerCount('pairing-done')).toBe(0)
        })

        test.failing('known defect R1: start() after a leave never sees an illegal state', async () => {
            await leaveWithStaleContinuation()
            const logSpy = jest.spyOn((sm as any).logger, 'logEvent')

            sm.start(jest.fn())

            expect(errorLogs(logSpy)).toHaveLength(0)
            expect(sm.state).toBe('Idle')
        })

        test('today: the same happens with a scan started by the stale continuation (state Scanning)', async () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            await jest.advanceTimersByTimeAsync(3000)
            sm.stop()
            stopPairing.resolve()
            await jest.advanceTimersByTimeAsync(0)
            const logSpy = jest.spyOn((sm as any).logger, 'logEvent')

            sm.start(jest.fn())

            expect(errorLogs(logSpy)[0][0].error).toBe('State machine in illegal state Scanning')
        })
    })

    describe('re-entry while work of the previous visit is in flight', () => {

        test('today (a): re-entering while an attempt is in flight starts a second attempt (known defect R3)', () => {
            startPairingPending()
            sm.stop()

            sm.start(jest.fn())
            sm.onPageReady()

            expect(pairing.startPairing).toHaveBeenCalledTimes(2)
        })

        test.failing('known defect R3: re-entering while an attempt is in flight does not start a second attempt', () => {
            startPairingPending()
            sm.stop()

            sm.start(jest.fn())
            sm.onPageReady()

            expect(pairing.startPairing).toHaveBeenCalledTimes(1)
        })

        test('today (a): the old attempt\'s cleanup clears the new attempt\'s in-flight marker (known defect R1)', async () => {
            const first = startPairingPending()
            sm.stop()
            const second = deferred()
            pairing.startPairing.mockReturnValueOnce(second.promise)
            sm.start(jest.fn())
            sm.onPageReady()
            const secondMarker = (sm as any).pairingPromise
            expect(secondMarker).toBeDefined()

            first.resolve()
            await jest.advanceTimersByTimeAsync(0)

            expect((sm as any).pairingPromise).toBeUndefined()
        })

        test.failing('known defect R1: the old attempt\'s cleanup leaves the new attempt\'s marker in place', async () => {
            const first = startPairingPending()
            sm.stop()
            const second = deferred()
            pairing.startPairing.mockReturnValueOnce(second.promise)
            sm.start(jest.fn())
            sm.onPageReady()
            const secondMarker = (sm as any).pairingPromise

            first.resolve()
            await jest.advanceTimersByTimeAsync(0)

            expect((sm as any).pairingPromise).toBe(secondMarker)
        })

        test('today (b): re-entering while a scan is in flight starts a second scan (known defect R3/R4)', () => {
            startScanningPending()
            sm.stop()
            ;(configMock.canStartRide as jest.Mock).mockReturnValue(false)

            sm.start(jest.fn())
            sm.onPageReady()

            expect(pairing.startScanning).toHaveBeenCalledTimes(2)
        })

        test('today (d): re-entering while a stopPairing is still pending starts pairing straight away', async () => {
            startPairingPending()
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            void sm.onDeviceSelectionClosed()
            sm.stop()
            pairing.startPairing.mockClear()

            sm.start(jest.fn())
            sm.onPageReady()

            expect(pairing.startPairing).toHaveBeenCalledTimes(1)
            stopPairing.resolve()
        })
    })

    describe('pause() and resume()', () => {

        test('today (f): pause() sets Closed but keeps the service handlers registered (known defect R1)', async () => {
            sm.start(jest.fn())

            await sm.pause()

            expect(sm.state).toBe('Closed')
            expect(pairing.listenerCount('pairing-done')).toBe(1)
        })

        test('today (f): pause() stops a running attempt and then the service', async () => {
            startPairingPending()

            await sm.pause()

            expect(pairing.stopPairing).toHaveBeenCalledTimes(1)
            expect(pairing.stop).toHaveBeenCalledWith([], true)
        })

        test('today (f): resume() forces Idle, also while an attempt is running (known defect R1)', () => {
            startPairingPending()
            expect(sm.state).toBe('Pairing')

            sm.resume()

            expect(sm.state).toBe('Idle')
        })

        test.failing('known defect R1: resume() only opens a Closed machine, it never changes a running one', () => {
            startPairingPending()

            sm.resume()

            expect(sm.state).toBe('Pairing')
        })
    })

    describe('retry timers', () => {

        test('today (e): a second retry timer overwrites the first one without clearing it (known defect R1)', async () => {
            sm.start(jest.fn())
            sm.onPageReady()
            await (sm as any).pairingPromise
            const clearSpy = jest.spyOn(globalThis, 'clearTimeout')

            pairing.emit('pairing-done')                     // timer 1
            const first = (sm as any).retryTimeout
            pairing.emit('pairing-done')                     // timer 2 replaces it
            const second = (sm as any).retryTimeout

            expect(second).not.toBe(first)
            expect(clearSpy).not.toHaveBeenCalledWith(first)
            clearSpy.mockRestore()
        })
    })
})
