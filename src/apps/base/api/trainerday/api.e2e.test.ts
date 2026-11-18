import dotenv from 'dotenv'
import fs from 'node:fs'
import { TrainerDayApi } from './api'
import { TrainerDayRawResponse } from './types'

/**
 * E2E tests against the TrainerDay API. They also serve as the API spike: they log what TrainerDay really delivers
 * (keys, types, status codes), never tokens or private content.
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

const trim = (text: string, max = 500) => text.length > max ? text.substring(0, max) + '...' : text
const stringify = (data: unknown) => trim(typeof data === 'string' ? data : JSON.stringify(data) ?? '')

const asArray = (data: TrainerDayRawResponse): unknown[] | undefined => {
    if (Array.isArray(data))
        return data
    // the structure is not known yet: also look at the first property that holds an array
    if (data && typeof data === 'object')
        return Object.values(data).find(v => Array.isArray(v)) as unknown[] | undefined
    return undefined
}

/** logs the keys of an object and the type of each field (not the values) */
const describeFields = (item: unknown) => {
    if (item === null || typeof item !== 'object')
        return typeof item
    return Object.entries(item).map(([k, v]) => `${k}:${v === null ? 'null' : typeof v}`).join(', ')
}

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

    describe('getAthlete', () => {
        test('returns the profile of the athlete', async () => {
            const athlete = await callAndLog('getAthlete', () => api.getAthlete())

            console.log('athlete keys:', athlete && typeof athlete === 'object' ? Object.keys(athlete).join(', ') : typeof athlete)
            expect(athlete).toBeDefined()
        })
    })

    describe('getCalendar', () => {
        test('the current week and the 28 days after', async () => {
            const start = monday()
            const end = new Date(start)
            end.setDate(end.getDate() + 28)

            const calendar = await callAndLog('getCalendar', () => api.getCalendar(start, end))

            console.log('calendar body type:', Array.isArray(calendar) ? 'array' : typeof calendar,
                calendar && typeof calendar === 'object' && !Array.isArray(calendar) ? 'keys: ' + Object.keys(calendar).join(', ') : '')
            const items = asArray(calendar)
            console.log('calendar items:', items?.length)
            items?.slice(0, 3).forEach((item, idx) => {
                console.log(`calendar item ${idx} fields: ${describeFields(item)}`)
                // only title and date: everything else can be private
                const { title, name, date, startDate } = (item ?? {}) as Record<string, unknown>
                console.log(`calendar item ${idx}: ${JSON.stringify({ title, name, date, startDate })}`)
            })
            expect(calendar).toBeDefined()
        })
    })

    describe('getActivities', () => {
        test('lists the activities', async () => {
            const activities = await callAndLog('getActivities', () => api.getActivities())

            const items = asArray(activities)
            console.log('activities body type:', Array.isArray(activities) ? 'array' : typeof activities,
                activities && typeof activities === 'object' && !Array.isArray(activities) ? 'keys: ' + Object.keys(activities).join(', ') : '')
            console.log('activities items:', items?.length)
            if (items?.[0])
                console.log('first activity fields:', describeFields(items[0]))
            expect(activities).toBeDefined()
        })
    })

    describe('uploadActivity', () => {

        // How TrainerDay handles a new file and a duplicate is not known yet: these tests log status and body of
        // the responses. A new file is needed for every run, otherwise even the first upload is a duplicate.

        const uploadAndLog = async (fileName: string, file: string) => {
            console.log(`uploading ${fileName} to ${apiUrl}`)
            try {
                const res = await api.uploadActivity({ fileName, data: readFile(file) })
                console.log(`upload ${fileName}: HTTP ${res.status}, body: ${stringify(res.body)}`)
                return res
            }
            catch (err) {
                console.log(`upload ${fileName} failed: ${err.message}`)
                throw err
            }
        }

        test('tcx file, uploaded twice (second upload shows the duplicate response)', async () => {
            const file = '__tests__/data/activities/test.tcx'

            const first = await uploadAndLog('test.tcx', file).catch(e => e)
            expect(first).toBeDefined()

            // the same file again: shows how TrainerDay reports a duplicate (status and body are logged)
            const second = await uploadAndLog('test.tcx', file).catch(e => e)
            expect(second).toBeDefined()
        })

        test('fit file, uploaded twice (second upload shows the duplicate response)', async () => {
            const file = '__tests__/data/activities/test.fit'

            const first = await uploadAndLog('test.fit', file).catch(e => e)
            expect(first).toBeDefined()

            const second = await uploadAndLog('test.fit', file).catch(e => e)
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

            const athlete = await callAndLog('refresh and getAthlete', () => expired.getAthlete())

            expect(athlete).toBeDefined()
            expect(onUpdate).toHaveBeenCalledTimes(1)
            console.log('token refreshed. The refresh token in .env is probably no longer valid, please connect again to get a new one')
        })
    })
})
