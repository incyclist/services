import { EventEmitter } from 'node:events'
import { getBindings } from '../../../api/bindings'
import { Inject } from '../../../base/decorators'
import type { SharedRouteEntry } from '../types'
import { RouteCopyService } from './service'
import type { RouteCopyStateEvent } from './types'

const MB = 1024 * 1024
const GB = 1024 * MB

class FakeSession extends EventEmitter {
    start = jest.fn()
    stop = jest.fn()
    constructor(public url: string, public file: string) { super() }
}

const row = (linkId: string, videoHandle = `h-${linkId}`): SharedRouteEntry => ({
    linkId, routeKey: 'r1', routeIdOnComputer: 'r1', videoHandle, videoFormat: 'mp4', size: 2 * GB, mtime: 1, lastConfirmedAt: 1, missCount: 0,
})

const flush = async (times = 5) => { for (let i = 0; i < times; i++) await new Promise(resolve => setImmediate(resolve)) }

describe('RouteCopyService', () => {
    const bindings = getBindings() as unknown as Record<string, unknown>
    const savedFetch = globalThis.fetch
    let service: RouteCopyService
    let rows: SharedRouteEntry[]
    let sessions: FakeSession[]
    let supported: boolean
    let status: Record<string, number>
    let unreachable: Set<string>
    let expiresAt: number
    let freeBytes: number | undefined
    let existing: Set<string>
    let route: { description: { id: string, linkShared?: boolean }, details?: unknown }
    let card: { hasLocalCopy: jest.Mock, onCopiedToDevice: jest.Mock }
    let sharing: Record<string, jest.Mock>
    let client: Record<string, unknown>
    let events: RouteCopyStateEvent[]

    const lastSession = () => sessions.at(-1)!

    beforeEach(() => {
        rows = [row('A')]
        sessions = []
        supported = true
        status = {}
        unreachable = new Set()
        expiresAt = Date.now() + 3_600_000
        freeBytes = 10 * GB
        existing = new Set()
        route = { description: { id: 'r1' }, details: {} }
        card = { hasLocalCopy: jest.fn(() => false), onCopiedToDevice: jest.fn(async () => undefined) }
        sharing = {
            isActive: jest.fn(() => supported),
            getRowsForRoute: jest.fn(() => rows),
            onStaleHandle: jest.fn(async () => undefined),
            onGone: jest.fn(async () => undefined),
            loadDescriptor: jest.fn(async () => route),
        }
        client = {
            isSupported: () => supported,
            getDisplayProps: () => ({ links: rows.map(r => ({ linkId: r.linkId, lastSeenAt: 1 })) }),
            getSession: () => ({}),
            getMedia: jest.fn(async (linkId: string) => unreachable.has(linkId) ? undefined : { baseUrl: `http://${linkId}:1`, token: 'tk', expiresAt, catalogVersion: 'v' }),
        }
        globalThis.fetch = jest.fn(async (url: string) => ({ status: status[/http:\/\/([^:]+):1/.exec(url)![1]] ?? 200 })) as unknown as typeof fetch
        bindings.downloadManager = {
            getVideoDir: () => '/videos',
            getFreeSpace: jest.fn(async () => freeBytes),
            createSession: jest.fn((url: string, file: string) => { const s = new FakeSession(url, file); sessions.push(s); return s }),
        }
        bindings.path = { join: (...parts: string[]) => parts.join('/') }
        bindings.fs = {
            existsFile: jest.fn(async (p: string) => existing.has(p)),
            unlink: jest.fn(async (p: string) => { existing.delete(p) }),
        }
        Inject('SharingClient', sharing)
        Inject('LocalLinkClient', client)
        Inject('RouteList', { getRoute: () => route, getCard: () => card })
        service = new RouteCopyService()
        events = []
        service.on('state-changed', (e: RouteCopyStateEvent) => events.push(e))
    })

    afterEach(() => {
        service.reset()
        Inject('SharingClient', null)
        Inject('LocalLinkClient', null)
        Inject('RouteList', null)
        delete bindings.downloadManager
        delete bindings.path
        delete bindings.fs
        globalThis.fetch = savedFetch
        jest.clearAllMocks()
    })

    describe('copyToDevice', () => {
        test('pulls the video with a fresh token, reports progress and marks the route as copied', async () => {
            const result = service.copyToDevice('r1')
            await flush()

            expect(lastSession().url).toBe('http://A:1/v/h-A?t=tk')
            expect(lastSession().file).toBe('/videos/r1.mp4')
            expect(service.getState('r1')).toEqual({ status: 'copying', progress: 0 })

            lastSession().emit('progress', '42.5', '1 MB/s', 100)
            expect(service.getState('r1')).toEqual({ status: 'copying', progress: 42.5 })

            lastSession().emit('done', 'video:///videos/r1.mp4')
            expect(await result).toEqual({ status: 'idle' })
            expect(card.onCopiedToDevice).toHaveBeenCalledWith('video:///videos/r1.mp4')
            expect(service.getState('r1')).toEqual({ status: 'idle' })
            expect(events.at(-1)?.state).toEqual({ status: 'idle' })
        })

        test('a second call while copying shares the copy', async () => {
            const first = service.copyToDevice('r1')
            const second = service.copyToDevice('r1')
            await flush()
            expect(sessions).toHaveLength(1)
            lastSession().emit('done')
            expect(await first).toEqual(await second)
        })

        test('a route that has a local copy needs nothing', async () => {
            card.hasLocalCopy.mockReturnValue(true)
            expect(await service.copyToDevice('r1')).toEqual({ status: 'idle' })
            expect(sessions).toHaveLength(0)
        })

        test('is inert if route sharing is not supported', async () => {
            supported = false
            expect(await service.copyToDevice('r1')).toEqual({ status: 'failed', reason: 'not-supported' })
            expect(sessions).toHaveLength(0)
        })

        test('fails if no computer has the route', async () => {
            rows = []
            expect(await service.copyToDevice('r1')).toEqual({ status: 'failed', reason: 'unreachable' })
        })

        test('refuses up front if the video does not fit (with margin), pulling nothing', async () => {
            freeBytes = 2 * GB + 100 * MB
            expect(await service.copyToDevice('r1')).toEqual({ status: 'failed', reason: 'no-space', sizeBytes: 2 * GB, freeBytes })
            expect(sessions).toHaveLength(0)
            expect(globalThis.fetch).not.toHaveBeenCalled()
        })

        test('starts if the free space is unknown', async () => {
            freeBytes = undefined
            const result = service.copyToDevice('r1')
            await flush()
            lastSession().emit('done')
            expect(await result).toEqual({ status: 'idle' })
        })

        test('fails with no-space if the disk fills up during the copy and removes the partial file', async () => {
            const result = service.copyToDevice('r1')
            await flush()
            existing.add('/videos/r1.mp4')
            lastSession().emit('error', new Error('write failed: ENOSPC'))
            expect(await result).toEqual({ status: 'failed', reason: 'no-space' })
            expect(existing.has('/videos/r1.mp4')).toBe(false)
        })

        test('cancel stops the session, removes the partial file and reports cancelled', async () => {
            const result = service.copyToDevice('r1')
            await flush()
            existing.add('/videos/r1.mp4')
            service.cancel('r1')
            expect(lastSession().stop).toHaveBeenCalled()
            expect(await result).toEqual({ status: 'failed', reason: 'cancelled' })
            expect(existing.has('/videos/r1.mp4')).toBe(false)
            expect(card.onCopiedToDevice).not.toHaveBeenCalled()
        })

        test('a computer that disappears mid-copy fails the copy as unreachable and removes the partial file', async () => {
            const result = service.copyToDevice('r1')
            await flush()
            existing.add('/videos/r1.mp4')
            unreachable.add('A')
            lastSession().emit('error', new Error('connection lost'))
            expect(await result).toEqual({ status: 'failed', reason: 'unreachable' })
            expect(existing.has('/videos/r1.mp4')).toBe(false)
        })

        test('a transfer error message never reaches the log with a media token', async () => {
            const spy = jest.spyOn(service as unknown as { logEvent: (e: unknown) => void }, 'logEvent')
            const result = service.copyToDevice('r1')
            await flush()
            lastSession().emit('error', new Error('GET http://192.168.1.5:6002/v/h1?t=SECRETTOKEN failed'))
            await result
            const logged = JSON.stringify(spy.mock.calls)
            expect(logged).toContain('route copy transfer failed')
            expect(logged).not.toContain('SECRETTOKEN')
        })

        test('a transfer error from a computer that still answers fails as unknown', async () => {
            const result = service.copyToDevice('r1')
            await flush()
            lastSession().emit('error', new Error('boom'))
            expect(await result).toEqual({ status: 'failed', reason: 'unknown' })
            expect(sessions).toHaveLength(1)
        })

        test('a token that expired mid-copy is renewed and the transfer starts again', async () => {
            expiresAt = Date.now() + 1000
            const result = service.copyToDevice('r1')
            await flush()
            expect(sessions).toHaveLength(1)

            expiresAt = Date.now() + 3_600_000
            lastSession().emit('error', new Error('401'))
            await flush()
            expect(sessions).toHaveLength(2)
            expect(client.getMedia).toHaveBeenCalledTimes(2)

            lastSession().emit('done')
            expect(await result).toEqual({ status: 'idle' })
            expect(card.onCopiedToDevice).toHaveBeenCalledTimes(1)
        })

        test('renews an expired token only a bounded number of times', async () => {
            expiresAt = Date.now() + 1000
            const result = service.copyToDevice('r1')
            for (let i = 0; i < 3; i++) {
                await flush()
                lastSession().emit('error', new Error('401'))
            }
            expect(await result).toEqual({ status: 'failed', reason: 'unknown' })
            expect(sessions).toHaveLength(3)
        })

        test('a stale handle (404) is resynced once and the new handle is used', async () => {
            let calls = 0
            globalThis.fetch = jest.fn(async () => ({ status: ++calls === 1 ? 404 : 200 })) as unknown as typeof fetch
            sharing.onStaleHandle.mockResolvedValue(row('A', 'fresh'))

            const result = service.copyToDevice('r1')
            await flush()

            expect(sharing.onStaleHandle).toHaveBeenCalledTimes(1)
            expect(sharing.onStaleHandle).toHaveBeenCalledWith('A', 'r1')
            expect(lastSession().url).toBe('http://A:1/v/fresh?t=tk')
            lastSession().emit('done')
            expect(await result).toEqual({ status: 'idle' })
        })

        test('a handle that stays stale fails as unreachable after one resync', async () => {
            status.A = 404
            expect(await service.copyToDevice('r1')).toEqual({ status: 'failed', reason: 'unreachable' })
            expect(sharing.onStaleHandle).toHaveBeenCalledTimes(1)
            expect(sessions).toHaveLength(0)
        })

        test('a gone file (410) counts a miss and fails as gone', async () => {
            status.A = 410
            expect(await service.copyToDevice('r1')).toEqual({ status: 'failed', reason: 'gone' })
            expect(sharing.onGone).toHaveBeenCalledWith('A', 'r1')
            expect(sessions).toHaveLength(0)
        })

        test('a computer that does not have the file is skipped for the next one', async () => {
            rows = [row('A'), row('B')]
            status.A = 410
            const result = service.copyToDevice('r1')
            await flush()
            expect(lastSession().url).toBe('http://B:1/v/h-B?t=tk')
            lastSession().emit('done')
            expect(await result).toEqual({ status: 'idle' })
        })

        test('loads the details of a route that came from a computer before any video byte is pulled', async () => {
            route = { description: { id: 'r1', linkShared: true } }
            const order: string[] = []
            sharing.loadDescriptor.mockImplementation(async () => { order.push('details') })
            ;(bindings.downloadManager as { createSession: jest.Mock }).createSession.mockImplementation((url: string, file: string) => {
                order.push('session')
                const s = new FakeSession(url, file); sessions.push(s); return s
            })
            const result = service.copyToDevice('r1')
            await flush()
            expect(sharing.loadDescriptor).toHaveBeenCalledWith(route, 'copy')
            expect(order).toEqual(['details', 'session'])
            lastSession().emit('done')
            await result
        })

        test('fails without pulling anything if the details can not be loaded', async () => {
            route = { description: { id: 'r1', linkShared: true } }
            sharing.loadDescriptor.mockRejectedValue(new Error('x'))
            expect(await service.copyToDevice('r1')).toEqual({ status: 'failed', reason: 'details' })
            expect(sessions).toHaveLength(0)
        })

        test('a failure can be retried', async () => {
            let result = service.copyToDevice('r1')
            await flush()
            lastSession().emit('error', new Error('boom'))
            await result
            expect(service.getState('r1')).toEqual({ status: 'failed', reason: 'unknown' })

            result = service.copyToDevice('r1')
            await flush()
            expect(service.getState('r1')).toEqual({ status: 'copying', progress: 0 })
            lastSession().emit('done')
            expect(await result).toEqual({ status: 'idle' })
        })
    })

    describe('clear', () => {
        test('dismisses a failure', async () => {
            supported = false
            await service.copyToDevice('r1')
            service.clear('r1')
            expect(service.getState('r1')).toEqual({ status: 'idle' })
        })
    })
})
