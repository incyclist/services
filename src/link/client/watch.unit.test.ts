import { LinkWatch } from './watch'
import type { LinkMdnsAnnouncement, LinkWifiBinding } from './types'

describe('LinkWatch', () => {
    let up: ((s: LinkMdnsAnnouncement) => void) | undefined
    let mdns: { connect: jest.Mock, disconnect: jest.Mock, find: jest.Mock, stopFind?: jest.Mock }
    let canRun: boolean
    let joined: boolean
    let found: LinkMdnsAnnouncement[]
    let watch: LinkWatch

    const finds = () => mdns.find.mock.calls.length

    beforeEach(() => {
        jest.useFakeTimers()
        up = undefined
        canRun = true
        joined = false
        found = []
        mdns = { connect: jest.fn(), disconnect: jest.fn(), stopFind: jest.fn(), find: jest.fn((_o, cb) => { up = cb }) }
        watch = new LinkWatch({
            getWifi: () => ({ net: { createSocket: jest.fn() }, mdns }) as unknown as LinkWifiBinding,
            canRun: () => canRun,
            isJoined: () => joined,
            onAnnouncement: s => found.push(s),
        })
    })
    afterEach(() => {
        watch.halt()
        jest.useRealTimers()
    })

    test('starts armed and browses for _incyclist._tcp', () => {
        watch.sync()
        expect(watch.isRunning()).toBe(true)
        expect(watch.isArmed()).toBe(true)
        expect(mdns.connect).toHaveBeenCalledTimes(1)
        expect(mdns.find).toHaveBeenCalledWith({ type: 'incyclist', protocol: 'tcp' }, expect.any(Function))
    })
    test('delivers announcements of its type only', () => {
        watch.sync()
        up?.({ type: 'incyclist', name: 'A', address: '10.0.0.1', port: 1 })
        up?.({ type: 'directconnect', name: 'B', address: '10.0.0.2', port: 2 })
        up?.({ name: 'C', address: '', port: 3 })
        up?.({ name: 'D (untyped)', address: '10.0.0.4', port: 4 })
        expect(found.map(f => f.name)).toEqual(['A', 'D (untyped)'])
    })
    test('an announcement handler that throws does not escape', () => {
        const throwing = new LinkWatch({
            getWifi: () => ({ net: {}, mdns }) as unknown as LinkWifiBinding,
            canRun: () => true, isJoined: () => false, onAnnouncement: () => { throw new Error('x') },
        })
        throwing.sync()
        expect(() => up?.({ name: 'A', address: '10.0.0.1', port: 1 })).not.toThrow()
        throwing.halt()
    })
    test('does not run when the conditions do not hold, and stops when they stop', () => {
        canRun = false
        watch.sync()
        expect(watch.isRunning()).toBe(false)
        expect(finds()).toBe(0)
        canRun = true
        watch.sync()
        canRun = false
        watch.sync()
        expect(watch.isRunning()).toBe(false)
        expect(mdns.stopFind).toHaveBeenCalledWith('incyclist', 'tcp')
        expect(mdns.disconnect).not.toHaveBeenCalled()
    })
    test('does not run on a binding without stopFind: the shared binding cannot be released per type', () => {
        mdns.stopFind = undefined
        watch.sync()
        expect(watch.isRunning()).toBe(false)
        expect(finds()).toBe(0)
    })
    test('sync is idempotent: it re-arms but never stops or restarts', () => {
        watch.sync()
        watch.sync()
        watch.sync()
        expect(finds()).toBe(3)
        expect(mdns.stopFind).not.toHaveBeenCalled()
        expect(jest.getTimerCount()).toBe(2)
    })

    describe('duty cycle', () => {
        test('4 s on, 16 s off, again on at 20 s', () => {
            watch.sync()
            jest.advanceTimersByTime(3999)
            expect(mdns.stopFind).not.toHaveBeenCalled()
            jest.advanceTimersByTime(1)
            expect(mdns.stopFind).toHaveBeenCalledTimes(1)
            expect(watch.isArmed()).toBe(false)
            expect(watch.isRunning()).toBe(true)
            jest.advanceTimersByTime(15_999)
            expect(finds()).toBe(1)
            jest.advanceTimersByTime(1)
            expect(finds()).toBe(2)
            expect(watch.isArmed()).toBe(true)
        })
        test('a sync in the off phase does not browse', () => {
            watch.sync()
            jest.advanceTimersByTime(5000)
            watch.sync()
            expect(finds()).toBe(1)
        })
        test('stops at the end of the cycle when the conditions are gone', () => {
            watch.sync()
            jest.advanceTimersByTime(5000)
            canRun = false
            jest.advanceTimersByTime(15_000)
            expect(watch.isRunning()).toBe(false)
            expect(jest.getTimerCount()).toBe(0)
        })
    })

    describe('joined to the trainer rotation', () => {
        beforeEach(() => { joined = true })

        test('never stops its browser by itself, re-arms every 20 s', () => {
            watch.sync()
            jest.advanceTimersByTime(19_999)
            expect(mdns.stopFind).not.toHaveBeenCalled()
            expect(finds()).toBe(1)
            jest.advanceTimersByTime(1)
            expect(finds()).toBe(2)
            expect(mdns.stopFind).not.toHaveBeenCalled()
            jest.advanceTimersByTime(60_000)
            expect(finds()).toBe(5)
        })
        test('switches to the duty cycle when the rotation ends', () => {
            watch.sync()
            joined = false
            jest.advanceTimersByTime(20_000)
            expect(mdns.stopFind).toHaveBeenCalledTimes(1)
            expect(watch.isArmed()).toBe(true)
            jest.advanceTimersByTime(4000)
            expect(watch.isArmed()).toBe(false)
        })
    })

    test('nothing throws when the binding does', () => {
        mdns.connect.mockImplementation(() => { throw new Error('x') })
        expect(() => watch.sync()).not.toThrow()
        mdns.stopFind?.mockImplementation(() => { throw new Error('x') })
        expect(() => watch.halt()).not.toThrow()
        const broken = new LinkWatch({
            getWifi: () => { throw new Error('x') }, canRun: () => true, isJoined: () => false, onAnnouncement: () => undefined,
        })
        expect(() => { broken.sync(); broken.halt() }).not.toThrow()
    })
})
