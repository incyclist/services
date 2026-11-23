import { LinkPairing } from './pairing'
import { LocalLinkService } from './service'

const boom = () => { throw new Error('boom') }
const boomAsync = async () => { throw new Error('boom') }

type Internals = Record<string, unknown>

describe('LocalLinkService never throws', () => {
    let service: LocalLinkService
    let internals: Internals
    let logError: jest.SpyInstance

    beforeEach(() => {
        service = new LocalLinkService()
        internals = service as unknown as Internals
        jest.spyOn(service, 'isAvailable').mockReturnValue(true)
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
    })
    afterEach(() => {
        jest.restoreAllMocks()
        service.reset()
    })

    test('getDisplayProps falls back to "not available"', () => {
        internals.getClients = boom
        expect(service.getDisplayProps()).toMatchObject({ available: false, state: 'never-connected', devices: [] })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'getDisplayProps')
    })

    test('isAvailable answers false if the toggle lookup throws', () => {
        jest.restoreAllMocks()
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        internals.getAppState = boom
        expect(service.isAvailable()).toBe(false)
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'isAvailable')
    })

    test('denyPairing and dismissFirewallNotice do not throw', () => {
        internals.pairing = { deny: boom }
        expect(() => service.denyPairing()).not.toThrow()
        internals.emitState = boom
        expect(() => service.dismissFirewallNotice()).not.toThrow()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['denyPairing', 'dismissFirewallNotice'])
    })

    test('setDisplayName resolves with a failure result', async () => {
        internals.getUserSettings = boom
        await expect(service.setDisplayName('My PC')).resolves.toEqual({ ok: false, error: 'unavailable' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'setDisplayName')
    })

    test('init, openPairing, closePairing, setEnabled, removeClient resolve', async () => {
        internals.getClients = boom
        internals.startTransport = boomAsync
        internals.stopTransport = boomAsync
        internals.setOff = boom
        internals.getAuth = boom
        await expect(service.init()).resolves.toBeUndefined()
        await expect(service.openPairing()).resolves.toBeUndefined()
        await expect(service.closePairing()).resolves.toBeUndefined()
        await expect(service.setEnabled(true)).resolves.toBeUndefined()
        await expect(service.removeClient('a')).resolves.toBeUndefined()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['init', 'openPairing', 'closePairing', 'setEnabled', 'removeClient'])
    })

    test('reset does not throw', () => {
        internals.pairing = { reset: boom }
        expect(() => service.reset()).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'reset')
    })

    describe('callbacks', () => {
        test('the transport event callback does not throw', () => {
            let listener: (e: unknown) => void = () => undefined
            internals.onLinkEvent = boom
            ;(internals.subscribeToTransport as (l: unknown) => void).call(service, { onEvent: (cb: typeof listener) => { listener = cb; return () => undefined } })
            expect(() => listener({ type: 'resumed' })).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onLinkEvent')
        })

        test('an asynchronously failing event handler is logged, not rejected', async () => {
            let listener: (e: unknown) => void = () => undefined
            internals.onLinkEvent = boomAsync
            ;(internals.subscribeToTransport as (l: unknown) => void).call(service, { onEvent: (cb: typeof listener) => { listener = cb; return () => undefined } })
            listener({ type: 'resumed' })
            await new Promise(resolve => setTimeout(resolve, 0))
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onLinkEvent')
        })

        test('the catalog-changed listener, the deadline timer and the token timer do not throw', () => {
            internals.emitState = boom
            expect(() => (internals.onCatalogChanged as (v: string) => void).call(service, 'v1')).not.toThrow()
            internals.connections = { get: boom }
            expect(() => (internals.onDeadline as (c: unknown) => void).call(service, { id: 'c' })).not.toThrow()
            internals.pruneExpiredTokens = boom
            expect(() => (internals.onTokenTimer as () => void).call(service)).not.toThrow()
            expect(logError.mock.calls.map(c => c[1])).toEqual(['onCatalogChanged', 'onDeadline', 'tokenExpiry'])
        })

        test('pushing a pairing outcome does not throw', () => {
            internals.connections = { get: boom }
            expect(() => (internals.pushPairFailed as (id: string, b: unknown) => void).call(service, 'c', { outcome: 'denied' })).not.toThrow()
            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'pushPairFailed')
        })
    })
})

describe('LinkPairing expiry timer', () => {
    test('does not throw if a hook throws', () => {
        const pairing = new LinkPairing({ generatePin: () => '123456', newRequestId: () => 'r', onChange: boom, notify: boom })
        const logError = jest.spyOn(pairing as unknown as { logError: () => void }, 'logError').mockImplementation(() => undefined)
        const pending = { requestId: 'r', connectionId: 'c', clientName: 'n', pin: '123456', expiresAt: 0, attempts: 0 }
        ;(pairing as unknown as { pending: unknown }).pending = pending
        expect(() => (pairing as unknown as { expire: (p: unknown) => void }).expire(pending)).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'expire')
    })
})
