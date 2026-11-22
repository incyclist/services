import type { PairFailedBody } from '../types'
import { LinkPairing } from './pairing'

describe('LinkPairing', () => {
    let pairing: LinkPairing
    let notify: jest.Mock
    let onChange: jest.Mock
    let pins: string[]
    let ids: number

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(1_000_000)
        notify = jest.fn()
        onChange = jest.fn()
        pins = ['111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888']
        ids = 0
        pairing = new LinkPairing({
            generatePin: () => pins.shift()!, newRequestId: () => `r${++ids}`, onChange, notify,
        })
    })
    afterEach(() => {
        pairing.reset()
        jest.useRealTimers()
    })

    const failed = (body: PairFailedBody) => ({ kind: 'failed', body })

    describe('request', () => {
        test('pairing-closed while the pairing UI is not open', () => {
            expect(pairing.request('c1', 'p1', 'Pixel')).toEqual(failed({ outcome: 'pairing-closed' }))
        })
        test('pending with the 120s expiry when open', () => {
            pairing.open()
            expect(pairing.request('c1', 'p1', 'Pixel')).toEqual({ kind: 'pending', requestId: 'r1', expiresIn: 120 })
            expect(pairing.getWindow()).toMatchObject({ phase: 'code', device: 'Pixel', pin: '111111', attemptsLeft: 3 })
        })
        test('rate-limited per peer after five requests', () => {
            pairing.open()
            for (let i = 0; i < 5; i++)
                pairing.request('c1', 'p1', 'Pixel')
            const res = pairing.request('c1', 'p1', 'Pixel')
            expect(res).toMatchObject({ kind: 'failed', body: { outcome: 'rate-limited' } })
            expect((res as { body: { retryAfter: number } }).body.retryAfter).toBeGreaterThan(0)
        })
        test('rate-limited globally across peers', () => {
            pairing.open()
            pins = Array.from({ length: 30 }, () => '123456')
            for (let i = 0; i < 20; i++)
                expect(pairing.request('c', `peer${i}`, 'X').kind).toBe('pending')
            expect(pairing.request('c', 'peer-new', 'X')).toMatchObject({ kind: 'failed', body: { outcome: 'rate-limited' } })
        })
        test('a new request supersedes the pending one and tells the old connection', () => {
            pairing.open()
            pairing.request('c1', 'p1', 'Pixel')
            pairing.request('c2', 'p2', 'iPad')
            expect(notify).toHaveBeenCalledWith('c1', { outcome: 'superseded' })
            expect(pairing.verify('c1', 'r1', '111111')).toEqual(failed({ outcome: 'superseded' }))
            expect(pairing.getWindow()).toMatchObject({ phase: 'code', device: 'iPad', notice: 'replaced' })
        })
    })

    describe('verify', () => {
        beforeEach(() => {
            pairing.open()
            pairing.request('c1', 'p1', 'Pixel')
        })
        test('accepts the right PIN', () => {
            expect(pairing.verify('c1', 'r1', '111111')).toEqual({ kind: 'accepted', clientName: 'Pixel' })
            expect(pairing.getWindow()).toMatchObject({ phase: 'connected', device: 'Pixel' })
        })
        test('wrong PIN counts down and the third wrong try invalidates the request', () => {
            expect(pairing.verify('c1', 'r1', '000000')).toEqual(failed({ outcome: 'wrong', attemptsRemaining: 2 }))
            expect(pairing.verify('c1', 'r1', '000000')).toEqual(failed({ outcome: 'wrong', attemptsRemaining: 1 }))
            expect(pairing.verify('c1', 'r1', '000000')).toEqual(failed({ outcome: 'wrong', attemptsRemaining: 0 }))
            expect(pairing.verify('c1', 'r1', '111111')).toEqual(failed({ outcome: 'expired' }))
            expect(pairing.getWindow()).toMatchObject({ phase: 'waiting', notice: 'invalidated' })
        })
        test('malformed PIN is a wrong PIN', () => {
            expect(pairing.verify('c1', 'r1', 'abc')).toEqual(failed({ outcome: 'wrong', attemptsRemaining: 2 }))
        })
        test('expires after 120 s and pushes expired', () => {
            jest.advanceTimersByTime(120_000)
            expect(notify).toHaveBeenCalledWith('c1', { outcome: 'expired' })
            expect(pairing.verify('c1', 'r1', '111111')).toEqual(failed({ outcome: 'expired' }))
            expect(pairing.getWindow()).toMatchObject({ phase: 'waiting', notice: 'expired' })
        })
        test('denied', () => {
            pairing.deny()
            expect(notify).toHaveBeenCalledWith('c1', { outcome: 'denied' })
            expect(pairing.verify('c1', 'r1', '111111')).toEqual(failed({ outcome: 'denied' }))
            expect(pairing.getWindow()).toMatchObject({ phase: 'waiting', notice: 'denied', device: 'Pixel' })
        })
        test('another connection cannot verify the request', () => {
            expect(pairing.verify('c9', 'r1', '111111')).toEqual(failed({ outcome: 'expired' }))
        })
        test('pairing-closed after the UI closed, even with a request pending', () => {
            pairing.close()
            expect(pairing.verify('c1', 'r1', '111111')).toEqual(failed({ outcome: 'pairing-closed' }))
            expect(pairing.getWindow()).toBeUndefined()
        })
    })

    describe('connectionClosed', () => {
        test('abandons the pending request of that connection', () => {
            pairing.open()
            pairing.request('c1', 'p1', 'Pixel')
            pairing.connectionClosed('c1')
            expect(pairing.getWindow()).toMatchObject({ phase: 'waiting', notice: 'abandoned' })
        })
    })
})
