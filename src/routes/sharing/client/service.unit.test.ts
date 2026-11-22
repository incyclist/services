import { EventEmitter } from 'node:events'
import { Inject } from '../../../base/decorators'
import type { LinkClientLink } from '../../../link/client/types'
import { SYNC_TIMEOUT_MS } from './consts'
import { SharedRouteRepo } from './repo'
import type { SharedRouteJsonRepo } from './repo'
import { RouteSharingClientService } from './service'

const doc = (version: string, keys: string[]) => ({
    catalogVersion: version,
    routes: keys.map(k => ({ routeKey: k, routeIdOnComputer: `id-${k}`, title: k, videoHandle: `h-${k}`, videoFormat: 'mp4', size: 1, mtime: 1 })),
})

class FakeClient extends EventEmitter {
    links: Array<Partial<LinkClientLink>> = []
    sessions = new Set<string>()
    media = new Map<string, unknown>()
    mediaDelay = new Map<string, number>()
    supported = true
    isSupported = () => this.supported
    getDisplayProps = () => ({ links: this.links })
    getSession = (linkId: string) => this.sessions.has(linkId) ? { linkId } : undefined
    getMedia = jest.fn(async (linkId: string) => {
        const delay = this.mediaDelay.get(linkId)
        if (delay)
            await new Promise(r => setTimeout(r, delay))
        return this.media.get(linkId)
    })
    setCatalogVersion = jest.fn(async (linkId: string, v: string) => {
        const l = this.links.find(x => x.linkId === linkId)
        if (l)
            l.catalogVersion = v
    })
    check = jest.fn(async () => undefined)
}

describe('RouteSharingClientService', () => {
    let client: FakeClient
    let list: EventEmitter
    let service: RouteSharingClientService
    let files: Map<string, unknown>
    let responses: Map<string, unknown>
    let fetchMock: jest.Mock
    const savedFetch = globalThis.fetch

    const access = (linkId: string, catalogVersion = 'v1') => ({ baseUrl: `http://${linkId}:1`, token: `tok-${linkId}`, expiresAt: Date.now() + 1e7, catalogVersion })
    const addLink = (linkId: string, opts: { online?: boolean, catalogVersion?: string, version?: string } = {}) => {
        client.links.push({ linkId, catalogVersion: opts.catalogVersion })
        if (opts.online !== false) {
            client.media.set(linkId, access(linkId, opts.version))
            client.sessions.add(linkId)
        }
    }
    const rowKeys = () => [...files.keys()].sort()

    beforeEach(() => {
        jest.useFakeTimers()
        client = new FakeClient()
        list = new EventEmitter()
        files = new Map()
        responses = new Map()
        fetchMock = jest.fn(async (url: string) => {
            const base = url.replace('/catalog', '')
            const r = responses.get(base)
            if (r === 'down')
                throw new Error('ECONNREFUSED')
            if (r === 'hang')
                return await new Promise(() => undefined)
            return { ok: true, status: 200, json: async () => r }
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch
        Inject('LocalLinkClient', client)
        Inject('RouteList', list)
        service = new RouteSharingClientService()
        const json: SharedRouteJsonRepo = {
            read: jest.fn(async (name: string) => files.get(name) as never),
            write: jest.fn(async (name: string, data: unknown) => { files.set(name, JSON.parse(JSON.stringify(data))); return true }),
            delete: jest.fn(async (name: string) => files.delete(name)),
            list: jest.fn(async () => [...files.keys()]),
        };
        (service as unknown as { repo: SharedRouteRepo }).repo = new SharedRouteRepo(json)
    })

    afterEach(() => {
        service.reset()
        Inject('LocalLinkClient', null)
        Inject('RouteList', null)
        globalThis.fetch = savedFetch
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('syncAll', () => {
        test('computer A off, B online: only B writes, A keeps its rows', async () => {
            addLink('A')
            addLink('B')
            responses.set('http://A:1', doc('a1', ['x']))
            responses.set('http://B:1', doc('b1', ['y']))
            await service.syncAll()
            expect(rowKeys()).toEqual(['A:x', 'B:y'])

            client.media.delete('A')
            client.sessions.delete('A')
            responses.set('http://B:1', doc('b2', ['y', 'z']))
            client.media.set('B', access('B', 'b2'))
            const results = await service.syncAll({ force: true })
            expect(results.find(r => r.linkId === 'A')?.status).toBe('unreachable')
            expect(rowKeys()).toEqual(['A:x', 'B:y', 'B:z'])
            expect(service.getRepo().getRow('A', 'x')?.missCount).toBe(0)
            expect(client.links.find(l => l.linkId === 'A')?.catalogVersion).toBe('a1')
        })

        test('an unreachable computer never loses a row, however often it is tried', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x']))
            await service.syncAll()
            client.media.delete('A')
            for (let i = 0; i < 10; i++)
                await service.syncAll({ force: true })
            expect(service.getRepo().getRow('A', 'x')?.missCount).toBe(0)
        })

        test('a computer that answers without a route counts a miss, never removes on the first', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x', 'y']))
            await service.syncAll()
            responses.set('http://A:1', doc('a2', ['y']))
            client.media.set('A', access('A', 'a2'))
            await service.syncAll()
            expect(service.getRepo().getRow('A', 'x')?.missCount).toBe(1)
            expect(rowKeys()).toEqual(['A:x', 'A:y'])
        })

        test('a computer that answers with a broken catalog writes nothing', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x']))
            await service.syncAll()
            responses.set('http://A:1', { nope: true })
            client.media.set('A', access('A', 'a2'))
            const [res] = await service.syncAll()
            expect(res.status).toBe('failed')
            expect(service.getRepo().getRow('A', 'x')?.missCount).toBe(0)
            expect(client.links[0].catalogVersion).toBe('a1')
        })

        test('a failing fetch writes nothing', async () => {
            addLink('A')
            responses.set('http://A:1', 'down')
            const [res] = await service.syncAll()
            expect(res.status).toBe('unreachable')
            expect(rowKeys()).toEqual([])
        })

        test('one computer timing out does not abort another', async () => {
            addLink('A')
            addLink('B')
            client.mediaDelay.set('A', SYNC_TIMEOUT_MS * 2)
            responses.set('http://A:1', doc('a1', ['x']))
            responses.set('http://B:1', doc('b1', ['y']))
            const run = service.syncAll()
            await jest.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 100)
            const results = await run
            expect(results.find(r => r.linkId === 'A')?.status).toBe('unreachable')
            expect(results.find(r => r.linkId === 'B')?.status).toBe('synced')
            expect(rowKeys()).toEqual(['B:y'])
        })

        test('one computer failing unexpectedly does not abort another', async () => {
            addLink('A')
            addLink('B')
            client.getMedia.mockImplementationOnce(async () => { throw new Error('boom') })
            responses.set('http://B:1', doc('b1', ['y']))
            const results = await service.syncAll()
            expect(results.find(r => r.linkId === 'A')?.status).toBe('failed')
            expect(rowKeys()).toEqual(['B:y'])
        })

        test('skips the fetch when the catalog version is unchanged', async () => {
            addLink('A', { catalogVersion: 'v1', version: 'v1' })
            const [res] = await service.syncAll()
            expect(res.status).toBe('unchanged')
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('fetches when the version differs and stores the new version', async () => {
            addLink('A', { catalogVersion: 'v1', version: 'v2' })
            responses.set('http://A:1', doc('v2', ['x']))
            const [res] = await service.syncAll()
            expect(res.status).toBe('synced')
            expect(client.setCatalogVersion).toHaveBeenCalledWith('A', 'v2')
            expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-A')
        })

        test('ignores entries with unsafe handles', async () => {
            addLink('A')
            const bad = doc('a1', ['x'])
            bad.routes.push({ ...bad.routes[0], routeKey: 'evil', videoHandle: '../../etc' })
            responses.set('http://A:1', bad)
            await service.syncAll()
            expect(rowKeys()).toEqual(['A:x'])
        })

        test('is inert when route sharing is not supported', async () => {
            client.supported = false
            addLink('A')
            expect(await service.syncAll()).toEqual([])
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('an automatic trigger leaves a computer alone that just did not answer', async () => {
            addLink('A', { online: false })
            await service.syncAll()
            await service.syncAll()
            expect(client.getMedia).toHaveBeenCalledTimes(1)
            await service.syncAll({ force: true })
            expect(client.getMedia).toHaveBeenCalledTimes(2)
        })
    })

    describe('triggers', () => {
        test('route list preload syncs every computer', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x']))
            await service.start()
            list.emit('load-done')
            await jest.advanceTimersByTimeAsync(10)
            expect(rowKeys()).toEqual(['A:x'])
        })

        test('a new session syncs when the version changed', async () => {
            addLink('A')
            responses.set('http://A:1', doc('v1', ['x']))
            await service.start()
            client.emit('session-changed', { linkId: 'A', session: { linkId: 'A' } })
            await jest.advanceTimersByTimeAsync(10)
            expect(rowKeys()).toEqual(['A:x'])
        })

        test('an ended session writes nothing', async () => {
            addLink('A')
            await service.start()
            client.emit('session-changed', { linkId: 'A', session: undefined })
            await jest.advanceTimersByTimeAsync(10)
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('catalog-changed push forces a sync', async () => {
            addLink('A', { catalogVersion: 'v1', version: 'v1' })
            responses.set('http://A:1', doc('v2', ['x']))
            await service.start()
            client.emit('push', { linkId: 'A', message: { t: 'ping', b: {} } })
            client.emit('push', { linkId: 'A', message: { t: 'catalog-changed', b: { catalogVersion: 'v1' } } })
            await jest.advanceTimersByTimeAsync(10)
            expect(fetchMock).not.toHaveBeenCalled()
            client.emit('push', { linkId: 'A', message: { t: 'catalog-changed', b: { catalogVersion: 'v2' } } })
            await jest.advanceTimersByTimeAsync(10)
            expect(rowKeys()).toEqual(['A:x'])
        })

        test('forgetting a computer deletes exactly its rows', async () => {
            addLink('A')
            addLink('B')
            responses.set('http://A:1', doc('a1', ['x']))
            responses.set('http://B:1', doc('b1', ['y']))
            await service.start()
            await service.syncAll()
            client.emit('link-forgotten', 'A')
            await jest.advanceTimersByTimeAsync(10)
            expect(rowKeys()).toEqual(['B:y'])
        })

        test('start does nothing when route sharing is not supported', async () => {
            client.supported = false
            await service.start()
            list.emit('load-done')
            expect(fetchMock).not.toHaveBeenCalled()
        })
    })

    describe('checkAgain', () => {
        test('re-checks the addresses, then syncs the computers that answer even with an unchanged version', async () => {
            addLink('A', { catalogVersion: 'v1', version: 'v1' })
            responses.set('http://A:1', doc('v1', ['x']))
            await service.checkAgain()
            expect(client.check).toHaveBeenCalledWith({ manual: true })
            expect(rowKeys()).toEqual(['A:x'])
        })
    })

    describe('onStaleHandle', () => {
        test('resyncs once and returns the new handle', async () => {
            addLink('A')
            responses.set('http://A:1', doc('v1', ['x']))
            await service.syncAll()
            responses.set('http://A:1', { ...doc('v2', ['x']), routes: [{ ...doc('v2', ['x']).routes[0], videoHandle: 'fresh' }] })
            const row = await service.onStaleHandle('A', 'x')
            expect(row?.videoHandle).toBe('fresh')
            expect(await service.onStaleHandle('A', 'x')).toBeUndefined()
        })

        test('does nothing for a computer that is not connected', async () => {
            addLink('A')
            client.sessions.delete('A')
            expect(await service.onStaleHandle('A', 'x')).toBeUndefined()
            expect(fetchMock).not.toHaveBeenCalled()
        })
    })

    describe('onGone', () => {
        test('counts a miss and keeps the row', async () => {
            addLink('A')
            responses.set('http://A:1', doc('v1', ['x']))
            await service.syncAll()
            await service.onGone('A', 'x')
            expect(service.getRepo().getRow('A', 'x')?.missCount).toBe(1)
        })
    })
})
