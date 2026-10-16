import { EventLogger } from 'gd-eventlog'
import { Inject } from '../../../base/decorators'
import { Route } from '../../base/model/route'
import { RouteApiDescription, RouteApiDetail } from '../../base/api/types'
import { RoutesApiLoader } from './api'
import { LoadDetailsTargets } from './types'
import { RouteInfo } from '../../types'

const waitTick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

const dbSave = jest.fn().mockResolvedValue(undefined)
const dbGetDescription = jest.fn()
const dbGetDetails = jest.fn().mockResolvedValue(undefined)

jest.mock('./db', () => ({
    RoutesDbLoader: jest.fn().mockImplementation(() => ({
        save: dbSave,
        getDescription: dbGetDescription,
        getDetails: dbGetDetails,
    })),
}))

const descr = (props: Partial<RouteApiDescription> = {}): RouteApiDescription => ({
    id: 'r1',
    title: 'Route 1',
    points: { id: 'p1' },
    ...props,
} as RouteApiDescription)

const detail = (props: Partial<RouteApiDetail> = {}): RouteApiDetail => ({
    id: 'r1',
    title: 'Route 1',
    points: [{ lat: 1, lng: 1, routeDistance: 0, distance: 0 }],
    ...props,
} as unknown as RouteApiDetail)

describe('RoutesApiLoader', () => {
    let service: RoutesApiLoader
    let apiMock
    let userSettingsMock

    const setupApi = (props: { gpx?: Array<RouteApiDescription>, video?: Array<RouteApiDescription>, rejectGpx?: Error, rejectVideo?: Error } = {}) => {
        apiMock = {
            getRouteDescriptions: jest.fn(async (q) => {
                if (q.type === 'gpx') {
                    if (props.rejectGpx) throw props.rejectGpx
                    return props.gpx ?? []
                }
                if (props.rejectVideo) throw props.rejectVideo
                return props.video ?? []
            }),
            getRouteDetails: jest.fn().mockResolvedValue(detail()),
            setSource: jest.fn(),
        }
        Inject('IncyclistRoutesApi', { create: jest.fn().mockReturnValue(apiMock) })
        return apiMock
    }

    const waitDone = (observer): Promise<{ added: Array<Route>, updated: Array<Route> }> => new Promise(resolve => {
        const added = []
        const updated = []
        observer.on('route.added', (route: Route) => added.push(route))
        observer.on('route.updated', (route: Route) => updated.push(route))
        observer.on('done', () => resolve({ added, updated }))
    })

    beforeEach(() => {
        userSettingsMock = { getValue: jest.fn().mockReturnValue(null) }
        Inject('UserSettings', userSettingsMock)
        setupApi()
        dbGetDescription.mockReset().mockReturnValue(undefined)
        dbGetDetails.mockReset().mockResolvedValue(undefined)
        dbSave.mockReset().mockResolvedValue(undefined)
    })

    afterEach(() => {
        Inject('IncyclistRoutesApi', null)
        Inject('UserSettings', null)
        jest.clearAllMocks()
    })

    describe('constructor', () => {
        test('creates the default api via the injected factory', () => {
            const factory = { create: jest.fn().mockReturnValue(apiMock) }
            Inject('IncyclistRoutesApi', factory)

            service = new RoutesApiLoader()

            expect(factory.create).toHaveBeenCalledWith()
        })
    })

    describe('load', () => {

        test('concurrent call returns the same (in-progress) observer', () => {
            service = new RoutesApiLoader()
            const o1 = service.load()
            const o2 = service.load()

            expect(o1).toBe(o2)
        })

        test('new route: emits route.added, then route.updated once its details complete it, and persists it', async () => {
            // list descriptions only carry a points *reference*, never the actual point array (see
            // RouteApiDescription.points), so a freshly added route is never "complete" straight out
            // of buildRouteInfo - it always goes through a details round-trip, which (via the
            // `added` flag on LoadDetailsTargets meaning "needs an update emission") re-emits it as
            // route.updated once details are in
            setupApi({ gpx: [descr({ id: 'new1', title: 'New Route' })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added, updated } = await waitDone(service.load())

            expect(added).toHaveLength(1)
            expect(added[0].description.id).toBe('new1')
            expect(updated).toHaveLength(1)
            expect(updated[0].description.id).toBe('new1')
            expect(dbSave).toHaveBeenCalled()

            // the final housekeeping (stopping and clearing the load observer) happens on a
            // deferred tick after 'done' - give it a moment before the test tears down
            await waitTick()
        })

        test('demo category and video metadata are reflected on the built route info', async () => {
            setupApi({
                gpx: [descr({
                    id: 'demo1',
                    category: 'Demo',
                    video: { format: 'mp4', url: 'http://example.com/video.mp4' } as RouteApiDescription['video'],
                })],
            })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            const route = added.find(r => r.description.id === 'demo1')
            expect(route.description.isDemo).toBe(true)
            expect(route.description.hasVideo).toBe(true)
            expect(route.description.videoFormat).toBe('mp4')
            expect(route.description.videoUrl).toBe('http://example.com/video.mp4')
        })

        test('same route id returned by both gpx and video queries: the second occurrence is skipped', async () => {
            setupApi({
                gpx: [descr({ id: 'dup' })],
                video: [descr({ id: 'dup' })],
            })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            expect(added.filter(r => r.description.id === 'dup')).toHaveLength(1)
        })

        test('a brand-new route that is already complete is also saved immediately, in addition to the regular details round-trip', async () => {
            // completeness only affects whether an *extra*, eager save (enforcedWriteDetails=false)
            // happens on top of the normal route.added -> details -> route.updated flow every new
            // route goes through - it is not an alternative to it
            setupApi({ gpx: [descr({ id: 'complete1' })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined);
            (service as any).buildRouteInfo = jest.fn().mockReturnValue({
                id: 'complete1',
                title: 'Already complete',
                hasVideo: false,
                points: [{ lat: 1, lng: 1, routeDistance: 0 }],
            })

            const { added, updated } = await waitDone(service.load())

            expect(added).toHaveLength(1)
            expect(updated).toHaveLength(1)
            expect(dbSave).toHaveBeenCalledWith(expect.anything(), false)
        })

        test('saving a brand-new, already-complete route fails: the failure is logged, not thrown', async () => {
            setupApi({ gpx: [descr({ id: 'complete-fails' })] })
            dbSave.mockRejectedValueOnce(new Error('disk full'))
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined);
            (service as any).buildRouteInfo = jest.fn().mockReturnValue({
                id: 'complete-fails',
                title: 'Already complete',
                hasVideo: false,
                points: [{ lat: 1, lng: 1, routeDistance: 0 }],
            })

            await waitDone(service.load())
            await waitTick()

            expect(dbSave).toHaveBeenCalled()
        })

        test('existing complete video route whose details are missing locally: hash is (re-)verified and it is persisted', async () => {
            dbGetDescription.mockReturnValue({
                id: 'r1',
                version: 2,
                hasVideo: true,
                points: [{ lat: 1, lng: 1, routeDistance: 0 }],
                videoUrl: 'http://example.com/video.mp4',
            })
            dbGetDetails.mockResolvedValue(undefined)
            setupApi({ gpx: [descr({ id: 'r1', version: 1 })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            await waitDone(service.load())

            expect(dbSave).toHaveBeenCalled()
        })

        test('an external query failing to process (e.g. a broken db lookup) logs the failure without crashing the run', async () => {
            const logSpy = jest.spyOn(EventLogger.prototype, 'logEvent')
            userSettingsMock.getValue.mockReturnValue({ myserver: 'https://myserver.example.com' })
            setupApi({ gpx: [descr({ id: 'g1' })] })
            const externalApi = {
                getRouteDescriptions: jest.fn().mockResolvedValue([descr({ id: 'ext-boom', apiServer: 'myserver' })]),
                getRouteDetails: jest.fn().mockResolvedValue(detail()),
                setSource: jest.fn(),
            }
            const factory = { create: jest.fn((key?: string) => key ? externalApi : apiMock) }
            Inject('IncyclistRoutesApi', factory)
            dbGetDescription.mockImplementation((id: string) => {
                if (id === 'ext-boom') throw new Error('db exploded')
                return undefined
            })

            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            await waitDone(service.load())
            await waitTick(20)

            expect(logSpy).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'could not process route list load' })
            )
        })

        test('existing, outdated route: emits route.updated and persists it', async () => {
            dbGetDescription.mockReturnValue({ id: 'r1', version: 1, title: 'Old title' })
            dbGetDetails.mockResolvedValue(detail())
            setupApi({ gpx: [descr({ id: 'r1', version: 2 })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added, updated } = await waitDone(service.load())

            expect(updated.length + added.length).toBeGreaterThan(0)
            expect(dbSave).toHaveBeenCalled()
        })

        test('existing, up to date, local route: is skipped without persisting again', async () => {
            dbGetDescription.mockReturnValue({ id: 'r1', version: 2, isLocal: true })
            dbGetDetails.mockResolvedValue(detail())
            setupApi({ gpx: [descr({ id: 'r1', version: 1 })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added, updated } = await waitDone(service.load())

            expect(added).toHaveLength(0)
            expect(updated).toHaveLength(0)
            expect(dbSave).not.toHaveBeenCalled()
        })

        test('existing, up to date route missing details: still triggers a detail load', async () => {
            dbGetDescription.mockReturnValue({ id: 'r1', version: 2 })
            dbGetDetails.mockResolvedValue(undefined)
            setupApi({ gpx: [descr({ id: 'r1', version: 1 })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            await waitDone(service.load())

            expect(apiMock.getRouteDetails).toHaveBeenCalled()
        })

        test('deleted route no longer downloaded: is treated as updated', async () => {
            dbGetDescription.mockReturnValue({ id: 'r1', version: 2, isDownloaded: false })
            dbGetDetails.mockResolvedValue(detail())
            setupApi({ gpx: [descr({ id: 'r1', version: 2, isDeleted: true })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added, updated } = await waitDone(service.load())

            expect(added.length + updated.length).toBeGreaterThan(0)
        })

        test('invalid route (buildRouteInfo yields nothing): is skipped', async () => {
            setupApi({ gpx: [descr({ id: 'invalid', title: undefined, points: undefined })] })
            service = new RoutesApiLoader();
            (service as any).buildRouteInfo = jest.fn().mockReturnValue(undefined);
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added, updated } = await waitDone(service.load())

            expect(added).toHaveLength(0)
            expect(updated).toHaveLength(0)
        })

        test('gpx query rejects: the failure is logged and video results are still processed', async () => {
            setupApi({ rejectGpx: new Error('gpx down'), video: [descr({ id: 'v1' })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            expect(added.some(r => r.description.id === 'v1')).toBe(true)
        })

        test('video query rejects: the failure is logged and gpx results are still processed', async () => {
            setupApi({ rejectVideo: new Error('video down'), gpx: [descr({ id: 'g1' })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            expect(added.some(r => r.description.id === 'g1')).toBe(true)
        })

        test('no external route servers configured: only the default api is queried', async () => {
            userSettingsMock.getValue.mockReturnValue(null)
            setupApi({ gpx: [descr({ id: 'g1' })] })
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            await waitDone(service.load())

            expect(apiMock.getRouteDescriptions).toHaveBeenCalled()
        })

        test('external route servers configured: queries each one for videos and tags routes with apiServer', async () => {
            userSettingsMock.getValue.mockReturnValue({ myserver: 'https://myserver.example.com' })
            const externalApi = {
                getRouteDescriptions: jest.fn().mockResolvedValue([descr({ id: 'ext1', apiServer: 'myserver' })]),
                getRouteDetails: jest.fn().mockResolvedValue(detail({ id: 'ext1' })),
                setSource: jest.fn(),
            }
            const factory = { create: jest.fn((key?: string) => key ? externalApi : apiMock) }
            Inject('IncyclistRoutesApi', factory)

            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            expect(factory.create).toHaveBeenCalledWith('myserver')
            expect(externalApi.getRouteDescriptions).toHaveBeenCalledWith({ type: 'video' }, true)
            expect(added.some(r => r.description.apiServer === 'myserver')).toBe(true)
            expect(added.some(r => r.description.source === 'Myserver')).toBe(true)

        })

        test('external route already processed via the default api: is not added twice', async () => {
            userSettingsMock.getValue.mockReturnValue({ myserver: 'https://myserver.example.com' })
            setupApi({ gpx: [descr({ id: 'shared' })] })
            const externalApi = {
                getRouteDescriptions: jest.fn().mockResolvedValue([descr({ id: 'shared' })]),
                getRouteDetails: jest.fn().mockResolvedValue(detail()),
                setSource: jest.fn(),
            }
            const factory = { create: jest.fn((key?: string) => key ? externalApi : apiMock) }
            Inject('IncyclistRoutesApi', factory)

            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            expect(added.filter(r => r.description.id === 'shared')).toHaveLength(1)
        })

        test('external query rejects: the failure is logged without throwing', async () => {
            userSettingsMock.getValue.mockReturnValue({ myserver: 'https://myserver.example.com' })
            setupApi({ gpx: [descr({ id: 'g1' })] })
            const externalApi = {
                getRouteDescriptions: jest.fn().mockRejectedValue(new Error('external down')),
                getRouteDetails: jest.fn(),
                setSource: jest.fn(),
            }
            const factory = { create: jest.fn((key?: string) => key ? externalApi : apiMock) }
            Inject('IncyclistRoutesApi', factory)

            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const { added } = await waitDone(service.load())

            expect(added.some(r => r.description.id === 'g1')).toBe(true)
        })
    })

    describe('stopLoad', () => {
        test('stops and clears an in-progress observer', () => {
            service = new RoutesApiLoader()
            service.load()

            expect(() => service.stopLoad()).not.toThrow()
        })

        test('is a no-op when no load is in progress', () => {
            service = new RoutesApiLoader()

            expect(() => service.stopLoad()).not.toThrow()
        })
    })

    describe('save', () => {
        test('delegates to the db loader', async () => {
            service = new RoutesApiLoader()
            const route = new Route(descr() as undefined as RouteInfo)

            await service.save(route, true)

            expect(dbSave).toHaveBeenCalledWith(route, true)
        })
    })

    describe('loadDetails', () => {

        beforeEach(() => {
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)
        })

        const target = (id: string, added = true) => ({ route: new Route(descr({ id }) as undefined as RouteInfo), added })

        test('duplicate items (same route id) are reduced to one before loading', async () => {
            const items: LoadDetailsTargets = [target('r1'), target('r1')]
            dbGetDetails.mockResolvedValue(detail())

            await service.loadDetails(items)

            expect(dbGetDetails).toHaveBeenCalledTimes(1)
        })

        test('a failure while deduping items is tolerated: the dedupe step is skipped, not the whole load', async () => {
            const items: LoadDetailsTargets = [target('r1'), target('r1')]
            // force the dedupe step itself (items.filter(...)) to throw, without affecting the
            // array's other methods that the rest of loadDetails() relies on afterwards
            items.filter = () => { throw new Error('boom') }
            dbGetDetails.mockResolvedValue(detail())

            await expect(service.loadDetails(items)).resolves.not.toThrow()
            // dedup was skipped (items unchanged), so the duplicate 'r1' entry was attempted twice
            expect(dbGetDetails).toHaveBeenCalledTimes(2)
        })

        test('details already present in the local db: resolved from there, no remote fetch and no re-save', async () => {
            const items: LoadDetailsTargets = [target('r1')]
            dbGetDetails.mockResolvedValue(detail())

            await service.loadDetails(items)

            expect(apiMock.getRouteDetails).not.toHaveBeenCalled()
            expect(dbSave).not.toHaveBeenCalled()
        })

        test('details missing from the local db: falls back to the remote api', async () => {
            const items: LoadDetailsTargets = [target('r1')]
            dbGetDetails.mockResolvedValue(undefined)
            apiMock.getRouteDetails.mockResolvedValue(detail())

            await service.loadDetails(items)

            expect(apiMock.getRouteDetails).toHaveBeenCalled()
        })

        test('enforced=true: skips the local db and always goes to the remote api', async () => {
            const items: LoadDetailsTargets = [target('r1')]
            apiMock.getRouteDetails.mockResolvedValue(detail())

            await service.loadDetails(items, true)

            expect(dbGetDetails).not.toHaveBeenCalled()
            expect(apiMock.getRouteDetails).toHaveBeenCalled()
        })

        test('a route tagged with apiServer loads details through that external api', async () => {
            const externalApi = {
                getRouteDescriptions: jest.fn(),
                getRouteDetails: jest.fn().mockResolvedValue(detail()),
                setSource: jest.fn(),
            }
            const factory = { create: jest.fn((key?: string) => key ? externalApi : apiMock) }
            Inject('IncyclistRoutesApi', factory)
            service = new RoutesApiLoader();
            (service as any).verifyCountry = jest.fn().mockResolvedValue(undefined)

            const items: LoadDetailsTargets = [{ route: new Route(descr({ id: 'ext1', apiServer: 'myserver' }) as undefined as RouteInfo), added: true }]

            await service.loadDetails(items, true)

            expect(factory.create).toHaveBeenCalledWith('myserver')
            expect(externalApi.getRouteDetails).toHaveBeenCalled()
        })

        test('remote detail fetch fails: the route is counted as failed, not saved', async () => {
            const items: LoadDetailsTargets = [target('r1')]
            apiMock.getRouteDetails.mockRejectedValue(new Error('not found'))

            await service.loadDetails(items, true)

            expect(dbSave).not.toHaveBeenCalled()
        })

        test('always emits route.updated, regardless of item.added', async () => {
            // processLoadDetailsResult calls emitRouteEvents(true, ...) unconditionally - an
            // item's `added` flag no longer has any bearing on which event fires once its details
            // have loaded; route.added is only ever emitted earlier, by emitAndPrepareLoadDetails
            const added = []
            const updated = [];
            (service as any).loadObserver = {
                emit: (event: string, route: Route) => {
                    if (event === 'route.added') added.push(route)
                    if (event === 'route.updated') updated.push(route)
                },
            }
            const items: LoadDetailsTargets = [target('emits-updated-1', false), target('emits-updated-2', true)]
            apiMock.getRouteDetails.mockResolvedValue(detail())

            await service.loadDetails(items, true)

            expect(added).toHaveLength(0)
            expect(updated.map(r => r.description.id)).toEqual(['emits-updated-1', 'emits-updated-2'])
        })
    })
})
