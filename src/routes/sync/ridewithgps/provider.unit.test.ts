import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Inject } from '../../../base/decorators'
import { RideWithGpsRoute } from '../../../apps/base/api/ridewithgps/types'
import { Route } from '../../base/model/route'
import { RideWithGpsSyncProvider } from './provider'

jest.mock('../../../utils/sleep', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }))

const gpxContent = readFileSync(join(__dirname, '../../../../__tests__/data/routes/Etzelbergrennen.gpx'), 'utf-8')

const rwgpsRoute = (id: number, name: string, props: Partial<RideWithGpsRoute> = {}): RideWithGpsRoute => ({
    id,
    user_id: 42,
    name,
    distance: 40237,
    elevation_gain: 457,
    archived: false,
    country_code: 'US',
    created_at: '2026-01-01T10:00:00-08:00',
    updated_at: '2026-02-01T10:00:00-08:00',
    ...props
})

describe('RideWithGPS Route Sync Provider', () => {

    let syncProvider: RideWithGpsSyncProvider
    const userSettingsSet = jest.fn()

    const connectionMock = {
        isConnected: jest.fn().mockReturnValue(true),
        getAppKey: jest.fn().mockReturnValue('ridewithgps')
    }

    const setupMocks = (api: object, props: { enabled?: boolean, routes?: Array<unknown> } = {}) => {
        Inject('Countries', { getIsoFromLatLng: jest.fn().mockResolvedValue('DE') })
        Inject('UserSettings', { isInitialized: true, get: jest.fn((_key, defValue) => defValue), set: userSettingsSet })
        Inject('AppsService', { isEnabled: jest.fn().mockReturnValue(props.enabled ?? true) })
        Inject('RouteListService', { getAllAppRoutes: jest.fn().mockReturnValue(props.routes ?? []) })

        syncProvider['getApi'] = jest.fn().mockReturnValue({ getCollections: jest.fn().mockResolvedValue([]), ...api })
        syncProvider['getConnection'] = jest.fn().mockReturnValue(connectionMock) as never
    }

    const runSync = () => new Promise<{ added: Array<any>, updated: Array<any>, deleted: Array<string> }>(done => {
        const result = { added: [], updated: [], deleted: [] } as { added: Array<any>, updated: Array<any>, deleted: Array<string> }
        const observer = syncProvider.sync()
        observer.on('added', routes => result.added.push(...routes))
        observer.on('updated', routes => result.updated.push(...routes))
        observer.on('deleted', ids => result.deleted.push(...ids))
        observer.on('done', () => done(result))
    })

    beforeEach(() => {
        syncProvider = new RideWithGpsSyncProvider()
    })

    afterEach(() => {
        Inject('Countries', null)
        Inject('UserSettings', null)
        Inject('AppsService', null)
        Inject('RouteListService', null)
        jest.clearAllMocks()
    })

    describe('loadDetails', () => {
        test('adds the track of the GPX file to the route', async () => {
            const getRouteAsGPX = jest.fn().mockResolvedValue(gpxContent)
            setupMocks({ getRouteAsGPX })

            const res = await syncProvider.loadDetails(new Route({ id: 'ridewithgps:123', title: 'test', hasGpx: true }))

            expect(getRouteAsGPX).toHaveBeenCalledWith('123')
            expect(res.details.points.length).toBeGreaterThan(0)
            expect(res.description.distance).toBeGreaterThan(0)
            expect(typeof res.description.isLoop).toBe('boolean')
        })

        test('routes of other apps are not loaded', async () => {
            const getRouteAsGPX = jest.fn()
            setupMocks({ getRouteAsGPX })

            const res = await syncProvider.loadDetails(new Route({ id: 'strava:123', title: 'test', hasGpx: true }))

            expect(res).toBeUndefined()
            expect(getRouteAsGPX).not.toHaveBeenCalled()
        })

        test('download failure: returns undefined', async () => {
            setupMocks({ getRouteAsGPX: jest.fn().mockRejectedValue(new Error('HTTP 403')) })

            const res = await syncProvider.loadDetails(new Route({ id: 'ridewithgps:123', title: 'test', hasGpx: true }))

            expect(res).toBeUndefined()
        })
    })

    describe('sync', () => {
        test('reports the relevant routes as added and reads all pages', async () => {
            const getRoutes = jest.fn()
                .mockResolvedValueOnce({
                    routes: [rwgpsRoute(1, 'Road'), rwgpsRoute(2, 'Run')],
                    pagination: { record_count: 4, page_count: 2, page_size: 100, next_page_url: 'https://ridewithgps.com/api/v1/routes.json?page=2' }
                })
                .mockResolvedValueOnce({
                    routes: [rwgpsRoute(3, 'Archived', { archived: true }), rwgpsRoute(4, 'Gravel', { unpaved_pct: 90 })],
                    pagination: { record_count: 4, page_count: 2, page_size: 100, next_page_url: null }
                })
            const types: Record<number, Array<string> | undefined> = { 1: ['cycling:road'], 2: ['running:generic'], 4: undefined }
            const getRoute = jest.fn(async (id: number) => rwgpsRoute(id, 'x', { activity_types: types[id], unpaved_pct: id === 4 ? 90 : 0 }))
            setupMocks({ getRoutes, getRoute })

            const res = await runSync()

            expect(getRoutes).toHaveBeenCalledTimes(2)
            expect(getRoutes).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 100, archived: false })
            expect(getRoutes).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100, archived: false })
            // archived routes are not checked, the sport is only known from the detail (no types: mostly unpaved is not relevant)
            expect(getRoute).toHaveBeenCalledTimes(3)
            expect(res.added).toHaveLength(1)
            expect(res.added[0]).toMatchObject({
                id: 'ridewithgps:1', title: 'Road', distance: 40237, elevation: 457,
                category: 'external', source: 'ridewithgps', hasGpx: true, hasVideo: false
            })
            expect(userSettingsSet).toHaveBeenCalledWith('apps.ridewithgps.lastSync', expect.any(Number))
        })

        // regression: the owner of the routes of the list was compared with the user id of the credentials, a mismatch hid all routes
        test('own routes are synced, no matter which user id is stored in the credentials', async () => {
            const getRoute = jest.fn(async (id: number) => rwgpsRoute(id, 'x', { activity_types: ['cycling:road'] }))
            setupMocks({ getRoutes: jest.fn().mockResolvedValue({ routes: [rwgpsRoute(1, 'Road', { user_id: 99 })] }), getRoute })

            const res = await runSync()

            expect(res.added.map(r => r.id)).toEqual(['ridewithgps:1'])
        })

        test('the activity types win over the surface: a pinned route that is half unpaved but marked as road is synced', async () => {
            const getRoutes = jest.fn().mockResolvedValue({ routes: [] })
            const pinned = rwgpsRoute(9, 'Pinned', { user_id: 7, archived: null, unpaved_pct: 50 })
            const getRoute = jest.fn().mockResolvedValue({ ...pinned, activity_types: ['cycling:road'] })
            setupMocks({
                getRoutes, getRoute,
                getCollections: jest.fn().mockResolvedValue([{ id: 1, name: 'pinned' }]),
                getCollection: jest.fn().mockResolvedValue({ id: 1, name: 'pinned', routes: [pinned] })
            })

            const res = await runSync()

            expect(res.added.map(r => r.id)).toEqual(['ridewithgps:9'])
        })

        test('known routes: reports changed ones as updated and missing ones as deleted', async () => {
            const known = [
                { id: 'ridewithgps:1', tsLastChange: new Date('2026-02-01T10:00:00-08:00').valueOf() },
                { id: 'ridewithgps:2', tsLastChange: new Date('2026-01-01T10:00:00-08:00').valueOf() },
                { id: 'ridewithgps:3', tsLastChange: 1 },
            ]
            const getRoutes = jest.fn().mockResolvedValue({
                routes: [rwgpsRoute(1, 'Unchanged'), rwgpsRoute(2, 'Changed')],
                pagination: { record_count: 2, page_count: 1, page_size: 100, next_page_url: null }
            })
            const getRoute = jest.fn().mockResolvedValue(rwgpsRoute(2, 'Changed', { activity_types: ['cycling:generic'] }))
            setupMocks({ getRoutes, getRoute }, { routes: known })

            const res = await runSync()

            // the unchanged route is not checked again
            expect(getRoute).toHaveBeenCalledTimes(1)
            expect(getRoute).toHaveBeenCalledWith(2)
            expect(res.added).toHaveLength(0)
            expect(res.updated.map(r => r.description.id)).toEqual(['ridewithgps:2'])
            expect(res.deleted).toEqual(['ridewithgps:3'])
        })

        describe('pinned routes and bucket list', () => {
            const own = rwgpsRoute(1, 'Own')
            const foreign = (id: number, props: Partial<RideWithGpsRoute> = {}) => rwgpsRoute(id, 'Foreign', { user_id: 7, archived: null, ...props })
            const collections = [{ id: 10, name: 'pinned' }, { id: 11, name: '{{bucket_list}}' }, { id: 12, name: 'Favorites' }]

            const setup = (collection: jest.Mock, props: { known?: Array<unknown> } = {}) => {
                const getRoute = jest.fn(async (id: number) => rwgpsRoute(id, 'x', { activity_types: ['cycling:road'] }))
                setupMocks({
                    getRoutes: jest.fn().mockResolvedValue({ routes: [own] }),
                    getCollections: jest.fn().mockResolvedValue(collections),
                    getCollection: collection,
                    getRoute
                }, { routes: props.known })
                return getRoute
            }

            test('routes of other users are synced, other collections are ignored, duplicates only once', async () => {
                const getCollection = jest.fn(async (id: number) => ({
                    id,
                    name: 'x',
                    routes: id === 10 ? [foreign(2), rwgpsRoute(1, 'Own')] : [foreign(3), foreign(2), foreign(4, { archived: true })]
                }))
                setup(getCollection)

                const res = await runSync()

                expect(getCollection.mock.calls.map(c => c[0])).toEqual([10, 11])
                expect(res.added.map(r => r.id)).toEqual(['ridewithgps:1', 'ridewithgps:2', 'ridewithgps:3'])
            })

            test('routes that left the collection are reported as deleted', async () => {
                setup(jest.fn().mockResolvedValue({ id: 10, name: 'pinned', routes: [] }), { known: [{ id: 'ridewithgps:1', tsLastChange: new Date(own.updated_at as string).valueOf() }, { id: 'ridewithgps:5', tsLastChange: 1 }] })

                const res = await runSync()

                expect(res.deleted).toEqual(['ridewithgps:5'])
            })

            test('a collection that can not be loaded: the run is incomplete, nothing is reported (no deletions)', async () => {
                const getCollection = jest.fn()
                    .mockRejectedValueOnce(new Error('HTTP 500'))
                    .mockResolvedValueOnce({ id: 11, name: 'x', routes: [foreign(3)] })
                setup(getCollection, { known: [{ id: 'ridewithgps:5', tsLastChange: 1 }] })
                const onChange = jest.fn()
                const observer = syncProvider.sync()
                observer.on('added', onChange)
                observer.on('deleted', onChange)
                const done = new Promise<void>(resolve => observer.once('done', () => resolve()))

                await done

                expect(getCollection).toHaveBeenCalledTimes(2)
                expect(onChange).not.toHaveBeenCalled()
                expect(userSettingsSet).not.toHaveBeenCalled()
            })

            test('the collections can not be loaded: the run is incomplete', async () => {
                const onChange = jest.fn()
                setupMocks({ getRoutes: jest.fn().mockResolvedValue({ routes: [own] }), getCollections: jest.fn().mockRejectedValue(new Error('HTTP 500')) })
                const observer = syncProvider.sync()
                observer.on('added', onChange)
                await new Promise<void>(resolve => observer.once('done', () => resolve()))

                expect(onChange).not.toHaveBeenCalled()
            })
        })

        describe('sport check', () => {
            const page = (routes: Array<RideWithGpsRoute>) => ({ routes, pagination: { record_count: routes.length, page_count: 1, page_size: 100, next_page_url: null } })

            test('only routes with road cycling types are added', async () => {
                const getRoutes = jest.fn().mockResolvedValue(page([rwgpsRoute(1, 'Road'), rwgpsRoute(2, 'Run'), rwgpsRoute(3, 'Gravel'), rwgpsRoute(4, 'Unknown'), rwgpsRoute(5, 'Mixed')]))
                const types: Record<number, Array<string> | undefined> = {
                    1: ['cycling:road'], 2: ['running:generic'], 3: ['cycling:gravel', 'cycling:mountain'], 4: undefined, 5: ['cycling:gravel', 'cycling:commute']
                }
                const getRoute = jest.fn(async (id: number) => rwgpsRoute(id, 'x', { activity_types: types[id] }))
                setupMocks({ getRoutes, getRoute })

                const res = await runSync()

                expect(res.added.map(r => r.id)).toEqual(['ridewithgps:1', 'ridewithgps:4', 'ridewithgps:5'])
            })

            test('excluded routes are not requested again until they change', async () => {
                const getRoute = jest.fn().mockResolvedValue(rwgpsRoute(2, 'Run', { activity_types: ['running:generic'] }))
                const getRoutes = jest.fn().mockResolvedValue(page([rwgpsRoute(2, 'Run')]))
                setupMocks({ getRoutes, getRoute })

                await runSync()
                await new Promise(resolve => setTimeout(resolve, 10))
                const second = await runSync()

                expect(getRoute).toHaveBeenCalledTimes(1)
                expect(second.added).toHaveLength(0)

                getRoutes.mockResolvedValue(page([rwgpsRoute(2, 'Run', { updated_at: '2026-03-01T10:00:00-08:00' })]))
                await new Promise(resolve => setTimeout(resolve, 10))
                await runSync()

                expect(getRoute).toHaveBeenCalledTimes(2)
            })

            test('reset forgets the excluded routes', async () => {
                const getRoute = jest.fn().mockResolvedValue(rwgpsRoute(2, 'Run', { activity_types: ['walking:hiking'] }))
                setupMocks({ getRoutes: jest.fn().mockResolvedValue(page([rwgpsRoute(2, 'Run')])), getRoute })

                await runSync()
                syncProvider.reset()
                await new Promise(resolve => setTimeout(resolve, 10))
                await runSync()

                expect(getRoute).toHaveBeenCalledTimes(2)
            })

            test('a failing detail request does not abort the sync: the route is included', async () => {
                const getRoute = jest.fn()
                    .mockRejectedValueOnce(new Error('HTTP 500'))
                    .mockResolvedValueOnce(rwgpsRoute(2, 'Run', { activity_types: ['cycling:road'] }))
                setupMocks({ getRoutes: jest.fn().mockResolvedValue(page([rwgpsRoute(1, 'A'), rwgpsRoute(2, 'B')])), getRoute })

                const res = await runSync()

                expect(res.added.map(r => r.id)).toEqual(['ridewithgps:1', 'ridewithgps:2'])
            })
        })

        test('loading the routes fails: the sync ends without reporting anything', async () => {
            const getRoutes = jest.fn().mockRejectedValue(new Error('not authenticated'))
            setupMocks({ getRoutes }, { routes: [{ id: 'ridewithgps:3', tsLastChange: 1 }] })

            const res = await runSync()

            expect(getRoutes).toHaveBeenCalledTimes(1)
            expect(res).toEqual({ added: [], updated: [], deleted: [] })
            expect(userSettingsSet).not.toHaveBeenCalled()
        })

        test('disabled operation: no request', async () => {
            const getRoutes = jest.fn()
            setupMocks({ getRoutes }, { enabled: false })

            const res = await runSync()

            expect(res.added).toHaveLength(0)
            expect(getRoutes).not.toHaveBeenCalled()
        })
    })
})
