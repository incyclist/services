import { EventEmitter } from 'node:events'
import { LinkClientConnection } from './connection'
import { LinkBrowse } from './browse'
import { LinkPairingFlow } from './pairing'
import { LocalLinkClientService } from './service'

const boom = () => { throw new Error('boom') }
const boomAsync = async () => { throw new Error('boom') }

type Internals = Record<string, unknown>

describe('LocalLinkClientService never throws', () => {
    let service: LocalLinkClientService
    let internals: Internals
    let logError: jest.SpyInstance

    beforeEach(() => {
        service = new LocalLinkClientService()
        internals = service as unknown as Internals
        jest.spyOn(service, 'isSupported').mockReturnValue(true)
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
    })
    afterEach(() => {
        jest.restoreAllMocks()
        service.reset()
    })

    const failingStore = () => jest.spyOn(internals.store as Record<string, never>, 'update' as never).mockImplementation(boomAsync as never)

    test('getDisplayProps falls back to "not available"', () => {
        jest.spyOn(internals.store as Record<string, never>, 'getAll' as never).mockImplementation(boom as never)
        expect(service.getDisplayProps()).toMatchObject({ available: false, links: [], discovery: { phase: 'idle' }, pairing: { step: 'idle' } })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'getDisplayProps')
    })

    test('getSession returns undefined', () => {
        internals.sessions = { get: boom }
        expect(service.getSession('x')).toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'getSession')
    })

    test('isSupported answers false if the toggle lookup throws', () => {
        jest.restoreAllMocks()
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        jest.spyOn(service as unknown as { getAppState: () => unknown }, 'getAppState').mockImplementation(boom)
        expect(service.isSupported()).toBe(false)
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'isSupported')
    })

    test('init resolves', async () => {
        internals.ready = boomAsync
        await expect(service.init()).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'init')
    })

    test('startSearch resolves with an idle state', async () => {
        internals.doSearch = boomAsync
        await expect(service.startSearch()).resolves.toEqual({ phase: 'idle' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'startSearch')
    })

    test('cancelSearch does not throw', () => {
        internals.browse = { cancel: boom }
        expect(() => service.cancelSearch()).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'cancelSearch')
    })

    test('selectComputer resolves', async () => {
        internals.discovered = new Map([['c', { id: 'c', host: 'h', port: 1, displayName: 'n' }]])
        internals.pairingFlow = { start: boomAsync, cancel: () => undefined }
        await expect(service.selectComputer('c')).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'selectComputer')
    })

    test('submitCode, retryPairing and cancelPairing do not throw or reject', async () => {
        internals.pairingFlow = { submit: boom, retry: boomAsync, cancel: boom }
        expect(() => service.submitCode('123456')).not.toThrow()
        await expect(service.retryPairing()).resolves.toBeUndefined()
        expect(() => service.cancelPairing()).not.toThrow()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['submitCode', 'retryPairing', 'cancelPairing'])
    })

    test('check resolves', async () => {
        internals.doCheck = boomAsync
        await expect(service.check()).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'check')
    })

    test('check resolves if even the support check throws', async () => {
        ;(service.isSupported as jest.Mock).mockImplementation(boom)
        await expect(service.check()).resolves.toBeUndefined()
    })

    test('rename, setCatalogVersion, forget resolve', async () => {
        internals.ready = async () => undefined
        failingStore()
        await expect(service.rename('a', 'b')).resolves.toBeUndefined()
        await expect(service.setCatalogVersion('a', 'v')).resolves.toBeUndefined()
        internals.media = { release: boomAsync }
        await expect(service.forget('a')).resolves.toBeUndefined()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['rename', 'setCatalogVersion', 'forget'])
    })

    test('ensureSession, getMedia, getMediaBaseUrl resolve with undefined', async () => {
        internals.ready = boomAsync
        await expect(service.ensureSession('a')).resolves.toBeUndefined()
        await expect(service.getMedia('a')).resolves.toBeUndefined()
        await expect(service.getMediaBaseUrl('a')).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'ensureSession')
    })

    test('getMedia resolves with undefined if the media path fails', async () => {
        jest.spyOn(service, 'getSession').mockReturnValue({ mediaTokenExpiresAt: Date.now() + 1e9, host: 'h', mediaPort: 1 } as never)
        internals.media = { getBaseUrl: boomAsync }
        await expect(service.getMedia('a')).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'getMedia')
    })

    test('request resolves with undefined if the connection fails', async () => {
        internals.sessions = new Map([['a', { conn: { request: boomAsync } }]])
        await expect(service.request('a', 'ping', {}, 10)).resolves.toBeUndefined()
    })

    test('media helpers do not throw', async () => {
        internals.media = { isAvailable: boom, setPipeEnabled: boom, release: boomAsync }
        expect(service.isMediaAvailable()).toBe(false)
        expect(() => service.setMediaPipeEnabled(true)).not.toThrow()
        await expect(service.releaseMedia()).resolves.toBeUndefined()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['isMediaAvailable', 'setMediaPipeEnabled', 'releaseMedia'])
    })

    test('reset does not throw', () => {
        internals.pairingFlow = { cancel: boom }
        expect(() => service.reset()).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'reset')
    })

    describe('passive watch', () => {
        test('triggers do not throw when the watch does', () => {
            internals.watch = { sync: boom, halt: boom, isRunning: boom }
            internals.canRetry = boom
            expect(() => { service.onForeground(); service.onBackground(); service.onNetworkChange(); service.retryNow() }).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'syncWatch')
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'retryNow')
        })
        test('the announcement handler does not throw', () => {
            internals.shouldWatch = boom
            const handle = internals.onWatchAnnouncement as (s: unknown) => void
            expect(() => handle.call(service, { address: '10.0.0.1', port: 1, name: 'x' })).not.toThrow()
            expect(() => handle.call(service, null)).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onWatchAnnouncement')
        })
        test('the probe of an announcement never rejects out of the handler', async () => {
            internals.shouldWatch = () => true
            internals.watchProbe = boomAsync
            ;(internals.onWatchAnnouncement as (s: unknown) => void).call(service, { address: '10.0.0.1', port: 1, name: 'x' })
            await Promise.resolve()
            await Promise.resolve()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'watchProbe')
            expect((internals.watchInFlight as Set<string>).size).toBe(0)
        })
        test('the trainer rotation check answers false when the device access fails', () => {
            internals.getDeviceAccess = boom
            expect((internals.isTrainerRotationRunning as () => boolean).call(service)).toBe(false)
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'isTrainerRotationRunning')
        })
    })

    describe('callbacks', () => {
        test('a throwing push listener does not break the session handling', () => {
            service.on('push', boom)
            expect(() => (internals.onPush as (l: string, m: unknown) => void).call(service, 'a', { t: 'pong' })).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onPush')
        })

        test('a throwing session-changed listener does not break onSessionClosed', () => {
            const active = { intentional: true }
            ;(internals.sessions as Map<string, unknown>).set('a', active)
            service.on('session-changed', boom)
            expect(() => (internals.onSessionClosed as (l: string, a: unknown) => void).call(service, 'a', active)).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onSessionClosed')
        })

        test('the reconnect timer callback does not throw', () => {
            internals.ensureSession = boom
            expect(() => (internals.onReconnectTimer as (l: string) => void).call(service, 'a')).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'reconnect')
        })

        test('a failing pairing save becomes a pairing failure instead of a rejection', async () => {
            internals.doSavePaired = boomAsync
            await expect((internals.savePaired as (t: unknown, b: unknown) => Promise<unknown>).call(service, {}, {})).resolves.toBe('storage-unavailable')
        })
    })
})

describe('LinkClientConnection never throws from callbacks', () => {
    class FakeSocket extends EventEmitter {
        connect = jest.fn()
        write = jest.fn()
        destroy = jest.fn()
    }

    let socket: FakeSocket
    let conn: LinkClientConnection
    let logError: jest.SpyInstance

    beforeEach(() => {
        socket = new FakeSocket()
        conn = new LinkClientConnection(socket as never)
        logError = jest.spyOn(conn as unknown as { logError: () => void }, 'logError').mockImplementation(() => undefined)
        ;(conn as unknown as { attach: () => void }).attach()
    })

    test('a data handler fed with garbage closes the connection and does not throw', () => {
        const closed = jest.fn()
        conn.on('close', closed)
        expect(() => socket.emit('data', Buffer.from('this is not a preamble'))).not.toThrow()
        expect(closed).toHaveBeenCalled()
    })

    test('a failing reader does not throw out of the data handler', () => {
        ;(conn as unknown as { reader: unknown }).reader = { push: boom }
        expect(() => socket.emit('data', Buffer.from('x'))).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onData')
        expect(conn.isClosed()).toBe(true)
    })

    test('a throwing close listener does not throw out of the socket handlers', () => {
        conn.on('close', boom)
        expect(() => socket.emit('close')).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'end')
    })

    test('a throwing message listener does not stop the connection', () => {
        conn.on('message', boom)
        conn.listen()
        expect(() => (conn as unknown as { dispatch: (m: unknown) => void }).dispatch({ t: 'catalog-changed', s: 1, b: {} })).not.toThrow()
        expect(conn.isClosed()).toBe(false)
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'dispatch')
    })

    test('the keepalive tick does not throw', () => {
        ;(conn as unknown as { send: () => void }).send = boom
        expect(() => (conn as unknown as { keepaliveTick: () => void }).keepaliveTick()).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'keepaliveTick')
    })

    test('close does not throw if the socket does', () => {
        socket.destroy.mockImplementation(boom)
        expect(() => conn.close()).not.toThrow()
    })
})

describe('LinkPairingFlow never throws', () => {
    const host = (): Record<string, unknown> => ({
        createConnection: boom, getClientName: () => 'n', now: () => 0, onChange: boom, onPaired: jest.fn(boomAsync), log: jest.fn(),
    })

    test('start resolves and ends in a failed state when the connection cannot be created', async () => {
        const h = host()
        h.onChange = jest.fn()
        const flow = new LinkPairingFlow(h as never)
        await expect(flow.start({ id: 'a', name: 'n', host: 'h', port: 1 })).resolves.toBeUndefined()
        expect(flow.getState()).toMatchObject({ step: 'failed', reason: 'unreachable' })
    })

    test('public methods do not throw when the change callback throws', async () => {
        const flow = new LinkPairingFlow(host() as never)
        expect(() => flow.cancel()).not.toThrow()
        expect(() => flow.markConnected('l', 'n', true)).not.toThrow()
        expect(() => flow.submit('123456')).not.toThrow()
        await expect(flow.retry()).resolves.toBeUndefined()
    })

    test('a failing onPaired host callback becomes storage-unavailable', async () => {
        const h = host()
        h.onChange = jest.fn()
        const flow = new LinkPairingFlow(h as never)
        ;(flow as unknown as { target: unknown }).target = { id: 'a', name: 'n', host: 'h', port: 1 }
        await expect((flow as unknown as { onPaired: (c: unknown, b: unknown) => Promise<void> }).onPaired(undefined, { linkId: 'l', name: 'n' })).resolves.toBeUndefined()
        expect(flow.getState()).toMatchObject({ step: 'failed', reason: 'storage-unavailable' })
    })
})

describe('LinkBrowse never throws from the mDNS callback', () => {
    test('a throwing onFound callback is contained', async () => {
        let onup: (s: unknown) => void = () => undefined
        const wifi = { mdns: { connect: jest.fn(), disconnect: jest.fn(), find: jest.fn((_q, cb) => { onup = cb }) } }
        const browse = new LinkBrowse(wifi as never)
        const running = browse.run(5, boom)
        expect(() => onup({ address: '1.2.3.4', port: 1, name: 'n' })).not.toThrow()
        await expect(running).resolves.toHaveLength(1)
    })
})
