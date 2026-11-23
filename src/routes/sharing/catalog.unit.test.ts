import type { RouteInfo } from '../base/types'
import { buildCatalog, buildSummary, getRouteKey, isShareable } from './catalog'

const opts = (sizes: Record<string, number | undefined> = {}) => ({
    linkId: 'L1',
    makeHandle: (kind: 'v' | 't', path: string) => `${kind}-${path.replaceAll(/\W/g, '_')}`,
    stat: async (path: string) => sizes[path],
    hash: (text: string) => `h${text.length}`,
})

const ALL = new Proxy({} as Record<string, number>, { get: () => 1 })

const route = (o: Partial<RouteInfo>): RouteInfo => ({ id: 'r', title: 'T', hasVideo: true, ...o })

describe('isShareable', () => {
    test('needs isLocal or isDownloaded and a local video path', () => {
        expect(isShareable(route({ isLocal: true, videoUrl: 'video:///home/a.mp4' }))).toBe(true)
        expect(isShareable(route({ isDownloaded: true, videoUrl: 'file:///home/a.mp4' }))).toBe(true)
        expect(isShareable(route({ videoUrl: 'video:///home/a.mp4' }))).toBe(false)
        expect(isShareable(route({ isLocal: true, videoUrl: 'https://x/a.mp4' }))).toBe(false)
        expect(isShareable(route({ isLocal: true, videoUrl: 'video:///a.mp4', isDeleted: true }))).toBe(false)
        expect(isShareable(undefined)).toBe(false)
    })
})

describe('getRouteKey', () => {
    test('official route: its id', () => {
        expect(getRouteKey(route({ id: 'srv-1', isDownloaded: true, routeHash: 'abc' }), 'L1')).toBe('srv-1')
    })
    test('local route: routeHash', () => {
        expect(getRouteKey(route({ id: 'x', isLocal: true, routeHash: 'abc' }), 'L1')).toBe('abc')
    })
    test('local route without hash: linkId and own id', () => {
        expect(getRouteKey(route({ id: 'x', isLocal: true }), 'L1')).toBe('L1:x')
    })
})

describe('buildCatalog', () => {
    test('lists only shareable routes with handles, sizes and thumbnails', async () => {
        const res = await buildCatalog([
            route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4', previewUrl: 'file:///d/a.jpg', title: 'A' }),
            route({ id: 'b', isDownloaded: true, videoUrl: 'file:///d/b.mkv' }),
            route({ id: 'c', videoUrl: 'video:///d/c.mp4' }),
            route({ id: 'd', isDownloaded: true, videoUrl: 'https://remote/d.mp4' }),
        ], opts({ '/d/a.mp4': 100, '/d/b.mkv': 50, '/d/a.jpg': 7 }))

        expect(res.document.routes.map(r => r.routeKey)).toEqual(['b', 'ha'])
        const a = res.document.routes[1]
        expect(a).toMatchObject({ routeKey: 'ha', routeIdOnComputer: 'a', title: 'A', size: 100, origin: 'local', routeHash: 'ha', videoFormat: 'mp4' })
        expect(a.videoHandle).toBe('v-_d_a_mp4')
        expect(a.thumbHandle).toBe('t-_d_a_jpg')
        expect(res.document.routes[0]).toMatchObject({ origin: 'official', size: 50, videoFormat: 'mkv' })
        expect(res.document.routes[0].thumbHandle).toBeUndefined()
        expect(res.handles).toEqual([
            { handle: 'v-_d_b_mkv', path: '/d/b.mkv', contentType: 'video/x-matroska' },
            { handle: 'v-_d_a_mp4', path: '/d/a.mp4', contentType: 'video/mp4' },
            { handle: 't-_d_a_jpg', path: '/d/a.jpg', contentType: 'image/jpeg' },
        ])
    })

    test('only known video and image types are shared; counts of the rest are reported', async () => {
        const res = await buildCatalog([
            route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4', previewUrl: 'file:///d/a.svg' }),
            route({ id: 'b', isLocal: true, routeHash: 'hb', videoUrl: 'video:///d/b.exe' }),
            route({ id: 'c', isLocal: true, routeHash: 'hc', videoUrl: 'video:///d/c' }),
            route({ id: 'd', isLocal: true, routeHash: 'hd', videoUrl: 'video:///d/constructor' }),
            route({ id: 'e', isLocal: true, routeHash: 'he', videoUrl: 'video:///d/e.MP4', previewUrl: 'file:///d/e.PNG' }),
            route({ id: 'f', isLocal: true, routeHash: 'hf', videoUrl: 'video:///d/f.avi' }),
        ], opts({ '/d/a.mp4': 1, '/d/e.MP4': 1, '/d/e.PNG': 3, '/d/f.avi': 5 }))

        expect(res.document.routes.map(r => r.routeKey)).toEqual(['ha', 'he'])
        expect(res.document.routes[0].thumbHandle).toBeUndefined()
        expect(res.document.routes[1].thumbHandle).toBeDefined()
        expect(res.handles.map(h => h.path)).toEqual(['/d/a.mp4', '/d/e.MP4', '/d/e.PNG'])
        expect(res.handles.every(h => h.contentType !== undefined)).toBe(true)
        expect(res.skipped).toEqual({ video: 4, thumbnail: 1, missingVideo: 0 })
    })

    test('a preview file that is missing or empty gets no thumbHandle, is counted, and the route stays', async () => {
        const res = await buildCatalog([
            route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4', previewUrl: 'file:///d/gone.jpg' }),
            route({ id: 'b', isLocal: true, routeHash: 'hb', videoUrl: 'video:///d/b.mp4', previewUrl: 'file:///d/empty.jpg' }),
            route({ id: 'c', isLocal: true, routeHash: 'hc', videoUrl: 'video:///d/c.mp4', previewUrl: 'file:///d/my%20pic.jpg' }),
            route({ id: 'd', isLocal: true, routeHash: 'hd', videoUrl: 'video:///d/d.mp4' }),
        ], opts({ '/d/a.mp4': 1, '/d/b.mp4': 1, '/d/c.mp4': 1, '/d/d.mp4': 1, '/d/empty.jpg': 0, '/d/my pic.jpg': 10 }))

        expect(res.document.routes.map(r => r.routeKey)).toEqual(['ha', 'hb', 'hc', 'hd'])
        expect(res.document.routes.map(r => r.thumbHandle !== undefined)).toEqual([false, false, true, false])
        expect(res.handles.map(h => h.path)).toEqual(['/d/a.mp4', '/d/b.mp4', '/d/c.mp4', '/d/my pic.jpg', '/d/d.mp4'])
        expect(res.skipped).toEqual({ video: 0, thumbnail: 2, missingVideo: 0 })
        expect(res.thumbnails).toEqual({ with: 1, without: 3 })
    })

    test('catalog version changes when a preview file disappears', async () => {
        const r = route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4', previewUrl: 'file:///d/a.jpg' })
        const present = await buildCatalog([r], opts({ '/d/a.mp4': 1, '/d/a.jpg': 5 }))
        const gone = await buildCatalog([r], opts({ '/d/a.mp4': 1 }))
        expect(present.document.catalogVersion).not.toBe(gone.document.catalogVersion)
    })

    test('duplicate keys are listed once', async () => {
        const res = await buildCatalog([
            route({ id: 'a', isLocal: true, routeHash: 'same', videoUrl: 'video:///d/a.mp4' }),
            route({ id: 'b', isLocal: true, routeHash: 'same', videoUrl: 'video:///d/b.mp4' }),
        ], opts(ALL))
        expect(res.document.routes).toHaveLength(1)
    })

    test('catalog version follows the content, not the input order', async () => {
        const a = route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4' })
        const b = route({ id: 'b', isLocal: true, routeHash: 'hb', videoUrl: 'video:///d/b.mp4' })
        const one = await buildCatalog([a, b], opts(ALL))
        const two = await buildCatalog([b, a], opts(ALL))
        expect(one.document).toEqual(two.document)
        const three = await buildCatalog([a], opts(ALL))
        expect(three.document.catalogVersion).not.toBe(one.document.catalogVersion)
    })

    test('carries no profile data or credentials', async () => {
        const res = await buildCatalog([route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4' })], opts(ALL))
        expect(Object.keys(res.document.routes[0]).sort()).toEqual(
            ['mtime', 'origin', 'routeHash', 'routeIdOnComputer', 'routeKey', 'size', 'summary', 'title', 'videoFormat', 'videoHandle'])
    })

    test('summary only for local routes with a hash', async () => {
        const res = await buildCatalog([
            route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4', distance: 1000 }),
            route({ id: 'b', isLocal: true, videoUrl: 'video:///d/b.mp4' }),
            route({ id: 'c', isDownloaded: true, routeHash: 'hc', videoUrl: 'file:///d/c.mp4' }),
        ], opts(ALL))
        const byId = (id: string) => res.document.routes.find(r => r.routeIdOnComputer === id)!
        expect(byId('a').summary).toEqual({ title: 'T', distance: 1000 })
        expect(byId('b').summary).toBeUndefined()
        expect(byId('b').routeKey).toBe('L1:b')
        expect(byId('c').summary).toBeUndefined()
    })

    test('catalog version is stable across rebuilds and ignores fields that are not in the summary', async () => {
        const make = (tsLastStart: number) => route({
            id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4', distance: 5, tsLastStart, previewUrl: undefined,
        })
        const one = await buildCatalog([make(1)], opts(ALL))
        const two = await buildCatalog([make(2)], opts(ALL))
        expect(one.document.catalogVersion).toBe(two.document.catalogVersion)
        expect(one.document).toEqual(two.document)
    })
})

describe('buildCatalog with missing video files', () => {
    const a = route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///nas/a.mp4' })
    const b = route({ id: 'b', isLocal: true, routeHash: 'hb', videoUrl: 'video:///d/b.mp4' })

    test('a route whose video is missing is left out and counted', async () => {
        const res = await buildCatalog([a], opts())
        expect(res.document.routes).toEqual([])
        expect(res.handles).toEqual([])
        expect(res.skipped).toEqual({ video: 0, thumbnail: 0, missingVideo: 1 })
    })

    test('an empty video file counts as missing', async () => {
        const res = await buildCatalog([a], opts({ '/nas/a.mp4': 0 }))
        expect(res.document.routes).toEqual([])
        expect(res.skipped.missingVideo).toBe(1)
    })

    test('an existing video is listed with its size', async () => {
        const res = await buildCatalog([b], opts({ '/d/b.mp4': 123 }))
        expect(res.document.routes).toHaveLength(1)
        expect(res.document.routes[0].size).toBe(123)
        expect(res.skipped.missingVideo).toBe(0)
    })

    test('mixed list: only the routes with a video are listed, the version differs', async () => {
        const stat = jest.fn(async (path: string) => ({ '/d/b.mp4': 5 } as Record<string, number>)[path])
        const mixed = await buildCatalog([a, b], { ...opts(), stat })
        expect(mixed.document.routes.map(r => r.routeKey)).toEqual(['hb'])
        expect(mixed.skipped.missingVideo).toBe(1)
        expect(stat).toHaveBeenCalledTimes(2)

        const both = await buildCatalog([a, b], opts({ '/nas/a.mp4': 9, '/d/b.mp4': 5 }))
        expect(both.document.routes.map(r => r.routeKey)).toEqual(['ha', 'hb'])
        expect(both.document.catalogVersion).not.toBe(mixed.document.catalogVersion)
    })
})

describe('buildSummary', () => {
    test('copies the whitelisted fields and omits undefined ones', () => {
        const summary = buildSummary(route({
            title: 'X', country: 'DE', isLoop: false, hasGpx: true, pointsSource: 'gpx', videoFormat: 'mp4', elevation: undefined,
            videoUrl: 'video:///C:/Users/bob/a.mp4', tsImported: 1,
        }))
        expect(summary).toEqual({ title: 'X', country: 'DE', isLoop: false, hasGpx: true, pointsSource: 'gpx', videoFormat: 'mp4' })
        expect(JSON.stringify(summary)).not.toContain('bob')
    })
})
