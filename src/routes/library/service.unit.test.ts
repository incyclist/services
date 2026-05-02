import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { JsonRepository } from '../../api/repository/json'
import { ParserFactory } from '../base/parsers/factory'
import { RouteParser } from '../base/parsers'
import { RouteLibraryScannerService, useRouteLibraryScanner } from './service'
import { FolderInfo, ParsedRoute, ScannedRoute } from './types'
import { Route } from '../base/model/route'
import { RouteInfo } from '../types'
import { IObserver } from '../../types'

// Helpers to build mock ReadDirResult entries
const dir = (name: string, uri: string) => ({ name, uri, isDirectory: true })
const file = (name: string, uri: string) => ({ name, uri, isDirectory: false })

const makeFolder = (displayName: string, uri: string): FolderInfo => ({ displayName, uri })

describe('RouteLibraryScannerService', () => {
    let service: RouteLibraryScannerService
    let fsMock: any
    let appInfoMock: any
    let dbMock: any
    let routeListMock: any
    let parsersFactory: ParserFactory

    beforeEach(() => {

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
            existsBySourceUri: jest.fn().mockReturnValue(false),
            addRoute: jest.fn(),
            pauseListUpdates: jest.fn(),
            resumeListUpdates: jest.fn(),
            emitLists:jest.fn()

        }

        dbMock = {
            save: jest.fn().mockResolvedValue(undefined)
        }

        Inject('Bindings', { fs: fsMock, appInfo: appInfoMock })
        Inject('RouteList', routeListMock)
        Inject('RoutesDBLoader', dbMock)

        // Ensure parsers are initialised before each test
        const { useParsers } = require('../base/parsers')
        parsersFactory = useParsers()

        service = new RouteLibraryScannerService()
    })

    afterEach(() => {
        Inject('Bindings', null)
        Inject('RouteList', null)
        Inject('RoutesDBLoader', null)
        jest.clearAllMocks()
        service.reset()
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

        test('emits scan-result for each primary file found', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.xml', 'content://root/route.xml'),
                file('ride.mp4', 'content://root/ride.mp4'),
            ])

            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-result', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered).toHaveLength(1)
            expect(discovered[0].format).toBe('xml')
            expect(discovered[0].controlFileUri).toBe('content://root/route.xml')
        })

        test('sets importable: false when companion file is missing', async () => {
            // .epm requires .epp companion
            fsMock.readdir.mockResolvedValue([
                file('route.epm', 'content://root/route.epm'),
                file('video.mp4', 'content://root/video.mp4'),
            ])

            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-result', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].scanError).toMatch(/companion/i)
        })
        test('sets importable: true when companion file is present', async () => {
            // .epm requires .epp companion
            fsMock.readdir.mockResolvedValue([
                file('route.epm', 'content://root/route.epm'),
                file('route.epp', 'content://root/route.epp'),
                file('video.mp4', 'content://root/video.mp4'),
            ])

            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-result', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(discovered[0].scanError).toBeUndefined()
            
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

        let observer:IObserver
        const makeRouteObject = (overrride:Partial<RouteInfo>={}): Route => {

            return  new Route( {
                id:'1',
                title:'test route',
                ...overrride
            })

        }


        const makeRoute = (overrides: Partial<ParsedRoute> = {}, routeOverride:Partial<RouteInfo>={}): ParsedRoute => {
            return {
                route: makeRouteObject(routeOverride),
                folderUri: 'content://root/folder',
                controlFileUri: 'content://root/folder/route.xml',
                alreadyImported: false,
                format:'xml',
                observer:new Observer(),
                ...overrides,
            }
        }

        afterEach( ()=>{
            observer.stop()
        })

        test('returns an observer immediately', () => {
            observer = service.ingest([])
            expect(observer).toBeInstanceOf(Observer)
        })

        test('emits ingest-complete with zero counts for empty list', async () => {
            observer = service.ingest([])
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )
            expect(result).toEqual({ imported: 0, skipped: 0, errors: 0, failedRoutes: [],importedRoutes:[] })
        })

        test('emits ingest-progress for each route processed', async () => {
            const routes = [makeRoute({},{ id: 'r1', title:'r1' }), makeRoute({},{ id: 'r2', title:'r2' })]
            const progressEvents: any[] = []

            observer = service.ingest(routes)
            observer.on('ingest-progress', e => progressEvents.push(e))
            await new Promise<void>(resolve => observer.once('ingest-complete', resolve))

            expect(progressEvents).toHaveLength(2)
            expect(progressEvents[0]).toEqual({ current: 1, total: 2, currentName:'r1'})
            expect(progressEvents[1]).toEqual({ current: 2, total: 2, currentName:'r2'})
        })

        test('counts imported correctly', async () => {
            observer = service.ingest([makeRoute()])
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )
            expect(result.imported).toBe(1)
            expect(result.errors).toBe(0)
        })

        test('counts skipped routes (not importable or already imported)', async () => {
            const routes = [
                makeRoute({ alreadyImported: true }),
                makeRoute({ parseError:'xyz'}),
                makeRoute(),
            ]
            observer = service.ingest(routes)
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )
            expect(result.skipped).toBe(2)
            expect(result.imported).toBe(1)
        })

        test('emits ingest-error and continues on per-route failure', async () => {

            dbMock.save= jest.fn()
                .mockRejectedValueOnce( new Error('db save error') )
                .mockResolvedValue(undefined)

            const routes = [makeRoute({},{ title: 'r1' }), makeRoute({},{ title: 'r2' })]
            const errors: any[] = []
            observer = service.ingest(routes)

            observer.on('ingest-error', e => errors.push(e))
            const result: any = await new Promise(resolve =>
                observer.once('ingest-complete', resolve)
            )

            expect(errors).toHaveLength(1)
            expect(errors[0].reason).toBe('db save error')
            expect(result.imported).toBe(1)
            expect(result.errors).toBe(1)
            expect(result.failedRoutes).toHaveLength(1)
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
