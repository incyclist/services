import { EventEmitter } from 'node:events'
import { Inject } from '../../../base/decorators'
import type { LinkClientLink } from '../../../link/client/types'
import { CATALOG_TIMEOUT_MS, SYNC_TIMEOUT_MS } from './consts'
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
            client.emit('push', { linkId: 'A', message: { t: 'catalog-changed', s: 1, b: { catalogVersion: 'v1' } } })
            await jest.advanceTimersByTimeAsync(10)
            expect(fetchMock).not.toHaveBeenCalled()
            client.emit('push', { linkId: 'A', message: { t: 'catalog-changed', s: 1, b: { catalogVersion: 'v2' } } })
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

    describe('getSyncState', () => {
        const states = (): string[] => {
            const seen: string[] = []
            service.on('sync-state', (s: { state: string }) => seen.push(s.state))
            return seen
        }

        test('is idle before any sync', () => {
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'idle' })
        })

        test('goes syncing, then done with the number of routes', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x', 'y']))
            const seen = states()
            await service.syncAll()
            expect(seen).toEqual(['syncing', 'done'])
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'done', routeCount: 2 })
        })

        test('is done with the stored count when the catalog is unchanged', async () => {
            addLink('A')
            responses.set('http://A:1', doc('v1', ['x']))
            await service.syncAll()
            const seen = states()
            await service.syncAll()
            expect(seen).toEqual([])
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'done', routeCount: 1 })
        })

        test('is media-unavailable when this device cannot load media', async () => {
            addLink('A', { online: false })
            client.links[0].mediaAvailable = false
            client.sessions.add('A')
            const seen = states()
            await service.syncAll()
            expect(seen).toEqual(['syncing', 'media-unavailable'])
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'media-unavailable', reason: 'media-unavailable' })
        })

        test('is failed with unreachable when the computer does not answer', async () => {
            addLink('A', { online: false })
            await service.syncAll()
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'failed', reason: 'unreachable' })
        })

        test('is failed with unreachable when the catalog request fails', async () => {
            addLink('A')
            responses.set('http://A:1', 'down')
            await service.syncAll()
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'failed', reason: 'unreachable' })
        })

        test('is failed with bad-catalog when the answer is not a catalog', async () => {
            addLink('A')
            responses.set('http://A:1', { nope: true })
            await service.syncAll()
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'failed', reason: 'bad-catalog' })
        })

        test('is failed with timeout when the session does not come up in time', async () => {
            addLink('A')
            client.mediaDelay.set('A', SYNC_TIMEOUT_MS * 2)
            const run = service.syncAll()
            await jest.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 100)
            await run
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'failed', reason: 'timeout' })
        })

        test('is failed with timeout when the catalog request is not answered', async () => {
            addLink('A')
            responses.set('http://A:1', 'hang')
            fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('aborted')))
            }))
            const run = service.syncAll()
            await jest.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS + 100)
            await run
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'failed', reason: 'timeout' })
        })

        test('a retry after a failure ends in done', async () => {
            addLink('A')
            responses.set('http://A:1', 'down')
            await service.syncAll()
            responses.set('http://A:1', doc('a1', ['x']))
            await service.checkAgain()
            expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'done', routeCount: 1 })
        })

        test('forgetting a computer clears its state', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x']))
            await service.start()
            await service.syncAll()
            client.links = []
            client.emit('link-forgotten', 'A')
            expect(service.getSyncState('A').state).toBe('idle')
        })

        test('a first session after pairing starts the sync', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x', 'y', 'z']))
            await service.start()
            const seen = states()
            client.emit('session-changed', { linkId: 'A', session: { linkId: 'A' } })
            await jest.advanceTimersByTimeAsync(10)
            expect(seen).toEqual(['syncing', 'done'])
            expect(service.getSyncState('A').routeCount).toBe(3)
        })

        test('logs the start and the result without addresses or tokens', async () => {
            addLink('A')
            responses.set('http://A:1', doc('a1', ['x']))
            const log = jest.spyOn(service, 'logEvent')
            await service.syncAll()
            const lines = log.mock.calls.map(c => c[0] as Record<string, unknown>)
            expect(lines.some(l => l.message === 'route sharing sync started')).toBe(true)
            const result = lines.find(l => l.message === 'route sharing sync result')
            expect(result).toMatchObject({ status: 'synced', state: 'done', routes: 1 })
            expect(JSON.stringify(lines)).not.toMatch(/http:|tok-/)
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

    describe('materialisation', () => {
        const hash = 'a'.repeat(32)
        const localDoc = () => ({
            catalogVersion: 'v1',
            routes: [{ routeKey: hash, routeIdOnComputer: 'id', title: 'T', videoHandle: 'h', videoFormat: 'mp4', size: 1, mtime: 1, origin: 'local', routeHash: hash, summary: { title: 'Local one', distance: 10 } }],
        })
        let routes: Array<{ description: Record<string, unknown> }>
        let loaded: boolean

        beforeEach(() => {
            routes = []
            loaded = true
            Object.assign(list, {
                getAllRoutes: () => loaded ? routes : undefined,
                isStillLoading: () => !loaded,
                getRoute: (id: string) => routes.find(r => r.description.id === id),
                getSelected: () => undefined,
                addRoutes: jest.fn((added: Array<{ description: Record<string, unknown> }>) => { routes.push(...added) }),
                saveRoute: jest.fn(async () => undefined),
                removeSharedRoute: jest.fn(async (r: { description: { id: string } }) => { routes = routes.filter(x => x.description.id !== r.description.id) }),
            })
        })

        test('a synced catalog creates the routes of that computer', async () => {
            addLink('A')
            responses.set('http://A:1', localDoc())
            await service.syncAll()
            expect(routes.map(r => r.description.id)).toEqual([hash])
            expect(routes[0].description).toMatchObject({ title: 'Local one', linkShared: true })
        })

        test('a catalog that arrived before the route list was loaded is materialised on load-done', async () => {
            loaded = false
            addLink('A')
            responses.set('http://A:1', localDoc())
            await service.start()
            await service.syncAll()
            expect(routes).toHaveLength(0)
            loaded = true
            list.emit('load-done')
            await jest.advanceTimersByTimeAsync(10)
            expect(routes).toHaveLength(1)
        })

        test('forgetting the last computer removes the routes that only it had', async () => {
            addLink('A')
            addLink('B')
            responses.set('http://A:1', localDoc())
            responses.set('http://B:1', localDoc())
            await service.start()
            await service.syncAll()
            expect(routes).toHaveLength(1)

            client.emit('link-forgotten', 'A')
            await jest.advanceTimersByTimeAsync(10)
            expect(routes).toHaveLength(1)

            client.emit('link-forgotten', 'B')
            await jest.advanceTimersByTimeAsync(10)
            expect(routes).toHaveLength(0)
        })

        test('an unreachable computer removes nothing', async () => {
            addLink('A')
            responses.set('http://A:1', localDoc())
            await service.syncAll()
            client.media.delete('A')
            await service.syncAll({ force: true })
            expect(routes).toHaveLength(1)
        })
    })

    describe('link source markers', () => {
        const hash = 'b'.repeat(32)
        type Descr = Record<string, unknown>
        let routes: Array<{ description: Descr }>
        let loaded: boolean
        let updateLinkSources: jest.Mock
        const catalog = (version: string, entries: Array<Record<string, unknown>>) => ({
            catalogVersion: version,
            routes: entries.map(e => ({ routeIdOnComputer: 'id', title: 'T', videoHandle: 'h', videoFormat: 'mp4', size: 1, mtime: 1, ...e })),
        })
        const official = { routeKey: 'off1', origin: 'official' }
        const byHash = { routeKey: hash, origin: 'local', routeHash: hash, summary: { title: 'Mine' } }
        const description = (id: string) => routes.find(r => r.description.id === id)!.description

        beforeEach(() => {
            loaded = true
            routes = [
                { description: { id: 'off1', title: 'Official', hasVideo: true, requiresDownload: true, distance: 1000, version: 3 } },
                { description: { id: 'mine', routeHash: hash, title: 'Mine', isLocal: true, hasVideo: true, distance: 2000 } },
                { description: { id: 'other', title: 'Other', hasVideo: true } },
            ]
            updateLinkSources = jest.fn((updates: Array<{ id: string, linkSources: string[] }>) => {
                for (const u of updates) {
                    const d = description(u.id)
                    if (u.linkSources.length > 0)
                        d.linkSources = u.linkSources
                    else
                        delete d.linkSources
                }
                return updates.length
            })
            Object.assign(list, {
                getAllRoutes: () => loaded ? routes : undefined,
                isStillLoading: () => !loaded,
                getRoute: (id: string) => routes.find(r => r.description.id === id),
                getSelected: () => undefined,
                addRoutes: jest.fn(),
                saveRoute: jest.fn(async () => undefined),
                removeSharedRoute: jest.fn(async () => true),
                updateLinkSources,
            })
        })

        test('a fresh install: no computer, no marker, no write', async () => {
            await service.start()
            list.emit('load-done')
            await jest.advanceTimersByTimeAsync(10)
            expect(updateLinkSources).not.toHaveBeenCalled()
            expect(routes.every(r => !('linkSources' in r.description))).toBe(true)
        })

        test('a sync marks the matching routes by id and by routeHash, officials are not materialised, nothing else changes', async () => {
            const before = JSON.parse(JSON.stringify(routes))
            const changed = jest.fn()
            service.on('link-sources-changed', changed)
            addLink('A')
            responses.set('http://A:1', catalog('v1', [official, byHash, { routeKey: 'unknown', origin: 'official' }]))
            await service.syncAll()

            expect(description('off1')).toEqual({ ...before[0].description, linkSources: ['A'] })
            expect(description('mine')).toEqual({ ...before[1].description, linkSources: ['A'] })
            expect(description('other')).toEqual(before[2].description)
            expect(routes).toHaveLength(3)
            expect((list as unknown as { addRoutes: jest.Mock }).addRoutes).not.toHaveBeenCalled()
            expect(updateLinkSources).toHaveBeenCalledTimes(1)
            expect(updateLinkSources.mock.calls[0][0]).toHaveLength(2)
            expect(changed).toHaveBeenCalledWith(2)
        })

        test('a second sync that changes nothing writes nothing', async () => {
            addLink('A')
            responses.set('http://A:1', catalog('v1', [official]))
            await service.syncAll()
            updateLinkSources.mockClear()
            responses.set('http://A:1', catalog('v2', [official]))
            client.media.set('A', access('A', 'v2'))
            await service.syncAll()
            expect(updateLinkSources).not.toHaveBeenCalled()
        })

        test('several computers are all listed; a computer that drops the route is removed from the marker', async () => {
            addLink('A')
            addLink('B')
            responses.set('http://A:1', catalog('a1', [official]))
            responses.set('http://B:1', catalog('b1', [official]))
            await service.syncAll()
            expect(description('off1').linkSources).toEqual(['A', 'B'])

            responses.set('http://B:1', catalog('b2', []))
            client.media.set('B', access('B', 'b2'))
            await service.syncAll()
            expect(description('off1').linkSources).toEqual(['A'])
        })

        test('the route is dropped from the marker as soon as the computer answers without it', async () => {
            addLink('A')
            responses.set('http://A:1', catalog('a1', [official]))
            await service.syncAll()
            responses.set('http://A:1', catalog('a2', []))
            client.media.set('A', access('A', 'a2'))
            await service.syncAll()
            expect(description('off1')).not.toHaveProperty('linkSources')
        })

        test('a computer that does not answer keeps its markers', async () => {
            addLink('A')
            responses.set('http://A:1', catalog('a1', [official]))
            await service.syncAll()
            client.media.delete('A')
            await service.syncAll({ force: true })
            expect(description('off1').linkSources).toEqual(['A'])
        })

        test('forgetting a computer clears its markers and keeps the others', async () => {
            addLink('A')
            addLink('B')
            responses.set('http://A:1', catalog('a1', [official, byHash]))
            responses.set('http://B:1', catalog('b1', [official]))
            await service.start()
            await service.syncAll()

            client.emit('link-forgotten', 'A')
            await jest.advanceTimersByTimeAsync(10)
            expect(description('off1').linkSources).toEqual(['B'])
            expect(description('mine')).not.toHaveProperty('linkSources')
            expect(routes).toHaveLength(3)

            client.emit('link-forgotten', 'B')
            await jest.advanceTimersByTimeAsync(10)
            expect(description('off1')).not.toHaveProperty('linkSources')
        })

        test('a route list that finished loading after the sync gets the markers on load-done', async () => {
            loaded = false
            addLink('A')
            responses.set('http://A:1', catalog('a1', [official]))
            await service.start()
            await service.syncAll()
            expect(updateLinkSources).not.toHaveBeenCalled()
            expect(description('off1')).not.toHaveProperty('linkSources')

            loaded = true
            list.emit('load-done')
            await jest.advanceTimersByTimeAsync(10)
            expect(description('off1').linkSources).toEqual(['A'])
        })

        test('a route that exists only because of the computer carries no marker (its rows are the source)', async () => {
            routes.push({ description: { id: hash.replace('b', 'c'), linkShared: true, title: 'Shared', isLocal: true, hasVideo: true } })
            const key = hash.replace('b', 'c')
            addLink('A')
            responses.set('http://A:1', catalog('a1', [{ routeKey: key, origin: 'local', routeHash: key, summary: { title: 'Shared' } }]))
            await service.syncAll()
            expect(description(key)).not.toHaveProperty('linkSources')
        })

        test('a failing route list never throws out of a sync', async () => {
            updateLinkSources.mockImplementation(() => { throw new Error('boom') })
            addLink('A')
            responses.set('http://A:1', catalog('a1', [official]))
            await expect(service.syncAll()).resolves.toEqual([expect.objectContaining({ status: 'synced' })])
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
