import { RideWithGpsApi } from './api'
import { RideWithGpsConfig, RideWithGpsTimeDataMissingError } from './types'

jest.mock('../../../../utils/sleep', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }))

describe('RideWithGPS API', () => {
    let api
    let restClient
    let formBinding
    let settings

    const API = 'https://ridewithgps.com'
    const config: RideWithGpsConfig = { id: '42', accessToken: 'token' }

    const pending = { id: 7, type: 'gps_file_upload', status: 'pending', items: [], errors: [] }
    const completed = (items = [{ item_type: 'trip', item_id: 123, item_url: API + '/api/v1/trips/123.json' }], errors = []) =>
        ({ ...pending, status: 'completed', items, errors })

    beforeEach(() => {
        api = new RideWithGpsApi()
        restClient = { request: jest.fn() }
        formBinding = {
            createForm: jest.fn(async (opts, info) => ({ ...opts, info })),
            post: jest.fn().mockResolvedValue({ data: { task: pending }, statusCode: 202 })
        }
        settings = { isInitialized: true, get: jest.fn((_key: string, def: unknown) => def) }

        api.getApi = jest.fn(() => restClient)
        api.getUserSettings = jest.fn(() => settings)
        api.getFormBinding = jest.fn(() => formBinding)
        api.init({ ...config })
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe('getUserId', () => {
        test('id of the credentials', () => {
            expect(api.getUserId()).toBe('42')
        })

        test('unknown', () => {
            api.init({ accessToken: 'token' })
            expect(api.getUserId()).toBeUndefined()
        })
    })

    describe('requests', () => {
        test('Bearer token, no refresh without expiration', async () => {
            restClient.request.mockResolvedValue({ data: { routes: [], meta: { pagination: { record_count: 0, page_count: 0, page_size: 20 } } } })

            await api.getRoutes()

            expect(restClient.request).toHaveBeenCalledTimes(1)
            expect(restClient.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'get', url: API + '/api/v1/routes.json', headers: { Authorization: 'Bearer token' }
            }))
        })

        test('null refresh token and expiration (as passed by the mobile app): no refresh, no invalid date', async () => {
            api.init({ id: '42', accessToken: 'token', refreshToken: null, expiration: null })
            restClient.request.mockResolvedValue({ data: { routes: [] } })

            await api.getRoutes()

            expect(restClient.request).toHaveBeenCalledTimes(1)
            expect(restClient.request.mock.calls[0][0].url).toBe(API + '/api/v1/routes.json')
        })

        test('API url from the user settings', async () => {
            settings.get = jest.fn((key: string, def: unknown) => key === 'RWGPS_API' ? 'https://sandbox.test' : def)
            restClient.request.mockResolvedValue({ data: { routes: [] } })

            await api.getRoutes()

            expect(restClient.request.mock.calls[0][0].url).toBe('https://sandbox.test/api/v1/routes.json')
        })

        test('a revoked token emits auth.failed', async () => {
            const onFailed = jest.fn()
            api.init({ ...config }).on('auth.failed', onFailed)
            restClient.request.mockRejectedValue({ response: { status: 401, data: { errors: ['Unauthorized'] } } })

            await expect(api.getRoutes()).rejects.toBeDefined()

            expect(onFailed).toHaveBeenCalledTimes(1)
        })
    })

    describe('getRoutes', () => {
        test('maps the query and returns routes and pagination', async () => {
            const route = { id: 123, user_id: 42, name: 'Forest Park loop', distance: 40237, elevation_gain: 457, archived: false, updated_at: '2000-01-01T08:00:00-08:00' }
            const pagination = { record_count: 45, page_count: 3, page_size: 20, next_page_url: 'https://ridewithgps.com/api/v1/routes.json?page=2' }
            restClient.request.mockResolvedValue({ data: { routes: [route], meta: { pagination } } })

            const res = await api.getRoutes({ page: 2, pageSize: 100, archived: false })

            expect(restClient.request.mock.calls[0][0].params).toEqual({ page: 2, page_size: 100, archived: 'false' })
            expect(res).toEqual({ routes: [route], pagination })
        })

        test('unexpected response', async () => {
            restClient.request.mockResolvedValue({ data: {} })
            await expect(api.getRoutes()).rejects.toThrow('expected a list of routes')
        })
    })

    describe('getRoute', () => {
        test('returns the route', async () => {
            restClient.request.mockResolvedValue({ data: { route: { id: 123, name: 'x', track_points: [{ x: 1, y: 2, d: 0, e: 10 }] } } })

            const res = await api.getRoute(123)

            expect(restClient.request.mock.calls[0][0].url).toBe(API + '/api/v1/routes/123.json')
            expect(res.track_points).toHaveLength(1)
        })

        test('route missing', async () => {
            restClient.request.mockResolvedValue({ data: {} })
            await expect(api.getRoute(123)).rejects.toThrow('route is missing')
        })
    })

    describe('getRouteAsGPX', () => {
        test('requests the file as text', async () => {
            restClient.request.mockResolvedValue({ data: '<gpx/>' })

            const res = await api.getRouteAsGPX('123')

            expect(res).toBe('<gpx/>')
            expect(restClient.request).toHaveBeenCalledWith(expect.objectContaining({ url: API + '/api/v1/routes/123.gpx', responseType: 'text' }))
        })

        test('no content', async () => {
            restClient.request.mockResolvedValue({ data: '' })
            await expect(api.getRouteAsGPX('123')).rejects.toThrow('no GPX content')
        })
    })

    describe('uploadActivity', () => {
        test('posts the file, polls the task and sets the activity type', async () => {
            restClient.request
                .mockResolvedValueOnce({ data: { task: completed() } })
                .mockResolvedValueOnce({ data: { trip: { id: 123 } } })

            const res = await api.uploadActivity({ fileName: '/data/ride.tcx', name: 'Morning Ride', activityType: 'cycling:virtual' })

            expect(res).toEqual({ tripId: '123' })
            expect(formBinding.createForm).toHaveBeenCalledWith(
                { url: API + '/api/v1/trips.json', headers: { Authorization: 'Bearer token' } },
                { file: { type: 'file', fileName: '/data/ride.tcx' }, name: 'Morning Ride' }
            )
            expect(restClient.request.mock.calls[0][0]).toMatchObject({ method: 'get', url: API + '/api/v1/tasks/7.json' })
            expect(restClient.request.mock.calls[1][0]).toMatchObject({
                method: 'put', url: API + '/api/v1/trips/123.json', data: { trip: { activity_type: 'cycling:virtual' } }
            })
        })

        test('task already completed: no polling', async () => {
            formBinding.post.mockResolvedValue({ data: { task: completed() } })

            const res = await api.uploadActivity({ fileName: '/data/ride.tcx' })

            expect(res).toEqual({ tripId: '123' })
            expect(restClient.request).not.toHaveBeenCalled()
        })

        test('name and description are only sent if set', async () => {
            formBinding.post.mockResolvedValue({ data: { task: completed() } })

            await api.uploadActivity({ fileName: '/data/ride.tcx', name: '', description: 'desc' })

            expect(formBinding.createForm.mock.calls[0][1]).toEqual({ file: { type: 'file', fileName: '/data/ride.tcx' }, description: 'desc' })
        })

        test('a failing activity type update does not fail the upload', async () => {
            formBinding.post.mockResolvedValue({ data: { task: completed() } })
            restClient.request.mockRejectedValue({ response: { status: 422 }, message: 'invalid' })

            const res = await api.uploadActivity({ fileName: '/data/ride.tcx', activityType: 'cycling:indoor' })

            expect(res).toEqual({ tripId: '123' })
        })

        test('duplicate: reported with the existing trip, activity type is not touched', async () => {
            formBinding.post.mockResolvedValue({ data: { task: completed([], [{ code: 'duplicate', message: 'exists', item_type: 'trip', item_id: 55 }]) } })

            const res = await api.uploadActivity({ fileName: '/data/ride.tcx', activityType: 'cycling:virtual' })

            expect(res).toEqual({ tripId: '55', duplicate: true })
            expect(restClient.request).not.toHaveBeenCalled()
        })

        test('time data missing', async () => {
            formBinding.post.mockResolvedValue({ data: { task: completed([], [{ code: 'time_data_missing', message: 'no times' }]) } })

            await expect(api.uploadActivity({ fileName: '/data/route.gpx' })).rejects.toBeInstanceOf(RideWithGpsTimeDataMissingError)
        })

        test('the task does not complete in time', async () => {
            restClient.request.mockResolvedValue({ data: { task: pending } })

            await expect(api.uploadActivity({ fileName: '/data/ride.tcx' })).rejects.toThrow('did not finish processing')
            expect(restClient.request).toHaveBeenCalledTimes(60)
        })

        test('rejected upload: HTTP status and body', async () => {
            formBinding.post.mockRejectedValue({ response: { status: 422, data: { errors: ['Empty file'] } } })

            await expect(api.uploadActivity({ fileName: '/data/ride.tcx' })).rejects.toThrow('Upload rejected by RideWithGPS (HTTP 422): {"errors":["Empty file"]}')
        })

        test('revoked token during the upload emits auth.failed', async () => {
            const onFailed = jest.fn()
            api.init({ ...config }).on('auth.failed', onFailed)
            formBinding.post.mockRejectedValue({ response: { status: 401, data: { errors: ['Unauthorized'] } } })

            await expect(api.uploadActivity({ fileName: '/data/ride.tcx' })).rejects.toThrow('HTTP 401')
            expect(onFailed).toHaveBeenCalledTimes(1)
        })

        test('response without task', async () => {
            formBinding.post.mockResolvedValue({ data: {} })
            await expect(api.uploadActivity({ fileName: '/data/ride.tcx' })).rejects.toThrow('task is missing')
        })

        test('throws if not authenticated', async () => {
            api.init(undefined)
            await expect(api.uploadActivity({ fileName: '/data/ride.tcx' })).rejects.toThrow('not authenticated')
            expect(formBinding.post).not.toHaveBeenCalled()
        })
    })
})
