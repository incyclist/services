import crypto from 'node:crypto'
import { getBindings } from '../../api/bindings'
import type { ICryptoBinding } from '../../api/crypto/types'
import { Inject } from '../../base/decorators'
import { RouteSharingService } from './service'

describe('RouteSharingService', () => {
    let service: RouteSharingService
    let publishMedia: jest.Mock
    let savedCrypto: ICryptoBinding
    const bindings = getBindings() as unknown as Record<string, unknown>
    const routes = [
        { description: { id: 'a', isLocal: true, routeHash: 'ha', hasVideo: true, videoUrl: 'video:///d/a.mp4', title: 'A' } },
    ]

    beforeEach(() => {
        publishMedia = jest.fn(async () => ({ ok: true, rejectedHandles: [], rejectedTokens: 0 }))
        bindings.localLink = { publishMedia }
        bindings.fs = { stat: jest.fn(async () => ({ size: 42 })) }
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        Inject('RouteList', { getAllRoutes: () => routes, isStillLoading: () => false, on: jest.fn(), off: jest.fn() })
        Inject('UserSettings', {
            requestNotifyOnChange: () => ({ on: jest.fn() }), stopNotifyOnChange: jest.fn(),
        })
        service = new RouteSharingService()
    })
    afterEach(() => {
        service.reset()
        Inject('RouteList', null)
        Inject('UserSettings', null)
        getBindings().crypto = savedCrypto
        delete bindings.localLink
        delete bindings.fs
        jest.clearAllMocks()
    })

    test('publishes catalog, handles and the given token digests', async () => {
        await service.setTokens([{ digest: 'D', id: 't1' }])
        await service.start('L1')
        expect(publishMedia).toHaveBeenCalledTimes(1)
        const state = publishMedia.mock.calls[0][0]
        expect(state.tokens).toEqual([{ digest: 'D', id: 't1' }])
        expect(state.handles).toHaveLength(1)
        expect(state.handles[0]).toMatchObject({ path: '/d/a.mp4', contentType: 'video/mp4' })
        expect(state.documents.catalog.body.routes).toMatchObject([{ routeKey: 'ha', size: 42 }])
        expect(state.documents.catalog.body.catalogVersion).toBe(service.getCatalogVersion())
        expect(service.getRouteCount()).toBe(1)
    })

    test('handles are stable across rebuilds', async () => {
        await service.start('L1')
        await service.refresh()
        const [first, second] = publishMedia.mock.calls.map(c => c[0].handles[0].handle)
        expect(first).toBe(second)
        expect(first).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    })

    test('setTokens republishes the current catalog', async () => {
        await service.start('L1')
        await service.setTokens([])
        expect(publishMedia).toHaveBeenCalledTimes(2)
        expect(publishMedia.mock.calls[1][0].tokens).toEqual([])
    })

    test('emits catalog-changed when the content changes', async () => {
        const changed = jest.fn()
        service.on('catalog-changed', changed)
        await service.start('L1')
        expect(changed).toHaveBeenCalledWith({ catalogVersion: service.getCatalogVersion(), routeCount: 1 })
    })

    describe('getDescriptor', () => {
        const POINTS = [{ lat: 1, lng: 2, elevation: 3, routeDistance: 0 }, { lat: 1.1, lng: 2.1, elevation: 4, routeDistance: 500 }]
        const makeRoute = (id: string, hash: string, extra: Record<string, unknown> = {}) => ({
            description: <Record<string, unknown>>{ id, isLocal: true, routeHash: hash, hasVideo: true, videoUrl: `video:///d/${id}.mp4`, title: id, tsLastStart: 5 },
            details: { id, title: id, points: POINTS, video: { file: `/home/bob/${id}.mp4`, url: 'file:///x', framerate: 30, format: 'mp4', mappings: [{ time: 0 }] }, ...extra },
        })
        let store: Record<string, ReturnType<typeof makeRoute> & { details?: unknown }>
        let getRouteDetails: jest.Mock
        let now: number
        const names = () => Object.keys(publishMedia.mock.calls.at(-1)?.[0].documents ?? {}).filter(n => n !== 'catalog')

        beforeEach(async () => {
            now = 1_000_000
            jest.spyOn(Date, 'now').mockImplementation(() => now)
            store = { a: makeRoute('a', 'ha'), b: makeRoute('b', 'hb'), c: makeRoute('c', 'hc'), d: makeRoute('d', 'hd'), e: makeRoute('e', 'he') }
            getRouteDetails = jest.fn()
            Inject('RouteList', {
                getAllRoutes: () => Object.values(store), isStillLoading: () => false, on: jest.fn(), off: jest.fn(),
                getRoute: (id: string) => store[id], getRouteDetails,
            })
            await service.start('L1')
            publishMedia.mockClear()
        })
        afterEach(() => { jest.restoreAllMocks() })

        test('publishes the catalog plus a temporary document and answers with its name, size and digest', async () => {
            const res = await service.getDescriptor('ha', 'c1')
            expect(res.error).toBeUndefined()
            expect(res.document).toMatch(/^rd-[0-9a-f]{16}$/)
            expect(res.document).toMatch(/^[a-z][a-z0-9-]{0,31}$/)
            const docs = publishMedia.mock.calls.at(-1)![0].documents
            expect(Object.keys(docs).sort()).toEqual(['catalog', res.document])
            const body = docs[res.document!].body as string
            expect(docs[res.document!].contentType).toBe('application/json')
            expect(res.size).toBe(Buffer.byteLength(body))
            expect(res.sha256).toBe(crypto.createHash('sha256').update(body).digest('base64url'))
            expect(JSON.parse(body)).toMatchObject({ v: 1, routeKey: 'ha' })
            expect(body).not.toContain('bob')
        })

        test('the name is stable for a route', async () => {
            const first = await service.getDescriptor('ha', 'c1')
            const second = await service.getDescriptor('ha', 'c1')
            expect(second.document).toBe(first.document)
            expect(names()).toHaveLength(1)
        })

        test('unknown-route: not in the catalog, official, or without hash', async () => {
            store.o = { ...makeRoute('o', 'ho'), description: { ...makeRoute('o', 'ho').description, isLocal: false, isDownloaded: true } }
            store.n = { ...makeRoute('n', ''), description: { ...makeRoute('n', '').description, routeHash: undefined as unknown as string } }
            await service.refresh()
            expect(await service.getDescriptor('zzz', 'c1')).toEqual({ routeKey: 'zzz', error: 'unknown-route' })
            expect((await service.getDescriptor('o', 'c1')).error).toBe('unknown-route')
            expect((await service.getDescriptor('L1:n', 'c1')).error).toBe('unknown-route')
            expect((await service.getDescriptor(undefined as unknown as string, 'c1')).error).toBe('unknown-route')
        })

        test('loads missing details once', async () => {
            const route = store.a as { details?: unknown }
            const details = route.details
            delete route.details
            getRouteDetails.mockImplementation(async () => { route.details = details })
            const res = await service.getDescriptor('ha', 'c1')
            expect(getRouteDetails).toHaveBeenCalledWith('a')
            expect(res.document).toBeDefined()
        })

        test('no-details when they can not be loaded', async () => {
            delete (store.a as { details?: unknown }).details
            expect((await service.getDescriptor('ha', 'c1')).error).toBe('no-details')
        })

        test('busy: second request on the same connection while one is running', async () => {
            let release: () => void = () => undefined
            publishMedia.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ ok: true, rejectedHandles: [], rejectedTokens: 0 }) }))
            const first = service.getDescriptor('ha', 'c1')
            await new Promise(resolve => setImmediate(resolve))
            expect((await service.getDescriptor('hb', 'c1')).error).toBe('busy')
            release()
            expect((await first).document).toBeDefined()
            expect((await service.getDescriptor('hb', 'c1')).document).toBeDefined()
        })

        test('too-large: more than 16 MB', async () => {
            store.a.details = { ...store.a.details as object, infoTexts: [{ distance: 1, text: 'x'.repeat(17 * 1024 * 1024), localizedText: {} }] } as never
            expect((await service.getDescriptor('ha', 'c1')).error).toBe('too-large')
            expect(names()).toHaveLength(0)
        })

        test('publish-failed removes the document again', async () => {
            publishMedia.mockResolvedValueOnce({ ok: false, rejectedHandles: [], rejectedTokens: 0 })
            expect((await service.getDescriptor('ha', 'c1')).error).toBe('publish-failed')
            await service.setTokens([])
            expect(names()).toHaveLength(0)
        })

        test('keeps at most 4 documents, oldest first out', async () => {
            const served: string[] = []
            for (const key of ['ha', 'hb', 'hc', 'hd', 'he']) {
                now += 1000
                served.push((await service.getDescriptor(key, 'c1')).document!)
            }
            expect(names().sort()).toEqual(served.slice(1).sort())
        })

        test('keeps at most 16 MB in total, oldest first out', async () => {
            const big = (id: string) => { store[id].details = { ...store[id].details as object, infoTexts: [{ distance: 1, text: 'x'.repeat(7 * 1024 * 1024), localizedText: {} }] } as never }
            ;['a', 'b', 'c'].forEach(big)
            const served: string[] = []
            for (const key of ['ha', 'hb', 'hc']) {
                now += 1000
                served.push((await service.getDescriptor(key, 'c1')).document!)
            }
            expect(names().sort()).toEqual(served.slice(1).sort())
        })

        test('documents expire 120 s after the reply and are removed from the publication', async () => {
            const first = await service.getDescriptor('ha', 'c1')
            now += 119_000
            await service.setTokens([])
            expect(names()).toEqual([first.document])
            now += 2000
            await service.setTokens([])
            expect(names()).toEqual([])
        })

        test('an expired document is republished away by the timer', async () => {
            jest.useFakeTimers()
            try {
                const first = await service.getDescriptor('ha', 'c1')
                expect(first.document).toBeDefined()
                publishMedia.mockClear()
                now += 121_000
                await jest.advanceTimersByTimeAsync(121_000)
                expect(publishMedia).toHaveBeenCalledTimes(1)
                expect(names()).toEqual([])
            }
            finally {
                jest.useRealTimers()
            }
        })

        test('stop drops the documents', async () => {
            await service.getDescriptor('ha', 'c1')
            service.stop()
            await service.start('L1')
            expect(names()).toEqual([])
        })
    })
})
