import { getBindings } from '../../../api/bindings'
import { Inject } from '../../../base/decorators'
import type { SharedRouteEntry } from '../types'
import { RouteVideoResolver } from './resolver'
import type { VideoSourceInput } from './types'

const row = (linkId: string, routeKey = 'r1', videoHandle = `h-${linkId}`): SharedRouteEntry => ({
    linkId, routeKey, routeIdOnComputer: routeKey, videoHandle, videoFormat: 'mp4', size: 1, mtime: 1, lastConfirmedAt: 1, missCount: 0,
})

describe('RouteVideoResolver', () => {
    const bindings = getBindings() as unknown as Record<string, unknown>
    const savedFetch = globalThis.fetch
    let resolver: RouteVideoResolver
    let rows: SharedRouteEntry[]
    let sessions: Set<string>
    let lastSeen: Record<string, number>
    let supported: boolean
    let status: Record<string, number | 'down'>
    let unreachable: Set<string>
    let fetchMock: jest.Mock
    let existing: Set<string>
    let sharing: { getRowsForRoute: jest.Mock, onStaleHandle: jest.Mock, onGone: jest.Mock }
    let client: Record<string, unknown>

    const official: VideoSourceInput = { id: 'r1', videoUrl: 'https://cdn/x.mp4', originalVideoUrl: 'https://cdn/x.mp4' }
    const downloaded: VideoSourceInput = { ...official, isDownloaded: true, videoUrl: 'file:///data/x.mp4' }

    beforeEach(() => {
        rows = []
        sessions = new Set()
        lastSeen = {}
        status = {}
        unreachable = new Set()
        existing = new Set(['/data/x.mp4'])
        supported = true
        sharing = {
            getRowsForRoute: jest.fn(() => rows),
            onStaleHandle: jest.fn(async () => undefined),
            onGone: jest.fn(async () => undefined),
        }
        client = {
            isSupported: () => supported,
            getDisplayProps: () => ({ links: [...new Set(rows.map(r => r.linkId))].map(linkId => ({ linkId, lastSeenAt: lastSeen[linkId] })) }),
            getSession: (linkId: string) => sessions.has(linkId) ? { linkId } : undefined,
            getMedia: jest.fn(async (linkId: string) => unreachable.has(linkId) ? undefined : { baseUrl: `http://${linkId}:1`, token: 'tk/1', expiresAt: 1e12, catalogVersion: 'v' }),
        }
        fetchMock = jest.fn(async (url: string) => {
            const link = /http:\/\/([^:]+):1/.exec(url)![1]
            const s = status[link] ?? 200
            if (s === 'down')
                throw new Error('down')
            return { status: s }
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch
        bindings.fs = { existsFile: jest.fn(async (p: string) => existing.has(p)) }
        Inject('SharingClient', sharing)
        Inject('LocalLinkClient', client)
        resolver = new RouteVideoResolver()
    })

    afterEach(() => {
        Inject('SharingClient', null)
        Inject('LocalLinkClient', null)
        delete bindings.fs
        globalThis.fetch = savedFetch
        jest.clearAllMocks()
    })

    describe('resolve', () => {
        test('a local copy wins over everything', async () => {
            rows = [row('A')]
            sessions.add('A')
            expect(await resolver.resolve(downloaded)).toEqual({ source: 'local', url: 'file:///data/x.mp4' })
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('a missing local file falls through to a computer', async () => {
            existing.clear()
            rows = [row('A')]
            sessions.add('A')
            expect((await resolver.resolve(downloaded)).source).toBe('link')
        })

        test('a computer that answers gives the direct URL with the token', async () => {
            rows = [row('A')]
            sessions.add('A')
            expect(await resolver.resolve(official)).toEqual({ source: 'link', linkId: 'A', url: 'http://A:1/v/h-A?t=tk%2F1' })
            expect(fetchMock.mock.calls[0][1].method).toBe('HEAD')
        })

        test('the base URL of the client decides the path (Android pipe)', async () => {
            rows = [row('A')]
            sessions.add('A');
            (client.getMedia as jest.Mock).mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:5555', token: 't', expiresAt: 1e12, catalogVersion: 'v' })
            fetchMock.mockResolvedValueOnce({ status: 200 })
            expect(await resolver.resolve(official)).toEqual({ source: 'link', linkId: 'A', url: 'http://127.0.0.1:5555/v/h-A?t=t' })
        })

        test('connected computers come first, then the most recently seen', async () => {
            rows = [row('A'), row('B'), row('C')]
            lastSeen = { A: 1, B: 5, C: 9 }
            sessions.add('A')
            const calls: string[] = []
            fetchMock.mockImplementation(async (url: string) => { calls.push(url); return { status: 404 } })
            await resolver.resolve(official)
            expect(calls.map(u => u.slice(7, 8))).toEqual(['A', 'C', 'B'])
        })

        test('the first that answers wins', async () => {
            rows = [row('A'), row('B')]
            sessions.add('A')
            sessions.add('B')
            status = { A: 503 }
            const res = await resolver.resolve(official)
            expect(res).toMatchObject({ source: 'link', linkId: 'B' })
        })

        test('skipLinks is the one fallthrough after a load failure', async () => {
            rows = [row('A'), row('B')]
            sessions.add('A')
            sessions.add('B')
            expect(await resolver.resolve(official, { skipLinks: ['A'] })).toMatchObject({ source: 'link', linkId: 'B' })
            expect(await resolver.resolve(official, { skipLinks: ['A', 'B'] })).toEqual({ source: 'remote', url: 'https://cdn/x.mp4' })
        })

        test('an unreachable computer is skipped and not asked again right away', async () => {
            rows = [row('A')]
            unreachable.add('A')
            expect(await resolver.resolve(official)).toEqual({ source: 'remote', url: 'https://cdn/x.mp4' })
            await resolver.resolve(official)
            expect(client.getMedia).toHaveBeenCalledTimes(1)
        })

        test('a stale handle is refreshed once and retried', async () => {
            rows = [row('A')]
            sessions.add('A')
            sharing.onStaleHandle.mockResolvedValue(row('A', 'r1', 'fresh'))
            fetchMock.mockResolvedValueOnce({ status: 404 }).mockResolvedValueOnce({ status: 200 })
            expect(await resolver.resolve(official)).toMatchObject({ source: 'link', url: 'http://A:1/v/fresh?t=tk%2F1' })
            expect(sharing.onStaleHandle).toHaveBeenCalledWith('A', 'r1')
        })

        test('a stale handle that cannot be refreshed moves on', async () => {
            rows = [row('A')]
            sessions.add('A')
            status = { A: 404 }
            expect((await resolver.resolve(official)).source).toBe('remote')
        })

        test('a gone file counts a miss and moves on to the next computer', async () => {
            rows = [row('A'), row('B')]
            sessions.add('A')
            sessions.add('B')
            status = { A: 410 }
            expect(await resolver.resolve(official)).toMatchObject({ source: 'link', linkId: 'B' })
            expect(sharing.onGone).toHaveBeenCalledWith('A', 'r1')
        })

        test('a computer that does not answer the probe falls through to the remote original', async () => {
            rows = [row('A')]
            sessions.add('A')
            status = { A: 'down' }
            expect(await resolver.resolve(official)).toEqual({ source: 'remote', url: 'https://cdn/x.mp4' })
        })

        test('without route sharing the chain is local then remote', async () => {
            supported = false
            rows = [row('A')]
            sessions.add('A')
            expect(await resolver.resolve(official)).toEqual({ source: 'remote', url: 'https://cdn/x.mp4' })
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('a route without a remote original is not handled', async () => {
            rows = [row('A')]
            sessions.add('A')
            expect(await resolver.resolve({ id: 'r1', videoUrl: 'file:///data/x.mp4', isDownloaded: true })).toEqual({ source: 'unavailable' })
            expect(await resolver.resolve({ ...official, isLocal: true })).toEqual({ source: 'unavailable' })
        })

        test('the result is never written back to the route', async () => {
            rows = [row('A')]
            sessions.add('A')
            const input = { ...official }
            await resolver.resolve(input)
            expect(input).toEqual(official)
        })
    })

    describe('getAvailability', () => {
        test('uses cached state only', () => {
            rows = [row('A')]
            sessions.add('A')
            expect(resolver.getAvailability(official)).toEqual({ canStart: true, availability: 'fromLink', linkId: 'A' })
            expect(resolver.hasLinkSource(official)).toBe(true)
            expect(fetchMock).not.toHaveBeenCalled()
            expect(client.getMedia).not.toHaveBeenCalled()
        })

        test('a computer that is not connected does not count', () => {
            rows = [row('A')]
            expect(resolver.getAvailability(official)).toEqual({ canStart: true, availability: 'remote' })
            expect(resolver.hasLinkSource(official)).toBe(false)
        })

        test('local copy and ineligible routes', () => {
            expect(resolver.getAvailability(downloaded).availability).toBe('local')
            expect(resolver.getAvailability({ id: 'x', isLocal: true }).canStart).toBe(false)
        })

        test('nothing when route sharing is not supported', () => {
            supported = false
            rows = [row('A')]
            sessions.add('A')
            expect(resolver.hasLinkSource(official)).toBe(false)
        })
    })

    describe('getThumbnailLink', () => {
        test('prefers the given computer, otherwise the most recently confirmed row that has a thumbnail', () => {
            rows = [
                { ...row('A'), thumbHandle: 'tA', lastConfirmedAt: 5 },
                { ...row('B'), thumbHandle: 'tB', lastConfirmedAt: 9 },
                { ...row('C'), lastConfirmedAt: 20 },
            ]
            expect(resolver.getThumbnailLink('r1', 'A')).toEqual({ linkId: 'A', thumbHandle: 'tA' })
            expect(resolver.getThumbnailLink('r1')).toEqual({ linkId: 'B', thumbHandle: 'tB' })
        })

        test('is undefined without a thumbnail and when the lookup fails', () => {
            rows = [row('A')]
            expect(resolver.getThumbnailLink('r1')).toBeUndefined()
            sharing.getRowsForRoute.mockImplementation(() => { throw new Error('boom') })
            expect(resolver.getThumbnailLink('r1')).toBeUndefined()
        })
    })

    describe('getRouteAvailability', () => {
        const shared: VideoSourceInput = { id: 'r1', isLocal: true, hasVideo: true, linkShared: true }
        type LinkState = { displayName: string, reachability: string, mediaAvailable?: boolean, capabilities?: string[] }
        let state: Record<string, LinkState>

        beforeEach(() => {
            state = {}
            client.getDisplayProps = () => ({
                links: Object.entries(state).map(([linkId, l]) => ({ linkId, lastSeenAt: lastSeen[linkId], displayName: l.displayName, reachability: l.reachability, mediaAvailable: l.mediaAvailable ?? true })),
            })
            client.getSession = (linkId: string) => sessions.has(linkId) ? { linkId, capabilities: state[linkId]?.capabilities ?? ['route-sharing', 'route-descriptor'] } : undefined
        })

        const link = (linkId: string, extra: Partial<LinkState> = {}, connected = true) => {
            state[linkId] = { displayName: `PC ${linkId}`, reachability: connected ? 'reachable' : 'not-reachable', ...extra }
            rows.push(row(linkId))
            if (connected)
                sessions.add(linkId)
        }

        test('linkShared, connected computer with the capability: fromLink with its name; details not needed', () => {
            link('A')
            expect(resolver.getRouteAvailability(shared)).toEqual({ canStart: true, availability: 'fromLink', sourceLabel: 'PC A', linkId: 'A' })
        })

        test('linkShared on two computers: one name, the most recently seen connected one', () => {
            link('A')
            link('B')
            link('C', {}, false)
            lastSeen = { A: 1, B: 5, C: 9 }
            const res = resolver.getRouteAvailability(shared)
            expect(res).toMatchObject({ availability: 'fromLink', sourceLabel: 'PC B' })
            expect(JSON.stringify(res)).not.toMatch(/\d computers?/)
        })

        test('linkShared, connected computer without the capability: versionMismatch unless details are persisted', () => {
            link('A', { capabilities: ['route-sharing'] })
            expect(resolver.getRouteAvailability(shared)).toEqual({ canStart: false, availability: 'unavailable', unavailableReason: 'versionMismatch', sourceLabel: 'PC A' })
            expect(resolver.getRouteAvailability(shared, { hasDetails: true })).toMatchObject({ canStart: true, availability: 'fromLink' })
        })

        test('linkShared, a capable computer is preferred over a more recent one without the capability', () => {
            link('A')
            link('B', { capabilities: ['route-sharing'] })
            lastSeen = { A: 1, B: 9 }
            expect(resolver.getRouteAvailability(shared)).toMatchObject({ availability: 'fromLink', sourceLabel: 'PC A' })
        })

        test('linkShared, no connected computer: the most recently seen one, reason from its reachability', () => {
            link('A', { reachability: 'not-reachable' }, false)
            link('B', { reachability: 'never-reached' }, false)
            lastSeen = { A: 9, B: 1 }
            expect(resolver.getRouteAvailability(shared, { hasDetails: true })).toEqual({ canStart: false, availability: 'unavailable', unavailableReason: 'linkUnreachable', sourceLabel: 'PC A' })
            lastSeen = { A: 1, B: 9 }
            expect(resolver.getRouteAvailability(shared)).toMatchObject({ unavailableReason: 'linkNeverReached', sourceLabel: 'PC B' })
            state.B.reachability = 'version-mismatch'
            expect(resolver.getRouteAvailability(shared)).toMatchObject({ unavailableReason: 'versionMismatch' })
        })

        test('linkShared without any row: noSource, no label', () => {
            expect(resolver.getRouteAvailability(shared)).toEqual({ canStart: false, availability: 'unavailable', unavailableReason: 'noSource' })
        })

        test('linkShared with a local copy: local', () => {
            expect(resolver.getRouteAvailability({ ...shared, isDownloaded: true, videoUrl: 'file:///data/x.mp4' })).toEqual({ canStart: true, availability: 'local' })
        })

        test('linkShared while route sharing is not supported: noSource', () => {
            link('A')
            supported = false
            expect(resolver.getRouteAvailability(shared)).toMatchObject({ canStart: false, unavailableReason: 'noSource' })
        })

        test('a connected computer whose media can not be played is not a source', () => {
            link('A', { mediaAvailable: false })
            expect(resolver.getRouteAvailability(shared)).toMatchObject({ availability: 'unavailable', unavailableReason: 'linkUnreachable' })
        })

        test('official route: local copy, fromLink with the name, remote', () => {
            expect(resolver.getRouteAvailability(downloaded)).toEqual({ canStart: true, availability: 'local' })
            expect(resolver.getRouteAvailability(official)).toEqual({ canStart: true, availability: 'remote' })
            link('A')
            expect(resolver.getRouteAvailability(official)).toEqual({ canStart: true, availability: 'fromLink', sourceLabel: 'PC A', linkId: 'A' })
        })

        test('the phone\'s own routes and routes without video are local', () => {
            expect(resolver.getRouteAvailability({ id: 'x', isLocal: true, hasVideo: true, videoUrl: 'file:///a.mp4' }).availability).toBe('local')
            expect(resolver.getRouteAvailability({ id: 'x', hasVideo: false }).availability).toBe('local')
        })

        test('never causes a request or a probe', () => {
            link('A')
            link('B', {}, false)
            resolver.getRouteAvailability(shared)
            resolver.getRouteAvailability(official)
            expect(fetchMock).not.toHaveBeenCalled()
            expect((client.getMedia as jest.Mock)).not.toHaveBeenCalled()
        })

        test('a snapshot read once serves many routes', () => {
            link('A')
            const getDisplayProps = jest.spyOn(client as { getDisplayProps: () => unknown }, 'getDisplayProps')
            const links = resolver.getLinkSnapshot()
            getDisplayProps.mockClear()
            for (let i = 0; i < 50; i++) {
                resolver.getRouteAvailability(shared, { links })
                resolver.getRouteAvailability(official, { links })
            }
            expect(getDisplayProps).not.toHaveBeenCalled()
        })
    })

    describe('resolve for linkShared routes', () => {
        const shared: VideoSourceInput = { id: 'r1', isLocal: true, hasVideo: true, linkShared: true }

        test('is eligible and resolves through a computer; without one it is unavailable (no remote original)', async () => {
            expect(resolver.isEligible(shared)).toBe(true)
            expect(await resolver.resolve(shared)).toEqual({ source: 'unavailable' })
            rows = [row('A')]
            sessions.add('A')
            expect(await resolver.resolve(shared)).toMatchObject({ source: 'link', linkId: 'A' })
        })
    })
})
