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
})
