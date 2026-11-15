// the apps module has to be loaded first (it registers the uploaders and depends on the upload factory)
import '../../apps'
import { TrainingPeaksApi, TrainingPeaksAppConnection, TrainingPeaksDuplicateError, TrainingPeaksWorkout } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { ActivityDetails } from '../base'
import { TrainingPeaksUpload } from './trainingpeaks'

const CALENDAR_URL = 'https://app.trainingpeaks.com/#calendar'

const ApiMock = (props: {
    uploadResponse?: { trainingPeaksId: string }, uploadError?: string, duplicate?: boolean,
    existing?: Partial<TrainingPeaksWorkout>, findError?: string
} = {}): Partial<TrainingPeaksApi> => {
    let upload = jest.fn().mockResolvedValue(props.uploadResponse ?? { trainingPeaksId: '12345' })
    if (props.uploadError)
        upload = jest.fn().mockRejectedValue(new Error(props.uploadError))
    if (props.duplicate)
        upload = jest.fn().mockRejectedValue(new TrainingPeaksDuplicateError())

    return {
        upload,
        getCalendarUrl: jest.fn().mockReturnValue(CALENDAR_URL),
        findWorkout: props.findError
            ? jest.fn().mockRejectedValue(new Error(props.findError))
            : jest.fn().mockResolvedValue(props.existing)
    }
}

const ConnectionMock = (initialized: boolean, connected: boolean, api?: Partial<TrainingPeaksApi>): Partial<TrainingPeaksAppConnection> => ({
    init: jest.fn().mockReturnValue(initialized),
    isConnected: jest.fn().mockReturnValue(connected),
    getApi: jest.fn().mockReturnValue(api)
})

/**
 * @param raw simulates a binding that ignores the requested encoding and delivers the content as it is
 *            (otherwise the mock behaves like the bindings of the apps: `readFile(file, 'base64')` returns a base64 string)
 */
const FileSystemMock = (files: Record<string, string | Buffer> = {}, raw = false) => ({
    existsFile: jest.fn(async (name: string) => name in files),
    readFile: jest.fn(async (name: string, encoding?: string) => {
        const content = files[name]
        if (raw || encoding !== 'base64' || !content)
            return content
        return (typeof content === 'string' ? Buffer.from(content, 'utf-8') : content).toString('base64')
    })
})

describe('TrainingPeaksUpload', () => {

    let service: TrainingPeaksUpload

    const setupMocks = (props: { initialized?: boolean, connected?: boolean, api?: Partial<TrainingPeaksApi>, files?: Record<string, string | Buffer>, raw?: boolean }) => {
        const connection = ConnectionMock(props.initialized ?? true, props.connected ?? true, props.api)
        const fs = FileSystemMock(props.files, props.raw)
        Inject('TrainingPeaksAppConnection', connection)
        Inject('FileSystem', fs)
        return { connection, fs }
    }

    beforeEach(() => {
        service = new TrainingPeaksUpload()
    })

    afterEach(() => {
        Inject('TrainingPeaksAppConnection', null)
        Inject('FileSystem', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('init / isConnected', () => {
        test('initialized and connected', () => {
            setupMocks({ initialized: true, connected: true })

            expect(service.init()).toBe(true)
            expect(service.isConnected()).toBe(true)
        })

        test('not connected', () => {
            setupMocks({ initialized: true, connected: false })

            expect(service.init()).toBe(true)
            expect(service.isConnected()).toBe(false)
        })

        test('user settings not yet initialized', () => {
            setupMocks({ initialized: false })

            expect(service.init()).toBe(false)
        })
    })

    describe('upload', () => {
        const logSpy = jest.fn()

        beforeEach(() => {
            service.on('log', logSpy)
        })

        test('successful tcx upload: sends the base64 encoded file and links the activity', async () => {
            const api = ApiMock({ uploadResponse: { trainingPeaksId: '777' } })
            setupMocks({ api, files: { '/data/My Ride.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: '/data/My Ride.tcx', title: 'Morning Ride' }
            const success = await service.upload(activity as ActivityDetails, 'TCX')

            expect(success).toBe(true)
            expect(api.upload).toHaveBeenCalledWith({
                fileName: 'My_Ride.tcx',
                data: Buffer.from('<xml/>').toString('base64'),
                title: 'Morning Ride',
                type: 'bike'
            })
            expect(activity.links).toEqual({
                trainingpeaks: { activity_id: '777', url: CALENDAR_URL }
            })
        })

        test('uses TCX by default', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': '<xml/>' } })

            const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails)

            expect(success).toBe(true)
            expect(api.upload).toHaveBeenCalled()
        })

        test('successful fit upload: binary content is sent unmodified', async () => {
            const content = Buffer.from([0x0e, 0x10, 0xff, 0x00, 0x80])
            const api = ApiMock()
            setupMocks({ api, files: { '/data/ride.fit': content } })

            const success = await service.upload({ fitFileName: '/data/ride.fit', title: 't' } as ActivityDetails, 'fit')

            expect(success).toBe(true)
            expect((api.upload as jest.Mock).mock.calls[0][0]).toMatchObject({ fileName: 'ride.fit', data: content.toString('base64') })
        })

        test('fit file delivered as text by a binding that ignores the encoding (binary content would be corrupted): fails', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'ride.fit': 'not-binary' } })

            const activity: Partial<ActivityDetails> = { fitFileName: 'ride.fit', title: 't' }
            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(activity.links?.trainingpeaks?.error).toBe('binary file could not be read')
        })

        test('keeps the links to other apps', async () => {
            setupMocks({ api: ApiMock(), files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't', links: { strava: { activity_id: '1' } } }
            await service.upload(activity as ActivityDetails)

            expect(activity.links?.strava).toEqual({ activity_id: '1' })
            expect(activity.links?.trainingpeaks?.activity_id).toBe('12345')
        })

        test('not connected: skipped without touching the activity', async () => {
            const api = ApiMock()
            setupMocks({ api, connected: false })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(activity.links).toBeUndefined()
        })

        test('not initialized: skipped', async () => {
            const api = ApiMock()
            setupMocks({ api, initialized: false })

            const success = await service.upload({ tcxFileName: 'a.tcx' } as ActivityDetails)

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Upload skipped', reason: 'not initialized' })
        })

        test('unsupported format: error is stored in the links', async () => {
            const api = ApiMock()
            setupMocks({ api })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx' }
            const success = await service.upload(activity as ActivityDetails, 'gpx')

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(activity.links?.trainingpeaks?.error).toBe('format GPX is not supported by TrainingPeaks')
        })

        test('activity without a file for the format: error is stored in the links', async () => {
            setupMocks({ api: ApiMock() })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx' }
            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(activity.links?.trainingpeaks?.error).toBe('no FIT file available for this activity')
        })

        test('file does not exist: error is stored in the links', async () => {
            const api = ApiMock()
            setupMocks({ api, files: {} })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'missing.tcx' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(activity.links?.trainingpeaks?.error).toBe('activity file not found')
        })

        test('empty file: error is stored in the links', async () => {
            setupMocks({ api: ApiMock(), files: { 'empty.tcx': '' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'empty.tcx' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(activity.links?.trainingpeaks?.error).toBe('activity file is empty')
        })

        test('any other rejection by TrainingPeaks: error is stored in the links', async () => {
            const api = ApiMock({ uploadError: 'Upload rejected by TrainingPeaks (HTTP 400): invalid' })
            setupMocks({ api, files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(activity.links).toEqual({ trainingpeaks: { error: 'Upload rejected by TrainingPeaks (HTTP 400): invalid' } })
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Upload failure', error: 'Upload rejected by TrainingPeaks (HTTP 400): invalid' })
            expect(api.findWorkout).not.toHaveBeenCalled()
        })
    })

    describe('activity exists already in TrainingPeaks', () => {
        const logSpy = jest.fn()
        const startTime = '2026-11-15T07:10:13.303Z'

        beforeEach(() => {
            service.on('log', logSpy)
        })

        const uploadDuplicate = async (api: Partial<TrainingPeaksApi>, activityProps: Partial<ActivityDetails> = {}) => {
            setupMocks({ api, files: { 'a.tcx': '<xml/>' } })
            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't', startTime, ...activityProps } as Partial<ActivityDetails>
            const success = await service.upload(activity as ActivityDetails)
            return { activity, success }
        }

        test('is not a failure: the activity is linked to the existing workout', async () => {
            const api = ApiMock({ duplicate: true, existing: { Id: 4711 } })

            const { activity, success } = await uploadDuplicate(api)

            expect(success).toBe(true)
            expect(activity.links).toEqual({
                trainingpeaks: { activity_id: '4711', url: CALENDAR_URL }
            })
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Upload duplicate', activityId: '4711', found: true })
        })

        test('the workout is searched by the start time of the activity', async () => {
            const api = ApiMock({ duplicate: true, existing: { Id: 1 } })

            await uploadDuplicate(api)

            expect(api.findWorkout).toHaveBeenCalledWith(new Date(startTime))
        })

        test('a start time as number (epoch milliseconds) is supported', async () => {
            const api = ApiMock({ duplicate: true, existing: { Id: 1 } })

            await uploadDuplicate(api, { startTime: new Date(startTime).valueOf() as unknown as string })

            expect(api.findWorkout).toHaveBeenCalledWith(new Date(startTime))
        })

        test('workout not found: still seen as uploaded (the app requires an id for a successful upload)', async () => {
            const api = ApiMock({ duplicate: true, existing: undefined })

            const { activity, success } = await uploadDuplicate(api)

            expect(success).toBe(true)
            expect(activity.links).toEqual({ trainingpeaks: { activity_id: 'existing', url: CALENDAR_URL } })
            expect(activity.links?.trainingpeaks?.error).toBeUndefined()
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Upload duplicate', activityId: undefined, found: false })
        })

        test('searching the workout fails: still seen as uploaded', async () => {
            const api = ApiMock({ duplicate: true, findError: 'ECONNRESET' })

            const { activity, success } = await uploadDuplicate(api)

            expect(success).toBe(true)
            expect(activity.links?.trainingpeaks).toEqual({ activity_id: 'existing', url: CALENDAR_URL })
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Upload duplicate: workout not found', error: 'ECONNRESET' })
        })

        test('activity without a valid start time: still seen as uploaded, nothing is searched', async () => {
            const api = ApiMock({ duplicate: true, existing: { Id: 1 } })

            const { activity, success } = await uploadDuplicate(api, { startTime: 'garbage' })

            expect(success).toBe(true)
            expect(api.findWorkout).not.toHaveBeenCalled()
            expect(activity.links?.trainingpeaks?.activity_id).toBe('existing')
        })

        test('the activity is reported as uploaded by the app (status derived from the links)', async () => {
            const api = ApiMock({ duplicate: true, existing: { Id: 4711 } })

            const { activity } = await uploadDuplicate(api)

            // see ActivityRideService / getUploadStatus: success = no error and an activity_id
            const info = activity.links?.trainingpeaks
            expect(Boolean(info?.error) || !info?.activity_id).toBe(false)
        })
    })

    describe('file content', () => {
        // (the padding that the TCX exporter writes around the values is removed by the TrainingPeaks API)
        test('a tcx file is passed on unchanged', async () => {
            const api = ApiMock()
            const tcx = '<Id>\n      2026-11-15T06:00:00.000Z\n    </Id>'
            setupMocks({ api, files: { 'a.tcx': tcx } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            const { data } = (api.upload as jest.Mock).mock.calls[0][0]
            expect(Buffer.from(data, 'base64').toString('utf-8')).toBe(tcx)
        })

        test('a file that is delivered as Buffer is passed on unchanged', async () => {
            const api = ApiMock()
            const content = Buffer.from([0x0e, 0x10, 0x20, 0x0a, 0xff])
            setupMocks({ api, files: { 'a.fit': content } })

            await service.upload({ fitFileName: 'a.fit', title: 't' } as ActivityDetails, 'fit')

            const { data } = (api.upload as jest.Mock).mock.calls[0][0]
            expect(Buffer.from(data, 'base64').equals(content)).toBe(true)
        })
    })

    describe('file content delivered as base64 by the fs binding', () => {
        const tcx = '<?xml version="1.0"?><Id>2026-11-15T06:00:00.000Z</Id>'

        test('the file is requested as base64', async () => {
            const api = ApiMock()
            const { fs } = setupMocks({ api, files: { 'a.tcx': tcx } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(fs.readFile).toHaveBeenCalledWith('a.tcx', 'base64')
        })

        test('the base64 string is passed on to the api as it is', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': tcx } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect((api.upload as jest.Mock).mock.calls[0][0].data).toBe(Buffer.from(tcx).toString('base64'))
        })

        test('binary files are not modified (fit)', async () => {
            const api = ApiMock()
            const fit = Buffer.from([0x0e, 0x10, 0xff, 0x00, 0x80, 0x0a, 0x20, 0xfe])
            setupMocks({ api, files: { 'a.fit': fit } })

            const success = await service.upload({ fitFileName: 'a.fit', title: 't' } as ActivityDetails, 'fit')

            expect(success).toBe(true)
            expect(Buffer.from((api.upload as jest.Mock).mock.calls[0][0].data, 'base64').equals(fit)).toBe(true)
        })

        test('line breaks in the base64 string (as some platforms write them) are ignored', async () => {
            const api = ApiMock()
            const base64 = Buffer.from(tcx).toString('base64')
            const wrapped = base64.replaceAll(/(.{20})/g, '$1\r\n')
            // the mock returns the content as it is, so that the line breaks are delivered
            setupMocks({ api, raw: true, files: { 'a.tcx': wrapped } })

            const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(success).toBe(true)
            expect((api.upload as jest.Mock).mock.calls[0][0].data).toBe(base64)
        })

        test('logs the type and the size of the content, never the content', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': tcx } })
            const logSpy = jest.fn()
            service.on('log', logSpy)

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Upload file', contentType: 'string', bytes: tcx.length, isXml: true })
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain('<Id>')
        })

        test('text that is not xml is rejected with a meaningful error (e.g. a list of bytes)', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': '60,63,120,109,108' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails, 'tcx')

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(activity.links?.trainingpeaks?.error).toContain('activity file does not contain xml')
        })
    })

    describe('binding that does not apply the requested encoding', () => {
        const tcx = '<Id>\n      2026-11-15T06:00:00.000Z\n    </Id>'
        const bytes = Buffer.from(tcx, 'utf-8')

        // (the app asks for base64, but a binding could deliver the content in the format of the platform)
        const decoded = (api: Partial<TrainingPeaksApi>) =>
            Buffer.from((api.upload as jest.Mock).mock.calls[0][0].data, 'base64')

        // in the desktop app the content arrives via IPC as Uint8Array: toString('base64') on it returns "60,73,..." instead of base64
        test('Uint8Array', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': new Uint8Array(bytes) as unknown as Buffer } })

            const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(success).toBe(true)
            expect(decoded(api).toString('utf-8')).toBe(tcx)
        })

        test('Uint8Array that is a view on a part of a larger buffer', async () => {
            const api = ApiMock()
            const large = Buffer.concat([Buffer.from('xxxx'), bytes, Buffer.from('yyyy')])
            setupMocks({ api, raw: true, files: { 'a.tcx': new Uint8Array(large.buffer, large.byteOffset + 4, bytes.length) as unknown as Buffer } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(decoded(api).toString('utf-8')).toBe(tcx)
        })

        test('binary content as Uint8Array is not modified (fit)', async () => {
            const api = ApiMock()
            const fit = Uint8Array.from([0x0e, 0x10, 0xff, 0x00, 0x80, 0x0a, 0x20])
            setupMocks({ api, raw: true, files: { 'a.fit': fit as unknown as Buffer } })

            const success = await service.upload({ fitFileName: 'a.fit', title: 't' } as ActivityDetails, 'fit')

            expect(success).toBe(true)
            expect(decoded(api).equals(Buffer.from(fit))).toBe(true)
        })

        test('ArrayBuffer', async () => {
            const api = ApiMock()
            const arrayBuffer = new Uint8Array(bytes).buffer
            setupMocks({ api, raw: true, files: { 'a.tcx': arrayBuffer as unknown as Buffer } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(decoded(api).toString('utf-8')).toBe(tcx)
        })

        test('Buffer that was serialized as JSON', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': { type: 'Buffer', data: [...bytes] } as unknown as Buffer } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(decoded(api).toString('utf-8')).toBe(tcx)
        })

        test.each([
            ['string', '<?xml version="1.0"?><Id>1</Id>', 'string'],
            ['Uint8Array', new Uint8Array(Buffer.from('<?xml version="1.0"?><Id>1</Id>')), 'Uint8Array'],
            ['Buffer', Buffer.from('  <?xml version="1.0"?><Id>1</Id>'), 'Buffer'],
        ])('logs the type of the content, never the content: %s', async (_name, content, contentType) => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': content as unknown as Buffer } })
            const logSpy = jest.fn()
            service.on('log', logSpy)

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
                message: 'TrainingPeaks Upload file', contentType, isXml: true
            }))
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain('<Id>')
        })

        test('a list of bytes delivered as string (e.g. "60,73,100") fails with a meaningful error', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': '60,63,120,109,108' } })
            const logSpy = jest.fn()
            service.on('log', logSpy)

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails, 'tcx')

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'string', isXml: false }))
            expect(activity.links?.trainingpeaks?.error).toBe('activity file does not contain xml (content type: string)')
        })

        test('a tcx file without xml declaration and with a BOM is accepted', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': '\uFEFF<TrainingCenterDatabase></TrainingCenterDatabase>' } })

            const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(success).toBe(true)
        })

        test('unsupported type: error is stored in the links, nothing is uploaded', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': { some: 'object' } as unknown as Buffer } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails, 'tcx')

            expect(success).toBe(false)
            expect(api.upload).not.toHaveBeenCalled()
            expect(activity.links?.trainingpeaks?.error).toBe('activity file has an unsupported content type')
        })
    })

    describe('upload file name', () => {
        // TrainingPeaks rejects names that contain / \ ? % * : | " < > or a space, or a dot other than the one of the extension
        test.each([
            ['/data/ride.tcx', 'tcx', 'ride.tcx'],
            ['C:\\Users\\me\\activities\\ride.tcx', 'tcx', 'ride.tcx'],
            ['/data/My Ride (1).tcx', 'tcx', 'My_Ride_(1).tcx'],
            ['/data/2026-11-15 10:30:00.v2.tcx', 'tcx', '2026-11-15_10_30_00_v2.tcx'],
            ['/data/a%b*c?d.tcx', 'tcx', 'a_b_c_d.tcx'],
            ['/data/.tcx', 'tcx', 'activity.tcx'],
            ['/data/ride', 'fit', 'ride.fit'],
        ])('%s', async (path, format, expected) => {
            const api = ApiMock()
            setupMocks({ api, files: { [path]: format === 'fit' ? Buffer.from([1, 2, 3]) : '<xml/>' } })

            await service.upload({ [`${format}FileName`]: path, title: 't' } as unknown as ActivityDetails, format)

            expect((api.upload as jest.Mock).mock.calls[0][0].fileName).toBe(expected)
        })
    })

    describe('getUrl', () => {
        // TrainingPeaks can not link to a workout (or a date), so the activity is linked to the calendar
        test('is the url of the calendar, as provided by the api (production or sandbox)', () => {
            const api = ApiMock()
            setupMocks({ api })

            expect(service.getUrl()).toBe(CALENDAR_URL)

            ;(api.getCalendarUrl as jest.Mock).mockReturnValue('https://app.sandbox.trainingpeaks.com/#calendar')
            expect(service.getUrl()).toBe('https://app.sandbox.trainingpeaks.com/#calendar')
        })
    })
})
