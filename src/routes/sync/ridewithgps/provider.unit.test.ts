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

        syncProvider['getApi'] = jest.fn().mockReturnValue({ getUserId: () => '42', ...api })
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
                    routes: [rwgpsRoute(1, 'Road'), rwgpsRoute(2, 'Run', { activity_types: ['running:generic'] })],
                    pagination: { record_count: 4, page_count: 2, page_size: 100, next_page_url: 'https://ridewithgps.com/api/v1/routes.json?page=2' }
                })
                .mockResolvedValueOnce({
                    routes: [rwgpsRoute(3, 'Archived', { archived: true }), rwgpsRoute(4, 'Gravel', { unpaved_pct: 90 })],
                    pagination: { record_count: 4, page_count: 2, page_size: 100, next_page_url: null }
                })
            const getRoute = jest.fn().mockResolvedValue(rwgpsRoute(1, 'Road', { activity_types: ['cycling:road'] }))
            setupMocks({ getRoutes, getRoute })

            const res = await runSync()

            expect(getRoute).toHaveBeenCalledTimes(1)
            expect(getRoutes).toHaveBeenCalledTimes(2)
            expect(getRoutes).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 100, archived: false })
            expect(getRoutes).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100, archived: false })
            expect(res.added).toHaveLength(1)
            expect(res.added[0]).toMatchObject({
                id: 'ridewithgps:1', title: 'Road', distance: 40237, elevation: 457,
                category: 'external', source: 'ridewithgps', hasGpx: true, hasVideo: false
            })
            expect(userSettingsSet).toHaveBeenCalledWith('apps.ridewithgps.lastSync', expect.any(Number))
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

        test('loading the routes fails: nothing is reported', async () => {
            const getRoutes = jest.fn().mockRejectedValue(new Error('not authenticated'))
            setupMocks({ getRoutes }, { routes: [{ id: 'ridewithgps:3', tsLastChange: 1 }] })
            const onChange = jest.fn()

            const observer = syncProvider.sync()
            observer.on('added', onChange)
            observer.on('updated', onChange)
            observer.on('deleted', onChange)
            await new Promise(resolve => setTimeout(resolve, 20))

            expect(getRoutes).toHaveBeenCalledTimes(1)
            expect(onChange).not.toHaveBeenCalled()
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
