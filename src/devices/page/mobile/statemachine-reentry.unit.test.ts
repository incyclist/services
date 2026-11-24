/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { Inject } from '../../../base/decorators'
import { DeviceConfigurationService } from '../../configuration'
import { PairingPageStateMachine } from './statemachine'

/**
 * Characterization of the pairing page state machine around leaving and re-entering the page.
 *
 * Re-entry while work of the visit before is still running: an attempt is adopted, a stop that is still
 * running is waited for by the adapter, scans are stopped by the service on every leave.
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
        activity: any = { stopping: false }
        getActivity() { return this.activity }
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

        test('stop() resets the selection state to Closed', () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())

            sm.stop()

            expect(sm.selectState).toBe('Closed')
        })

        test('stop() clears the selection timeout', () => {
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

        test('onDeviceSelectionClosed() does nothing once stop() was called', async () => {
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

        test('the selection timeout continuation does nothing once stop() was called', async () => {
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

        test('start() after a leave never sees an illegal state', async () => {
            await leaveWithStaleContinuation()
            const logSpy = jest.spyOn((sm as any).logger, 'logEvent')

            sm.start(jest.fn())

            expect(errorLogs(logSpy)).toHaveLength(0)
            expect(sm.state).toBe('Idle')
        })
    })

    describe('re-entry while work of the previous visit is in flight', () => {

        test('re-entering while an attempt is in flight adopts it: state Pairing, no second attempt', () => {
            startPairingPending()
            sm.stop()
            pairing.activity = { pairing: { attemptId: 5, ageMs: 1000, udids: ['1'] }, stopping: false }

            sm.start(jest.fn())
            sm.onPageReady()

            expect(sm.state).toBe('Pairing')
            expect(pairing.startPairing).toHaveBeenCalledTimes(1)
        })

        test('an adopted attempt that finishes sends the machine to Idle with a retry', async () => {
            startPairingPending()
            sm.stop()
            pairing.activity = { pairing: { attemptId: 5, ageMs: 1000, udids: ['1'] }, stopping: false }
            sm.start(jest.fn())

            pairing.emit('pairing-done', { attemptId: 5 })

            expect(sm.state).toBe('Idle')
            expect((sm as any).retryTimeout).toBeDefined()
        })

        test('events of another attempt are ignored and logged', () => {
            startPairingPending()
            sm.stop()
            pairing.activity = { pairing: { attemptId: 5, ageMs: 1000, udids: ['1'] }, stopping: false }
            sm.start(jest.fn())
            const logSpy = jest.spyOn((sm as any).logger, 'logEvent')

            pairing.emit('pairing-done', { attemptId: 3 })

            expect(sm.state).toBe('Pairing')
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'foreign attempt event ignored', attemptId: 3 }))
        })

        test('a stop that is still running at re-entry: Idle, the check starts a new attempt', () => {
            startPairingPending()
            sm.stop()
            pairing.activity = { stopping: true }
            pairing.startPairing.mockClear()

            sm.start(jest.fn())
            sm.onPageReady()

            expect(pairing.startPairing).toHaveBeenCalledTimes(1)
        })

        test('the old attempt\'s cleanup leaves the new attempt\'s marker in place', async () => {
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

        test('pause() ends the session like stop(): handlers removed', async () => {
            sm.start(jest.fn())

            await sm.pause()

            expect(sm.state).toBe('Closed')
            expect(pairing.listenerCount('pairing-done')).toBe(0)
        })

        test('resume() after pause() opens the session again like start()', async () => {
            const callback = jest.fn()
            sm.start(callback)
            await sm.pause()

            sm.resume()

            expect(sm.state).toBe('Idle')
            expect(pairing.listenerCount('pairing-done')).toBe(1)
        })

        test('resume() after stop() does nothing', () => {
            sm.start(jest.fn())
            sm.stop()

            sm.resume()

            expect(sm.state).toBe('Closed')
        })

        test('today (f): pause() stops a running attempt and then the service', async () => {
            startPairingPending()

            await sm.pause()

            expect(pairing.stopPairing).toHaveBeenCalledTimes(1)
            expect(pairing.stop).toHaveBeenCalledWith([], true)
        })

        test('resume() only opens a Closed machine, it never changes a running one', () => {
            startPairingPending()

            sm.resume()

            expect(sm.state).toBe('Pairing')
        })
    })

    describe('stale continuations are logged', () => {

        test('a dropped continuation logs "stale continuation dropped"', async () => {
            startPairingPending()
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            const logSpy = jest.spyOn((sm as any).logger, 'logEvent')
            const closing = sm.onDeviceSelectionClosed()
            sm.stop()
            stopPairing.resolve()
            await closing

            const dropped = logSpy.mock.calls.filter(([e]: any) => e?.message === 'stale continuation dropped')
            expect(dropped).toHaveLength(1)
            expect((dropped[0][0] as any).fn).toBe('onDeviceSelectionClosed')
        })

        test('the list close and the selection timeout share one stopPairing() call', async () => {
            startPairingPending()
            sm.onDeviceSelectionOpened(jest.fn())
            const stopPairing = deferred()
            pairing.stopPairing.mockReturnValueOnce(stopPairing.promise)
            await jest.advanceTimersByTimeAsync(3000)

            void sm.onDeviceSelectionClosed()

            expect(pairing.stopPairing).toHaveBeenCalledTimes(1)
            stopPairing.resolve()
            await jest.advanceTimersByTimeAsync(0)
        })
    })

    describe('retry timers', () => {

        test('a second retry timer replaces the first one, which is cleared', async () => {
            sm.start(jest.fn())
            sm.onPageReady()
            await (sm as any).pairingPromise
            const clearSpy = jest.spyOn(globalThis, 'clearTimeout')

            pairing.emit('pairing-done')
            const first = (sm as any).retryTimeout
            pairing.emit('pairing-done')

            expect(clearSpy).toHaveBeenCalledWith(first)
            clearSpy.mockRestore()
        })
    })
})
