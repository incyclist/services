import dotenv from 'dotenv'
import { RideWithGpsApi } from './api'
import { AxiosFormPost } from '../../../../../__tests__/utils/formPost'

/**
 * E2E tests against the RideWithGPS API. They also serve as the API spike: they log what RideWithGPS really delivers
 * (keys, types, status codes), never tokens or private content.
 *
 * They run against the real account of the user and create trips there (see the upload tests).
 * They are only executed on purpose (`npm run test:e2e`, or "Run" in VS Code) and fail if no access token is provided.
 *
 * RideWithGPS access tokens never expire and there is no refresh token, so the tests do not cover a refresh.
 *
 * Configure them in the (git-ignored) `.env` file:
 *
 *   RWGPS_ACCESS_TOKEN=...       required
 *   RWGPS_USER_ID=...            optional: id of the user
 *   RWGPS_API=...                default: https://ridewithgps.com
 *   RWGPS_AUTH_SERVER_URL=...    not used by these tests (there is no token refresh)
 */

dotenv.config()

jest.setTimeout(90_000)

const accessToken = process.env.RWGPS_ACCESS_TOKEN
const userId = process.env.RWGPS_USER_ID
const apiUrl = process.env.RWGPS_API ?? 'https://ridewithgps.com'

/** the keys of an object (not the values) */
const keysOf = (item: unknown): string =>
    item !== null && typeof item === 'object' ? Object.keys(item).join(', ') : typeof item

/** runs a call and logs the outcome on the console, no matter if it succeeded or failed */
const callAndLog = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
        const res = await fn()
        console.log(`${name} succeeded`)
        return res
    }
    catch (err) {
        console.log(`${name} failed: ${err.message}`)
        throw err
    }
}

// Note: tests and suites are declared with plain describe()/test() (no aliases, no conditional skip),
// otherwise the VS Code Jest extension can not determine the name of a test and skips everything when "Run" is clicked
describe('RideWithGPS API', () => {
    let api: RideWithGpsApi

    beforeAll(() => {
        if (!accessToken)
            throw new Error('RWGPS_ACCESS_TOKEN is not set (see the description at the top of this file)')
    })

    beforeEach(() => {
        api = new RideWithGpsApi()
        api.getFormBinding = jest.fn(() => new AxiosFormPost())
        api['getUserSettings'] = jest.fn().mockReturnValue({
            isInitialized: true,
            get: (key: string, defValue: unknown) => key === 'RWGPS_API' ? apiUrl : defValue
        }) as never
        api.init({ id: userId, accessToken: accessToken as string })
    })

    describe('getRoutes', () => {
        test('first page of the active routes', async () => {
            const res = await callAndLog('getRoutes', () => api.getRoutes({ page: 1, pageSize: 20, archived: false }))

            console.log('routes:', res.routes.length, 'pagination:', JSON.stringify(res.pagination))
            res.routes.slice(0, 3).forEach((route, idx) => {
                // never print the name or description: they can be private
                const { id, user_id, archived, track_type, terrain, surface, unpaved_pct, updated_at } = route
                console.log(`route ${idx}: ${JSON.stringify({ id, user_id, archived, track_type, terrain, surface, unpaved_pct, updated_at })}`)
                console.log(`route ${idx} keys: ${keysOf(route)}`)
                console.log(`route ${idx} activity_types: ${JSON.stringify(route.activity_types)}`)
            })
            expect(Array.isArray(res.routes)).toBe(true)
        })
    })

    describe('getRoute / getRouteAsGPX', () => {
        test('detail and GPX of the first route', async () => {
            const { routes } = await api.getRoutes({ page: 1, pageSize: 20, archived: false })
            if (routes.length === 0) {
                console.log('no routes in the account, nothing to download')
                return
            }
            const id = routes[0].id

            const detail = await callAndLog('getRoute', () => api.getRoute(id))
            console.log('route detail keys:', keysOf(detail))
            console.log('route activity_types:', JSON.stringify(detail.activity_types))
            console.log('track points:', detail.track_points?.length, 'first point keys:', keysOf(detail.track_points?.[0]))

            const gpx = await callAndLog('getRouteAsGPX', () => api.getRouteAsGPX(id))
            console.log('gpx length:', gpx.length, 'has elevation:', gpx.includes('<ele>'), 'has time:', gpx.includes('<time>'))
            expect(gpx).toContain('<gpx')
        })
    })

    describe('uploadActivity', () => {

        // Re-uploading the same file is reported as duplicate by RideWithGPS. The first upload of a file can therefore
        // only be tested once per account, a new file is needed for another run.

        const uploadAndLog = async (file: string, name: string) => {
            try {
                const res = await api.uploadActivity({ fileName: file, name, activityType: 'cycling:virtual' })
                console.log(`upload ${file}: tripId ${res.tripId}${res.duplicate ? ' (duplicate)' : ''}`)
                return res
            }
            catch (err) {
                console.log(`upload ${file} failed: ${err.message}`)
                throw err
            }
        }

        test('tcx file', async () => {
            const res = await uploadAndLog('__tests__/data/activities/test.tcx', `Incyclist E2E test ${new Date().toISOString()}`).catch(e => e)
            expect(res).toBeDefined()
        })

        test('fit file', async () => {
            const res = await uploadAndLog('__tests__/data/activities/test.fit', `Incyclist E2E test ${new Date().toISOString()}`).catch(e => e)
            expect(res).toBeDefined()
        })

        test('the same tcx file again is reported as duplicate', async () => {
            const file = '__tests__/data/activities/test.tcx'
            // independent of earlier runs: make sure that RideWithGPS has the file (the result of this upload does not matter)
            await uploadAndLog(file, `Incyclist E2E test ${new Date().toISOString()}`).catch(e => e)

            const res = await uploadAndLog(file, `Incyclist E2E test ${new Date().toISOString()}`)

            expect(res.duplicate).toBe(true)
            console.log('duplicate reports the id of the existing trip:', res.tripId !== undefined)
        })
    })
})
