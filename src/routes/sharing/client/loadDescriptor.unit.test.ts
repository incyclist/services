import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { getBindings } from '../../../api/bindings'
import type { ICryptoBinding } from '../../../api/crypto/types'
import { Inject } from '../../../base/decorators'
import { Route } from '../../base/model/route'
import type { RouteApiDetail } from '../../base/api/types'
import { getRouteHash } from '../../base/utils/route'
import type { SharedRouteDescriptor } from '../types'
import { DescriptorLoadError, parseDescriptor } from './descriptor'
import { parseCatalog, RouteSharingClientService } from './service'

const POINTS = [
    { lat: 48.1, lng: 11.5, elevation: 500, routeDistance: 0 },
    { lat: 48.2, lng: 11.6, elevation: 510, routeDistance: 1200 },
] as RouteApiDetail['points']

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('base64url')

describe('parseCatalog', () => {
    const entry = (extra: Record<string, unknown>) => ({
        routeKey: 'k', routeIdOnComputer: 'id', title: 'T', videoHandle: 'h', videoFormat: 'mp4', size: 1, mtime: 1, ...extra,
    })
    const parse = (extra: Record<string, unknown>) => parseCatalog({ catalogVersion: 'v', routes: [entry(extra)] })!.routes[0]

    test('keeps origin, routeHash and a well-typed summary', () => {
        const hash = 'f'.repeat(32)
        const res = parse({
            origin: 'local', routeHash: hash,
            summary: { title: 'A', localizedTitle: { en: 'A' }, country: 'DE', distance: 5, elevation: 6, isLoop: true, hasGpx: false, pointsSource: 'gpx', videoFormat: 'mp4', extra: 'x' },
        })
        expect(res.origin).toBe('local')
        expect(res.routeHash).toBe(hash)
        expect(res.summary).toEqual({ title: 'A', localizedTitle: { en: 'A' }, country: 'DE', distance: 5, elevation: 6, isLoop: true, hasGpx: false, pointsSource: 'gpx', videoFormat: 'mp4' })
    })

    test('drops a malformed origin, hash and summary', () => {
        expect(parse({ origin: 'weird', routeHash: 'xyz', summary: { distance: 1 } })).not.toHaveProperty('origin')
        expect(parse({ routeHash: 'xyz' })).not.toHaveProperty('routeHash')
        expect(parse({ routeHash: 'F'.repeat(32) })).not.toHaveProperty('routeHash')
        expect(parse({ summary: { distance: 1 } })).not.toHaveProperty('summary')
        expect(parse({ summary: 'nope' })).not.toHaveProperty('summary')
    })

    test('drops summary fields of the wrong type', () => {
        const res = parse({ summary: { title: 'A', distance: '5', isLoop: 'yes', pointsSource: 'other', country: 7, localizedTitle: 3 } })
        expect(res.summary).toEqual({ title: 'A' })
    })

    test('a catalog of an old computer parses as before', () => {
        expect(parse({})).toEqual({ routeKey: 'k', routeIdOnComputer: 'id', title: 'T', videoHandle: 'h', videoFormat: 'mp4', size: 1, mtime: 1 })
    })
})

describe('parseDescriptor', () => {
    let routeKey: string
    let savedCrypto: ICryptoBinding
    const build = (over: Partial<SharedRouteDescriptor> = {}): SharedRouteDescriptor => ({
        v: 1, routeKey, description: { title: 'T' },
        details: { title: 'T', points: POINTS, video: { framerate: 30, format: 'mp4', mappings: [] } }, ...over,
    })

    beforeEach(() => {
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        routeKey = getRouteHash({ id: 'x', title: 'T', points: POINTS })
    })
    afterEach(() => { getBindings().crypto = savedCrypto })

    const code = (fn: () => unknown) => { try { fn() } catch (err) { return (err as DescriptorLoadError).reason } }

    test('accepts a descriptor with matching digest and hash', () => {
        const text = JSON.stringify(build())
        expect(parseDescriptor(text, sha256(text), routeKey).routeKey).toBe(routeKey)
    })

    test('digest mismatch', () => {
        const text = JSON.stringify(build())
        expect(code(() => parseDescriptor(text, sha256('other'), routeKey))).toBe('hash-mismatch')
    })

    test('routeHash mismatch: other geometry than announced', () => {
        const other = build({ details: { ...build().details, points: [...POINTS!].reverse() } })
        const text = JSON.stringify(other)
        expect(code(() => parseDescriptor(text, sha256(text), routeKey))).toBe('hash-mismatch')
    })

    test('malformed: not JSON, wrong version or key, no points, no video', () => {
        const check = (text: string) => code(() => parseDescriptor(text, sha256(text), routeKey))
        expect(check('{nope')).toBe('malformed')
        expect(check(JSON.stringify(build({ v: 2 as never })))).toBe('malformed')
        expect(check(JSON.stringify(build({ routeKey: 'other' })))).toBe('malformed')
        expect(check(JSON.stringify(build({ details: { title: 'T', video: build().details.video } })))).toBe('malformed')
        expect(check(JSON.stringify(build({ details: { title: 'T', points: POINTS } })))).toBe('malformed')
    })
})

describe('RouteSharingClientService.loadDescriptor', () => {
    let client: EventEmitter
    let service: RouteSharingClientService
    let savedCrypto: ICryptoBinding
    let route: Route
    let routeKey: string
    let body: string
    let reply: Record<string, unknown>
    let routeList: { saveRoute: jest.Mock, findCard: jest.Mock }
    let request: jest.Mock
    let fetchMock: jest.Mock
    let rows: Array<{ linkId: string, routeKey: string }>
    let capabilities: Record<string, string[] | undefined>
    const savedFetch = globalThis.fetch

    const make = (extra: Partial<SharedRouteDescriptor['details']> = {}) => JSON.stringify({
        v: 1, routeKey, description: { title: 'T', segments: [{ start: 0, end: 5, name: 's' }] },
        details: { title: 'T', distance: 1200, points: POINTS, video: { framerate: 30, format: 'mp4', mappings: [{ time: 0, videoSpeed: 1, distance: 0 }] }, ...extra },
    })
    const respondWith = (text: string) => {
        body = text
        reply = { routeKey, document: 'rd-0123456789abcdef', size: text.length, sha256: sha256(text) }
    }

    beforeEach(() => {
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        routeKey = getRouteHash({ id: 'x', title: 'T', points: POINTS })
        route = new Route({ id: routeKey, routeHash: routeKey, title: 'T', isLocal: true, hasVideo: true, linkShared: true })
        respondWith(make())
        rows = [{ linkId: 'A', routeKey }]
        capabilities = { A: ['route-sharing', 'route-descriptor'] }
        request = jest.fn(async () => ({ t: 'route-descriptor', b: reply }))
        client = Object.assign(new EventEmitter(), {
            isSupported: () => true,
            getDisplayProps: () => ({ links: [{ linkId: 'A', lastSeenAt: 1 }, { linkId: 'B', lastSeenAt: 9 }] }),
            getSession: (linkId: string) => capabilities[linkId] ? { linkId, capabilities: capabilities[linkId] } : undefined,
            getMedia: jest.fn(async (linkId: string) => ({ baseUrl: `http://${linkId}:1`, token: 'tok', expiresAt: Date.now() + 1e7, catalogVersion: 'v' })),
            request,
        })
        fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => body }))
        globalThis.fetch = fetchMock as unknown as typeof fetch
        routeList = { saveRoute: jest.fn(async () => undefined), findCard: jest.fn(() => undefined) }
        Inject('LocalLinkClient', client)
        Inject('RouteList', Object.assign(new EventEmitter(), routeList))
        service = new RouteSharingClientService()
        service.getRowsForRoute = (key: string) => rows.filter(r => r.routeKey === key) as never
    })

    afterEach(() => {
        service.reset()
        Inject('LocalLinkClient', null)
        Inject('RouteList', null)
        getBindings().crypto = savedCrypto
        globalThis.fetch = savedFetch
        jest.clearAllMocks()
    })

    // loadDescriptor never rejects: a failure leaves the details absent and is logged with its reason
    const failure = async (p: Promise<Route>): Promise<{ reason?: string, httpStatus?: number } | undefined> => {
        const logEvent = jest.spyOn(service as unknown as { logEvent: (e: unknown) => void }, 'logEvent')
        const res = await p
        expect(res.details).toBeUndefined()
        const event = logEvent.mock.calls.map(c => c[0] as { message: string, reason?: string, httpStatus?: number })
            .find(e => e.message === 'route descriptor failed')
        logEvent.mockRestore()
        return event
    }

    test('loads, verifies and persists the details; a second call makes no request', async () => {
        const res = await service.loadDescriptor(route, 'details')
        expect(res).toBe(route)
        expect(route.details?.points).toHaveLength(2)
        expect(route.description.distance).toBe(1200)
        expect(route.description.segments).toEqual([{ start: 0, end: 5, name: 's' }])
        expect(route.description.videoUrl).toBeUndefined()
        expect(routeList.saveRoute).toHaveBeenCalledWith(route, true)
        expect(request).toHaveBeenCalledWith('A', 'route-descriptor', { routeKey }, 10_000)
        expect(fetchMock).toHaveBeenCalledWith('http://A:1/rd-0123456789abcdef', expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }))

        await service.loadDescriptor(route, 'details')
        expect(request).toHaveBeenCalledTimes(1)
    })

    test('concurrent loads of one route share one request', async () => {
        await Promise.all([service.loadDescriptor(route, 'details'), service.loadDescriptor(route, 'ride')])
        expect(request).toHaveBeenCalledTimes(1)
    })

    test('unsupported: the computer lacks the capability, no request is made', async () => {
        capabilities.A = ['route-sharing']
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('unsupported')
        expect(request).not.toHaveBeenCalled()
    })

    test('unreachable: no session', async () => {
        capabilities.A = undefined
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('unreachable')
        rows = []
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('unreachable')
        expect(request).not.toHaveBeenCalled()
        expect(routeList.saveRoute).not.toHaveBeenCalled()
    })

    test('the most recently seen computer is asked first, the next one when it fails', async () => {
        rows.push({ linkId: 'B', routeKey })
        capabilities.B = ['route-descriptor']
        request.mockImplementationOnce(async () => ({ t: 'route-descriptor', b: { routeKey, error: 'no-details' } }))
        await service.loadDescriptor(route, 'details')
        expect(request.mock.calls.map(c => c[0])).toEqual(['B', 'A'])
    })

    test('busy: one retry after 2 s', async () => {
        jest.useFakeTimers()
        try {
            request.mockImplementationOnce(async () => ({ t: 'route-descriptor', b: { routeKey, error: 'busy' } }))
            const done = service.loadDescriptor(route, 'details')
            await jest.advanceTimersByTimeAsync(2100)
            await done
            expect(request).toHaveBeenCalledTimes(2)
        }
        finally {
            jest.useRealTimers()
        }
    })

    describe('one request at a time per computer', () => {
        const route2 = () => {
            const key = getRouteHash({ id: 'y', title: 'T2', points: [...POINTS!].reverse() })
            const r = new Route({ id: key, routeHash: key, title: 'T2', isLocal: true, hasVideo: true, linkShared: true })
            rows.push({ linkId: 'A', routeKey: key })
            return { r, key }
        }

        test('later requests wait for the one in flight and run first come first served', async () => {
            const { r: r2, key: k2 } = route2()
            const { r: r3, key: k3 } = route2()
            const order: string[] = []
            let inFlight = 0
            let maxInFlight = 0
            request.mockImplementation(async (_l: string, _t: string, body: { routeKey: string }) => {
                inFlight++
                maxInFlight = Math.max(maxInFlight, inFlight)
                order.push(body.routeKey)
                await new Promise(resolve => setTimeout(resolve, 5))
                inFlight--
                return { t: 'route-descriptor', b: { error: 'unknown-route' } }
            })
            await Promise.all([service.loadDescriptor(route, 'list'), service.loadDescriptor(r2, 'list'), service.loadDescriptor(r3, 'list')])
            expect(maxInFlight).toBe(1)
            expect(order).toEqual([routeKey, k2, k3])
        })

        test('a failing request releases the slot', async () => {
            const { r: r2 } = route2()
            request.mockRejectedValueOnce(new Error('boom'))
            await service.loadDescriptor(route, 'list')
            await service.loadDescriptor(r2, 'list')
            expect(request).toHaveBeenCalledTimes(2)
        })
    })

    describe('negative cache', () => {
        const busyTwice = () => request.mockImplementation(async () => ({ t: 'route-descriptor', b: { routeKey, error: 'busy' } }))

        test('a list fetch does not repeat a busy answer', async () => {
            jest.useFakeTimers()
            try {
                busyTwice()
                const first = service.loadDescriptor(route, 'list')
                await jest.advanceTimersByTimeAsync(2100)
                await first
                expect(request).toHaveBeenCalledTimes(2)

                await service.loadDescriptor(route, 'list')
                expect(request).toHaveBeenCalledTimes(2)
            }
            finally {
                jest.useRealTimers()
            }
        })

        test.each(['ride', 'copy', 'details'] as const)('%s bypasses a cached failure', async trigger => {
            jest.useFakeTimers()
            try {
                busyTwice()
                const first = service.loadDescriptor(route, 'list')
                await jest.advanceTimersByTimeAsync(2100)
                await first
                request.mockImplementation(async () => ({ t: 'route-descriptor', b: reply }))
                const res = await service.loadDescriptor(route, trigger)
                expect(res.details).toBeDefined()
            }
            finally {
                jest.useRealTimers()
            }
        })

        test('404 on the download is cached for list fetches; the entry expires after 60 s', async () => {
            jest.useFakeTimers()
            try {
                fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
                await service.loadDescriptor(route, 'list')
                expect(request).toHaveBeenCalledTimes(1)
                await service.loadDescriptor(route, 'list')
                expect(request).toHaveBeenCalledTimes(1)

                jest.setSystemTime(Date.now() + 61_000)
                await service.loadDescriptor(route, 'list')
                expect(request).toHaveBeenCalledTimes(2)
            }
            finally {
                jest.useRealTimers()
            }
        })

        test('a new session of the computer clears it', async () => {
            fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
            await service.loadDescriptor(route, 'list')
            const internals = service as unknown as { syncLink: unknown, onSessionChanged: (e: unknown) => void }
            internals.syncLink = jest.fn(async () => undefined)
            internals.onSessionChanged({ linkId: 'A', session: { linkId: 'A', capabilities: [] } })
            await service.loadDescriptor(route, 'list')
            expect(request).toHaveBeenCalledTimes(2)
        })

        test('a failure that is not busy, timeout or 404 is not cached', async () => {
            request.mockResolvedValueOnce({ t: 'route-descriptor', b: { routeKey, error: 'unknown-route' } })
            await service.loadDescriptor(route, 'list')
            await service.loadDescriptor(route, 'list')
            expect(request).toHaveBeenCalledTimes(2)
        })

        test('the suppressed fetch and the load are logged', async () => {
            const logEvent = jest.spyOn(service as unknown as { logEvent: (e: unknown) => void }, 'logEvent')
            fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
            await service.loadDescriptor(route, 'list')
            await service.loadDescriptor(route, 'list')
            const events = logEvent.mock.calls.map(c => c[0] as Record<string, unknown>)
            expect(events).toContainEqual(expect.objectContaining({ message: 'route descriptor failed', trigger: 'list', result: 'http', durationMs: expect.any(Number) }))
            expect(events).toContainEqual(expect.objectContaining({ message: 'route descriptor load suppressed', suppressed: 1 }))
        })
    })

    test('digest mismatch persists nothing', async () => {
        reply.sha256 = sha256('something else')
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('hash-mismatch')
        expect(route.details).toBeUndefined()
        expect(routeList.saveRoute).not.toHaveBeenCalled()
    })

    test('routeHash mismatch persists nothing', async () => {
        respondWith(make({ points: [...POINTS!].reverse() }))
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('hash-mismatch')
        expect(route.details).toBeUndefined()
        expect(routeList.saveRoute).not.toHaveBeenCalled()
    })

    test('a document name that is not a descriptor name is not fetched', async () => {
        reply.document = '../catalog'
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('malformed')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('http error and unknown-route are reported with their reason', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
        const http = await failure(service.loadDescriptor(route, 'details'))
        expect(http).toMatchObject({ reason: 'http', httpStatus: 404 })

        request.mockImplementation(async () => ({ t: 'route-descriptor', b: { routeKey, error: 'unknown-route' } }))
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('unknown-route')
    })

    test('a request that gets no answer is reported as unreachable', async () => {
        request.mockResolvedValueOnce(undefined)
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('unreachable')
    })

    test('a request that throws does not reject', async () => {
        request.mockRejectedValueOnce(new Error('boom'))
        expect((await failure(service.loadDescriptor(route, 'details')))?.reason).toBe('unreachable')
    })
})
