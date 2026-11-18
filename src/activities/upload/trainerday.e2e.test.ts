// the apps module has to be loaded first (it registers the uploaders and depends on the upload factory)
import '../../apps'
import dotenv from 'dotenv'
import fs from 'node:fs'
import { TrainerDayApi } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { ActivityDetails } from '../base'
import { TrainerDayUpload } from './trainerday'

/**
 * E2E test of the TrainerDay activity upload: the real provider uploads a real file through the real API client.
 *
 * NOTE: TrainerDay does not detect duplicates, so every run creates a NEW activity on the account.
 *
 * Only executed on purpose (`npm run test:e2e`). Configure in the (git-ignored) `.env` file:
 *
 *   TD_ACCESS_TOKEN=...          required. Access tokens are valid for 6 hours
 *   TD_EXPIRATION=...            optional: expiration of the access token (ISO string or epoch ms). Without it, the token is assumed to be valid
 *   TD_API=...                   default: https://api.trainerday.com
 */

dotenv.config()

jest.setTimeout(90_000)

const accessToken = process.env.TD_ACCESS_TOKEN
const apiUrl = process.env.TD_API ?? 'https://api.trainerday.com'

const parseExpiration = (value?: string): Date => {
    if (!value)
        return new Date(Date.now() + 5 * 60_000)
    const numeric = Number(value)
    return new Date(Number.isFinite(numeric) ? numeric : value)
}

/** behaves like the fs binding of the desktop app: `readFile(file, 'base64')` returns a base64 string */
const desktopFileSystem = () => ({
    existsFile: async (file: string) => fs.existsSync(file),
    readFile: async (file: string, encoding?: string) => {
        const content = fs.readFileSync(file)
        return encoding === 'base64' ? content.toString('base64') : content
    }
})

// Note: tests and suites are declared with plain describe()/test() (no aliases, no conditional skip),
// otherwise the VS Code Jest extension can not determine the name of a test and skips everything when "Run" is clicked
describe('TrainerDay activity upload', () => {
    let service: TrainerDayUpload

    beforeAll(() => {
        if (!accessToken)
            throw new Error('TD_ACCESS_TOKEN is not set (see the description at the top of this file)')
    })

    beforeEach(() => {
        const api = new TrainerDayApi()
        api['getUserSettings'] = jest.fn().mockReturnValue({
            isInitialized: true,
            get: (key: string, defValue: unknown) => key === 'TRAINERDAY_API' ? apiUrl : defValue
        }) as never
        api.init({ accessToken: accessToken as string, refreshToken: process.env.TD_REFRESH_TOKEN as string, expiration: parseExpiration(process.env.TD_EXPIRATION) })

        Inject('TrainerDayAppConnection', { init: () => true, isConnected: () => true, getApi: () => api })
        Inject('FileSystem', desktopFileSystem())
        service = new TrainerDayUpload()
    })

    afterEach(() => {
        Inject('TrainerDayAppConnection', null)
        Inject('FileSystem', null)
        service.reset()
    })

    test('uploads a tcx file and links the activity', async () => {
        const activity = {
            // TrainerDay seems to reject an upload that it has seen before (answering "TCX parsing error"),
            // the fixture is always the same, so the id (sent as externalId) has to be unique for every run
            id: `incyclist-e2e-${Date.now()}`,
            title: `Incyclist E2E test ${Date.now()}`,
            startTime: new Date().toISOString(),
            tcxFileName: '__tests__/data/activities/test.tcx'
        } as ActivityDetails

        console.log(`uploading tcx to ${apiUrl}`)
        let success: boolean
        try {
            success = await service.upload(activity, 'tcx')
            console.log(`upload tcx: success ${success}, link ${JSON.stringify(activity.links?.trainerday)}`)
        }
        catch (err) {
            console.log(`upload tcx failed: ${err.message}`)
            throw err
        }

        expect(success).toBe(true)
        expect(activity.links?.trainerday?.error).toBeUndefined()
        expect(activity.links?.trainerday?.activity_id).toBeTruthy()
    })
})
