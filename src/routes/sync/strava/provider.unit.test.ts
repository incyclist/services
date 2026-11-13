import { readFileSync } from 'fs'
import { join } from 'path'
import { Inject } from '../../../base/decorators'
import { StravaSyncProvider } from './provider'
import { UserSettingsService } from '../../../settings'
import { Route } from '../../base/model/route'
import { StravaRoute } from '../../../apps/base/api/strava/types'

const gpxContent = readFileSync(join(__dirname, '../../../../__tests__/data/routes/Etzelbergrennen.gpx'), 'utf-8')

const stravaRoute = (id: number, name: string): StravaRoute => ({
    id,
    id_str: `${id}`,
    name,
    distance: 12345,
    elevation_gain: 210,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
} as StravaRoute)

describe('Strava Route Sync Provider', () => {

    let syncProvider: StravaSyncProvider
    const userSettingsSet = jest.fn()
    const getIsoFromLatLng = jest.fn().mockResolvedValue('DE')

    const UserSettingsMock = (data?: Record<string, unknown>): Partial<UserSettingsService> => ({
        isInitialized: true,
        get: jest.fn((key, defValue) => data?.[key] ?? defValue),
        set: userSettingsSet
    })

    const setupMocks = (sp: StravaSyncProvider, mocks: { api?: any, connection?: any }, props: { enabled?: boolean, routes?: Array<unknown> } = {}) => {
        Inject('Countries', { getIsoFromLatLng })
        Inject('UserSettings', UserSettingsMock())
        Inject('AppsService', {
            isEnabled: jest.fn().mockReturnValue(props.enabled ?? true)
        })
        Inject('RouteListService', {
            getAllAppRoutes: jest.fn().mockReturnValue(props.routes ?? [])
        })

        if (mocks.api) sp.getApi = jest.fn().mockReturnValue(mocks.api)
        if (mocks.connection) sp.getConnection = jest.fn().mockReturnValue(mocks.connection)
    }

    const connectionMock = {
        isConnected: jest.fn().mockReturnValue(true),
        getAppKey: jest.fn().mockReturnValue('strava')
    }

    const cleanupMocks = () => {
        Inject('Countries', null)
        Inject('UserSettings', null)
        Inject('AppsService', null)
        Inject('RouteListService', null)
        jest.clearAllMocks()
    }

    describe('loadDetails', () => {

        beforeEach(() => {
            syncProvider = new StravaSyncProvider()
        })

        afterEach(() => {
            cleanupMocks()
        })

        test('adds GPX details to the route', async () => {
            const getRouteAsGPX = jest.fn().mockResolvedValue(gpxContent)
            setupMocks(syncProvider, {
                api: { getRouteAsGPX },
                connection: connectionMock
            })

            const route = new Route({ id: 'strava:123', title: 'test', hasGpx: true })

            const res = await syncProvider.loadDetails(route)

            expect(getRouteAsGPX).toHaveBeenCalledWith('123')
            expect(res.details.points.length).toBeGreaterThan(0)
            expect(res.description.points).toBe(res.details.points)
            expect(res.description.distance).toBeGreaterThan(0)
            expect(res.description.elevation).toBeGreaterThanOrEqual(0)
            expect(typeof res.description.isLoop).toBe('boolean')
        })

        test('does not call the API for routes from another app', async () => {
            const getRouteAsGPX = jest.fn()
            setupMocks(syncProvider, {
                api: { getRouteAsGPX },
                connection: connectionMock
            })

            const route = new Route({ id: 'komoot:123', title: 'test', hasGpx: true })

            const res = await syncProvider.loadDetails(route)

            expect(res).toBeUndefined()
            expect(getRouteAsGPX).not.toHaveBeenCalled()
        })

        test('returns undefined when the API returns an error', async () => {
            const getRouteAsGPX = jest.fn().mockResolvedValue({ props: { id: '123' }, error: 'getRouteAsGPX failed' })
            setupMocks(syncProvider, {
                api: { getRouteAsGPX },
                connection: connectionMock
            })

            const route = new Route({ id: 'strava:123', title: 'test', hasGpx: true })

            const res = await syncProvider.loadDetails(route)

            expect(res).toBeUndefined()
            expect(route.details?.points).toBeUndefined()
        })
    })

    describe('sync', () => {

        beforeEach(() => {
            syncProvider = new StravaSyncProvider()
        })

        afterEach(() => {
            cleanupMocks()
        })

        test('reports the athlete routes as added', async () => {
            const getLoggedInAthleteRoutes = jest.fn()
                .mockResolvedValueOnce([stravaRoute(1, 'First'), stravaRoute(2, 'Second')])
                .mockResolvedValueOnce([])
            setupMocks(syncProvider, {
                api: { getLoggedInAthleteRoutes },
                connection: connectionMock
            })

            const res = await new Promise(done => {
                const added: Array<any> = []
                const observer = syncProvider.sync()
                observer.on('added', routes => added.push(...routes))
                observer.on('done', () => done(added))
            }) as Array<any>

            expect(getLoggedInAthleteRoutes).toHaveBeenCalledWith({ page: 1, per_page: 50 }, { sport: 'ride' })
            expect(res).toHaveLength(2)
            expect(res[0]).toMatchObject({
                id: 'strava:1',
                title: 'First',
                distance: 12345,
                elevation: 210,
                category: 'external',
                source: 'strava',
                hasGpx: true,
                hasVideo: false
            })
            expect(userSettingsSet).toHaveBeenCalledWith('apps.strava.lastSync', expect.any(Number))
        })

        test('does not sync when the app is disabled', async () => {
            const getLoggedInAthleteRoutes = jest.fn()
            setupMocks(syncProvider, {
                api: { getLoggedInAthleteRoutes },
                connection: connectionMock
            }, { enabled: false })

            const res = await new Promise(done => {
                const added: Array<any> = []
                const observer = syncProvider.sync()
                observer.on('added', routes => added.push(...routes))
                observer.on('done', () => done(added))
            }) as Array<any>

            expect(res).toHaveLength(0)
            expect(getLoggedInAthleteRoutes).not.toHaveBeenCalled()
            expect(userSettingsSet).not.toHaveBeenCalledWith('apps.strava.lastSync', expect.any(Number))
        })
    })
})
