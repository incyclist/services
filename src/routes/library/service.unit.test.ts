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
            emitLists:jest.fn(),
            findCard:jest.fn()

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

        test('counts a folder readdir failure and surfaces it in scanProgress', async () => {
            fsMock.readdir.mockRejectedValueOnce(new Error('permission denied')) // root fails

            const observer = service.scan(makeFolder('Root', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 0, failedFolders: 1 })
        })

        test('counts only the sub-folders that actually fail, alongside the ones that succeed', async () => {
            fsMock.readdir
                .mockResolvedValueOnce([dir('sub-ok', 'content://root/sub-ok'), dir('sub-fail', 'content://root/sub-fail')]) // root
                .mockResolvedValueOnce([]) // sub-ok
                .mockRejectedValueOnce(new Error('NAS offline')) // sub-fail

            const observer = service.scan(makeFolder('Root', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 2, failedFolders: 1 })
        })

        test('emits scan-progress with the running failed-folder count when a folder cannot be listed', async () => {
            fsMock.readdir.mockRejectedValueOnce(new Error('permission denied'))

            const progressEvents: any[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-progress', e => progressEvents.push(e))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            expect(progressEvents).toContainEqual({ scannedFolders: 0, failedFolders: 1 })
        })

        test('logs a readdir failure without the folder\'s absolute path', async () => {
            const logEventSpy = jest.spyOn(service, 'logEvent')
            fsMock.readdir
                .mockResolvedValueOnce([dir('D:\\Videos\\secret-share', 'content://root/D:\\Videos\\secret-share')])
                .mockRejectedValueOnce(new Error('permission denied'))

            const observer = service.scan(makeFolder('Root', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            const errorCalls = logEventSpy.mock.calls
                .map(call => call[0])
                .filter(event => event.message === 'Error' && event.fn === 'scanFolder')

            expect(errorCalls).toHaveLength(1)
            expect(errorCalls[0]).not.toHaveProperty('uri')
            expect(errorCalls[0].folderName).toBe('D:\\Videos\\secret-share')
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

        test('logs diagnostic event when iCloud placeholder files are present', async () => {
            const logEventSpy = jest.spyOn(service, 'logEvent')
            fsMock.readdir.mockResolvedValue([
                file('route.xml', 'content://root/route.xml'),
                file('.route.xml.icloud', 'content://root/.route.xml.icloud'),
                file('.video.mp4.icloud', 'content://root/.video.mp4.icloud'),
            ])

            const observer = service.scan(makeFolder('Root', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(logEventSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'iCloud placeholder files detected in folder',
                    uri: 'content://root',
                    count: 2,
                    firstPlaceholder: '.route.xml.icloud'
                })
            )
        })

        test('does not log diagnostic event when no iCloud placeholder files present', async () => {
            const logEventSpy = jest.spyOn(service, 'logEvent')
            fsMock.readdir.mockResolvedValue([
                file('route.xml', 'content://root/route.xml'),
                file('ride.mp4', 'content://root/ride.mp4'),
            ])

            const observer = service.scan(makeFolder('Root', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(logEventSpy).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'iCloud placeholder files detected in folder'
                })
            )
        })

        test('returns unchanged routes when iCloud placeholder files are present', async () => {
            fsMock.readdir.mockResolvedValue([
                file('route.xml', 'content://root/route.xml'),
                file('.route.xml.icloud', 'content://root/.route.xml.icloud'),
            ])

            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-result', r => discovered.push(r))

            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            // Should discover only the non-placeholder route
            expect(discovered).toHaveLength(1)
            expect(discovered[0].format).toBe('xml')
            expect(discovered[0].controlFileUri).toBe('content://root/route.xml')
        })

        test('an object listing is used as-is: one listing per folder, no recursive listing, no probes', async () => {
            const root = [
                file('route.xml', 'content://root/route.xml'),
                file('notes', 'content://root/notes'),
                dir('sub', 'content://root/sub'),
            ]
            const sub = [file('b.xml', 'content://root/sub/b.xml')]
            fsMock.readdir.mockImplementation(async (uri: string) => (uri === 'content://root' ? root : sub))

            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-result', r => discovered.push(r))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(fsMock.readdir.mock.calls).toEqual([
                ['content://root', { recursive: false, extended: true }],
                ['content://root/sub', { recursive: false, extended: true }],
            ])
            expect(discovered.map(r => r.controlFileUri)).toEqual(['content://root/route.xml', 'content://root/sub/b.xml'])
            // the platform's own entry objects are handed on, not copies
            expect(discovered[0].files[0]).toBe(root[0])
            expect(discovered[0].files).toEqual([root[0], root[1]])
        })

        test('an object entry without isDirectory is treated as a file, never probed', async () => {
            fsMock.readdir.mockResolvedValueOnce([
                file('route.xml', 'content://root/route.xml'),
                { name: 'unreadable-metadata', uri: 'content://root/unreadable-metadata' },
            ])

            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Root', 'content://root'))
            observer.on('scan-result', r => discovered.push(r))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(fsMock.readdir).toHaveBeenCalledTimes(1)
            expect(discovered[0].files.map(f => f.name)).toEqual(['route.xml', 'unreadable-metadata'])
        })

        test('a folder whose listing is not an array counts as failed instead of crashing the scan', async () => {
            fsMock.readdir.mockResolvedValueOnce(null)

            const observer = service.scan(makeFolder('Root', 'content://root'))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))

            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 0, failedFolders: 1 })
        })
    })

    /**
     * Desktop's `readdir` returns names only (`string[]`), ignoring `extended`. These tests
     * emulate it over an in-memory tree: a key of `dirs` is a folder, anything else is a file
     * and rejects with ENOTDIR, like Node's `readdir` does on a file.
     */
    describe('scan - names-only listing', () => {
        type FakeTree = {
            dirs: Record<string, string[]>
            unreadable?: string[]
            recursiveSupported?: boolean
            probeResults?: Record<string, unknown>
        }

        const relativeDescendants = (dirs: Record<string, string[]>, root: string): string[] => {
            const result: string[] = []
            const walk = (dirPath: string, rel: string) => {
                for (const name of dirs[dirPath]) {
                    const childRel = rel ? `${rel}/${name}` : name
                    result.push(childRel)
                    const childPath = nodePath.join(dirPath, name)
                    if (dirs[childPath])
                        walk(childPath, childRel)
                }
            }
            walk(root, '')
            return result
        }

        const useFakeTree = (tree: FakeTree) => {
            fsMock.readdir.mockImplementation(async (uri: string, options?: { recursive?: boolean }) => {
                if (tree.unreadable?.includes(uri))
                    throw new Error(`EACCES: permission denied, scandir '${uri}'`)
                if (tree.probeResults && uri in tree.probeResults)
                    return tree.probeResults[uri]
                if (!tree.dirs[uri])
                    throw new Error(`ENOTDIR: not a directory, scandir '${uri}'`)

                if (options?.recursive && tree.recursiveSupported) {
                    if (tree.unreadable?.some(u => u.startsWith(uri + '/')))
                        throw new Error('EACCES: permission denied, scandir')
                    return relativeDescendants(tree.dirs, uri)
                }
                return [...tree.dirs[uri]]
            })
        }

        const libraryTree = (): FakeTree => ({
            dirs: {
                '/lib': ['a.rlv', 'a.pgmf', 'a.avi', 'notes.txt', 'Alps'],
                '/lib/Alps': ['README', 'Stelvio', 'Empty'],
                '/lib/Alps/Stelvio': ['s.xml', 's.mp4'],
                '/lib/Alps/Empty': [],
            }
        })

        const runScan = async (uri = '/lib') => {
            const discovered: ScannedRoute[] = []
            const observer = service.scan(makeFolder('Library', uri))
            observer.on('scan-result', r => discovered.push(r))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
            return discovered
        }

        const listingCalls = (uri: string) =>
            fsMock.readdir.mock.calls.filter(([u, o]: [string, { recursive?: boolean }]) => u === uri && !o?.recursive)

        beforeEach(() => {
            Inject('Bindings', { fs: fsMock, appInfo: appInfoMock, path: nodePath })
        })

        test('discovers routes in nested folders from a string[]-only listing', async () => {
            useFakeTree(libraryTree())

            const discovered = await runScan()

            expect(discovered.map(r => [r.controlFileUri, r.folderName])).toEqual([
                ['/lib/a.rlv', 'Library'],
                ['/lib/Alps/Stelvio/s.xml', 'Stelvio'],
            ])
            expect(discovered[1].folderUri).toBe('/lib/Alps/Stelvio')
            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 4, failedFolders: 0 })
        })

        test('hands on entry objects, with sub-folders left out of the folder files', async () => {
            useFakeTree(libraryTree())

            const discovered = await runScan()

            expect(discovered[0].files).toEqual([
                { name: 'a.rlv', uri: '/lib/a.rlv', isDirectory: false },
                { name: 'a.pgmf', uri: '/lib/a.pgmf', isDirectory: false },
                { name: 'a.avi', uri: '/lib/a.avi', isDirectory: false },
                { name: 'notes.txt', uri: '/lib/notes.txt', isDirectory: false },
            ])
        })

        test('lists every folder exactly once - the probe result is reused as the listing', async () => {
            useFakeTree(libraryTree())

            await runScan()

            expect(listingCalls('/lib')).toHaveLength(1)
            expect(listingCalls('/lib/Alps')).toHaveLength(1)
            expect(listingCalls('/lib/Alps/Stelvio')).toHaveLength(1)
            expect(listingCalls('/lib/Alps/Empty')).toHaveLength(1)
        })

        test('does not probe entries recognised as route, companion or video files', async () => {
            useFakeTree(libraryTree())

            await runScan()

            const probed = fsMock.readdir.mock.calls.map(([u]: [string]) => u)
            expect(probed).not.toContain('/lib/a.rlv')
            expect(probed).not.toContain('/lib/a.pgmf')
            expect(probed).not.toContain('/lib/a.avi')
            expect(probed).not.toContain('/lib/Alps/Stelvio/s.xml')
            expect(probed).not.toContain('/lib/Alps/Stelvio/s.mp4')
            // unrecognised names are probed - and are files
            expect(probed).toContain('/lib/notes.txt')
            expect(probed).toContain('/lib/Alps/README')
        })

        test('classifies probes: rejection -> file, [] -> empty folder, null/undefined -> not a folder', async () => {
            useFakeTree({
                dirs: { '/lib': ['route.xml', 'plain', 'empty', 'nothing', 'undef'] },
                probeResults: { '/lib/empty': [], '/lib/nothing': null, '/lib/undef': undefined },
            })

            const discovered = await runScan()

            expect(discovered[0].files.map(f => f.name)).toEqual(['route.xml', 'plain', 'nothing', 'undef'])
            // root + the empty folder, nothing failed
            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 2, failedFolders: 0 })
        })

        test('a sub-folder that cannot be read counts as failed, not as a file', async () => {
            const tree = libraryTree()
            tree.unreadable = ['/lib/Alps/Stelvio']
            useFakeTree(tree)

            const discovered = await runScan()

            expect(discovered.map(r => r.controlFileUri)).toEqual(['/lib/a.rlv'])
            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 3, failedFolders: 1 })
        })

        test('an error code carried only in the error\'s code property is recognised too', async () => {
            fsMock.readdir.mockImplementation(async (uri: string) => {
                if (uri === '/lib')
                    return ['locked']
                throw Object.assign(new Error('failed'), { code: 'EPERM' })
            })

            await runScan()

            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 1, failedFolders: 1 })
        })

        test('an unrecognisable probe rejection is taken as "not a directory"', async () => {
            fsMock.readdir.mockImplementation(async (uri: string) => {
                if (uri === '/lib')
                    return ['route.xml', 'thing']
                throw new Error('An object could not be cloned.')
            })

            const discovered = await runScan()

            expect(discovered[0].files.map(f => f.name)).toEqual(['route.xml', 'thing'])
            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 1, failedFolders: 0 })
        })

        test('tries the one-call recursive listing, and falls back to probing when it comes back flat', async () => {
            useFakeTree(libraryTree())

            await runScan()

            expect(fsMock.readdir).toHaveBeenCalledWith('/lib', { recursive: true })
            // the probes still ran
            expect(listingCalls('/lib/Alps')).toHaveLength(1)
        })

        test('uses the recursive listing when it recursed: same routes, no probes', async () => {
            const tree = libraryTree()
            tree.recursiveSupported = true
            useFakeTree(tree)

            const discovered = await runScan()

            expect(discovered.map(r => [r.controlFileUri, r.folderName])).toEqual([
                ['/lib/a.rlv', 'Library'],
                ['/lib/Alps/Stelvio/s.xml', 'Stelvio'],
            ])
            expect(fsMock.readdir.mock.calls).toEqual([
                ['/lib', { recursive: false, extended: true }],
                ['/lib', { recursive: true }],
            ])
            expect(discovered[1].files).toEqual([
                { name: 's.xml', uri: '/lib/Alps/Stelvio/s.xml', isDirectory: false },
                { name: 's.mp4', uri: '/lib/Alps/Stelvio/s.mp4', isDirectory: false },
            ])
        })

        test('the recursive listing accepts Windows separators', async () => {
            fsMock.readdir.mockImplementation(async (_uri: string, options?: { recursive?: boolean }) =>
                options?.recursive
                    ? ['Alps', 'Alps\\Stelvio', 'Alps\\Stelvio\\s.xml']
                    : ['Alps']
            )

            const discovered = await runScan()

            expect(discovered.map(r => r.controlFileUri)).toEqual(['/lib/Alps/Stelvio/s.xml'])
            expect(fsMock.readdir).toHaveBeenCalledTimes(2)
        })

        test('a recursive listing whose nested paths have no listed parent is not trusted', async () => {
            // a file name containing a backslash on Linux is not a nested path
            useFakeTree({ dirs: { '/lib': ['odd\\name.xml', 'sub'], '/lib/sub': ['b.xml'] } })
            fsMock.readdir.mockImplementationOnce(async () => ['odd\\name.xml', 'sub'])
                .mockImplementationOnce(async () => ['odd\\name.xml', 'sub', 'sub/b.xml', 'ghost/c.xml'])

            const discovered = await runScan()

            expect(discovered.map(r => r.controlFileUri)).toEqual(['/lib/odd\\name.xml', '/lib/sub/b.xml'])
        })

        test('falls back to probing when the recursive listing fails, and counts the unreadable folder', async () => {
            const tree = libraryTree()
            tree.recursiveSupported = true
            tree.unreadable = ['/lib/Alps/Stelvio']
            useFakeTree(tree)

            const discovered = await runScan()

            expect(discovered.map(r => r.controlFileUri)).toEqual(['/lib/a.rlv'])
            expect(service.getDisplayProps().scanProgress).toEqual({ scannedFolders: 3, failedFolders: 1 })
        })

        test('the companion check sees the names-only listing', async () => {
            useFakeTree({ dirs: { '/lib': ['ok.epm', 'ok.epp', 'Other'], '/lib/Other': ['missing.epm'] } })

            const discovered = await runScan()

            expect(discovered.map(r => [r.controlFileUri, r.scanError])).toEqual([
                ['/lib/ok.epm', undefined],
                ['/lib/Other/missing.epm', 'Missing companion file (.epp)'],
            ])
        })

        describe('video lookup against the scanned listing', () => {
            beforeEach(() => {
                routeListMock.getRoute = jest.fn().mockReturnValue(undefined)
                appInfoMock.getChannel = jest.fn().mockReturnValue('desktop')
            })

            afterEach(() => {
                jest.restoreAllMocks()
            })

            const scanAndParse = async (video: Record<string, unknown>) => {
                useFakeTree({ dirs: { '/lib': ['Alps'], '/lib/Alps': ['s.xml', 'Ride.MP4', 'r.mp4'] } })
                const [scanned] = await runScan()

                jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                    data: { id: 'r1', title: 'route 1', hasVideo: true } as any,
                    details: { video } as any,
                })
                const results: ParsedRoute[] = []
                const observer = service.parse([scanned])
                observer.on('parse-result', r => results.push(r))
                await new Promise<void>(resolve => observer.once('parse-complete', resolve))
                return results[0]
            }

            test('a relative video file resolves to its uri from the names-only listing', async () => {
                const result = await scanAndParse({ file: 'ride.mp4' })

                expect(result.parseError).toBeUndefined()
                expect(result.route.details.video.file).toBe('/lib/Alps/Ride.MP4')
            })

            test('a relative video file missing from the listing is reported', async () => {
                const result = await scanAndParse({ file: 'other.mp4' })

                expect(result.parseError).toMatch(/Video file not found in folder/)
            })

            test('on mobile, an AVI video is swapped for the MP4 found in the listing', async () => {
                appInfoMock.getChannel = jest.fn().mockReturnValue('mobile')

                const result = await scanAndParse({ file: '/lib/Alps/r.avi', format: 'avi' })

                expect(result.parseError).toBeUndefined()
                expect(result.route.details.video.file).toBe('/lib/Alps/r.mp4')
                expect(result.route.details.video.format).toBe('mp4')
            })
        })
    })

    describe('scan - import history', () => {
        let writeSpy: jest.Mock
        let deleteSpy: jest.Mock

        const useRecords = (records: Array<{ id: string, treeUri: string }>) => {
            writeSpy = jest.fn().mockResolvedValue(true)
            deleteSpy = jest.fn().mockResolvedValue(true)
            jest.spyOn(JsonRepository, 'create').mockReturnValue({
                list: jest.fn().mockResolvedValue(records.map(r => r.id)),
                read: jest.fn(async (id: string) => records.find(r => r.id === id)),
                write: writeSpy,
                delete: deleteSpy,
            } as any)
        }

        const runScan = async (uri: string) => {
            fsMock.readdir.mockResolvedValue([])
            const observer = service.scan(makeFolder('Library', uri))
            await new Promise<void>(resolve => observer.once('scan-complete', resolve))
        }

        afterEach(() => {
            jest.restoreAllMocks()
        })

        test.each([
            ['/home/u/Routes/', '/home/u/Routes'],
            ['C:\\Routes\\', 'C:\\Routes'],
            ['c:\\Routes', 'C:\\Routes'],
            ['/', '/'],
            ['c:\\', 'C:\\'],
            ['content://tree/primary%3AVideos/', 'content://tree/primary%3AVideos/'],
            ['file:///Users/u/Routes/', 'file:///Users/u/Routes/'],
        ])('stores %s as %s', async (uri, expected) => {
            useRecords([])

            await runScan(uri)

            expect(writeSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ treeUri: expected }))
        })

        test('a differently spelled path to the same folder updates the existing record', async () => {
            useRecords([{ id: 'lib-1', treeUri: 'c:\\Routes\\' }])

            await runScan('C:\\Routes')

            expect(writeSpy).toHaveBeenCalledTimes(1)
            expect(writeSpy).toHaveBeenCalledWith('lib-1', expect.objectContaining({ id: 'lib-1', treeUri: 'C:\\Routes' }))
        })

        test('pre-existing duplicate records for one folder collapse into the first one', async () => {
            useRecords([
                { id: 'lib-1', treeUri: '/home/u/Routes/' },
                { id: 'lib-2', treeUri: '/home/u/Other' },
                { id: 'lib-3', treeUri: '/home/u/Routes' },
            ])

            await runScan('/home/u/Routes')

            expect(deleteSpy).toHaveBeenCalledTimes(1)
            expect(deleteSpy).toHaveBeenCalledWith('lib-3')
            expect(writeSpy).toHaveBeenCalledWith('lib-1', expect.objectContaining({ treeUri: '/home/u/Routes' }))
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

        test('carries the containing folder name onto the display item, to disambiguate same-titled routes', async () => {
            jest.spyOn(RouteParser, 'parse').mockResolvedValue({
                data: { id: 'r1', title: 'Stelvio' } as any,
                details: {} as any,
            })

            await runParse(makeScanned({ folderName: 'Alps 2023' }))

            const [item] = service.getDisplayProps().routes
            expect(item.folder).toBe('Alps 2023')
        })

        test('a failed parse still carries the containing folder name', async () => {
            jest.spyOn(RouteParser, 'parse').mockRejectedValue(new Error('cannot parse <Track>'))

            await runParse(makeScanned({ folderName: 'Alps 2023' }))

            const [item] = service.getDisplayProps().routes
            expect(item.folder).toBe('Alps 2023')
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
                folderName: 'folder',
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
            expect(result.skipped).toBe(1)
            expect(result.imported).toBe(2)
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

        describe('preview adoption', () => {

            test('without the preview store nothing touches the description', async () => {
                const parsed = makeRoute({}, { title: 'r1', previewUrl: '/icloud/Videos/A/preview.png' })
                observer = service.ingest([parsed])

                const result: any = await new Promise(resolve => observer.once('ingest-complete', resolve))

                expect(result.imported).toBe(1)
                expect(result.errors).toBe(0)
                expect(parsed.route.description.previewUrl).toBe('/icloud/Videos/A/preview.png')
                expect(parsed.route.description.previewSource).toBeUndefined()
            })

            test('adopts the preview before the route is saved', async () => {
                const order: Array<string> = []
                const adoptOnImport = jest.fn(async () => { order.push('adopt') })
                dbMock.save = jest.fn(async () => { order.push('save') })
                Inject('PreviewStore', { isEnabled: () => true, adoptOnImport })

                const parsed = makeRoute({}, { title: 'r1' })
                observer = service.ingest([parsed])
                await new Promise(resolve => observer.once('ingest-complete', resolve))

                expect(adoptOnImport).toHaveBeenCalledWith(parsed.route)
                expect(order).toEqual(['adopt', 'save'])

                Inject('PreviewStore', null)
            })

            test('a failed preview copy does not fail the import', async () => {
                const adoptOnImport = jest.fn(async (route: Route) => {
                    route.description.previewUrl = undefined
                    route.description.previewSource = '/icloud/Videos/A/preview.png'
                })
                Inject('PreviewStore', { isEnabled: () => true, adoptOnImport })

                const parsed = makeRoute({}, { title: 'r1', previewUrl: '/icloud/Videos/A/preview.png' })
                observer = service.ingest([parsed])

                const result: any = await new Promise(resolve => observer.once('ingest-complete', resolve))

                expect(result.imported).toBe(1)
                expect(result.errors).toBe(0)
                expect(dbMock.save).toHaveBeenCalled()
                expect(parsed.route.description.previewSource).toBe('/icloud/Videos/A/preview.png')

                Inject('PreviewStore', null)
            })

            test('a throwing preview store does not fail the import', async () => {
                Inject('PreviewStore', {
                    isEnabled: () => true,
                    adoptOnImport: jest.fn().mockRejectedValue(new Error('store unavailable'))
                })

                const parsed = makeRoute({}, { title: 'r1' })
                observer = service.ingest([parsed])

                const result: any = await new Promise(resolve => observer.once('ingest-complete', resolve))

                expect(result.imported).toBe(1)
                expect(result.errors).toBe(0)

                Inject('PreviewStore', null)
            })
        })

        describe('route shape', () => {

            afterEach(() => {
                Inject('RouteShapeStore', null)
            })

            // ingestOne() calls saveOnImport() unguarded (no local try/catch), relying on the
            // store's own documented "never throws, never rejects" contract (covered directly
            // in shapes/store.unit.test.ts) rather than duplicating that guard here.
            test('saves a shape before the route is saved', async () => {
                const order: Array<string> = []
                const saveOnImport = jest.fn(async () => { order.push('shape') })
                dbMock.save = jest.fn(async () => { order.push('save') })
                Inject('RouteShapeStore', { saveOnImport })

                const parsed = makeRoute({}, { title: 'r1' })
                observer = service.ingest([parsed])
                await new Promise(resolve => observer.once('ingest-complete', resolve))

                expect(saveOnImport).toHaveBeenCalledWith(parsed.route)
                expect(order).toEqual(['shape', 'save'])
            })
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
