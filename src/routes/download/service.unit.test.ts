import { EventEmitter } from 'node:events'
import path from 'path'
import { getBindings } from '../../api'
import { Route } from '../base/model/route'
import { RouteDownloadService } from './service'
import { DownloadObserver } from './types'

describe('RouteDownloadService', () => {

    describe('downloadRoute', () => {

        let service: RouteDownloadService

        afterEach(() => {
            getBindings().path = undefined
            getBindings().downloadManager = undefined
            service?.reset?.()
            jest.restoreAllMocks()
        })

        const createSession = () => {
            const session = new EventEmitter() as EventEmitter & { start: jest.Mock, stop: jest.Mock }
            session.start = jest.fn(() => { session.emit('done') })
            session.stop = jest.fn()
            return session
        }

        test('emits a well-formed 3-slash video:// URL for an absolute target path (mobile-style download)', async () => {
            // Mimics the mobile case: targetDir is an OS-absolute path
            // (RNFS.ExternalDirectoryPath + '/videos'), which previously produced
            // a malformed `video:////...` (4-slash) URL.
            const targetDir = '/storage/emulated/0/Android/data/com.incyclist.app/files/videos'
            const videoUrl = 'https://cdn.example.com/routes/FR_Galibier_Demo.mp4'

            const session = createSession()
            const downloadManager = { createSession: jest.fn(() => session) }

            getBindings().path = path
            getBindings().downloadManager = downloadManager as any

            service = new RouteDownloadService()

            const route = new Route({ id: 'r1', title: 'Test Route', hasVideo: true, videoUrl })
            const observer = new DownloadObserver(Promise.resolve())
            const emitSpy = jest.spyOn(observer, 'emit')

            await service['downloadRoute'](route, targetDir, observer)

            expect(emitSpy).toHaveBeenCalledWith('done', 'video:///storage/emulated/0/Android/data/com.incyclist.app/files/videos/FR_Galibier_Demo.mp4')

            const [, emittedUrl] = emitSpy.mock.calls.find(([event]) => event === 'done') ?? []
            expect((emittedUrl as string).match(/^video:\/+/)?.[0]).toBe('video:///')
        })

        test('emits a well-formed 2-slash video:// URL for a relative target path', async () => {
            const targetDir = './videos'
            const videoUrl = 'https://cdn.example.com/routes/FR_Galibier_Demo.mp4'

            const session = createSession()
            const downloadManager = { createSession: jest.fn(() => session) }

            getBindings().path = path
            getBindings().downloadManager = downloadManager as any

            service = new RouteDownloadService()

            const route = new Route({ id: 'r2', title: 'Test Route', hasVideo: true, videoUrl })
            const observer = new DownloadObserver(Promise.resolve())
            const emitSpy = jest.spyOn(observer, 'emit')

            await service['downloadRoute'](route, targetDir, observer)

            const [, emittedUrl] = emitSpy.mock.calls.find(([event]) => event === 'done') ?? []
            expect(emittedUrl).toBe('video://videos/FR_Galibier_Demo.mp4')
        })

    })

    // FIXES_BACKLOG item #91: a completed/failed download was never pruned from `this.downloads`
    // (only stopDownload() removed an entry) - getActiveDownloads() kept returning dead entries
    // indefinitely, resurfacing as a "ghost" 0%-progress download on the next page open/resume.
    describe('download() registry pruning', () => {

        let service: RouteDownloadService

        afterEach(() => {
            service?.reset?.()
            jest.restoreAllMocks()
        })

        const routeWithId = (id: string) => new Route({ id, title: `Route ${id}`, hasVideo: true, videoUrl: 'https://cdn.example.com/route.mp4' })

        test('a route is removed from getActiveDownloads() once its download observer emits \'done\'', () => {
            service = new RouteDownloadService()
            ;(service as any)._download = jest.fn().mockResolvedValue(undefined)

            const route = routeWithId('r1')
            const observer = service.download(route)

            expect(service.getActiveDownloads().map(d => d.route.description.id)).toContain('r1')

            observer.emit('done', 'video:///tmp/route.mp4')

            expect(service.getActiveDownloads().map(d => d.route.description.id)).not.toContain('r1')
        })

        test('a route is removed from getActiveDownloads() once its download observer emits \'error\'', () => {
            service = new RouteDownloadService()
            ;(service as any)._download = jest.fn().mockResolvedValue(undefined)

            const route = routeWithId('r2')
            const observer = service.download(route)

            observer.emit('error', new Error('network error'))

            expect(service.getActiveDownloads().map(d => d.route.description.id)).not.toContain('r2')
        })

        test('a route already removed by stopDownload() is not double-removed / does not throw when its observer later emits \'done\'', () => {
            service = new RouteDownloadService()
            ;(service as any)._download = jest.fn().mockResolvedValue(undefined)

            const route = routeWithId('r3')
            const observer = service.download(route)

            service.stopDownload(route)
            expect(() => observer.emit('done', 'video:///tmp/route.mp4')).not.toThrow()
            expect(service.getActiveDownloads()).toEqual([])
        })
    })

})
