import { EventLogger } from 'gd-eventlog'
import { Inject } from '../../../base/decorators'
import IncyclistRoutesApi from './api'

const internalGet = jest.fn()
const externalGet = jest.fn()

jest.mock('../../../api', () => ({
    IncyclistRestApiClient: {
        getClient: jest.fn(() => ({ get: internalGet })),
    },
}))

jest.mock('../../../api/rest/external', () => ({
    IncyclistExternalRestApiClient: {
        getClient: jest.fn(() => ({ get: externalGet })),
    },
}))

const DEFAULT_BASE_URL = 'https://dlws.incyclist.com/api/v1/routes'

describe('IncyclistRoutesApi', () => {
    let api: IncyclistRoutesApi
    let userSettingsMock

    beforeEach(() => {
        userSettingsMock = {
            getValue: jest.fn().mockImplementation((_key, defValue) => defValue),
        }
        Inject('UserSettings', userSettingsMock)
        jest.spyOn(EventLogger.prototype, 'logEvent').mockImplementation()

        internalGet.mockReset()
        externalGet.mockReset()
    })

    afterEach(() => {
        Inject('UserSettings', null)
        jest.restoreAllMocks()
    })

    describe('constructor/getApi', () => {

        test('no baseUrl: uses the internal rest api client', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ data: [] })

            await api.getRouteDescriptions({ type: 'gpx' })

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}?private=false`, expect.anything())
            expect(externalGet).not.toHaveBeenCalled()
        })

        test('baseUrl given: uses the external rest api client', async () => {
            api = new IncyclistRoutesApi('https://custom.routes.api')
            externalGet.mockResolvedValue({ data: [] })

            await api.getRouteDescriptions({ type: 'gpx' })

            expect(externalGet).toHaveBeenCalledWith('https://custom.routes.api?private=false', expect.anything())
            expect(internalGet).not.toHaveBeenCalled()
        })
    })

    describe('getRouteDescriptions', () => {

        beforeEach(() => {
            api = new IncyclistRoutesApi()
        })

        test('type gpx, no category: queries with private=false', async () => {
            internalGet.mockResolvedValue({ data: [] })

            await api.getRouteDescriptions({ type: 'gpx' })

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}?private=false`, expect.anything())
        })

        test('type video, no category: queries by type', async () => {
            internalGet.mockResolvedValue({ data: [] })

            await api.getRouteDescriptions({ type: 'video' })

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}/?type=video`, expect.anything())
        })

        test('type video, with category: category is appended to the query', async () => {
            internalGet.mockResolvedValue({ data: [] })

            await api.getRouteDescriptions({ type: 'video', category: 'demo' })

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}/?type=video&category=demo`, expect.anything())
        })

        test('external api, array response: attaches apiServer to every route', async () => {
            api = new IncyclistRoutesApi('https://custom.routes.api')
            api.setSource('myserver')
            externalGet.mockResolvedValue({ data: [{ id: '1' }, { id: '2' }] })

            const routes = await api.getRouteDescriptions({ type: 'gpx' })

            expect(routes).toEqual([
                { id: '1', apiServer: 'myserver' },
                { id: '2', apiServer: 'myserver' },
            ])
        })

        test('internal (non-external) api: does not attach apiServer', async () => {
            internalGet.mockResolvedValue({ data: [{ id: '1' }] })

            const routes = await api.getRouteDescriptions({ type: 'gpx' })

            expect(routes).toEqual([{ id: '1' }])
        })

        test('request fails, throws=false (default): logs the error and resolves with undefined', async () => {
            const err = new Error('network down')
            internalGet.mockRejectedValue(err)

            const res = await api.getRouteDescriptions({ type: 'gpx' })

            expect(res).toBeUndefined()
            expect(EventLogger.prototype.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Error', error: 'network down', fn: 'getRouteDescriptions' })
            )
        })

        test('request fails, throws=true: rejects with the original error', async () => {
            const err = new Error('network down')
            internalGet.mockRejectedValue(err)

            await expect(api.getRouteDescriptions({ type: 'gpx' }, true)).rejects.toThrow('network down')
        })
    })

    describe('getRouteDetails', () => {

        beforeEach(() => {
            api = new IncyclistRoutesApi()
        })

        test('returns the route as-is when it has no legacy "decoded" property', async () => {
            internalGet.mockResolvedValue({ data: { id: 'r1', points: [{ lat: 1, lng: 1 }] } })

            const route = await api.getRouteDetails('r1')

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}/r1`)
            expect(route).toEqual({ id: 'r1', points: [{ lat: 1, lng: 1 }] })
        })

        test('migrates a legacy route: moves "decoded" into points and fills missing routeDistance', async () => {
            const legacy = {
                id: 'r1',
                decoded: [
                    { lat: 1, lng: 1, distance: 10 },
                    { lat: 2, lng: 2, distance: 5, routeDistance: 100 },
                    { lat: 3, lng: 3, distance: 7 },
                ],
            }
            internalGet.mockResolvedValue({ data: legacy })

            const route = await api.getRouteDetails('r1')

            expect(route['decoded']).toBeUndefined()
            expect(route.points).toEqual([
                { lat: 1, lng: 1, distance: 10, routeDistance: 0 },
                { lat: 2, lng: 2, distance: 5, routeDistance: 100 },
                { lat: 3, lng: 3, distance: 7, routeDistance: 105 },
            ])
        })

        test('request fails: resolves with undefined', async () => {
            internalGet.mockRejectedValue(new Error('not found'))

            const route = await api.getRouteDetails('r1')

            expect(route).toBeUndefined()
        })
    })

    describe('getRoutePreview', () => {

        beforeEach(() => {
            api = new IncyclistRoutesApi()
        })

        test('returns the preview url', async () => {
            internalGet.mockResolvedValue({ data: { url: 'https://preview.example.com/r1.png' } })

            const url = await api.getRoutePreview('r1')

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}/r1/preview`)
            expect(url).toBe('https://preview.example.com/r1.png')
        })

        test('no data in response: returns undefined', async () => {
            internalGet.mockResolvedValue({ data: undefined })

            const url = await api.getRoutePreview('r1')

            expect(url).toBeUndefined()
        })

        test('request fails: returns undefined', async () => {
            internalGet.mockRejectedValue(new Error('boom'))

            const url = await api.getRoutePreview('r1')

            expect(url).toBeUndefined()
        })
    })

    describe('getCountry', () => {

        test('external api: returns undefined without making a request', async () => {
            api = new IncyclistRoutesApi('https://custom.routes.api')

            const res = await api.getCountry({ lat: 1, lng: 2 })

            expect(res).toBeUndefined()
            expect(externalGet).not.toHaveBeenCalled()
        })

        test('no query: returns undefined without making a request', async () => {
            api = new IncyclistRoutesApi()

            const res = await api.getCountry(undefined)

            expect(res).toBeUndefined()
            expect(internalGet).not.toHaveBeenCalled()
        })

        test('single point: builds a lat/lng query', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ status: 200, data: { country: 'de' } })

            await api.getCountry({ lat: 1.23, lng: 4.56 })

            expect(internalGet).toHaveBeenCalledWith(
                `${DEFAULT_BASE_URL}/country?lat=1.23&lng=4.56`,
                expect.objectContaining({ validateStatus: expect.any(Function) })
            )
        })

        test('array of points: builds a points query, capped at 100 entries', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ status: 200, data: { country: 'de' } })
            const points = Array.from({ length: 105 }, (_, i) => ({ lat: i, lng: i }))

            await api.getCountry(points)

            const [url] = internalGet.mock.calls[0]
            const pointsParam = new URLSearchParams(url.split('?')[1]).get('points')
            expect(pointsParam.split(';')).toHaveLength(100)
        })

        test('returns the upper-cased country on success', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ status: 200, data: { country: 'de' } })

            const res = await api.getCountry({ lat: 1, lng: 2 })

            expect(res).toBe('DE')
        })

        test('status 404: returns undefined', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ status: 404 })

            const res = await api.getCountry({ lat: 1, lng: 2 })

            expect(res).toBeUndefined()
        })

        test('status 429: logs a rate-limit event and returns undefined', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ status: 429 })

            const res = await api.getCountry({ lat: 1, lng: 2 })

            expect(res).toBeUndefined()
            expect(EventLogger.prototype.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'getCountry hit rate limit' })
            )
        })

        test('request fails: logs the error and returns undefined', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockRejectedValue(new Error('timeout'))

            const res = await api.getCountry({ lat: 1, lng: 2 })

            expect(res).toBeUndefined()
            expect(EventLogger.prototype.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Error', error: 'timeout', fn: 'getCountry' })
            )
        })
    })

    describe('reload', () => {

        test('external api: does nothing', async () => {
            api = new IncyclistRoutesApi('https://custom.routes.api')

            await api.reload()

            expect(externalGet).not.toHaveBeenCalled()
        })

        test('internal api: triggers a reload request', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockResolvedValue({ data: {} })

            await api.reload()

            expect(internalGet).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}/reload`)
        })

        test('request fails: logs the error', async () => {
            api = new IncyclistRoutesApi()
            internalGet.mockRejectedValue(new Error('boom'))

            await api.reload()

            expect(EventLogger.prototype.logEvent).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Error', error: 'boom', fn: 'reload' })
            )
        })
    })
})
