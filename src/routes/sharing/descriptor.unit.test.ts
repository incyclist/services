import type { RouteApiDetail } from '../base/api/types'
import type { RouteInfo } from '../base/types'
import { buildRouteDescriptor } from './descriptor'

const USER_PATH = 'C:\\Users\\bob.builder\\Videos\\ride.mp4'

const descr = (): RouteInfo => ({
    id: 'r1', title: 'Alpe', routeHash: 'h', isLocal: true, hasVideo: true, country: 'FR', distance: 1000, elevation: 50,
    videoUrl: `video:///${USER_PATH}`, originalVideoUrl: 'https://secret.example/a.mp4', downloadUrl: 'https://secret.example/d.mp4',
    previewUrl: 'file:///C:/Users/bob.builder/prev.jpg', previewSource: 'https://prev.example/p.jpg', sourceTreeUri: 'content://tree/bob',
    tsImported: 111, tsLastStart: 222, tsLastChange: 333, source: 'strava', apiServer: 'srv', provider: { name: 'prov', url: 'u', logo: 'l' },
    legacyId: 'legacy', originalName: 'orig', next: 'next-route', isDownloaded: true, isDeleted: false,
    segments: [{ start: 0, end: 500, name: 'seg' }],
})

const details = (): RouteApiDetail => ({
    id: 'r1', title: 'Alpe', country: 'FR', distance: 1000, elevation: 50, gpxDisabled: false, elevationShifted: true,
    points: [{ lat: 1, lng: 2, elevation: 3, routeDistance: 0 }, { lat: 1.1, lng: 2.1, elevation: 4, routeDistance: 1000 }] as RouteApiDetail['points'],
    infoTexts: [{ distance: 10, text: 'hi', localizedText: { en: 'hi' } }],
    description: { en: 'nice' },
    previewUrl: 'file:///C:/Users/bob.builder/prev.jpg', previewUrlLocal: 'C:\\Users\\bob.builder\\prev.jpg',
    originalName: 'orig', next: 'next-route', downloadUrl: 'https://secret.example/d.mp4', provider: { name: 'prov', url: 'u', logo: 'l' },
    video: {
        file: USER_PATH, url: `file:///${USER_PATH}`, framerate: 30, width: 1920, height: 1080, format: 'mp4',
        mappings: [{ videoSpeed: 1, time: 0, distance: 0 }], selectableSegments: [{ start: 0, end: 10, name: 's' }],
        segments: [{ a: 1 }], informations: [{ b: 2 }], next: 'next-video',
    },
})

describe('buildRouteDescriptor', () => {
    test('keeps the whitelisted content', () => {
        const res = buildRouteDescriptor('h', descr(), details())
        expect(res.v).toBe(1)
        expect(res.routeKey).toBe('h')
        expect(res.description).toEqual({ title: 'Alpe', country: 'FR', distance: 1000, elevation: 50, segments: [{ start: 0, end: 500, name: 'seg' }] })
        expect(res.details.points).toHaveLength(2)
        expect(res.details).toMatchObject({ title: 'Alpe', gpxDisabled: false, elevationShifted: true, description: { en: 'nice' } })
        expect(res.details.video).toEqual({
            framerate: 30, width: 1920, height: 1080, format: 'mp4', mappings: [{ videoSpeed: 1, time: 0, distance: 0 }],
            selectableSegments: [{ start: 0, end: 10, name: 's' }], segments: [{ a: 1 }], informations: [{ b: 2 }],
        })
    })

    test('contains no path, user name, url, origin or usage timestamp', () => {
        const json = JSON.stringify(buildRouteDescriptor('h', descr(), details()))
        for (const leaked of ['bob', 'Users', 'ride.mp4', 'secret.example', 'prev.jpg', 'prev.example', 'content://', 'strava', 'srv', 'prov',
            'legacy', 'orig', 'next-route', 'next-video', '111', '222', '333', 'previewUrl', 'videoUrl', 'tsLast', 'tsImported', 'isDownloaded', '"file"', '"url"'])
            expect(json).not.toContain(leaked)
    })

    test('a field added to the stored record later is not copied', () => {
        const extra = { ...details(), secretField: 'oops', video: { ...details().video!, hostPath: '/home/x' } } as unknown as RouteApiDetail
        const json = JSON.stringify(buildRouteDescriptor('h', descr(), extra))
        expect(json).not.toContain('oops')
        expect(json).not.toContain('/home/x')
    })

    test('a route without video has no video part', () => {
        const d = details()
        delete d.video
        expect(buildRouteDescriptor('h', descr(), d).details.video).toBeUndefined()
    })

    test('legacy selectable segments in the root move into the video part', () => {
        const d = details()
        delete d.video!.selectableSegments
        d.selectableSegments = [{ start: 1, end: 2, name: 'l' }]
        expect(buildRouteDescriptor('h', descr(), d).details.video!.selectableSegments).toEqual([{ start: 1, end: 2, name: 'l' }])
    })
})
