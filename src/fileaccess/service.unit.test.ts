import { createFileAccessBindingMock, FileAccessBindingMock } from '../../__tests__/utils/fileAccessMock'
import type { FileLocation } from '../api/fileAccess/types'
import type { RouteInfo } from '../routes/base/types'
import { FolderAccessService } from './service'

/** Path-only classification, mirroring what the real binding does from path markers alone. */
const classify = (path: string): FileLocation => {
    if (path.startsWith('/app')) return 'app'
    if (path.startsWith('/icloud')) return 'icloud'
    if (path.startsWith('/device')) return 'on-device'
    if (path.startsWith('/nas')) return 'network'
    return 'other'
}

type RepoMock = {
    list: jest.Mock, read: jest.Mock, write: jest.Mock, delete: jest.Mock,
    records: Map<string, any>
}

const createRepoMock = (initial: Array<any> = []): RepoMock => {
    const records = new Map<string, any>(initial.map(r => [r.id, r]))
    return {
        records,
        list: jest.fn(async () => [...records.keys()]),
        read: jest.fn(async (name: string) => records.get(name)),
        write: jest.fn(async (name: string, data: any) => { records.set(name, data); return true }),
        delete: jest.fn(async (name: string) => records.delete(name))
    }
}

const route = (id: string, videoUrl?: string, extra: Partial<RouteInfo> = {}): RouteInfo =>
    ({ id, title: id, videoUrl, hasVideo: !!videoUrl, ...extra } as RouteInfo)

const createRouteListMock = (descriptions: Array<RouteInfo> = []) => ({
    getAllRoutes: jest.fn(() => descriptions.map(description => ({ description }))),
    // must never be used by this service - confirming access never imports anything
    startLibraryScan: jest.fn(),
    scanFolder: jest.fn()
})

const grantRecord = (over: Record<string, any> = {}) => ({
    id: 'g-icloud', folder: '/icloud/Videos', grant: 'T-icloud',
    location: 'icloud', source: 'pick', createdAt: 1000, ...over
})

describe('FolderAccessService', () => {

    let service: any
    let binding: FileAccessBindingMock
    let repo: RepoMock
    let routeList: ReturnType<typeof createRouteListMock>
    let ui: { selectDirectory: jest.Mock }
    let logged: Array<any>

    /** token -> path the platform resolves it to */
    let resolved: Record<string, string>

    const setup = (props: {
        grants?: Array<any>, routes?: Array<RouteInfo>,
        bindingOverrides?: Partial<FileAccessBindingMock>, noBinding?: boolean
    } = {}) => {

        binding = createFileAccessBindingMock(props.bindingOverrides)
        binding.classifyLocation.mockImplementation(classify)
        binding.activateGrant.mockImplementation(async (token: string) => {
            if (!resolved[token])
                throw new Error('could not resolve bookmark')
            return { resolvedPath: resolved[token], isStale: false }
        })

        repo = createRepoMock(props.grants)
        routeList = createRouteListMock(props.routes)
        ui = { selectDirectory: jest.fn() }
        logged = []

        service = new FolderAccessService()
        service.inject('Bindings', { fileAccess: props.noBinding ? undefined : binding, ui })
        service.inject('GrantsRepo', repo)
        service.inject('RouteList', routeList)
        service.logEvent = (event: any) => { logged.push(event) }

        return service
    }

    beforeEach(() => {
        resolved = {
            'T-icloud': '/icloud/Videos',
            'T-device': '/device/Videos',
            'T-other': '/icloud/Other',
            'T-captured': '/icloud/Videos'
        }
    })

    afterEach(() => {
        service?.reset()
        service = undefined
    })

    // ---------------------------------------------------------------- inertness

    describe('without the binding', () => {

        test('every method is a safe no-op', async () => {
            setup({ noBinding: true, routes: [route('1', '/icloud/Videos/A/a.mp4')] })

            await service.activateAll()
            await service.registerGrant('/icloud/Videos', 'T-icloud')

            expect(service.isSupported()).toBe(false)
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(false)
            expect(service.getTargetFor('1')).toBeUndefined()
            expect(await service.getAccessState('/icloud/Videos/A/a.mp4')).toEqual({ state: 'readable' })

            expect(await service.confirmAccess('1'))
                .toEqual({ outcome: 'cancelled', coversRoute: false, restoredCount: 0 })

            expect(repo.list).not.toHaveBeenCalled()
            expect(repo.write).not.toHaveBeenCalled()
            expect(ui.selectDirectory).not.toHaveBeenCalled()
        })

        test('an unsupported binding is treated the same way', async () => {
            setup({
                bindingOverrides: { isSupported: jest.fn().mockReturnValue(false) },
                routes: [route('1', '/icloud/Videos/A/a.mp4')]
            })

            await service.activateAll()
            await service.registerGrant('/icloud/Videos', 'T-icloud')

            expect(await service.getAccessState('/icloud/Videos/A/a.mp4')).toEqual({ state: 'readable' })
            expect(binding.activateGrant).not.toHaveBeenCalled()
            expect(binding.checkAccess).not.toHaveBeenCalled()
            expect(repo.write).not.toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- activateAll

    describe('activateAll', () => {

        test('activates every stored grant', async () => {
            setup({ grants: [grantRecord(), grantRecord({ id: 'g-device', folder: '/device/Videos', grant: 'T-device', location: 'on-device' })] })

            await service.activateAll()

            expect(binding.activateGrant).toHaveBeenCalledTimes(2)
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(true)
            expect(service.isCovered('/device/Videos/B/b.mp4')).toBe(true)
        })

        test('is idempotent per launch, also when called concurrently', async () => {
            setup({ grants: [grantRecord()] })

            await Promise.all([service.activateAll(), service.activateAll(), service.activateAll()])
            await service.activateAll()

            expect(repo.list).toHaveBeenCalledTimes(1)
            expect(binding.activateGrant).toHaveBeenCalledTimes(1)
        })

        test('holds the scope - a grant is never deactivated on its own', async () => {
            setup({ grants: [grantRecord()] })

            await service.activateAll()
            await service.getAccessState('/icloud/Videos/A/a.mp4')

            expect(binding.deactivateGrant).not.toHaveBeenCalled()
        })

        test('stores a renewed grant', async () => {
            setup({ grants: [grantRecord()] })
            binding.activateGrant.mockResolvedValue({
                resolvedPath: '/icloud/Videos', isStale: true, renewedGrant: 'T-renewed'
            })

            await service.activateAll()

            expect(repo.write).toHaveBeenCalled()
            expect(repo.records.get('g-icloud').grant).toBe('T-renewed')
            expect(repo.records.get('g-icloud').renewedAt).toBeDefined()
        })

        test('a moved folder stays covered under both paths', async () => {
            setup({ grants: [grantRecord()] })
            binding.activateGrant.mockResolvedValue({ resolvedPath: '/icloud/Moved', isStale: false })

            await service.activateAll()

            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(true)
            expect(service.isCovered('/icloud/Moved/A/a.mp4')).toBe(true)
            expect(logged.find(e => e.message === 'folder grant activated').moved).toBe(true)
        })

        test('a failed grant is recorded but never deleted', async () => {
            setup({ grants: [grantRecord({ grant: 'T-gone' })] })

            await service.activateAll()

            expect(repo.delete).not.toHaveBeenCalled()
            expect(repo.records.get('g-icloud')).toBeDefined()
            expect(repo.records.get('g-icloud').lastError).toBeDefined()
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(false)
            expect(logged.map(e => e.message)).toContain('folder grant failed')
        })

        test('emits access-changed', async () => {
            setup({ grants: [grantRecord()] })
            const onChanged = jest.fn()
            service.on('access-changed', onChanged)

            await service.activateAll()

            expect(onChanged).toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- registerGrant

    describe('registerGrant', () => {

        test('stores and verifies the grant from the picker', async () => {
            setup()

            await service.registerGrant('/icloud/Videos', 'T-icloud', undefined, 'Videos')

            expect(binding.activateGrant).toHaveBeenCalledWith('T-icloud')
            expect(repo.write).toHaveBeenCalled()
            const stored = [...repo.records.values()][0]
            expect(stored.folder).toBe('/icloud/Videos')
            expect(stored.source).toBe('pick')
            expect(stored.displayName).toBe('Videos')
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(true)
        })

        test('captures a grant when the picker did not return one', async () => {
            setup()
            binding.captureGrant.mockResolvedValue('T-captured')

            await service.registerGrant('/icloud/Videos', undefined, 'picker returned no bookmark')

            expect(binding.captureGrant).toHaveBeenCalledWith('/icloud/Videos')
            expect([...repo.records.values()][0].source).toBe('captured')
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(true)
        })

        test('captures a grant when the one from the picker cannot be verified', async () => {
            setup()
            binding.captureGrant.mockResolvedValue('T-captured')

            await service.registerGrant('/icloud/Videos', 'T-broken')

            expect(binding.captureGrant).toHaveBeenCalled()
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(true)
        })

        test('records an unverified grant without covering the folder', async () => {
            setup()

            await service.registerGrant('/icloud/Videos', 'T-broken')

            expect([...repo.records.values()][0].lastError).toBeDefined()
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(false)
            expect(logged.map(e => e.message)).toContain('folder grant unverified')
        })

        test('canonicalizes the folder before storing it', async () => {
            setup()
            resolved['T-icloud'] = '/icloud/My Videos'

            await service.registerGrant('file:///icloud/My%20Videos/', 'T-icloud')

            expect([...repo.records.values()][0].folder).toBe('/icloud/My Videos')
            expect(service.isCovered('/icloud/My Videos/A/a.mp4')).toBe(true)
        })

        test('re-registering the same folder releases the previous scope', async () => {
            setup()

            await service.registerGrant('/icloud/Videos', 'T-icloud')
            await service.registerGrant('/icloud/Videos', 'T-icloud')

            expect(binding.deactivateGrant).toHaveBeenCalledWith('/icloud/Videos')
            expect(repo.records.size).toBe(1)
        })

        test('never throws, whatever the platform does', async () => {
            setup()
            binding.activateGrant.mockRejectedValue(new Error('boom'))
            binding.captureGrant.mockRejectedValue(new Error('boom'))
            repo.write.mockRejectedValue(new Error('boom'))

            await expect(service.registerGrant('/icloud/Videos', 'T-icloud')).resolves.toBeUndefined()
        })

        test('ignores a folder that is not a local path', async () => {
            setup()

            await service.registerGrant('https://incyclist.com/videos', 'T-icloud')

            expect(repo.write).not.toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- isCovered

    describe('isCovered', () => {

        beforeEach(async () => {
            setup({ grants: [grantRecord()] })
            await service.activateAll()
        })

        test('covers files below the granted folder', () => {
            expect(service.isCovered('/icloud/Videos/A/a.mp4')).toBe(true)
        })

        test('covers the granted folder itself', () => {
            expect(service.isCovered('/icloud/Videos')).toBe(true)
        })

        test('matches on segment boundaries only', () => {
            expect(service.isCovered('/icloud/VideosOld/a.mp4')).toBe(false)
        })

        test('accepts the other spellings of the same path', () => {
            expect(service.isCovered('file:///icloud/Videos/A/a%20b.mp4')).toBe(true)
        })

        test('does not cover a folder without a grant', () => {
            expect(service.isCovered('/icloud/Other/a.mp4')).toBe(false)
        })

        test('makes no native calls', () => {
            binding.checkAccess.mockClear()
            binding.getAvailability.mockClear()

            service.isCovered('/icloud/Videos/A/a.mp4')

            expect(binding.checkAccess).not.toHaveBeenCalled()
            expect(binding.getAvailability).not.toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- getAccessState

    describe('getAccessState', () => {

        test('app storage is readable without probing', async () => {
            setup()

            expect(await service.getAccessState('/app/videos/a.mp4')).toEqual({ state: 'readable' })
            expect(binding.checkAccess).not.toHaveBeenCalled()
        })

        test('a remote URL is readable without probing', async () => {
            setup()

            expect(await service.getAccessState('https://incyclist.com/a.mp4')).toEqual({ state: 'readable' })
            expect(binding.checkAccess).not.toHaveBeenCalled()
        })

        test('activates stored grants before probing', async () => {
            setup({ grants: [grantRecord()] })

            await service.getAccessState('/icloud/Videos/A/a.mp4')

            expect(binding.activateGrant).toHaveBeenCalled()
            expect(binding.checkAccess).toHaveBeenCalledWith('/icloud/Videos/A/a.mp4')
        })

        test('reports a missing file as not-found', async () => {
            setup()
            binding.checkAccess.mockResolvedValue({ state: 'not-found' })

            expect(await service.getAccessState('/icloud/Videos/A/a.mp4')).toEqual({ state: 'not-found' })
        })

        test('reports an unreachable platform as unknown', async () => {
            setup()
            binding.checkAccess.mockRejectedValue(new Error('timeout'))

            expect(await service.getAccessState('/icloud/Videos/A/a.mp4')).toEqual({ state: 'unknown' })
        })

        test('captures a grant for a readable folder that has none', async () => {
            setup()
            binding.captureGrant.mockResolvedValue('T-captured')

            const state = await service.getAccessState('/icloud/Videos/a.mp4')

            expect(state).toEqual({ state: 'readable' })
            expect(binding.captureGrant).toHaveBeenCalledWith('/icloud/Videos')
            expect(service.isCovered('/icloud/Videos/a.mp4')).toBe(true)
        })

        test('does not capture a grant for a folder that already has one', async () => {
            setup({ grants: [grantRecord()] })
            await service.activateAll()
            binding.captureGrant.mockClear()

            await service.getAccessState('/icloud/Videos/A/a.mp4')

            expect(binding.captureGrant).not.toHaveBeenCalled()
        })

        describe('access-lost', () => {

            beforeEach(() => {
                setup({
                    grants: [
                        grantRecord({ grant: 'T-gone' }),
                        grantRecord({ id: 'g-device', folder: '/device/Videos', grant: 'T-device', location: 'on-device' })
                    ]
                })
                binding.checkAccess.mockResolvedValue({ state: 'denied', errno: 1 })
            })

            test('is transient when the platform reports no cloud identity', async () => {
                binding.isCloudIdentityAvailable.mockResolvedValue(false)

                expect(await service.getAccessState('/icloud/Videos/A/a.mp4'))
                    .toEqual({ state: 'access-lost', transient: true, location: 'icloud' })
            })

            test('is not transient when the platform reports a cloud identity', async () => {
                binding.isCloudIdentityAvailable.mockResolvedValue(true)

                expect(await service.getAccessState('/icloud/Videos/A/a.mp4'))
                    .toEqual({ state: 'access-lost', transient: false, location: 'icloud' })
            })

            test('falls back to the pattern when the platform cannot tell', async () => {
                // every cloud grant failed while an on-device grant still works: signed out
                binding.isCloudIdentityAvailable.mockResolvedValue(undefined)

                expect(await service.getAccessState('/icloud/Videos/A/a.mp4'))
                    .toEqual({ state: 'access-lost', transient: true, location: 'icloud' })
            })

            test('the pattern does not apply when a cloud grant still works', async () => {
                service.reset()
                setup({
                    grants: [
                        grantRecord(),
                        grantRecord({ id: 'g-other', folder: '/icloud/Other', grant: 'T-other' }),
                        grantRecord({ id: 'g-device', folder: '/device/Videos', grant: 'T-device', location: 'on-device' })
                    ]
                })
                binding.checkAccess.mockResolvedValue({ state: 'denied' })
                binding.isCloudIdentityAvailable.mockResolvedValue(undefined)

                expect(await service.getAccessState('/icloud/Third/a.mp4'))
                    .toEqual({ state: 'access-lost', transient: false, location: 'icloud' })
            })

            test('the pattern does not apply when nothing on the device works either', async () => {
                service.reset()
                setup({ grants: [grantRecord({ grant: 'T-gone' })] })
                binding.checkAccess.mockResolvedValue({ state: 'denied' })
                binding.isCloudIdentityAvailable.mockResolvedValue(undefined)

                expect(await service.getAccessState('/icloud/Videos/A/a.mp4'))
                    .toEqual({ state: 'access-lost', transient: false, location: 'icloud' })
            })
        })
    })

    // ---------------------------------------------------------------- getTargetFor

    describe('getTargetFor', () => {

        const routes = [
            route('1', 'video:///icloud/Videos/Alps/alps.mp4'),
            route('2', 'video:///icloud/Videos/Pyrenees/pyr.mp4'),
            route('3', 'video:///icloud/Videos/Alps/alps2.mp4'),
            route('4', 'video:///device/Videos/local.mp4'),
            route('5', '/app/videos/copied.mp4'),
            route('6', 'https://incyclist.com/video.mp4'),
            route('7')
        ]

        test('offers the deepest folder that covers every affected route', async () => {
            setup({ routes })
            await service.activateAll()

            const target = service.getTargetFor('1')

            expect(target.folder).toBe('/icloud/Videos')
            expect(target.location).toBe('icloud')
            expect(target.siblingCount).toBe(2)
            expect(target.displayPath).toBe('iCloud Drive › icloud › Videos')
        })

        test('only counts routes in the same location', async () => {
            setup({ routes })
            await service.activateAll()

            expect(service.getTargetFor('4')).toEqual(expect.objectContaining({
                folder: '/device/Videos', location: 'on-device', siblingCount: 0
            }))
        })

        test('ignores routes that already have a grant', async () => {
            setup({ routes, grants: [grantRecord({ folder: '/icloud/Videos/Alps', grant: 'T-alps' })] })
            resolved['T-alps'] = '/icloud/Videos/Alps'
            await service.activateAll()

            const target = service.getTargetFor('2')

            expect(target.folder).toBe('/icloud/Videos/Pyrenees')
            expect(target.siblingCount).toBe(0)
        })

        test('has no target for a route inside app storage', async () => {
            setup({ routes })
            await service.activateAll()

            expect(service.getTargetFor('5')).toBeUndefined()
        })

        test('has no target for a remote video or a route without one', async () => {
            setup({ routes })
            await service.activateAll()

            expect(service.getTargetFor('6')).toBeUndefined()
            expect(service.getTargetFor('7')).toBeUndefined()
            expect(service.getTargetFor('unknown-id')).toBeUndefined()
        })

        test('falls back to the route folder when the affected routes share nothing', async () => {
            setup({
                routes: [
                    route('1', '/icloud/A/one.mp4'),
                    route('2', '/icloud/B/two.mp4')
                ]
            })
            // both are classified icloud but live in unrelated trees
            binding.classifyLocation.mockReturnValue('icloud')
            await service.activateAll()

            expect(service.getTargetFor('1').folder).toBe('/icloud')
        })

        test('makes no native calls', async () => {
            setup({ routes })
            await service.activateAll()
            binding.checkAccess.mockClear()
            binding.getAvailability.mockClear()
            binding.activateGrant.mockClear()
            binding.captureGrant.mockClear()

            service.getTargetFor('1')

            expect(binding.checkAccess).not.toHaveBeenCalled()
            expect(binding.getAvailability).not.toHaveBeenCalled()
            expect(binding.activateGrant).not.toHaveBeenCalled()
            expect(binding.captureGrant).not.toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- confirmAccess

    describe('confirmAccess', () => {

        const routes = [
            route('1', 'video:///icloud/Videos/Alps/alps.mp4'),
            route('2', 'video:///icloud/Videos/Pyrenees/pyr.mp4'),
            route('3', 'video:///icloud/Videos/Alps/alps2.mp4')
        ]

        test('opens the picker at the folder we believe the video is in', async () => {
            setup({ routes })
            ui.selectDirectory.mockResolvedValue({ canceled: true })

            await service.confirmAccess('1')

            expect(ui.selectDirectory).toHaveBeenCalledWith({ initialDirectory: '/icloud/Videos' })
        })

        test('cancelling changes nothing', async () => {
            setup({ routes })
            ui.selectDirectory.mockResolvedValue({ canceled: true })

            expect(await service.confirmAccess('1'))
                .toEqual({ outcome: 'cancelled', coversRoute: false, restoredCount: 0 })
            expect(repo.write).not.toHaveBeenCalled()
        })

        test('confirms and reports how many routes were restored', async () => {
            setup({ routes })
            resolved['T-new'] = '/icloud/Videos'
            ui.selectDirectory.mockResolvedValue({ selected: '/icloud/Videos', grant: 'T-new' })

            const result = await service.confirmAccess('1')

            expect(result).toEqual({ outcome: 'confirmed', coversRoute: true, restoredCount: 3 })
            expect(service.isCovered('/icloud/Videos/Pyrenees/pyr.mp4')).toBe(true)
        })

        test('a folder that does not contain the video is kept but reported as wrong', async () => {
            setup({ routes })
            resolved['T-other'] = '/icloud/Other'
            ui.selectDirectory.mockResolvedValue({ selected: '/icloud/Other', grant: 'T-other' })

            const result = await service.confirmAccess('1')

            expect(result.outcome).toBe('wrong-folder')
            expect(result.coversRoute).toBe(false)
            expect([...repo.records.values()][0].folder).toBe('/icloud/Other')
        })

        test('a folder above the video also confirms', async () => {
            setup({ routes })
            resolved['T-parent'] = '/icloud'
            ui.selectDirectory.mockResolvedValue({ selected: '/icloud', grant: 'T-parent' })

            expect((await service.confirmAccess('1')).outcome).toBe('confirmed')
        })

        test('emits access-changed so cached state can be refreshed', async () => {
            setup({ routes })
            resolved['T-new'] = '/icloud/Videos'
            ui.selectDirectory.mockResolvedValue({ selected: '/icloud/Videos', grant: 'T-new' })
            const onChanged = jest.fn()

            await service.activateAll()
            service.on('access-changed', onChanged)
            await service.confirmAccess('1')

            expect(onChanged).toHaveBeenCalledWith('/icloud/Videos')
        })

        test('never triggers a scan or an import', async () => {
            setup({ routes })
            resolved['T-new'] = '/icloud/Videos'
            ui.selectDirectory.mockResolvedValue({ selected: '/icloud/Videos', grant: 'T-new' })

            await service.confirmAccess('1')

            expect(routeList.startLibraryScan).not.toHaveBeenCalled()
            expect(routeList.scanFolder).not.toHaveBeenCalled()
        })

        test('a failing picker is reported as cancelled', async () => {
            setup({ routes })
            ui.selectDirectory.mockRejectedValue(new Error('no picker'))

            expect(await service.confirmAccess('1'))
                .toEqual({ outcome: 'cancelled', coversRoute: false, restoredCount: 0 })
        })
    })

    // ---------------------------------------------------------------- access summary

    describe('access summary', () => {

        const routes = [
            route('1', 'video:///icloud/Videos/Alps/alps.mp4'),
            route('2', 'video:///icloud/Other/other.mp4'),
            route('3', 'video:///device/Videos/local.mp4'),
            route('4', '/app/videos/copied.mp4'),
            route('5', 'https://incyclist.com/video.mp4')
        ]

        test('counts external routes covered and not covered, by location', async () => {
            setup({ routes, grants: [grantRecord({ folder: '/icloud/Videos' })] })

            await service.activateAll()

            const summary = logged.find(e => e.message === 'access summary')
            expect(summary).toBeDefined()
            expect(summary.routes).toBe(3)
            expect(summary.covered).toBe(1)
            expect(summary.notCovered).toBe(2)
            expect(summary.byLocation).toEqual({
                icloud: { covered: 1, notCovered: 1 },
                'on-device': { covered: 0, notCovered: 1 }
            })
        })

        test('is written once per launch', async () => {
            setup({ routes })

            await service.activateAll()
            await service.activateAll()

            expect(logged.filter(e => e.message === 'access summary')).toHaveLength(1)
        })

        test('contains no paths and no grant data', async () => {
            setup({ routes, grants: [grantRecord({ folder: '/icloud/Videos' })] })

            await service.activateAll()

            const values = JSON.stringify(logged.find(e => e.message === 'access summary'))
            expect(values).not.toContain('/')
            expect(values).not.toContain('T-icloud')
        })

        test('makes no native probes', async () => {
            setup({ routes })

            await service.activateAll()

            expect(binding.checkAccess).not.toHaveBeenCalled()
            expect(binding.getAvailability).not.toHaveBeenCalled()
        })
    })
})
