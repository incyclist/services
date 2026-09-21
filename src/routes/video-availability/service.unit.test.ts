import { EventEmitter } from 'node:events'

import { createFileAccessBindingMock, FileAccessBindingMock } from '../../../__tests__/utils/fileAccessMock'
import type { FileAvailability, FileLocation } from '../../api/fileAccess/types'
import type { RouteInfo } from '../base/types'
import { RouteVideoAvailabilityService } from './service'
import type { RouteVideoState, VideoKeepChoice } from './types'

const GB = 1024 * 1024 * 1024

/** Path-only classification, as the real binding derives it from path markers. */
const classify = (path: string): FileLocation => {
    if (path.startsWith('/app')) return 'app'
    if (path.startsWith('/icloud')) return 'icloud'
    if (path.startsWith('/device')) return 'on-device'
    if (path.startsWith('/nas')) return 'network'
    return 'other'
}

const local = (over: Partial<FileAvailability> = {}): FileAvailability =>
    ({ isUbiquitous: false, isDownloading: false, downloadRequested: false, ...over })

const notDownloaded = (over: Partial<FileAvailability> = {}): FileAvailability => ({
    isUbiquitous: true, downloadStatus: 'not-downloaded', isDownloading: false, downloadRequested: false,
    sizeBytes: 4 * GB, volumeFreeBytes: 40 * GB, ...over
})

const downloaded = (over: Partial<FileAvailability> = {}): FileAvailability => ({
    isUbiquitous: true, downloadStatus: 'downloaded', isDownloading: false, downloadRequested: false,
    sizeBytes: 4 * GB, volumeFreeBytes: 40 * GB, ...over
})

const route = (id: string, videoUrl?: string, over: Partial<RouteInfo> = {}): RouteInfo =>
    ({ id, title: `Route ${id}`, videoUrl, hasVideo: !!videoUrl, ...over } as RouteInfo)

class FolderAccessMock extends EventEmitter {
    covered: Array<string> = []
    isSupported = jest.fn(() => true)
    isCovered = jest.fn((path: string) => this.covered.some(f => path.startsWith(f)))
    getAccessState = jest.fn(async (_path: string) => ({ state: 'readable' } as any))
}

type RepoMock = { read: jest.Mock, write: jest.Mock, delete: jest.Mock, list: jest.Mock, docs: Map<string, any> }

const createRepoMock = (stored?: Record<string, any>): RepoMock => {
    const docs = new Map<string, any>()
    if (stored)
        docs.set('entries', { entries: stored })
    return {
        docs,
        read: jest.fn(async (name: string) => docs.get(name)),
        write: jest.fn(async (name: string, data: any) => { docs.set(name, data); return true }),
        delete: jest.fn(async (name: string) => docs.delete(name)),
        list: jest.fn(async () => [...docs.keys()])
    }
}

describe('RouteVideoAvailabilityService', () => {

    let service: any
    let binding: FileAccessBindingMock
    let folderAccess: FolderAccessMock
    let repo: RepoMock
    let availability: Record<string, FileAvailability>
    let online: { onlineStatus: boolean }
    let logged: Array<any>

    const setup = (props: {
        routes?: Array<RouteInfo>,
        covered?: Array<string>,
        journal?: Record<string, any>,
        noBinding?: boolean,
        unsupported?: boolean
    } = {}) => {

        binding = createFileAccessBindingMock()
        binding.classifyLocation.mockImplementation(classify)
        binding.getAvailability.mockImplementation(async (path: string) => availability[path] ?? local())
        if (props.unsupported)
            binding.isSupported.mockReturnValue(false)

        folderAccess = new FolderAccessMock()
        folderAccess.covered = props.covered ?? []

        repo = createRepoMock(props.journal)
        logged = []

        const routes = props.routes ?? []

        service = new RouteVideoAvailabilityService()
        service.inject('Bindings', { fileAccess: props.noBinding ? undefined : binding })
        service.inject('FolderAccess', folderAccess)
        service.inject('OnlineStatus', online)
        service.inject('RouteList', {
            getAllRoutes: jest.fn(() => routes.map(description => ({ description }))),
            getCard: jest.fn((id: string) => {
                const description = routes.find(r => r.id === id)
                if (!description)
                    return undefined
                return { getData: () => ({ description, details: { next: description.next } }) }
            })
        })
        service.journal.inject('JournalRepo', repo)
        service.logEvent = (event: any) => { logged.push(event) }
        service.journal.logEvent = (event: any) => { logged.push(event) }

        return service
    }

    /** Pretends the platform already answered for a file, without going through a query. */
    const setCache = (path: string, entry: Record<string, any>) => {
        service.files[path] = { checkedAt: Date.now(), ...entry }
    }

    const messages = () => logged.map(e => e.message)

    beforeEach(() => {
        availability = {}
        online = { onlineStatus: true }
    })

    afterEach(() => {
        service?.reset()
        service = undefined
    })

    // ------------------------------------------------------------------ inertness

    describe('without the binding', () => {

        const expectInert = async () => {
            expect(service.isSupported()).toBe(false)

            expect(service.getStatus('r1')).toMatchObject({ state: 'unknown', fileCount: 0, isICloud: false })
            expect(service.getListPill('r1')).toBeUndefined()
            expect(service.needsConfirmation('r1')).toBe(false)
            expect(service.getDownloadRows()).toEqual([])
            expect(service.getStartOverlayReason('r1')).toBeUndefined()

            await service.download('r1', 'keep')
            await service.stop('r1')
            await service.retry('r1')
            await service.setChoice('r1', 'keep')
            await service.settle()
            await service.onForeground()
            await service.refresh('r1')

            expect(await service.remove('r1')).toBe('failed')

            // ride integration: latching, tracking and reconciliation are all no-ops too
            service.onRideStarted(['r1'], ['/icloud/Videos/a.mp4'])
            expect(service.rideRouteIds).toEqual([])
            service.setActiveRidePaths(['/icloud/Videos/a.mp4'])
            expect(service.activeRidePaths).toEqual([])
            await service.onRideLeft()
            expect(service.getRideRemovalNotice(['r1'])).toBeUndefined()

            // nothing probed, nothing started, nothing written
            expect(repo.write).not.toHaveBeenCalled()
            expect(folderAccess.getAccessState).not.toHaveBeenCalled()
        }

        test('everything is a safe no-op when the binding is absent', async () => {
            setup({ noBinding: true, routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            await expectInert()
        })

        test('and when the binding reports it is unsupported', async () => {
            setup({ unsupported: true, routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            await expectInert()
            expect(binding.getAvailability).not.toHaveBeenCalled()
            expect(binding.startDownload).not.toHaveBeenCalled()
        })

        test('a ride is never gated', async () => {
            setup({ noBinding: true, routes: [route('r1', '/icloud/Videos/a.mp4')] })
            expect(await service.getPlayability('/icloud/Videos/a.mp4')).toEqual({ playable: true, state: 'unknown' })
        })
    })

    // ------------------------------------------------------------------ single-file states

    describe('state of a single video', () => {

        const statusFor = async (avail: FileAvailability | undefined, access?: any) => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            if (avail)
                availability['/icloud/Videos/a.mp4'] = avail
            if (access)
                folderAccess.getAccessState.mockResolvedValue(access)
            return service.refresh('r1')
        }

        test('a file that is not cloud-backed is simply ready', async () => {
            const status = await statusFor(local())
            expect(status).toMatchObject({ state: 'ready', isICloud: true, fileCount: 1, notDownloadedCount: 0 })
        })

        test('a downloaded cloud file is ready', async () => {
            expect(await statusFor(downloaded())).toMatchObject({ state: 'ready' })
        })

        test('a cloud file whose status is unknown is treated as absent', async () => {
            expect(await statusFor(notDownloaded({ downloadStatus: undefined })))
                .toMatchObject({ state: 'not-downloaded' })
        })

        test('a placeholder is not downloaded, with its size and the free space', async () => {
            expect(await statusFor(notDownloaded())).toMatchObject({
                state: 'not-downloaded', notDownloadedCount: 1,
                sizeBytes: 4 * GB, freeBytes: 40 * GB
            })
        })

        test('a download running outside the app is watched, not owned', async () => {
            expect(await statusFor(notDownloaded({ isDownloading: true })))
                .toMatchObject({ state: 'downloading-external' })
        })

        test('a failed transfer is reported as failed', async () => {
            expect(await statusFor(notDownloaded({ downloadError: { domain: 'NSURLErrorDomain', code: -1009 } })))
                .toMatchObject({ state: 'download-failed' })
        })

        test('an out-of-space failure gets its own state, not a generic failure', async () => {
            expect(await statusFor(notDownloaded({ downloadError: { domain: 'NSCocoaErrorDomain', code: 640 } })))
                .toMatchObject({ state: 'not-enough-storage' })
            expect(await statusFor(notDownloaded({ downloadError: { domain: 'NSPOSIXErrorDomain', code: 28 } })))
                .toMatchObject({ state: 'not-enough-storage' })
        })

        test('a lost folder is access-lost, carrying whether it resolves on its own', async () => {
            const status = await statusFor(notDownloaded(), { state: 'access-lost', transient: true, location: 'icloud' })
            expect(status).toMatchObject({ state: 'access-lost', transient: true })
            // no point asking about a file that cannot be read
            expect(binding.getAvailability).not.toHaveBeenCalled()
        })

        test('a missing file is not-found', async () => {
            expect(await statusFor(notDownloaded(), { state: 'not-found' })).toMatchObject({ state: 'not-found' })
        })

        test('a query that fails leaves the state unknown rather than guessing', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            binding.getAvailability.mockRejectedValue(new Error('timed out'))

            expect(await service.refresh('r1')).toMatchObject({ state: 'unknown' })
        })

        test('a file nothing is known about yet is checking', () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            expect(service.getStatus('r1')).toMatchObject({ state: 'checking' })
        })

        test('a video inside app storage needs no gating', async () => {
            setup({ routes: [route('r1', '/app/videos/a.mp4')] })
            expect(await service.refresh('r1')).toMatchObject({ state: 'ready', isICloud: false })
            expect(binding.getAvailability).not.toHaveBeenCalled()
        })

        test('a route without a local video is not this service\'s business', async () => {
            setup({ routes: [route('r1', 'https://server/a.mp4'), route('r2')] })
            expect(await service.refresh('r1')).toMatchObject({ state: 'unknown', fileCount: 0 })
            expect(await service.refresh('r2')).toMatchObject({ state: 'unknown', fileCount: 0 })
        })
    })

    // ------------------------------------------------------------------ storage margin

    describe('storage margin', () => {

        const withFreeSpace = async (freeBytes: number) => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ sizeBytes: 4 * GB, volumeFreeBytes: freeBytes })
            return service.refresh('r1')
        }

        test('asks for more than the video itself', async () => {
            const status = await withFreeSpace(40 * GB)
            expect(status.requiredBytes).toBeGreaterThan(status.sizeBytes)
        })

        test('a volume that only just fits the video is not enough', async () => {
            expect(await withFreeSpace(4 * GB + 1)).toMatchObject({ state: 'not-enough-storage' })
        })

        test('plenty of room is fine', async () => {
            expect(await withFreeSpace(40 * GB)).toMatchObject({ state: 'not-downloaded' })
        })

        test('an unknown size never blocks a download', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ sizeBytes: 0, volumeFreeBytes: 1 })

            const status = await service.refresh('r1')

            expect(status).toMatchObject({ state: 'not-downloaded' })
            expect(status.sizeBytes).toBeUndefined()
            expect(status.requiredBytes).toBeUndefined()
        })

        test('a download is refused rather than started when the space is not there', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ sizeBytes: 4 * GB, volumeFreeBytes: 4 * GB })

            await service.download('r1', 'keep')

            expect(binding.startDownload).not.toHaveBeenCalled()
            expect(repo.write).not.toHaveBeenCalled()
            expect(logged.find(e => e.message === 'icloud download refused')).toMatchObject({
                reason: 'not-enough-storage'
            })
        })
    })

    // ------------------------------------------------------------------ precedence

    describe('precedence', () => {

        /** Worst first, exactly as the design orders them. */
        const ORDER: Array<{ state: RouteVideoState, choice?: VideoKeepChoice, transient?: boolean }> = [
            { state: 'not-found' },
            { state: 'access-lost', transient: true },
            { state: 'access-lost', transient: false },
            { state: 'not-enough-storage' },
            { state: 'download-failed' },
            { state: 'waiting-for-network' },
            { state: 'downloading' },
            { state: 'downloading-external' },
            { state: 'cancelled' },
            { state: 'not-downloaded' },
            { state: 'checking' },
            { state: 'ready', choice: 'this-ride' },
            { state: 'ready' },
            { state: 'unknown' }
        ]

        const fileState = (spec: typeof ORDER[number], segment: number) => ({
            file: { path: `/icloud/${segment}.mp4`, routeId: 'r1', segment, isExternal: true, isICloud: true },
            ...spec
        })

        test('every state beats every state below it, in both orders', () => {
            setup()

            for (let worse = 0; worse < ORDER.length; worse++) {
                for (let better = worse + 1; better < ORDER.length; better++) {
                    const a = fileState(ORDER[worse], 1)
                    const b = fileState(ORDER[better], 2)

                    expect(service.aggregate('r1', [a, b]).state).toBe(ORDER[worse].state)
                    expect(service.aggregate('r1', [b, a]).state).toBe(ORDER[worse].state)
                }
            }
        })

        test('an access loss that resolves itself is explained before one that needs the user', () => {
            setup()
            const transient = fileState({ state: 'access-lost', transient: true }, 1)
            const needsUser = fileState({ state: 'access-lost', transient: false }, 2)

            expect(service.aggregate('r1', [needsUser, transient]).transient).toBe(true)
        })

        test('a "for this ride" video is not hidden behind a plain ready one', () => {
            setup()
            const kept = fileState({ state: 'ready', choice: 'keep' }, 1)
            const thisRide = fileState({ state: 'ready', choice: 'this-ride' }, 2)

            expect(service.aggregate('r1', [kept, thisRide])).toMatchObject({
                state: 'ready', thisRide: true, affectedSegment: 2
            })
        })
    })

    // ------------------------------------------------------------------ multi-video

    describe('multi-video routes', () => {

        const chain = () => setup({
            routes: [
                route('r1', '/icloud/Videos/a.mp4', { next: 'r2' }),
                route('r2', '/icloud/Videos/b.mp4', { next: 'r3' }),
                route('r3', '/icloud/Videos/c.mp4')
            ],
            covered: ['/icloud/Videos']
        })

        test('the worst file decides, and the part number says which', async () => {
            chain()
            availability['/icloud/Videos/a.mp4'] = downloaded()
            availability['/icloud/Videos/b.mp4'] = downloaded()
            availability['/icloud/Videos/c.mp4'] = notDownloaded()

            expect(await service.refresh('r1')).toMatchObject({
                state: 'not-downloaded', fileCount: 3, notDownloadedCount: 1, affectedSegment: 3
            })
        })

        test('the files still needed are counted and their sizes added up', async () => {
            chain()
            availability['/icloud/Videos/a.mp4'] = downloaded()
            availability['/icloud/Videos/b.mp4'] = notDownloaded({ sizeBytes: 2 * GB })
            availability['/icloud/Videos/c.mp4'] = notDownloaded({ sizeBytes: 3 * GB })

            expect(await service.refresh('r1')).toMatchObject({
                state: 'not-downloaded', notDownloadedCount: 2, sizeBytes: 5 * GB
            })
        })

        test('a download in flight wins, and the missing file is still counted', async () => {
            chain()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            availability['/icloud/Videos/b.mp4'] = notDownloaded()
            availability['/icloud/Videos/c.mp4'] = downloaded()

            await service.download('r1', 'keep')
            // only the first file's download is confirmed as running by the platform
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ isDownloading: true })
            await service.journal.discard('/icloud/Videos/b.mp4')

            const status = await service.refresh('r1')

            expect(status.state).toBe('downloading')
            expect(status.notDownloadedCount).toBe(1)
        })

        test('every missing file of the chain is started', async () => {
            chain()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            availability['/icloud/Videos/b.mp4'] = downloaded()
            availability['/icloud/Videos/c.mp4'] = notDownloaded()

            await service.download('r1', 'keep')

            expect(binding.startDownload.mock.calls.map(c => c[0]).sort())
                .toEqual(['/icloud/Videos/a.mp4', '/icloud/Videos/c.mp4'])
        })

        test('a cyclic chain is followed once, not forever', async () => {
            setup({
                routes: [
                    route('r1', '/icloud/Videos/a.mp4', { next: 'r2' }),
                    route('r2', '/icloud/Videos/b.mp4', { next: 'r1' })
                ],
                covered: ['/icloud/Videos']
            })

            expect((await service.refresh('r1')).fileCount).toBe(2)
        })

        test('a single video gets no part number', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            expect((await service.refresh('r1')).affectedSegment).toBeUndefined()
        })
    })

    // ------------------------------------------------------------------ list pills

    describe('list pills', () => {

        const listSetup = (props: Parameters<typeof setup>[0] = {}) =>
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'], ...props })

        /** Lets the queued query run. */
        const flush = async () => { await new Promise(resolve => setImmediate(resolve)) }

        test('the journal answers first, with no platform call at all', async () => {
            listSetup({ journal: { '/icloud/Videos/a.mp4': { path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'keep', status: 'downloading', startedAt: 1, evictAttempts: 0 } } })
            await service.journal.init()

            expect(service.getListPill('r1')).toBe('downloading')
            expect(binding.getAvailability).not.toHaveBeenCalled()
        })

        test('a stopping download still shows as downloading until it is really gone', async () => {
            listSetup({ journal: { '/icloud/Videos/a.mp4': { path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'keep', status: 'stopping', startedAt: 1, evictAttempts: 0 } } })
            await service.journal.init()

            expect(service.getListPill('r1')).toBe('downloading')
        })

        test('a placeholder in a folder we have access to gets the iCloud pill', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            expect(service.getListPill('r1')).toBeUndefined()   // queued, not yet answered
            await flush()

            expect(service.getListPill('r1')).toBe('in-icloud')
        })

        test('a transfer started outside the app shows as downloading', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ isDownloading: true })
            service.getListPill('r1')
            await flush()

            expect(service.getListPill('r1')).toBe('downloading')
        })

        test('a downloaded file gets no pill', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = downloaded()
            service.getListPill('r1')
            await flush()

            expect(service.getListPill('r1')).toBeUndefined()
        })

        test('a folder without a grant is never queried and never labelled', async () => {
            listSetup({ covered: [] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            expect(service.getListPill('r1')).toBeUndefined()
            await flush()

            expect(service.getListPill('r1')).toBeUndefined()
            expect(binding.getAvailability).not.toHaveBeenCalled()
        })

        test('access is never probed for the list', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            service.getListPill('r1')
            await flush()

            expect(binding.checkAccess).not.toHaveBeenCalled()
            expect(folderAccess.getAccessState).not.toHaveBeenCalled()
        })

        test('a query that times out simply has no pill', async () => {
            listSetup()
            binding.getAvailability.mockRejectedValue(new Error('timed out'))

            service.getListPill('r1')
            await flush()

            expect(service.getListPill('r1')).toBeUndefined()
        })

        test('the answer is reused instead of re-queried', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            service.getListPill('r1')
            await flush()
            service.getListPill('r1')
            service.getListPill('r1')
            await flush()

            expect(binding.getAvailability).toHaveBeenCalledTimes(1)
        })

        test('a stale answer is queried again', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            service.getListPill('r1')
            await flush()

            service.files['/icloud/Videos/a.mp4'].checkedAt = Date.now() - 61_000
            service.getListPill('r1')
            await flush()

            expect(binding.getAvailability).toHaveBeenCalledTimes(2)
        })

        test('confirming access to a folder invalidates what was cached', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            service.getListPill('r1')
            await flush()
            expect(service.getListPill('r1')).toBe('in-icloud')

            folderAccess.emit('access-changed', '/icloud/Videos')

            expect(service.getListPill('r1')).toBeUndefined()
            await flush()
            expect(binding.getAvailability).toHaveBeenCalledTimes(2)
        })

        test('coming back to the foreground invalidates it too', async () => {
            listSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            service.getListPill('r1')
            await flush()

            await service.onForeground()

            expect(service.files).toEqual({})
        })

        test('no more than two files are queried at a time', async () => {
            const routes = Array.from({ length: 8 }, (_, i) => route(`r${i}`, `/icloud/Videos/${i}.mp4`))
            setup({ routes, covered: ['/icloud/Videos'] })

            let inFlight = 0
            let peak = 0
            const release: Array<() => void> = []

            binding.getAvailability.mockImplementation(() => {
                inFlight++
                peak = Math.max(peak, inFlight)
                return new Promise<FileAvailability>(resolve => {
                    release.push(() => { inFlight--; resolve(notDownloaded()) })
                })
            })

            routes.forEach(r => service.getListPill(r.id))

            expect(peak).toBe(2)

            while (release.length) {
                release.shift()?.()
                await new Promise(resolve => setImmediate(resolve))
            }

            expect(peak).toBe(2)
            expect(binding.getAvailability).toHaveBeenCalledTimes(8)
        })

        test('the same file is only queued once', async () => {
            listSetup()
            binding.getAvailability.mockImplementation(() => new Promise(() => { /* never settles */ }))

            service.getListPill('r1')
            service.getListPill('r1')
            service.getListPill('r1')

            expect(binding.getAvailability).toHaveBeenCalledTimes(1)
        })
    })

    // ------------------------------------------------------------------ session memory

    describe('session memory', () => {

        const memSetup = () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
        }

        test('the keep-or-remove question is asked before the first download', () => {
            memSetup()
            expect(service.needsConfirmation('r1')).toBe(true)
        })

        test('and not again once it has been answered this session', async () => {
            memSetup()
            await service.download('r1', 'this-ride')

            // the transfer is genuinely under way by the time refresh() re-queries it - a static
            // "not downloaded" answer here would be indistinguishable from C9's "iOS evicted it"
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ isDownloading: true })

            expect(service.needsConfirmation('r1')).toBe(false)
            expect((await service.refresh('r1')).confirmedThisSession).toBe(true)
        })

        test('a retry reuses the answer instead of asking again', async () => {
            memSetup()
            await service.download('r1', 'this-ride')
            await service.journal.discard('/icloud/Videos/a.mp4')
            binding.startDownload.mockClear()

            await service.retry('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')?.choice).toBe('this-ride')
            expect(binding.startDownload).toHaveBeenCalled()
        })

        test('a retry after a restart has nothing to reuse and keeps the file', async () => {
            memSetup()

            await service.retry('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')?.choice).toBe('keep')
        })

        test('removing the file makes the question relevant again', async () => {
            memSetup()
            await service.download('r1', 'this-ride')
            availability['/icloud/Videos/a.mp4'] = downloaded()

            expect(await service.remove('r1')).toBe('removed')
            expect(service.needsConfirmation('r1')).toBe(true)
        })
    })

    // ------------------------------------------------------------------ journal lifecycle

    describe('download and journal lifecycle', () => {

        const dlSetup = (avail: FileAvailability = notDownloaded()) => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = avail
        }

        const entry = () => service.journal.getEntry('/icloud/Videos/a.mp4')

        test('the entry is on disk before the download is started', async () => {
            dlSetup()
            const order: Array<string> = []
            repo.write.mockImplementation(async () => { order.push('journal'); return true })
            binding.startDownload.mockImplementation(async () => { order.push('start') })

            await service.download('r1', 'this-ride')

            expect(order).toEqual(['journal', 'start'])
        })

        test('a file that was already downloaded earns no entry and is not started', async () => {
            dlSetup(downloaded())

            await service.download('r1', 'keep')

            expect(entry()).toBeUndefined()
            expect(binding.startDownload).not.toHaveBeenCalled()
        })

        test('a download already running elsewhere earns no entry either', async () => {
            dlSetup(notDownloaded({ isDownloading: true }))

            await service.download('r1', 'keep')

            expect(entry()).toBeUndefined()
            expect(binding.startDownload).not.toHaveBeenCalled()
        })

        test('a start that throws leaves no entry behind', async () => {
            dlSetup()
            binding.startDownload.mockRejectedValue(new Error('no'))

            await service.download('r1', 'keep')

            expect(entry()).toBeUndefined()
            expect(service.getStatus('r1')).toMatchObject({ state: 'download-failed' })
        })

        test('a download whose entry cannot be persisted is kept, never removed', async () => {
            dlSetup()
            repo.write.mockResolvedValue(false)

            await service.download('r1', 'this-ride')

            expect(entry()).toBeUndefined()
            expect(binding.startDownload).toHaveBeenCalled()
            expect(logged.find(e => e.message === 'icloud download started')).toMatchObject({ choice: 'keep' })
        })

        test('a finished download the user keeps leaves no entry', async () => {
            dlSetup()
            await service.download('r1', 'keep')

            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.pollOnce()

            expect(entry()).toBeUndefined()
            expect(service.getStatus('r1')).toMatchObject({ state: 'ready' })
        })

        test('a finished "for this ride" download waits for the ride', async () => {
            dlSetup()
            await service.download('r1', 'this-ride')

            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.pollOnce()

            expect(entry()).toMatchObject({ status: 'awaiting-ride', choice: 'this-ride' })
            expect(service.getStatus('r1')).toMatchObject({ state: 'ready', thisRide: true })
        })

        test('a failed download drops its entry', async () => {
            dlSetup()
            await service.download('r1', 'this-ride')

            availability['/icloud/Videos/a.mp4'] = notDownloaded({ downloadError: { domain: 'NSURLErrorDomain', code: -1 } })
            await service.pollOnce()

            expect(entry()).toBeUndefined()
            expect(service.getStatus('r1')).toMatchObject({ state: 'download-failed' })
        })

        test('an offline download waits for the network rather than failing', async () => {
            dlSetup()
            await service.download('r1', 'keep')

            online.onlineStatus = false

            expect(service.getStatus('r1')).toMatchObject({ state: 'waiting-for-network' })
        })

        test('stopping gives the space back and keeps the claim until it is confirmed', async () => {
            dlSetup()
            await service.download('r1', 'keep')

            // the platform reports the file gone right after the eviction
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            await service.stop('r1')

            expect(binding.evict).toHaveBeenCalledWith('/icloud/Videos/a.mp4')
            expect(entry()).toBeUndefined()
            // and the route reads as a plain placeholder again, without waiting for a refresh
            expect(service.getStatus('r1')).toMatchObject({ state: 'not-downloaded' })
        })

        test('an eviction that has not taken effect yet is retried later', async () => {
            dlSetup()
            await service.download('r1', 'keep')

            // the eviction "succeeds" but the file is still there
            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.stop('r1')

            expect(entry()).toMatchObject({ status: 'stopping', evictAttempts: 1 })
        })

        test('an eviction that throws is counted, not lost', async () => {
            dlSetup()
            await service.download('r1', 'keep')
            binding.evict.mockRejectedValue(new Error('busy'))

            await service.stop('r1')

            expect(entry()).toMatchObject({ status: 'stopping', evictAttempts: 1 })
        })

        test('a stopped download is restarted as a download again', async () => {
            dlSetup()
            await service.download('r1', 'keep')
            binding.evict.mockRejectedValue(new Error('busy'))
            await service.stop('r1')
            expect(entry().status).toBe('stopping')

            await service.download('r1', 'keep')

            expect(entry()).toMatchObject({ status: 'downloading' })
        })

        test('a stop left over from a previous run is finished off at the next start', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: {
                    '/icloud/Videos/a.mp4': {
                        path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'keep',
                        status: 'stopping', startedAt: 1, stoppedAt: 2, dueAt: 2, evictAttempts: 0
                    }
                }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            await service.settle()

            expect(binding.evict).toHaveBeenCalledWith('/icloud/Videos/a.mp4')
            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
        })

        test('a file that is still arriving is not evicted mid-transfer', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: {
                    '/icloud/Videos/a.mp4': {
                        path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'keep',
                        status: 'stopping', startedAt: 1, stoppedAt: 2, dueAt: 2, evictAttempts: 0
                    }
                }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ isDownloading: true })

            await service.settle()

            expect(binding.evict).not.toHaveBeenCalled()
            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeDefined()
        })

        test('nothing is evicted for a file the ride is playing', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: {
                    '/icloud/Videos/a.mp4': {
                        path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'this-ride',
                        status: 'removal-due', startedAt: 1, dueAt: 2, evictAttempts: 0
                    }
                }
            })
            service.activeRidePaths = ['/icloud/Videos/a.mp4']

            await service.settle()

            expect(binding.evict).not.toHaveBeenCalled()
            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeDefined()
        })

        test('a running download is watched, and watching stops when there is nothing left', async () => {
            dlSetup()
            await service.download('r1', 'keep')
            expect(service.pollTimer).toBeDefined()

            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.pollOnce()

            expect(service.pollTimer).toBeUndefined()
        })

        test('the watcher polls until the download finishes', async () => {
            jest.useFakeTimers()
            try {
                dlSetup()
                await service.download('r1', 'keep')
                binding.getAvailability.mockClear()

                jest.advanceTimersByTime(10_000)
                await jest.runOnlyPendingTimersAsync()

                expect(binding.getAvailability).toHaveBeenCalled()
            }
            finally {
                jest.useRealTimers()
            }
        })

        test('a file with no entry is never evicted automatically', async () => {
            dlSetup(downloaded())
            await service.settle()

            expect(binding.evict).not.toHaveBeenCalled()
        })
    })

    // ------------------------------------------------------------------ keep choice / remove

    describe('changing the choice and removing', () => {

        const readySetup = async (choice: VideoKeepChoice) => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            await service.download('r1', choice)
            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.pollOnce()
        }

        test('"keep it instead" cancels the pending removal', async () => {
            await readySetup('this-ride')
            expect(service.journal.getEntry('/icloud/Videos/a.mp4')?.status).toBe('awaiting-ride')

            await service.setChoice('r1', 'keep')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
            expect(service.getStatus('r1')).toMatchObject({ state: 'ready', thisRide: undefined })
        })

        test('the choice of a running download can be changed', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            await service.download('r1', 'keep')

            await service.setChoice('r1', 'this-ride')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toMatchObject({
                status: 'downloading', choice: 'this-ride'
            })
        })

        test('the user can remove a video they downloaded', async () => {
            await readySetup('keep')
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            expect(await service.remove('r1')).toBe('removed')
            expect(binding.evict).toHaveBeenCalledWith('/icloud/Videos/a.mp4')
            expect(service.getStatus('r1')).toMatchObject({ state: 'not-downloaded' })
        })

        test('and one that was already on the device, which has no entry', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.refresh('r1')

            expect(await service.remove('r1')).toBe('removed')
            expect(binding.evict).toHaveBeenCalledWith('/icloud/Videos/a.mp4')
        })

        test('but not while the ride is playing it', async () => {
            await readySetup('keep')
            service.activeRidePaths = ['/icloud/Videos/a.mp4']

            expect(await service.remove('r1')).toBe('in-use')
            expect(binding.evict).not.toHaveBeenCalled()
        })

        test('a failed removal is reported as such', async () => {
            await readySetup('keep')
            binding.evict.mockRejectedValue(new Error('busy'))

            expect(await service.remove('r1')).toBe('failed')
        })

        test('removing a route with no local video is not possible', async () => {
            setup({ routes: [route('r1', 'https://server/a.mp4')] })
            expect(await service.remove('r1')).toBe('failed')
        })
    })

    // ------------------------------------------------------------------ download rows

    describe('download rows', () => {

        const rowSetup = () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4'), route('r2', '/icloud/Videos/b.mp4')],
                covered: ['/icloud/Videos']
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ sizeBytes: 2 * GB })
            availability['/icloud/Videos/b.mp4'] = notDownloaded({ sizeBytes: 3 * GB })
        }

        test('a started download gets a row with its title, size and choice', async () => {
            rowSetup()
            await service.download('r1', 'this-ride')

            expect(service.getDownloadRows()).toEqual([expect.objectContaining({
                routeId: 'r1', title: 'Route r1', state: 'downloading', choice: 'this-ride', sizeBytes: 2 * GB
            })])
        })

        test('rows are ordered by when they started', async () => {
            rowSetup()
            await service.download('r1', 'keep')
            service.rows['/icloud/Videos/a.mp4'].startedAt = 2000
            await service.download('r2', 'keep')
            service.rows['/icloud/Videos/b.mp4'].startedAt = 1000

            expect(service.getDownloadRows().map((r: any) => r.routeId)).toEqual(['r2', 'r1'])
        })

        test('a finished download stays listed with its outcome', async () => {
            rowSetup()
            await service.download('r1', 'this-ride')
            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.pollOnce()

            expect(service.getDownloadRows()).toEqual([expect.objectContaining({
                state: 'ready', choice: 'this-ride'
            })])
        })

        test('a failed one does too', async () => {
            rowSetup()
            await service.download('r1', 'keep')
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ downloadError: { domain: 'x', code: 1 } })
            await service.pollOnce()

            expect(service.getDownloadRows()).toEqual([expect.objectContaining({ state: 'download-failed' })])
        })

        test('a stopped one leaves no row', async () => {
            rowSetup()
            await service.download('r1', 'keep')
            await service.stop('r1')

            expect(service.getDownloadRows()).toEqual([])
        })

        test('a download the app only watches is not listed', async () => {
            rowSetup()
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ isDownloading: true })

            await service.download('r1', 'keep')

            expect(service.getDownloadRows()).toEqual([])
        })

        test('a removed download leaves no row', async () => {
            rowSetup()
            await service.download('r1', 'this-ride')
            availability['/icloud/Videos/a.mp4'] = downloaded()
            await service.pollOnce()
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            await service.remove('r1')

            expect(service.getDownloadRows()).toEqual([])
        })

        test('a change to the rows is announced', async () => {
            rowSetup()
            const updated = jest.fn()
            service.on('download-rows-update', updated)

            await service.download('r1', 'keep')

            expect(updated).toHaveBeenCalled()
        })
    })

    // ------------------------------------------------------------------ start overlay

    describe('start overlay reason', () => {

        const reasonFor = (over: Record<string, any>, opts?: { segment?: number }) => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            setCache('/icloud/Videos/a.mp4', over)
            return service.getStartOverlayReason('r1', opts)
        }

        test('not downloaded points the user at the route list', () => {
            expect(reasonFor({ accessState: 'readable', availability: notDownloaded() }))
                .toBe(`This route's video isn't downloaded to this device yet. Open the route under Routes to download it.`)
        })

        test('a download in flight says to wait for it', () => {
            expect(reasonFor({ accessState: 'readable', availability: notDownloaded({ isDownloading: true }) }))
                .toBe(`This route's video is still downloading from iCloud. Try again once it has finished — you can check under Routes.`)
        })

        test('offline says so', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            await service.download('r1', 'keep')
            online.onlineStatus = false

            expect(service.getStartOverlayReason('r1'))
                .toBe(`This route's video is waiting for an internet connection to finish downloading.`)
        })

        test('out of space says so', () => {
            expect(reasonFor({
                accessState: 'readable',
                availability: notDownloaded({ sizeBytes: 4 * GB, volumeFreeBytes: 1 })
            })).toBe(`This route's video isn't downloaded, and there isn't enough free space on this device for it.`)
        })

        test('a folder that needs confirming says where to confirm it', () => {
            expect(reasonFor({ accessState: 'access-lost', transient: false }))
                .toBe('Incyclist needs your OK to use the folder with this video. Open the route under Routes and tap Confirm Access.')
        })

        test('a signed-out cloud account points at Settings instead', () => {
            expect(reasonFor({ accessState: 'access-lost', transient: true }))
                .toBe(`iCloud Drive isn't available. Check in the Settings app that you're signed in to iCloud.`)
        })

        test('a missing file says it may have been moved', () => {
            expect(reasonFor({ accessState: 'not-found' }))
                .toBe(`The video file can't be found. It may have been moved, renamed or deleted.`)
        })

        test('anything else falls back to the existing wording', () => {
            expect(reasonFor({ indeterminate: true })).toBeUndefined()
            setCache('/icloud/Videos/a.mp4', { accessState: 'readable' })
            expect(service.getStartOverlayReason('r1')).toBe('Could not load video.')
        })

        test('a later part of the route is named, and re-worded to match', () => {
            const reason = reasonFor({ accessState: 'readable', availability: notDownloaded() }, { segment: 2 })
            expect(reason).toBe(`Part 2 of this route: the video isn't downloaded to this device yet. Open the route under Routes to download it.`)
        })

        test('a ready route has no reason to show', () => {
            expect(reasonFor({ accessState: 'readable', availability: downloaded() })).toBeUndefined()
        })
    })

    // ------------------------------------------------------------------ ride integration

    describe('ride integration', () => {

        test('onRideStarted latches the visit\'s routes and mounts the active paths', () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')] })

            service.onRideStarted(['r1', 'r2'], ['/icloud/Videos/a.mp4'])

            expect(service.rideRouteIds).toEqual(['r1', 'r2'])
            expect(service.activeRidePaths).toEqual(['/icloud/Videos/a.mp4'])
            expect(messages()).toContain('ride visit started')
        })

        test('setActiveRidePaths can also be called on its own, as segments change mid-ride', () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')] })

            service.setActiveRidePaths(['/icloud/Videos/b.mp4'])

            expect(service.activeRidePaths).toEqual(['/icloud/Videos/b.mp4'])
        })

        test('getPlayability reports a ready file as playable', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            setCache('/icloud/Videos/a.mp4', { accessState: 'readable', availability: downloaded() })

            expect(await service.getPlayability('/icloud/Videos/a.mp4')).toEqual({ playable: true, state: 'ready' })
        })

        test('getPlayability reports a not-downloaded file as not playable', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            setCache('/icloud/Videos/a.mp4', { accessState: 'readable', availability: notDownloaded() })

            expect(await service.getPlayability('/icloud/Videos/a.mp4'))
                .toEqual({ playable: false, state: 'not-downloaded' })
        })

        test('getPlayability treats an indeterminate query as unknown, and does not gate on it', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })
            setCache('/icloud/Videos/a.mp4', { indeterminate: true })

            expect(await service.getPlayability('/icloud/Videos/a.mp4')).toEqual({ playable: true, state: 'unknown' })
        })

        test('getPlayability reads the existing cache and never queries the platform itself', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')], covered: ['/icloud/Videos'] })

            await service.getPlayability('/icloud/Videos/a.mp4')

            expect(binding.getAvailability).not.toHaveBeenCalled()
        })

        test('getRideRemovalNotice reports pending for a this-ride entry and kept for a keep entry', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4'), route('r2', '/icloud/Videos/b.mp4')],
                journal: {
                    '/icloud/Videos/a.mp4': {
                        path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'this-ride',
                        status: 'downloading', startedAt: 1, evictAttempts: 0
                    },
                    '/icloud/Videos/b.mp4': {
                        path: '/icloud/Videos/b.mp4', routeId: 'r2', choice: 'keep',
                        status: 'downloading', startedAt: 1, evictAttempts: 0
                    }
                }
            })
            await service.journal.init()

            expect(service.getRideRemovalNotice(['r1'])).toEqual({ pending: true, kept: false })
            expect(service.getRideRemovalNotice(['r2'])).toEqual({ pending: false, kept: true })
            expect(service.getRideRemovalNotice(['r1', 'r2'])).toEqual({ pending: true, kept: true })
        })

        test('getRideRemovalNotice is undefined when neither choice is on record', async () => {
            setup({ routes: [route('r1', '/icloud/Videos/a.mp4')] })
            await service.journal.init()

            expect(service.getRideRemovalNotice(['r1'])).toBeUndefined()
        })

        test('leaving persists removal-due before settling, and leaves other visits\' entries alone', async () => {
            jest.useFakeTimers()
            try {
                setup({
                    routes: [route('r1', '/icloud/Videos/a.mp4'), route('r2', '/icloud/Videos/b.mp4')],
                    covered: ['/icloud/Videos'],
                    journal: {
                        '/icloud/Videos/a.mp4': {
                            path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'this-ride',
                            status: 'awaiting-ride', startedAt: 1, evictAttempts: 0
                        },
                        '/icloud/Videos/b.mp4': {
                            path: '/icloud/Videos/b.mp4', routeId: 'r2', choice: 'this-ride',
                            status: 'awaiting-ride', startedAt: 1, evictAttempts: 0
                        }
                    }
                })
                await service.journal.init()
                availability['/icloud/Videos/a.mp4'] = notDownloaded()

                // only r1 was visited; the active path is left empty so the settle below can evict
                service.onRideStarted(['r1'], [])
                repo.write.mockClear()

                await service.onRideLeft()

                // persisted before any eviction was attempted
                expect(repo.write).toHaveBeenCalled()
                expect(binding.evict).not.toHaveBeenCalled()
                expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toMatchObject({ status: 'removal-due' })
                // r2's entry belongs to a route this visit never touched
                expect(service.journal.getEntry('/icloud/Videos/b.mp4')).toMatchObject({ status: 'awaiting-ride' })
                expect(messages()).toContain('ride visit left')

                jest.advanceTimersByTime(2_000)
                await jest.runOnlyPendingTimersAsync()

                expect(binding.evict).toHaveBeenCalledWith('/icloud/Videos/a.mp4')
                expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
            }
            finally {
                jest.useRealTimers()
            }
        })

        test('a file the ride is still (or again) playing is never evicted, even once due', async () => {
            jest.useFakeTimers()
            try {
                setup({
                    routes: [route('r1', '/icloud/Videos/a.mp4')],
                    covered: ['/icloud/Videos'],
                    journal: {
                        '/icloud/Videos/a.mp4': {
                            path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'this-ride',
                            status: 'awaiting-ride', startedAt: 1, evictAttempts: 0
                        }
                    }
                })
                await service.journal.init()
                availability['/icloud/Videos/a.mp4'] = notDownloaded()

                service.onRideStarted(['r1'], ['/icloud/Videos/a.mp4'])

                await service.onRideLeft()

                jest.advanceTimersByTime(2_000)
                await jest.runOnlyPendingTimersAsync()

                expect(binding.evict).not.toHaveBeenCalled()
                expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toMatchObject({ status: 'removal-due' })
            }
            finally {
                jest.useRealTimers()
            }
        })
    })

    // ------------------------------------------------------------------ C9 reconciliation

    describe('C9 reconciliation', () => {

        const journalEntry = (over: Record<string, any> = {}) => ({
            path: '/icloud/Videos/a.mp4', routeId: 'r1', choice: 'keep',
            status: 'downloading', startedAt: 1, evictAttempts: 0, ...over
        })

        test('a downloading entry whose file is no longer local is dropped silently on refresh', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry() }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            const status = await service.refresh('r1')

            expect(status).toMatchObject({ state: 'not-downloaded' })
            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
            expect(logged.find(e => e.message === 'icloud download reconciled'))
                .toMatchObject({ routeId: 'r1', reason: 'no-longer-local' })
            expect(logged.some(e => /fail|abandon/i.test(e.message))).toBe(false)
        })

        test('an awaiting-ride entry is reconciled the same way', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry({ status: 'awaiting-ride', choice: 'this-ride' }) }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            await service.refresh('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
        })

        test('a stopping entry is reconciled the same way', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry({ status: 'stopping', dueAt: 1 }) }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            await service.refresh('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
        })

        test('a removal-due entry is reconciled the same way', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry({ status: 'removal-due', dueAt: 1 }) }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()

            await service.refresh('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
        })

        test('a download still arriving is left for the poller, not reconciled away', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry() }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded({ isDownloading: true })

            await service.refresh('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeDefined()
        })

        test('a download that failed with an error is left for the ordinary failure path', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry() }
            })
            availability['/icloud/Videos/a.mp4'] =
                notDownloaded({ downloadError: { domain: 'NSURLErrorDomain', code: -1 } })

            await service.refresh('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeDefined()
        })

        test('a file that is genuinely still local is left alone', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry() }
            })
            availability['/icloud/Videos/a.mp4'] = downloaded()

            await service.refresh('r1')

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeDefined()
        })

        test('reconciliation runs across the whole journal on foreground, not just one route', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4'), route('r2', '/icloud/Videos/b.mp4')],
                covered: ['/icloud/Videos'],
                journal: {
                    '/icloud/Videos/a.mp4': journalEntry(),
                    '/icloud/Videos/b.mp4': journalEntry({ routeId: 'r2', path: '/icloud/Videos/b.mp4' })
                }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            availability['/icloud/Videos/b.mp4'] = notDownloaded()

            await service.onForeground()

            expect(service.journal.getEntry('/icloud/Videos/a.mp4')).toBeUndefined()
            expect(service.journal.getEntry('/icloud/Videos/b.mp4')).toBeUndefined()
        })

        test('a route update is emitted and session memory cleared for the reconciled route', async () => {
            setup({
                routes: [route('r1', '/icloud/Videos/a.mp4')],
                covered: ['/icloud/Videos'],
                journal: { '/icloud/Videos/a.mp4': journalEntry() }
            })
            availability['/icloud/Videos/a.mp4'] = notDownloaded()
            service.sessionChoices['r1'] = 'keep'

            const updates: Array<string> = []
            service.on('route-video-update', (routeId: string) => updates.push(routeId))

            await service.refresh('r1')

            expect(updates).toContain('r1')
            expect(service.sessionChoices['r1']).toBeUndefined()
        })
    })
})
