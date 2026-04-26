import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { JsonRepository } from '../../api/repository/json'
import { ParserFactory } from '../base/parsers/factory'
import { RouteParser } from '../base/parsers'
import { RouteLibraryScannerService, useRouteLibraryScanner } from './service'
import { DiscoveredRoute, FolderInfo } from './types'

// Helpers to build mock ReadDirResult entries
const dir = (name: string, uri: string) => ({ name, uri, isDirectory: true })
const file = (name: string, uri: string) => ({ name, uri, isDirectory: false })

const makeFolder = (displayName: string, uri: string): FolderInfo => ({ displayName, uri })

describe('RouteLibraryScannerService', () => {
    let service: RouteLibraryScannerService
    let fsMock: any
    let appInfoMock: any
    let routeListMock: any
    let parsersFactory: ParserFactory

    beforeEach(() => {
        // Reset singleton so each test gets a fresh instance
        (RouteLibraryScannerService as any)._instance = undefined

        fsMock = {
            readdir: jest.fn(),
            readFile: jest.fn().mockResolvedValue(''),
            writeFile: jest.fn().mockResolvedValue(undefined),
            ensureDir: jest.fn().mockResolvedValue(undefined),
            existsFile: jest.fn().mockResolvedValue(false),
        }

        appInfoMock = {
            getAppDir: jest.fn().mockReturnValue('/app'),
        }

        routeListMock = {
            existsBySourceUri: jest.fn().mockResolvedValue(false),
            addRoute: jest.fn().mockResolvedValue(undefined),
        }

        Inject('Bindings', { fs: fsMock, appInfo: appInfoMock })
        Inject('RouteList', routeListMock)

        // Ensure parsers are initialised before each test
        const { useParsers } = require('../base/parsers')
        parsersFactory = useParsers()

        service = new RouteLibraryScannerService()
    })

    afterEach(() => {
        Inject('Bindings', null)
        Inject('RouteList', null)
        jest.clearAllMocks()
        // Reset ParserFactory singleton so tests don't bleed
        ;(ParserFactory as any)._instance = undefined
    })

    describe('scan', () => {
        test('returns an observer immediately', () => {
            fsMock.readdir.mockResolvedValue([])

            const observer = service.scan(makeFolder('My Routes', 'content://root'))
            expect(observer).toBeInstanceOf(Observer)
        })

        test('emits scan-complete after traversal', async () => {
            fsMock.readdir.mockResolvedValue([])

            const observer = service.scan(makeFolder('My Routes', 'content://root'))
            const completed = new Promise<void>(resolve => observer.once('scan-complete', resolve))
            await completed
        })

        test('emits scan-progress for each folder visited', async () => {
            fsMock.readdir
                .mockResolvedValueOnce([dir('sub', 'content://root/sub')]) // root
                .mockResolvedValueOnce([])                                  // sub

            const progressEvents: any[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-progress', e => progressEvents.push(e))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(progressEvents.length).toBe(2)
            expect(progressEvents[1].scannedFolders).toBe(2)
        })

        test('emits discovered for each primary file found', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
                file('ride.mp4', 'content://root/ride.mp4'),
            ])

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered).toHaveLength(1)
            expect(discovered[0].format).toBe('gpx')
            expect(discovered[0].controlFileUri).toBe('content://root/route.gpx')
        })

        test('sets importable: false when companion file is missing', async () => {
            // .epm requires .epp companion
            fsMock.readdir.mockResolvedValue([
                file('route.epm', 'content://root/route.epm'),
                file('video.mp4', 'content://root/video.mp4'),
            ])

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].importable).toBe(false)
            expect(discovered[0].skipReason).toMatch(/companion/i)
        })

        test('sets importable: false when no video file is present', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
            ])

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].importable).toBe(false)
            expect(discovered[0].skipReason).toMatch(/no video/i)
        })

        test('sets importable: false when only an AVI video is present', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
                file('video.avi', 'content://root/video.avi'),
            ])

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].importable).toBe(false)
            expect(discovered[0].skipReason).toMatch(/avi/i)
        })

        test('sets importable: false when control file contains absolute Unix path', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
                file('video.mp4', 'content://root/video.mp4'),
            ])
            fsMock.readFile.mockResolvedValue('<video>/storage/emulated/0/video.mp4</video>')

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].importable).toBe(false)
            expect(discovered[0].skipReason).toMatch(/absolute/i)
        })

        test('sets importable: false when control file contains absolute Windows path', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
                file('video.mp4', 'content://root/video.mp4'),
            ])
            fsMock.readFile.mockResolvedValue('<video>C:\\Users\\user\\video.mp4</video>')

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].importable).toBe(false)
            expect(discovered[0].skipReason).toMatch(/absolute/i)
        })

        test('sets alreadyImported from RouteListService.existsBySourceUri', async () => {
            routeListMock.existsBySourceUri.mockResolvedValue(true)

            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
                file('video.mp4', 'content://root/video.mp4'),
            ])

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].alreadyImported).toBe(true)
        })

        test('sets hasThumbnail when an image file is present', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.gpx', 'content://root/route.gpx'),
                file('video.mp4', 'content://root/video.mp4'),
                file('thumb.jpg', 'content://root/thumb.jpg'),
            ])

            const discovered: DiscoveredRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('discovered', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].hasThumbnail).toBe(true)
        })

        test('continues scanning after a folder readdir error', async () => {
            fsMock.readdir
                .mockRejectedValueOnce(new Error('permission denied')) // root fails
                .mockResolvedValueOnce([])

            const observer = service.scan(makeFolder('Root', 'content://root'))
            const completed = new Promise<void>(resolve => observer.once('scan-complete', resolve))
            await completed // should resolve, not hang
        })

        test('upserts import history after scan', async () => {
            const writeSpy = jest.fn().mockResolvedValue(true)
            const listSpy = jest.fn().mockResolvedValue([])
            jest.spyOn(JsonRepository, 'create').mockReturnValue({
                list: listSpy,
                read: jest.fn().mockResolvedValue(undefined),
                write: writeSpy,
            } as any)

            fsMock.readdir.mockResolvedValue([])

            const observer = service.scan(makeFolder('Library', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(writeSpy).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    treeUri: 'content://root',
                    displayName: 'Library',
                    lastScanned: expect.any(String),
                    routeCount: 0,
                })
            )
        })

        test('updates existing import history record on re-scan', async () => {
            const existingId = 'existing-id-123'
            const writeSpy = jest.fn().mockResolvedValue(true)
            jest.spyOn(JsonRepository, 'create').mockReturnValue({
                list: jest.fn().mockResolvedValue([existingId]),
                read: jest.fn().mockResolvedValue({
                    id: existingId,
                    treeUri: 'content://root',
                    displayName: 'Old Name',
                    lastScanned: '2025-01-01T00:00:00.000Z',
                    routeCount: 5,
                }),
                write: writeSpy,
            } as any)

            fsMock.readdir.mockResolvedValue([])

            const observer = service.scan(makeFolder('Library', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(writeSpy).toHaveBeenCalledWith(
                existingId,
                expect.objectContaining({ id: existingId, treeUri: 'content://root' })
            )
        })
    })

    describe('ingest', () => {
        const makeRoute = (overrides: Partial<DiscoveredRoute> = {}): DiscoveredRoute => ({
            id: 'route-1',
            folderUri: 'content://root/folder',
            folderName: 'folder',
            controlFileUri: 'content://root/folder/route.gpx',
            format: 'gpx',
            hasVideo: true,
            hasThumbnail: false,
            alreadyImported: false,
            importable: true,
            ...overrides,
        })

        beforeEach(() => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'parsed-id', title: 'My Route', videoUrl: 'video.mp4' },
                details: {} as any,
            })
        })

        test('returns an observer immediately', () => {
            const observer = service.ingest([], 'content://root')
            expect(observer).toBeInstanceOf(Observer)
        })

        test('emits ingest-complete with zero counts for empty list', async () => {
            const observer = service.ingest([], 'content://root')
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )
            expect(result).toEqual({ imported: 0, skipped: 0, errors: 0, failedRoutes: [] })
        })

        test('emits ingest-progress for each route processed', async () => {
            const routes = [makeRoute({ id: 'r1' }), makeRoute({ id: 'r2' })]
            const progressEvents: any[] = []
            const observer = service.ingest(routes, 'content://root')
            observer.on('ingest-progress', e => progressEvents.push(e))
            await new Promise<void>(resolve => observer.once('ingest-complete', resolve))

            expect(progressEvents).toHaveLength(2)
            expect(progressEvents[0]).toEqual({ current: 1, total: 2, currentName: 'folder' })
        })

        test('counts imported correctly', async () => {
            const observer = service.ingest([makeRoute()], 'content://root')
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )
            expect(result.imported).toBe(1)
            expect(result.errors).toBe(0)
        })

        test('counts skipped routes (not importable or already imported)', async () => {
            const routes = [
                makeRoute({ importable: false }),
                makeRoute({ alreadyImported: true }),
            ]
            const observer = service.ingest(routes, 'content://root')
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )
            expect(result.skipped).toBe(2)
            expect(result.imported).toBe(0)
        })

        test('emits ingest-error and continues on per-route failure', async () => {
            jest.spyOn(RouteParser, 'parse')
                .mockRejectedValueOnce(new Error('parse failure'))
                .mockResolvedValue({
                    data: { id: 'ok', title: 'OK Route', videoUrl: 'video.mp4' },
                    details: {} as any,
                })

            const routes = [makeRoute({ id: 'r1' }), makeRoute({ id: 'r2' })]
            const errors: any[] = []
            const observer = service.ingest(routes, 'content://root')
            observer.on('ingest-error', e => errors.push(e))
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )

            expect(errors).toHaveLength(1)
            expect(errors[0].reason).toBe('parse failure')
            expect(result.imported).toBe(1)
            expect(result.errors).toBe(1)
            expect(result.failedRoutes).toHaveLength(1)
        })

        test('calls RouteListService.addRoute with RouteRecord', async () => {
            const observer = service.ingest([makeRoute()], 'content://root')
            await new Promise<void>(resolve => observer.once('ingest-complete', resolve))

            expect(routeListMock.addRoute).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'parsed-id',
                    name: 'My Route',
                    format: 'gpx',
                    sourceTreeUri: 'content://root',
                })
            )
        })

        test('stores web video URL as-is', async () => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'id1', title: 'Route', videoUrl: 'https://cdn.example.com/ride.mp4' },
                details: {} as any,
            })

            const observer = service.ingest([makeRoute()], 'content://root')
            await new Promise<void>(resolve => observer.once('ingest-complete', resolve))

            const call = routeListMock.addRoute.mock.calls[0][0]
            expect(call.videoUri).toBe('https://cdn.example.com/ride.mp4')
        })

        test('resolves relative video URL against folder URI', async () => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'id1', title: 'Route', videoUrl: 'ride.mp4' },
                details: {} as any,
            })

            const observer = service.ingest([makeRoute()], 'content://root')
            await new Promise<void>(resolve => observer.once('ingest-complete', resolve))

            const call = routeListMock.addRoute.mock.calls[0][0]
            expect(call.videoUri).toBe('content://root/folder/ride.mp4')
        })

        test('rejects absolute video URI as ingest error', async () => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'id1', title: 'Route', videoUrl: '/storage/emulated/0/ride.mp4' },
                details: {} as any,
            })

            const errors: any[] = []
            const observer = service.ingest([makeRoute()], 'content://root')
            observer.on('ingest-error', e => errors.push(e))
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )

            expect(errors).toHaveLength(1)
            expect(errors[0].reason).toMatch(/absolute/i)
            expect(result.errors).toBe(1)
        })

        test('copies thumbnail when hasThumbnail is true', async () => {
            fsMock.readdir.mockResolvedValue([
                file('thumb.jpg', 'content://root/folder/thumb.jpg'),
            ])
            fsMock.readFile.mockResolvedValue(Buffer.from('img-data'))

            const observer = service.ingest([makeRoute({ hasThumbnail: true })], 'content://root')
            await new Promise<void>(resolve => observer.once('ingest-complete', resolve))

            expect(fsMock.writeFile).toHaveBeenCalled()
            const call = routeListMock.addRoute.mock.calls[0][0]
            expect(call.thumbnailPath).toMatch(/thumbnails/)
        })
    })

    describe('useRouteLibraryScanner', () => {
        test('returns the singleton instance', () => {
            const a = useRouteLibraryScanner()
            const b = useRouteLibraryScanner()
            expect(a).toBe(b)
        })
    })
})
