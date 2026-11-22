import type { RouteInfo } from '../base/types'
import { buildCatalog, getRouteKey, isShareable } from './catalog'

const opts = (sizes: Record<string, number | undefined> = {}) => ({
    linkId: 'L1',
    makeHandle: (kind: 'v' | 't', path: string) => `${kind}-${path.replaceAll(/\W/g, '_')}`,
    stat: async (path: string) => sizes[path],
    hash: (text: string) => `h${text.length}`,
})

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
        ], opts({ '/d/a.mp4': 100 }))

        expect(res.document.routes.map(r => r.routeKey)).toEqual(['b', 'ha'])
        const a = res.document.routes[1]
        expect(a).toMatchObject({ routeKey: 'ha', routeIdOnComputer: 'a', title: 'A', size: 100, origin: 'local', routeHash: 'ha', videoFormat: 'mp4' })
        expect(a.videoHandle).toBe('v-_d_a_mp4')
        expect(a.thumbHandle).toBe('t-_d_a_jpg')
        expect(res.document.routes[0]).toMatchObject({ origin: 'official', size: 0, videoFormat: 'mkv' })
        expect(res.document.routes[0].thumbHandle).toBeUndefined()
        expect(res.handles).toEqual([
            { handle: 'v-_d_b_mkv', path: '/d/b.mkv', contentType: 'video/x-matroska' },
            { handle: 'v-_d_a_mp4', path: '/d/a.mp4', contentType: 'video/mp4' },
            { handle: 't-_d_a_jpg', path: '/d/a.jpg', contentType: 'image/jpeg' },
        ])
    })

    test('duplicate keys are listed once', async () => {
        const res = await buildCatalog([
            route({ id: 'a', isLocal: true, routeHash: 'same', videoUrl: 'video:///d/a.mp4' }),
            route({ id: 'b', isLocal: true, routeHash: 'same', videoUrl: 'video:///d/b.mp4' }),
        ], opts())
        expect(res.document.routes).toHaveLength(1)
    })

    test('catalog version follows the content, not the input order', async () => {
        const a = route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4' })
        const b = route({ id: 'b', isLocal: true, routeHash: 'hb', videoUrl: 'video:///d/b.mp4' })
        const one = await buildCatalog([a, b], opts())
        const two = await buildCatalog([b, a], opts())
        expect(one.document).toEqual(two.document)
        const three = await buildCatalog([a], opts())
        expect(three.document.catalogVersion).not.toBe(one.document.catalogVersion)
    })

    test('carries no profile data or credentials', async () => {
        const res = await buildCatalog([route({ id: 'a', isLocal: true, routeHash: 'ha', videoUrl: 'video:///d/a.mp4' })], opts())
        expect(Object.keys(res.document.routes[0]).sort()).toEqual(
            ['mtime', 'origin', 'routeHash', 'routeIdOnComputer', 'routeKey', 'size', 'title', 'videoFormat', 'videoHandle'])
    })
})
