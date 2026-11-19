// the apps module has to be loaded first (it registers the uploaders and depends on the upload factory)
import '../../apps'
import { RideWithGpsApi, RideWithGpsAppConnection, RideWithGpsTimeDataMissingError } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { ActivityDetails } from '../base'
import { RideWithGpsUpload } from './ridewithgps'

describe('RideWithGpsUpload', () => {

    let service: RideWithGpsUpload
    let api: { uploadActivity: jest.Mock }

    const setup = (props: { initialized?: boolean, connected?: boolean } = {}) => {
        api = { uploadActivity: jest.fn().mockResolvedValue({ tripId: '123' }) }
        const connection: Partial<RideWithGpsAppConnection> = {
            init: jest.fn().mockReturnValue(props.initialized ?? true),
            isConnected: jest.fn().mockReturnValue(props.connected ?? true),
            getApi: jest.fn().mockReturnValue(api as unknown as RideWithGpsApi)
        }
        Inject('RideWithGpsAppConnection', connection)
    }

    const activity = (props: Partial<ActivityDetails> = {}) =>
        ({ id: 'abc', title: ' Morning Ride ', tcxFileName: '/data/ride.tcx', fitFileName: '/data/ride.fit', routeType: 'Video', ...props }) as ActivityDetails

    beforeEach(() => {
        service = new RideWithGpsUpload()
    })

    afterEach(() => {
        Inject('RideWithGpsAppConnection', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('init / isConnected', () => {
        test('initialized and connected', () => {
            setup()
            expect(service.init()).toBe(true)
            expect(service.isConnected()).toBe(true)
        })

        test('user settings not yet initialized', () => {
            setup({ initialized: false })
            expect(service.init()).toBe(false)
        })
    })

    describe('upload', () => {
        test('uploads the TCX file and links the trip', async () => {
            setup()
            const act = activity()

            const success = await service.upload(act, 'TCX')

            expect(success).toBe(true)
            expect(api.uploadActivity).toHaveBeenCalledTimes(1)
            expect(api.uploadActivity).toHaveBeenCalledWith({ fileName: '/data/ride.tcx', name: 'Morning Ride', activityType: 'cycling:virtual' })
            expect(act.links).toEqual({ ridewithgps: { activity_id: '123', url: 'https://ridewithgps.com/trips/123' } })
        })

        test('free ride: indoor cycling', async () => {
            setup()

            await service.upload(activity({ routeType: 'Free-Ride' }), 'tcx')

            expect(api.uploadActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: 'cycling:indoor' }))
        })

        test('no title: the name is taken from the file', async () => {
            setup()

            await service.upload(activity({ title: ' ' }), 'tcx')

            expect(api.uploadActivity.mock.calls[0][0].name).toBeUndefined()
        })

        test('TCX not accepted: falls back to FIT', async () => {
            setup()
            api.uploadActivity.mockRejectedValueOnce(new Error('Upload rejected by RideWithGPS: parse_failed')).mockResolvedValueOnce({ tripId: '124' })
            const act = activity()

            const success = await service.upload(act, 'tcx')

            expect(success).toBe(true)
            expect(api.uploadActivity.mock.calls.map(c => c[0].fileName)).toEqual(['/data/ride.tcx', '/data/ride.fit'])
            expect(act.links.ridewithgps.activity_id).toBe('124')
        })

        test('FIT requested, TCX is the fallback', async () => {
            setup()
            api.uploadActivity.mockRejectedValueOnce(new Error('rejected')).mockResolvedValueOnce({ tripId: '124' })

            await service.upload(activity(), 'fit')

            expect(api.uploadActivity.mock.calls.map(c => c[0].fileName)).toEqual(['/data/ride.fit', '/data/ride.tcx'])
        })

        test('no fallback if the activity has no other file', async () => {
            setup()
            api.uploadActivity.mockRejectedValue(new Error('rejected'))
            const act = activity({ fitFileName: undefined })

            const success = await service.upload(act, 'tcx')

            expect(success).toBe(false)
            expect(api.uploadActivity).toHaveBeenCalledTimes(1)
            expect(act.links).toEqual({ ridewithgps: { error: 'rejected' } })
        })

        test('both formats rejected: the error of the last attempt is linked', async () => {
            setup()
            api.uploadActivity.mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'))
            const act = activity()

            expect(await service.upload(act, 'tcx')).toBe(false)
            expect(act.links.ridewithgps).toEqual({ error: 'second' })
        })

        test('time data missing: typed failure without fallback', async () => {
            setup()
            api.uploadActivity.mockRejectedValue(new RideWithGpsTimeDataMissingError())
            const act = activity()

            const success = await service.upload(act, 'tcx')

            expect(success).toBe(false)
            expect(api.uploadActivity).toHaveBeenCalledTimes(1)
            expect(act.links.ridewithgps.error).toContain('no time data')
        })

        test('duplicate with the id of the existing trip counts as success', async () => {
            setup()
            api.uploadActivity.mockResolvedValue({ tripId: '55', duplicate: true })
            const act = activity()

            expect(await service.upload(act, 'tcx')).toBe(true)
            expect(act.links.ridewithgps).toEqual({ activity_id: '55', url: 'https://ridewithgps.com/trips/55' })
        })

        test('duplicate without id: still a success with a link that has an id', async () => {
            setup()
            api.uploadActivity.mockResolvedValue({ duplicate: true })
            const act = activity()

            expect(await service.upload(act, 'tcx')).toBe(true)
            expect(act.links.ridewithgps).toEqual({ activity_id: 'existing', url: 'https://ridewithgps.com/trips' })
        })

        test('no TCX and no FIT file', async () => {
            setup()
            const act = activity({ tcxFileName: undefined, fitFileName: undefined })

            expect(await service.upload(act, 'tcx')).toBe(false)
            expect(act.links.ridewithgps.error).toContain('no TCX or FIT file')
        })

        test('other format than TCX/FIT is not uploaded in that format', async () => {
            setup()

            await service.upload(activity(), 'gpx')

            expect(api.uploadActivity.mock.calls[0][0].fileName).toBe('/data/ride.tcx')
        })

        test('existing links of other apps are kept', async () => {
            setup()
            const act = activity({ links: { strava: { activity_id: '1', url: 'u' } } })

            await service.upload(act, 'tcx')

            expect(Object.keys(act.links)).toEqual(['strava', 'ridewithgps'])
        })

        test('not connected', async () => {
            setup({ connected: false })

            expect(await service.upload(activity(), 'tcx')).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
        })

        test('not initialized', async () => {
            setup({ initialized: false })

            expect(await service.upload(activity(), 'tcx')).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
        })
    })

    describe('getUrl', () => {
        test('link to the trip', () => {
            expect(service.getUrl('123')).toBe('https://ridewithgps.com/trips/123')
        })
    })
})
