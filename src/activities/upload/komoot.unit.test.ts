// Load the apps barrel before the upload module: importing the upload factory first
// creates a circular import that breaks ActivityUploadFactory construction.
import '../../apps'
import type { KomootApi } from '../../apps'
import type { KomootAppConnection } from '../../apps/komoot'
import { getBindings } from '../../api'
import { Inject } from '../../base/decorators/Injection'
import { ActivityDetails } from '../base'
import { KomootUpload } from './komoot'

const ApiMock = (props: { uploadResponse?: { id: number }, uploadError?: string } = {}): Partial<KomootApi> => {
    const result: Partial<KomootApi> = {
        uploadTour: jest.fn().mockResolvedValue(props.uploadResponse ?? { id: 0 })
    }
    if (props.uploadError) {
        result.uploadTour = jest.fn().mockRejectedValue(new Error(props.uploadError))
    }
    return result
}

const AppConnectionMock = (initialized: boolean, connected: boolean, api: unknown): Partial<KomootAppConnection> => ({
    init: jest.fn().mockReturnValue(initialized),
    isConnected: jest.fn().mockReturnValue(connected),
    getApi: jest.fn().mockReturnValue(api)
})

type FsMock = {
    existsFile: jest.Mock
    readFile: jest.Mock
}

const FsMock = (files: Record<string, Uint8Array | 'throw'> = {}, existsError?: boolean): FsMock => ({
    existsFile: jest.fn(async (fileName: string) => {
        if (existsError)
            throw new Error('fs error')
        return fileName in files
    }),
    readFile: jest.fn((fileName: string) => {
        const content = files[fileName]
        if (content === 'throw')
            throw new Error('read error')
        return content
    })
})

type MockDefinition = {
    api?: Partial<KomootApi>
    connection?: Partial<KomootAppConnection>
    initialized?: boolean
    connected?: boolean
}

describe('KomootUpload', () => {

    let service: KomootUpload
    let originalFs: unknown
    const logSpy = jest.fn()

    const setupMocks = (mocks: MockDefinition) => {
        const connection = mocks.connection ?? AppConnectionMock(mocks.initialized ?? false, mocks.connected ?? false, mocks.api)
        Inject('KomootAppConnection', connection)
    }

    const setupFs = (fs: FsMock) => {
        Object.assign(getBindings(), { fs })
    }

    const createService = () => {
        service = new KomootUpload()
        service.on('log', logSpy)
    }

    beforeEach(() => {
        originalFs = getBindings().fs
        logSpy.mockClear()
    })

    afterEach(() => {
        Inject('KomootAppConnection', null)
        Object.assign(getBindings(), { fs: originalFs })
        service?.reset()
        jest.clearAllMocks()
    })

    describe('init', () => {

        test('connection initialized', () => {
            setupMocks({ initialized: true, connected: true, api: ApiMock() })
            createService()

            expect(service.init()).toBe(true)
            expect(service.isConnected()).toBe(true)
        })

        test('connection not initialized (user settings not yet loaded)', () => {
            setupMocks({ initialized: false, api: ApiMock() })
            createService()

            expect(service.init()).toBe(false)
            expect(service.isConnected()).toBe(false)
            expect(logSpy).not.toHaveBeenCalled()
        })
    })

    describe('isConnected', () => {

        test('returns true when the app connection is connected', () => {
            const connection = AppConnectionMock(true, true, ApiMock())
            setupMocks({ connection })
            createService()

            expect(service.isConnected()).toBe(true)
            expect(connection.isConnected).toHaveBeenCalled()
        })

        test('returns false when the app connection is not connected', () => {
            setupMocks({ initialized: true, connected: false, api: ApiMock() })
            createService()

            expect(service.isConnected()).toBe(false)
        })
    })

    describe('upload', () => {

        test('successful fit upload', async () => {
            const api = ApiMock({ uploadResponse: { id: 12345 } })
            setupMocks({ initialized: true, connected: true, api })
            const fs = FsMock({ 'test.fit': new Uint8Array([1, 2, 3]) })
            setupFs(fs)
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(true)
            expect(activity.links).toMatchObject({
                komoot: {
                    activity_id: '12345',
                    url: 'https://www.komoot.com/tour/12345'
                }
            })
            expect(api.uploadTour).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'fit', 'racebike', 'test')
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Komoot Upload', requestedFormat: 'FIT', uploadFormat: 'fit' }))
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Komoot Upload success', activityId: 12345 }))
        })

        test('format defaults to fit', async () => {
            const api = ApiMock({ uploadResponse: { id: 1 } })
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.fit': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            expect(await service.upload(activity as ActivityDetails)).toBe(true)
            expect(api.uploadTour).toHaveBeenCalledWith(expect.anything(), 'fit', 'racebike', 'test')
        })

        
        test('tcx is not supported and falls back to fit', async () => {
            const api = ApiMock({ uploadResponse: { id: 2 } })
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.fit': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', tcxFileName: 'test.tcx', title: 'test' }

            expect(await service.upload(activity as ActivityDetails, 'tcx')).toBe(true)
            expect(api.uploadTour).toHaveBeenCalledWith(expect.anything(), 'fit', 'racebike', 'test')
        })

        test('tcx is not supported and fails if fit file is not available as fallback', async () => {
            const api = ApiMock({ uploadResponse: { id: 2 } })
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.tcx': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { tcxFileName: 'test.tcx', title: 'test' }

            expect(await service.upload(activity as ActivityDetails, 'tcx')).toBe(false)
            expect(api.uploadTour).not.toHaveBeenCalled()
            expect(activity.links).toMatchObject({ komoot: { error: 'data not exported to FIT' } })

        })


        test('successful gpx upload', async () => {
            const api = ApiMock({ uploadResponse: { id: 777 } })
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.gpx': new Uint8Array([9, 8]) }))
            createService()

            const activity = { gpxFileName: 'test.gpx', title: 'trail' } as Partial<ActivityDetails>

            expect(await service.upload(activity as ActivityDetails, 'gpx')).toBe(true)
            expect(api.uploadTour).toHaveBeenCalledWith(Buffer.from([9, 8]), 'gpx', 'racebike', 'trail')
            expect(activity.links).toMatchObject({ komoot: { activity_id: '777', url: 'https://www.komoot.com/tour/777' } })
        })

        test('format is case insensitive', async () => {
            const api = ApiMock({ uploadResponse: { id: 3 } })
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.gpx': new Uint8Array([1]) }))
            createService()

            const activity = { gpxFileName: 'test.gpx', title: 'test' } as Partial<ActivityDetails>

            expect(await service.upload(activity as ActivityDetails, 'GPX')).toBe(true)
            expect(api.uploadTour).toHaveBeenCalledWith(expect.anything(), 'gpx', 'racebike', 'test')
        })

        test('creates links object if the activity has none', async () => {
            setupMocks({ initialized: true, connected: true, api: ApiMock({ uploadResponse: { id: 4 } }) })
            setupFs(FsMock({ 'test.fit': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }
            expect(activity.links).toBeUndefined()

            await service.upload(activity as ActivityDetails, 'fit')
            expect(activity.links.komoot).toBeDefined()
        })

        test('upload rejected by komoot', async () => {
            const api = ApiMock({ uploadError: 'HTTP 500: {}' })
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.fit': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(activity.links).toMatchObject({ komoot: { error: 'HTTP 500: {}' } })
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Komoot Upload failure', error: 'HTTP 500: {}' }))
        })

        test('activity file does not exist', async () => {
            const api = ApiMock()
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({}))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'missing.fit', title: 'test' }

            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(activity.links).toMatchObject({ komoot: { error: 'file could not be read: missing.fit' } })
            expect(api.uploadTour).not.toHaveBeenCalled()
        })

        test('file read throws', async () => {
            const api = ApiMock()
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({ 'test.fit': 'throw' }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(activity.links).toMatchObject({ komoot: { error: 'file could not be read: test.fit' } })
            expect(api.uploadTour).not.toHaveBeenCalled()
        })

        test('file system check throws', async () => {
            const api = ApiMock()
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({}, true))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            expect(await service.upload(activity as ActivityDetails, 'fit')).toBe(false)
            expect(activity.links).toMatchObject({ komoot: { error: 'file could not be read: test.fit' } })
        })

        test('unsupported format', async () => {
            const api = ApiMock()
            setupMocks({ initialized: true, connected: true, api })
            setupFs(FsMock({}))
            createService()

            const activity: Partial<ActivityDetails> = { title: 'test' }

            expect(await service.upload(activity as ActivityDetails, 'xyz')).toBe(false)
            expect(api.uploadTour).not.toHaveBeenCalled()
        })

        test('not connected', async () => {
            const api = ApiMock()
            setupMocks({ initialized: true, connected: false, api })
            setupFs(FsMock({ 'test.fit': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            expect(await service.upload(activity as ActivityDetails, 'fit')).toBe(false)
            expect(activity.links).toBeUndefined()
            expect(api.uploadTour).not.toHaveBeenCalled()
        })

        test('not initialized', async () => {
            const api = ApiMock()
            setupMocks({ initialized: false, connected: false, api })
            setupFs(FsMock({ 'test.fit': new Uint8Array([1]) }))
            createService()

            const activity: Partial<ActivityDetails> = { fitFileName: 'test.fit', title: 'test' }

            expect(await service.upload(activity as ActivityDetails, 'fit')).toBe(false)
            expect(activity.links).toBeUndefined()
            expect(logSpy).toHaveBeenCalledWith({ message: 'Komoot Upload skipped', reason: 'not initialized' })
            expect(api.uploadTour).not.toHaveBeenCalled()
        })
    })

    describe('getUrl', () => {

        test('returns the komoot tour url for an activity id', () => {
            setupMocks({ initialized: true, connected: true, api: ApiMock() })
            createService()

            expect(service.getUrl('987')).toBe('https://www.komoot.com/tour/987')
        })
    })
})
