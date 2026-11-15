import dotenv from 'dotenv'
import fs from 'node:fs'
import { TrainingPeaksApi } from './api'
import { TrainingPeaksDuplicateError, TrainingPeaksUploadProps, TrainingPeaksWorkout } from './types'

/**
 * E2E tests against the TrainingPeaks API (sandbox by default).
 * They are only executed on purpose (`npm run test:e2e`, or "Run" in VS Code) and fail if no access token is provided.
 *
 * Configure them in the (git-ignored) `.env` file:
 *
 *   TP_ACCESS_TOKEN=...          required. Access tokens are only valid for 10 minutes, get a fresh one before every run
 *                                           (e.g. by connecting via the auth-server and copying the token from the callback)
 *   TP_REFRESH_TOKEN=...         only required for the (opt-in) refresh test
 *   TP_API=...                   default: https://api.sandbox.trainingpeaks.com
 *   TP_AUTH_SERVER_URL=...       default: https://auth.incyclist.com (e.g. http://localhost:5001/auth for a local auth-server)
 *   TP_E2E_REFRESH=true          opt-in for the refresh test. Refreshing can invalidate the refresh token that is stored
 *                                           in the .env file, so the new one has to be fetched again afterwards
 */

dotenv.config()

// TrainingPeaks processes uploads asynchronously (the api polls for up to 60s), the default timeout of 5s is not sufficient
jest.setTimeout(90_000)

const accessToken = process.env.TP_ACCESS_TOKEN
const refreshToken = process.env.TP_REFRESH_TOKEN
const apiUrl = process.env.TP_API ?? 'https://api.sandbox.trainingpeaks.com'
const authServerUrl = process.env.TP_AUTH_SERVER_URL ?? 'https://auth.incyclist.com'
const refreshEnabled = process.env.TP_E2E_REFRESH === 'true'

const readBase64 = (file: string) => fs.readFileSync(file).toString('base64')

/** uploads a file and reports the outcome on the console, no matter if the upload succeeded or was rejected */
const uploadAndLog = async (api: TrainingPeaksApi, props: TrainingPeaksUploadProps) => {
    console.log(`uploading ${props.fileName} (${Math.round(props.data.length * 0.75)} bytes) to ${apiUrl}`)
    try {
        const res = await api.upload(props)
        console.log('upload succeeded, workout id:', res.trainingPeaksId)
        return res
    }
    catch (err) {
        console.log('upload failed:', err.message)
        throw err
    }
}

const describeWorkout = (w: TrainingPeaksWorkout) => `${w.Id} ${w.WorkoutDay} ${w.WorkoutType} "${w.Title}" formats:${w.WorkoutFileFormats?.join(',')}`

// Note: tests and suites are declared with plain describe()/test() (no aliases, no conditional skip),
// otherwise the VS Code Jest extension can not determine the name of a test and skips everything when "Run" is clicked
describe('TrainingPeaks API', () => {
    let api: TrainingPeaksApi

    beforeAll(() => {
        if (!accessToken)
            throw new Error('TP_ACCESS_TOKEN is not set (see the description at the top of this file)')
    })

    const createApi = (config: { expiration?: Date, accessToken?: string, refreshToken?: string }) => {
        const instance = new TrainingPeaksApi()
        instance['getUserSettings'] = jest.fn().mockReturnValue({
            get: (key: string, defValue: unknown) => {
                if (key === 'TP_API') return apiUrl
                if (key === 'TP_AUTH_SERVER_URL') return authServerUrl
                return defValue
            }
        }) as never
        instance.init({ accessToken: config.accessToken ?? accessToken as string, refreshToken: config.refreshToken ?? refreshToken as string, expiration: config.expiration })
        return instance
    }

    beforeEach(() => {
        // the access token is assumed to be valid, so that no refresh is performed (see TP_E2E_REFRESH)
        api = createApi({ expiration: new Date(Date.now() + 5 * 60_000) })
    })

    describe('getWorkouts', () => {
        test('the next 30 days', async () => {
            const start = new Date()
            const end = new Date(start.valueOf() + 30 * 86400_000)

            const workouts = await api.getWorkouts(start, end)

            expect(Array.isArray(workouts)).toBe(true)
            console.log(`${workouts.length} workouts\n` + workouts.map(describeWorkout).join('\n'))
        })

        test('the current week and the 30 days after', async () => {
            const start = new Date()
            start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
            const end = new Date(start)
            end.setDate(end.getDate() + 30)

            const workouts = await api.getWorkouts(start, end)

            const cycling = workouts.filter(w => w.WorkoutType?.toLowerCase() === 'bike')
            console.log(`${workouts.length} workouts, ${cycling.length} cycling workouts`)
            workouts.forEach(w => { expect(w.Id).toBeDefined() })
        })
    })

    describe('getWorkoutFile', () => {
        test('structured cycling workout as ZWO', async () => {
            const start = new Date()
            const end = new Date(start.valueOf() + 30 * 86400_000)
            const workouts = await api.getWorkouts(start, end)
            const candidate = workouts.find(w => w.WorkoutType?.toLowerCase() === 'bike' && w.WorkoutFileFormats?.map(f => f.toLowerCase()).includes('zwo'))

            if (!candidate) {
                console.log('no cycling workout with a ZWO export found in the next 30 days - please plan a structured workout in the sandbox calendar')
                return
            }

            const zwo = await api.getWorkoutFile(candidate.Id, 'zwo')

            console.log(`downloaded ${describeWorkout(candidate)}\n${zwo.substring(0, 500)}`)
            expect(typeof zwo).toBe('string')
            expect(zwo).toContain('workout_file')
        })
    })

    describe('upload', () => {

        // TrainingPeaks rejects an activity that it already knows (same start time).
        // Please provide a new file here for every test run, otherwise you'll get an error
        // (Activity already exists in TrainingPeaks)

        test('valid tcx file', async () => {
            const file = '__tests__/data/activities/test.tcx'

            const res = await uploadAndLog(api, { fileName: 'test.tcx', data: readBase64(file), title: 'Incyclist Upload Test', comment: 'test', type: 'bike' })

            expect(res.trainingPeaksId).toMatch(/^\d+$/)
        })

        test('valid fit file', async () => {
            const file = '__tests__/data/activities/test.fit'

            const res = await uploadAndLog(api, { fileName: 'test.fit', data: readBase64(file), title: 'Incyclist Upload Test', comment: 'test', type: 'bike' })

            expect(res.trainingPeaksId).toMatch(/^\d+$/)
        })

        test('duplicate', async () => {
            const props = { fileName: 'test.tcx', data: readBase64('__tests__/data/activities/test.tcx'), title: 'Incyclist Upload Test', type: 'bike' as const }

            // make sure that the activity exists (it is rejected as duplicate if it was uploaded before)
            await uploadAndLog(api, props).catch(() => { /* already exists */ })

            await expect(uploadAndLog(api, props)).rejects.toBeInstanceOf(TrainingPeaksDuplicateError)
        })

        // shows which explanation TrainingPeaks provides if a request is rejected
        test('invalid file', async () => {
            const error = await uploadAndLog(api, { fileName: 'invalid.tcx', data: Buffer.from('this is not a tcx file').toString('base64') }).catch(e => e)

            expect(error).toBeInstanceOf(Error)
        })
    })

    describe('findWorkout', () => {
        test('finds a completed cycling workout by its start time', async () => {
            const from = new Date(Date.now() - 20 * 86400_000)
            const to = new Date(Date.now() + 20 * 86400_000)
            const workouts = await api.getWorkouts(from, to)
            const completed = workouts.find(w => w.Completed && w.WorkoutType?.toLowerCase() === 'bike' && w.StartTime)

            if (!completed) {
                console.log('no completed cycling workout found in the sandbox calendar (+/- 20 days) - upload an activity first')
                return
            }

            const found = await api.findWorkout(new Date(completed.StartTime as string))

            console.log(`searched for the workout that started at ${completed.StartTime}: found ${found?.Id} (expected ${completed.Id})`)
            expect(found?.Id).toBe(completed.Id)
        })

        test('no workout started at this time', async () => {
            expect(await api.findWorkout(new Date('2001-01-01T10:00:00Z'))).toBeUndefined()
        })
    })

    describe('token refresh', () => {
        test('an expired token is refreshed through the auth-server', async () => {
            // opt-in: refreshing can invalidate the refresh token that is stored in the .env file
            if (!refreshEnabled || !refreshToken) {
                console.log('refresh test not executed: set TP_E2E_REFRESH=true and TP_REFRESH_TOKEN to run it')
                return
            }

            const expired = createApi({ expiration: new Date(Date.now() - 1000), accessToken: 'expired' })
            const onUpdate = jest.fn()
            const observer = expired.init({ accessToken: 'expired', refreshToken: refreshToken as string, expiration: new Date(Date.now() - 1000) })
            observer.on('token.updated', onUpdate)

            const workouts = await expired.getWorkouts(new Date(), new Date(Date.now() + 86400_000))

            expect(Array.isArray(workouts)).toBe(true)
            expect(onUpdate).toHaveBeenCalledTimes(1)
            console.log('token refreshed. The refresh token in .env is probably no longer valid, please connect again to get a new one')
        })
    })
})
