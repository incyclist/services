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

})
