// the apps module has to be loaded first (it registers the uploaders and depends on the upload factory)
import '../../apps'
import dotenv from 'dotenv'
import { RideWithGpsApi } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { AxiosFormPost } from '../../../__tests__/utils/formPost'
import { ActivityDetails } from '../base'
import { ActivityUploadFactory } from './factory'
import { RideWithGpsUpload } from './ridewithgps'

/**
 * E2E test of the RideWithGPS activity upload: the real provider (through the upload factory) uploads real files through the real API client,
 * using an axios based form binding (like the desktop app).
 *
 * NOTE: this creates trips on the account. Uploading the same file again is reported as duplicate, which counts as success.
 *
 * Only executed on purpose (`npm run test:e2e`). Configure in the (git-ignored) `.env` file:
 *
 *   RWGPS_ACCESS_TOKEN=...       required
 *   RWGPS_USER_ID=...            optional: id of the user
 *   RWGPS_API=...                default: https://ridewithgps.com
 */

dotenv.config()

jest.setTimeout(90_000)

const accessToken = process.env.RWGPS_ACCESS_TOKEN
const userId = process.env.RWGPS_USER_ID
const apiUrl = process.env.RWGPS_API ?? 'https://ridewithgps.com'

// Note: plain describe()/test() (no aliases, no conditional skip), otherwise the VS Code Jest extension skips everything
describe('RideWithGPS activity upload', () => {
    let service: RideWithGpsUpload

    beforeAll(() => {
        if (!accessToken)
            throw new Error('RWGPS_ACCESS_TOKEN is not set (see the description at the top of this file)')
    })

    beforeEach(() => {
        const api = new RideWithGpsApi()
        api['getUserSettings'] = jest.fn().mockReturnValue({
            isInitialized: true,
            get: (key: string, defValue: unknown) => key === 'RWGPS_API' ? apiUrl : defValue
        }) as never
        api['getFormBinding'] = jest.fn(() => new AxiosFormPost()) as never
        api.init({ id: userId, accessToken: accessToken as string })

        Inject('RideWithGpsAppConnection', { init: () => true, isConnected: () => true, getApi: () => api })
        service = new RideWithGpsUpload()
    })

    afterEach(() => {
        Inject('RideWithGpsAppConnection', null)
        service.reset()
    })

    const uploadAndLog = async (format: 'tcx' | 'fit', file: string) => {
        const activity = {
            id: `e2e-${format}`,
            title: `Incyclist E2E test ${new Date().toISOString()}`,
            routeType: 'Video',
            [`${format}FileName`]: file
        } as unknown as ActivityDetails

        new ActivityUploadFactory().add('ridewithgps', service)
        const uploader = new ActivityUploadFactory().get('ridewithgps')

        try {
            const success = await uploader.upload(activity, format)
            console.log(`upload ${format}: success ${success}, link ${JSON.stringify(activity.links?.ridewithgps)}`)
            return { success, link: activity.links?.ridewithgps }
        }
        catch (err) {
            console.log(`upload ${format} failed: ${err.message}`)
            throw err
        }
    }

    test('uploads a fit file and links the trip', async () => {
        const { success, link } = await uploadAndLog('fit', '__tests__/data/activities/test.fit')

        expect(success).toBe(true)
        expect(link?.error).toBeUndefined()
        expect(link?.activity_id).toBeTruthy()
        console.log('url:', link?.url)
    })

    test('uploads a tcx file and links the trip', async () => {
        const { success, link } = await uploadAndLog('tcx', '__tests__/data/activities/test.tcx')

        expect(success).toBe(true)
        expect(link?.error).toBeUndefined()
        expect(link?.activity_id).toBeTruthy()
        console.log('url:', link?.url)
    })
})
