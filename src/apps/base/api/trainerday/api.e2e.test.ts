import dotenv from 'dotenv'
import fs from 'node:fs'
import { TrainerDayApi } from './api'

/**
 * E2E tests against the TrainerDay API. They also serve as the API spike: they log what TrainerDay really delivers
 * (keys, types, status codes), never tokens or private content.
 *
 * The Incyclist client of TrainerDay only has the scopes `calendar:read` and `activities:write`. Endpoints that need other
 * scopes (athlete:read, activities:read) are not available and therefore not covered. The tests cover the calendar,
 * the upload (tcx and fit, each uploaded twice) and the opt-in token refresh.
 *
 * They are only executed on purpose (`npm run test:e2e`, or "Run" in VS Code) and fail if no access token is provided.
 *
 * Configure them in the (git-ignored) `.env` file:
 *
 *   TD_ACCESS_TOKEN=...          required. Access tokens are valid for 6 hours
 *   TD_REFRESH_TOKEN=...         only required for the (opt-in) refresh test
 *   TD_EXPIRATION=...            optional: expiration of the access token (ISO string or epoch ms). Without it, the token is assumed to be valid
 *   TD_API=...                   default: https://api.trainerday.com
 *   TD_AUTH_SERVER_URL=...       default: https://auth.incyclist.com (e.g. http://localhost:5001/auth for a local auth-server)
 *   TD_E2E_REFRESH=true          opt-in for the refresh test. Refreshing rotates the refresh token, so the one stored
 *                                           in the .env file is no longer valid afterwards
 */

dotenv.config()

jest.setTimeout(90_000)

const accessToken = process.env.TD_ACCESS_TOKEN
const refreshToken = process.env.TD_REFRESH_TOKEN
const apiUrl = process.env.TD_API ?? 'https://api.trainerday.com'
const authServerUrl = process.env.TD_AUTH_SERVER_URL ?? 'https://auth.incyclist.com'
const refreshEnabled = process.env.TD_E2E_REFRESH === 'true'

const parseExpiration = (value?: string): Date => {
    if (!value)
        return new Date(Date.now() + 5 * 60_000)
    const numeric = Number(value)
    return new Date(Number.isFinite(numeric) ? numeric : value)
}

const readFile = (file: string) => new Uint8Array(fs.readFileSync(file))

/** the keys of an object (not the values) */
const keysOf = (item: unknown): string =>
    item !== null && typeof item === 'object' ? Object.keys(item).join(', ') : typeof item

const monday = (): Date => {
    const start = new Date()
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return start
}

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
describe('TrainerDay API', () => {
    let api: TrainerDayApi

    beforeAll(() => {
        if (!accessToken)
            throw new Error('TD_ACCESS_TOKEN is not set (see the description at the top of this file)')
    })

    const createApi = (config: { expiration?: Date, accessToken?: string, refreshToken?: string }) => {
        const instance = new TrainerDayApi()
        instance['getUserSettings'] = jest.fn().mockReturnValue({
            isInitialized: true,
            get: (key: string, defValue: unknown) => {
                if (key === 'TRAINERDAY_API') return apiUrl
                if (key === 'TRAINERDAY_AUTH_SERVER_URL') return authServerUrl
                return defValue
            }
        }) as never
        instance.init({ accessToken: config.accessToken ?? accessToken as string, refreshToken: config.refreshToken ?? refreshToken as string, expiration: config.expiration })
        return instance
    }

    beforeEach(() => {
        api = createApi({ expiration: parseExpiration(process.env.TD_EXPIRATION) })
    })

    describe('getCalendar', () => {
        test('the current week and the 28 days after', async () => {
            const start = monday()
            const end = new Date(start)
            end.setDate(end.getDate() + 28)

            const calendar = await callAndLog('getCalendar', () => api.getCalendar(start, end))

            console.log('calendar items:', calendar.length)
            calendar.slice(0, 3).forEach((item, idx) => {
                // never print the description: it can be private
                const { title, date, workoutId } = item
                console.log(`calendar item ${idx}: ${JSON.stringify({ title, date, workoutId })}`)
                console.log(`calendar item ${idx} keys: ${keysOf(item)}`)
                const block = item.workoutBlocks?.[0]
                console.log(`calendar item ${idx} first block keys: ${keysOf(block)}`)
                console.log(`calendar item ${idx} first segment keys: ${keysOf(block?.segments?.[0])}`)
            })
            expect(Array.isArray(calendar)).toBe(true)
        })
    })

    describe('uploadActivity', () => {

        // The upload is asynchronous on the side of TrainerDay. How a duplicate is reported is not known yet:
        // the tests upload every file twice and log the outcome.

        const uploadAndLog = async (dataType: 'tcx' | 'fit', file: string) => {
            console.log(`uploading ${dataType} to ${apiUrl}`)
            try {
                const res = await api.uploadActivity({ name: 'Incyclist E2E test', dataType, data: readFile(file) })
                console.log(`upload ${dataType}: activityId ${res.activityId}`)
                return res
            }
            catch (err) {
                console.log(`upload ${dataType} failed: ${err.message}`)
                throw err
            }
        }

        test('tcx file, uploaded twice', async () => {
            const file = '__tests__/data/activities/test.tcx'

            const first = await uploadAndLog('tcx', file).catch(e => e)
            expect(first).toBeDefined()

            const second = await uploadAndLog('tcx', file).catch(e => e)
            expect(second).toBeDefined()
        })

        test('fit file, uploaded twice', async () => {
            const file = '__tests__/data/activities/test.fit'

            const first = await uploadAndLog('fit', file).catch(e => e)
            expect(first).toBeDefined()

            const second = await uploadAndLog('fit', file).catch(e => e)
            expect(second).toBeDefined()
        })
    })

    describe('token refresh', () => {
        test('an expired token is refreshed through the auth-server', async () => {
            // opt-in: refreshing rotates the refresh token that is stored in the .env file
            if (!refreshEnabled || !refreshToken) {
                console.log('refresh test not executed: set TD_E2E_REFRESH=true and TD_REFRESH_TOKEN to run it')
                return
            }

            const expiredAt = new Date(Date.now() - 1000)
            const expired = createApi({ expiration: expiredAt, accessToken: 'expired' })
            const onUpdate = jest.fn()
            expired.init({ accessToken: 'expired', refreshToken, expiration: expiredAt }).on('token.updated', onUpdate)

            const calendar = await callAndLog('refresh and getCalendar', () => expired.getCalendar(monday(), new Date()))

            expect(calendar).toBeDefined()
            expect(onUpdate).toHaveBeenCalledTimes(1)
            console.log('token refreshed. The refresh token in .env is probably no longer valid, please connect again to get a new one')
        })
    })
})
