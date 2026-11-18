import dotenv from 'dotenv'
// the apps module has to be loaded first (it registers the uploaders/providers and depends on the factories)
import '../../../../apps'
import { Inject } from '../../../../base/decorators'
import { TrainerDayApi } from '../../../../apps/base/api/trainerday'
import { WorkoutCalendarEntry } from '../../types'
import { TrainerDayCalendarSyncProvider } from './provider'

/**
 * E2E test of the TrainerDay workout sync provider against the real TrainerDay calendar (read only, scope `calendar:read`).
 * It runs the real sync twice: the second run must not report any change.
 *
 * Configure it in the (git-ignored) `.env` file:
 *
 *   TD_ACCESS_TOKEN=...          required. Access tokens are valid for 6 hours
 *   TD_REFRESH_TOKEN=...         optional
 *   TD_EXPIRATION=...            optional: expiration of the access token (ISO string or epoch ms). Without it, the token is assumed to be valid
 *   TD_API=...                   default: https://api.trainerday.com
 *   TD_AUTH_SERVER_URL=...       default: https://auth.incyclist.com
 */

dotenv.config()

jest.setTimeout(90_000)

const accessToken = process.env.TD_ACCESS_TOKEN
const refreshToken = process.env.TD_REFRESH_TOKEN
const apiUrl = process.env.TD_API ?? 'https://api.trainerday.com'
const authServerUrl = process.env.TD_AUTH_SERVER_URL ?? 'https://auth.incyclist.com'

const parseExpiration = (value?: string): Date => {
    if (!value)
        return new Date(Date.now() + 5 * 60_000)
    const numeric = Number(value)
    return new Date(Number.isFinite(numeric) ? numeric : value)
}

type SyncResult = { event: string, workouts: Array<WorkoutCalendarEntry>, changes: Array<string> }

// Note: plain describe()/test() (no aliases, no conditional skip), otherwise the VS Code Jest extension skips everything
describe('TrainerDayCalendarSyncProvider (real TrainerDay)', () => {
    let provider: TrainerDayCalendarSyncProvider

    beforeAll(() => {
        if (!accessToken)
            throw new Error('TD_ACCESS_TOKEN is not set (see the description at the top of this file)')

        const api = new TrainerDayApi()
        api['getUserSettings'] = jest.fn().mockReturnValue({
            isInitialized: true,
            get: (key: string, defValue: unknown) => {
                if (key === 'TRAINERDAY_API') return apiUrl
                if (key === 'TRAINERDAY_AUTH_SERVER_URL') return authServerUrl
                return defValue
            }
        }) as never
        api.init({ accessToken, refreshToken: refreshToken as string, expiration: parseExpiration(process.env.TD_EXPIRATION) })

        Inject('TrainerDayAppConnection', { isConnected: () => true, getApi: () => api })
        Inject('AppsService', { isEnabled: () => true })
        provider = new TrainerDayCalendarSyncProvider()
    })

    afterAll(() => {
        Inject('TrainerDayAppConnection', null)
        Inject('AppsService', null)
        provider?.reset()
    })

    const syncOnce = (): Promise<SyncResult> => new Promise<SyncResult>((resolve, reject) => {
        try {
            const observer = provider.sync()
            const changes: Array<string> = []
            for (const change of ['added', 'updated', 'deleted']) {
                observer.on(change, (w: WorkoutCalendarEntry) => { changes.push(`${change}:${w.workoutId}`) })
            }
            const finish = (event: string) => (workouts: Array<WorkoutCalendarEntry>) => {
                console.log(`sync ${event}: ${workouts.length} workouts, changes: ${changes.length}`)
                resolve({ event, workouts: [...workouts], changes })
            }
            observer.once('loaded', finish('loaded'))
            observer.once('done', finish('done'))
        }
        catch (err) {
            console.log(`sync failed: ${err.message}`)
            reject(err)
        }
    })

    test('the second sync does not report any change', async () => {
        const first = await syncOnce()
        expect(first.event).toBe('loaded')
        first.workouts.forEach(w => {
            console.log(`workout: ${w.workout?.name} on ${w.day.toDateString()}, ${w.workout?.duration}s`)
        })

        // let the provider clean up the observer
        await new Promise(resolve => setTimeout(resolve, 20))

        const second = await syncOnce()
        expect(second.event).toBe('done')
        expect(second.changes).toEqual([])
        expect(second.workouts.map(w => w.workoutId)).toEqual(first.workouts.map(w => w.workoutId))
    })
})
