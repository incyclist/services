import nodePath from 'path'
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
import { useExternalFileService } from '../../fileaccess/externalFiles'
import type { EnsureLocalFailure } from '../../fileaccess/types'

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

    describe('parse', () => {

        const makeScanned = (overrides: Partial<ScannedRoute> = {}): ScannedRoute => ({
            controlFileUri: 'content://root/folder/route.xml',
            folderUri: 'content://root/folder',
            folderName: 'folder',
            format: 'xml',
            files: [],
            ...overrides,
        })

        beforeEach(() => {
            Inject('Bindings', { fs: fsMock, appInfo: appInfoMock, path: nodePath })
            // _parseTarget() consults the route list for a duplicate-id/already-imported check;
            // the outer beforeEach's mock doesn't define getRoute() since 'scan'/'ingest' never
            // reach that far.
            routeListMock.getRoute = jest.fn().mockReturnValue(undefined)
        })

        afterEach(() => {
            jest.restoreAllMocks()
            // always restore real timers, even if a fake-timer test failed mid-assertion and
            // never reached its own jest.useRealTimers() call - otherwise every later test in
            // this file hangs until Jest's real-time test timeout.
            jest.useRealTimers()
            useExternalFileService()['reset']?.()
        })

        const runParse = async (scanned: ScannedRoute | ScannedRoute[]) => {
            const observer = service.parse(Array.isArray(scanned) ? scanned : [scanned])
            await new Promise<void>(resolve => observer.once('parse-complete', resolve))
        }

        /** What the loader decorator does while the parser is reading a file it cannot get. */
        const recordReadFailure = (reason: EnsureLocalFailure['reason'], file = '/icloud/routes/route.xml') => {
            useExternalFileService().getActiveScope()?.recordFailure(file, { ok: false, reason })
        }

        test('successful parse -> no errorCode, importable', async () => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'r1', title: 'route 1' } as any,
                details: {} as any,
            })

            await runParse(makeScanned())

            const [item] = service.getDisplayProps().routes
            expect(item.importable).toBe(true)
            expect(item.errorCode).toBeUndefined()
            expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(false)
        })

        test('a file that could not be downloaded because there is no connection -> ICLOUD_OFFLINE', async () => {
            jest.spyOn(RouteParser, 'parse').mockImplementation(async () => {
                recordReadFailure('offline')
                throw new Error('Could not open file: route.xml')
            })

            await runParse(makeScanned())

            const [item] = service.getDisplayProps().routes
            expect(item.importable).toBe(false)
            expect(item.errorCode).toBe('ICLOUD_OFFLINE')
            expect(item.errorReason).toContain('no internet connection')
            expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(true)
        })

        test.each(['timeout', 'download-failed'] as const)(
            'a download that ended in %s -> ICLOUD_DOWNLOAD_FAILED',
            async (reason) => {
                jest.spyOn(RouteParser, 'parse').mockImplementation(async () => {
                    recordReadFailure(reason)
                    throw new Error('Could not open file: route.xml')
                })

                await runParse(makeScanned())

                expect(service.getDisplayProps().routes[0].errorCode).toBe('ICLOUD_DOWNLOAD_FAILED')
                expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(true)
            }
        )

        test('a lost folder grant -> READ_FAILED, and no iCloud download hint', async () => {
            jest.spyOn(RouteParser, 'parse').mockImplementation(async () => {
                recordReadFailure('access-lost')
                throw new Error('Could not open file: route.xml')
            })

            await runParse(makeScanned())

            expect(service.getDisplayProps().routes[0].errorCode).toBe('READ_FAILED')
            expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(false)
        })

        test('a parser that swallows the read failure and returns a route anyway still fails the route', async () => {
            jest.spyOn(RouteParser, 'parse').mockImplementation(async () => {
                recordReadFailure('download-failed')
                return { data: { id: 'r1', title: 'route 1' } as any, details: {} as any }
            })

            await runParse(makeScanned())

            const [item] = service.getDisplayProps().routes
            expect(item.importable).toBe(false)
            expect(item.errorCode).toBe('ICLOUD_DOWNLOAD_FAILED')
            expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(true)
        })

        test('the scope is ended on both the success and the error path', async () => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'r1', title: 'route 1' } as any, details: {} as any
            })
            await runParse(makeScanned())
            expect(useExternalFileService().getActiveScope()).toBeUndefined()

            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('boom'))
            await runParse(makeScanned({ controlFileUri: 'content://root/folder/b.xml' }))
            expect(useExternalFileService().getActiveScope()).toBeUndefined()
        })

        test('a generic "Could not open file" error maps to READ_FAILED, and does not flip hasICloudDownloadFailures', async () => {
            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('Could not open file: route.xml'))

            await runParse(makeScanned())

            expect(service.getDisplayProps().routes[0].errorCode).toBe('READ_FAILED')
            expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(false)
        })

        test('an AVI error maps to AVI_NOT_SUPPORTED', async () => {
            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('AVI video not supported'))

            await runParse(makeScanned())

            expect(service.getDisplayProps().routes[0].errorCode).toBe('AVI_NOT_SUPPORTED')
        })

        test('a missing-video error maps to NO_VIDEO', async () => {
            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('no video found'))

            await runParse(makeScanned())

            expect(service.getDisplayProps().routes[0].errorCode).toBe('NO_VIDEO')
        })

        test('an XML parse failure maps to PARSE_FAILED', async () => {
            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('cannot parse <Track>'))

            await runParse(makeScanned())

            expect(service.getDisplayProps().routes[0].errorCode).toBe('PARSE_FAILED')
        })

        test('an unrecognized error maps to UNSUPPORTED', async () => {
            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('something else entirely'))

            await runParse(makeScanned())

            expect(service.getDisplayProps().routes[0].errorCode).toBe('UNSUPPORTED')
        })

        test('hasICloudDownloadFailures is true only when at least one route has an iCloud errorCode', async () => {
            jest.spyOn(RouteParser, 'parse')
                .mockResolvedValueOnce({ data: { id: 'r1', title: 'ok' } as any, details: {} as any })
                .mockImplementationOnce(async () => {
                    recordReadFailure('offline')
                    throw new Error('Could not open file: b.xml')
                })

            await runParse(makeScanned({ controlFileUri: 'content://root/folder/a.xml' }))
            await runParse(makeScanned({ controlFileUri: 'content://root/folder/b.xml' }))

            expect(service.getDisplayProps().hasICloudDownloadFailures).toBe(true)
        })

        /**
         * `waitingForICloud` reflects an actual download wait, reported by the loader
         * decorator through the scope - which is what these tests stand in for.
         */
        describe('parseProgress.waitingForICloud', () => {

            /**
             * Parses two routes: the first resolves immediately so the loop crosses a real
             * await boundary (needed for the service's own 'parse-progress' listener -
             * registered right after starting `_parse()` - to actually be attached before the
             * *second* route's progress event fires); the second is held pending so its state
             * can be inspected mid-flight.
             */
            const parseWithSecondRouteHeld = async (onSecondParse?: () => void) => {
                let resolveSecond: (v: any) => void
                jest.spyOn(RouteParser, 'parse')
                    .mockResolvedValueOnce({ data: { id: 'r1', title: 'route 1' } as any, details: {} as any })
                    .mockImplementationOnce(() => {
                        onSecondParse?.()
                        return new Promise(resolve => { resolveSecond = resolve })
                    })

                const parsePromise = runParse([
                    makeScanned({ controlFileUri: 'content://root/folder/a.xml' }),
                    makeScanned({ controlFileUri: 'content://root/folder/b.xml' }),
                ])

                // let the first route finish and the second route's parse actually start - a
                // real, short delay, since the first mock resolves via a real microtask.
                await new Promise(resolve => setTimeout(resolve, 10))

                return {
                    finish: async () => {
                        resolveSecond!({ data: { id: 'r2', title: 'route 2' }, details: {} })
                        await parsePromise
                    }
                }
            }

            test('true once an actual download wait has been running past the threshold', async () => {
                const { finish } = await parseWithSecondRouteHeld(
                    () => useExternalFileService().getActiveScope()?.beginWait()
                )

                expect(service.getDisplayProps().parseProgress?.waitingForICloud).toBe(false)

                const realNow = Date.now()
                jest.spyOn(Date, 'now').mockReturnValue(realNow + 2_001)
                expect(service.getDisplayProps().parseProgress?.waitingForICloud).toBe(true)
                jest.spyOn(Date, 'now').mockRestore()

                await finish()
                // cleared once the parse has finished
                expect(service.getDisplayProps().parseProgress?.waitingForICloud).toBe(false)
            })

            test('false for a slow parse that is not waiting for a download', async () => {
                const { finish } = await parseWithSecondRouteHeld()

                const realNow = Date.now()
                jest.spyOn(Date, 'now').mockReturnValue(realNow + 60_000)
                expect(service.getDisplayProps().parseProgress?.waitingForICloud).toBe(false)
                jest.spyOn(Date, 'now').mockRestore()

                await finish()
            })
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

    // FIXES_BACKLOG.md item #40 - production crash: RouteImportDialog's own unmount effect
    // (mobile) calls onImportClosed() -> RouteLibraryScannerService.done(), clearing
    // importProps, *before* an in-flight importSingle() (kicked off by a native file picker
    // that took long enough to background the app and unmount the page) resolves. The
    // success/error handlers wired in importSingle(), and the write inside importRoute()
    // itself, used to write to this.importProps.phase unconditionally and crashed with
    // "Cannot set property 'phase' of undefined" once importProps was already undefined.
    describe('importSingle - teardown race (FIXES_BACKLOG item #40)', () => {
        test('emitting success after prepare()->done() does not throw (scanner already torn down)', () => {
            service.prepare()
            service.done()

            const observer = service.importSingle({ filename: 'route.gpx', ext: 'gpx' } as any)

            expect(() => observer.emit('success', { title: 'Test Route' } as any)).not.toThrow()
        })

        test('emitting error after prepare()->done() does not throw (scanner already torn down)', () => {
            service.prepare()
            service.done()

            const observer = service.importSingle({ filename: 'route.gpx', ext: 'gpx' } as any)

            expect(() => observer.emit('error', 'some error')).not.toThrow()
        })

        test('a still-open import (prepare() but no done()) still updates importProps normally on success', () => {
            service.prepare()

            const observer = service.importSingle({ filename: 'route.gpx', ext: 'gpx' } as any)
            observer.emit('success', { title: 'Test Route' } as any)

            const props = service.getDisplayProps()
            expect(props.phase).toBe('result')
            expect(props.resultSuccess).toEqual({ routeName: 'Test Route' })
        })

        test('a still-open import (prepare() but no done()) still updates importProps normally on error', () => {
            service.prepare()

            const observer = service.importSingle({ filename: 'route.gpx', ext: 'gpx' } as any)
            observer.emit('error', 'boom')

            const props = service.getDisplayProps()
            expect(props.phase).toBe('result')
            expect(props.error).toBe('boom')
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
