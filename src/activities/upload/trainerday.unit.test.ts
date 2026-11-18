// the apps module has to be loaded first (it registers the uploaders and depends on the upload factory)
import '../../apps'
import { TrainerDayApi, TrainerDayAppConnection } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { ActivityDetails } from '../base'
import { TrainerDayUpload, TRAINERDAY_ACTIVITY_URL } from './trainerday'

const ApiMock = (props: { activityId?: unknown, duplicate?: boolean, uploadError?: string } = {}): Partial<TrainerDayApi> => ({
    uploadActivity: props.uploadError
        ? jest.fn().mockRejectedValue(new Error(props.uploadError))
        : jest.fn().mockResolvedValue({ activityId: 'activityId' in props ? props.activityId : 'td-1', duplicate: props.duplicate })
})

const ConnectionMock = (initialized: boolean, connected: boolean, api?: Partial<TrainerDayApi>): Partial<TrainerDayAppConnection> => ({
    init: jest.fn().mockReturnValue(initialized),
    isConnected: jest.fn().mockReturnValue(connected),
    getApi: jest.fn().mockReturnValue(api)
})

/**
 * @param raw simulates a binding that ignores the requested encoding and delivers the content as it is
 *            (otherwise the mock behaves like the bindings of the apps: `readFile(file, 'base64')` returns a base64 string)
 */
const FileSystemMock = (files: Record<string, unknown> = {}, raw = false) => ({
    existsFile: jest.fn(async (name: string) => name in files),
    readFile: jest.fn(async (name: string, encoding?: string) => {
        const content = files[name]
        if (raw || encoding !== 'base64' || !content)
            return content
        return (typeof content === 'string' ? Buffer.from(content, 'utf-8') : content as Buffer).toString('base64')
    })
})

describe('TrainerDayUpload', () => {

    let service: TrainerDayUpload

    const setupMocks = (props: { initialized?: boolean, connected?: boolean, api?: Partial<TrainerDayApi>, files?: Record<string, unknown>, raw?: boolean }) => {
        const connection = ConnectionMock(props.initialized ?? true, props.connected ?? true, props.api)
        const fs = FileSystemMock(props.files, props.raw)
        Inject('TrainerDayAppConnection', connection)
        Inject('FileSystem', fs)
        return { connection, fs }
    }

    const sentData = (api: Partial<TrainerDayApi>) => (api.uploadActivity as jest.Mock).mock.calls[0][0].data

    beforeEach(() => {
        service = new TrainerDayUpload()
    })

    afterEach(() => {
        Inject('TrainerDayAppConnection', null)
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
            const api = ApiMock({ activityId: '777' })
            setupMocks({ api, files: { '/data/ride.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { id: 'abc', tcxFileName: '/data/ride.tcx', title: 'Morning Ride' }
            const success = await service.upload(activity as ActivityDetails, 'TCX')

            expect(success).toBe(true)
            expect(api.uploadActivity).toHaveBeenCalledWith({
                name: 'Morning Ride',
                dataType: 'tcx',
                data: Buffer.from('<xml/>').toString('base64'),
                externalId: 'abc',
                sportType: 'bike'
            })
            expect(activity.links).toEqual({ trainerday: { activity_id: '777', url: `${TRAINERDAY_ACTIVITY_URL}/777` } })
        })

        test('a duplicate counts as success and links the activity that already exists', async () => {
            const api = ApiMock({ activityId: 'existing-1', duplicate: true })
            setupMocks({ api, files: { '/data/ride.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { id: 'abc', tcxFileName: '/data/ride.tcx', title: 'Morning Ride' }
            const success = await service.upload(activity as ActivityDetails, 'TCX')

            expect(success).toBe(true)
            expect(activity.links).toEqual({ trainerday: { activity_id: 'existing-1', url: `${TRAINERDAY_ACTIVITY_URL}/existing-1` } })
        })

        test('uses TCX by default', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': '<xml/>' } })

            const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails)

            expect(success).toBe(true)
            expect((api.uploadActivity as jest.Mock).mock.calls[0][0].dataType).toBe('tcx')
        })

        test('successful fit upload: binary content is sent as base64', async () => {
            const content = Buffer.from([0x0e, 0x10, 0xff, 0x00, 0x80])
            const api = ApiMock()
            setupMocks({ api, files: { '/data/ride.fit': content } })

            const success = await service.upload({ fitFileName: '/data/ride.fit', title: 't' } as ActivityDetails, 'fit')

            expect(success).toBe(true)
            expect((api.uploadActivity as jest.Mock).mock.calls[0][0]).toMatchObject({ dataType: 'fit', data: content.toString('base64') })
        })

        test('rowing activity: no sport type is sent', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.fit': Buffer.from([1, 2, 3, 4]) } })

            await service.upload({ fitFileName: 'a.fit', title: 't', sport: 'rowing' } as ActivityDetails, 'fit')

            expect((api.uploadActivity as jest.Mock).mock.calls[0][0].sportType).toBeUndefined()
        })

        test('keeps the links to other apps', async () => {
            setupMocks({ api: ApiMock(), files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't', links: { strava: { activity_id: '1' } } }
            await service.upload(activity as ActivityDetails)

            expect(activity.links?.strava).toEqual({ activity_id: '1' })
            expect(activity.links?.trainerday?.activity_id).toBe('td-1')
        })

        test('activity.links undefined: is created', async () => {
            setupMocks({ api: ApiMock(), files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't', links: undefined }
            await service.upload(activity as ActivityDetails)

            expect(activity.links?.trainerday?.activity_id).toBe('td-1')
        })

        test('success rule of the app: no error and a non-empty activity_id', async () => {
            setupMocks({ api: ApiMock({ activityId: 4711 }), files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            await service.upload(activity as ActivityDetails)

            const info = activity.links?.trainerday
            expect(info?.activity_id).toBe('4711')
            expect(Boolean(info?.error) || !info?.activity_id).toBe(false)
        })

        test.each([[undefined], [''], [null]])('no activity id returned (%p): failure', async (activityId) => {
            setupMocks({ api: ApiMock({ activityId }), files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(activity.links).toEqual({ trainerday: { error: 'TrainerDay did not return an activity id' } })
        })

        test('not connected: skipped without touching the activity', async () => {
            const api = ApiMock()
            setupMocks({ api, connected: false })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
            expect(activity.links).toBeUndefined()
        })

        test('not initialized: skipped', async () => {
            const api = ApiMock()
            setupMocks({ api, initialized: false })

            const success = await service.upload({ tcxFileName: 'a.tcx' } as ActivityDetails)

            expect(success).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainerDay Upload skipped', reason: 'not initialized' })
        })

        test('unsupported format: error is stored in the links', async () => {
            const api = ApiMock()
            setupMocks({ api })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx' }
            const success = await service.upload(activity as ActivityDetails, 'gpx')

            expect(success).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
            expect(activity.links?.trainerday?.error).toBe('format GPX is not supported by TrainerDay')
        })

        test('activity without a file for the format: error is stored in the links', async () => {
            setupMocks({ api: ApiMock() })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx' }
            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(activity.links?.trainerday?.error).toBe('no FIT file available for this activity')
        })

        test('file does not exist: error is stored in the links', async () => {
            const api = ApiMock()
            setupMocks({ api, files: {} })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'missing.tcx' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
            expect(activity.links?.trainerday?.error).toBe('activity file not found')
        })

        test('empty file: error is stored in the links', async () => {
            setupMocks({ api: ApiMock(), files: { 'empty.tcx': '' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'empty.tcx' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(activity.links?.trainerday?.error).toBe('activity file is empty')
        })

        test('rejection by TrainerDay: error is stored in the links', async () => {
            const api = ApiMock({ uploadError: 'Upload rejected by TrainerDay (HTTP 400): invalid' })
            setupMocks({ api, files: { 'a.tcx': '<xml/>' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails)

            expect(success).toBe(false)
            expect(activity.links).toEqual({ trainerday: { error: 'Upload rejected by TrainerDay (HTTP 400): invalid' } })
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainerDay Upload failure', error: 'Upload rejected by TrainerDay (HTTP 400): invalid' })
        })

        test('fit file delivered as text by a binding that ignores the encoding: fails', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'ride.fit': 'not-binary' } })

            const activity: Partial<ActivityDetails> = { fitFileName: 'ride.fit', title: 't' }
            const success = await service.upload(activity as ActivityDetails, 'fit')

            expect(success).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
            expect(activity.links?.trainerday?.error).toBe('binary file could not be read')
        })
    })

    describe('activity name', () => {
        const nameOf = async (props: Partial<ActivityDetails>) => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': '<xml/>' } })
            await service.upload({ tcxFileName: 'a.tcx', ...props } as ActivityDetails)
            return (api.uploadActivity as jest.Mock).mock.calls[0][0].name
        }

        test('title', async () => {
            expect(await nameOf({ title: '  My Ride ', route: { name: 'Route' } as ActivityDetails['route'] })).toBe('My Ride')
        })

        test('route name if the title is empty', async () => {
            expect(await nameOf({ title: '', route: { name: 'Route' } as ActivityDetails['route'] })).toBe('Route')
        })

        test('date if there is no title and no route', async () => {
            expect(await nameOf({ startTime: '2026-11-15T07:10:13.303Z' })).toBe('Incyclist ride 2026-11-15')
        })

        test('fallback if nothing is known', async () => {
            expect(await nameOf({})).toBe('Incyclist ride')
        })
    })

    describe('file content', () => {
        const tcx = '<?xml version="1.0"?><Id>2026-11-15T06:00:00.000Z</Id>'
        const bytes = Buffer.from(tcx, 'utf-8')

        test('the file is requested as base64 and passed on as it is', async () => {
            const api = ApiMock()
            const { fs } = setupMocks({ api, files: { 'a.tcx': tcx } })

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(fs.readFile).toHaveBeenCalledWith('a.tcx', 'base64')
            expect(sentData(api)).toBe(bytes.toString('base64'))
        })

        test('line breaks in the base64 string are ignored', async () => {
            const api = ApiMock()
            const base64 = bytes.toString('base64')
            setupMocks({ api, raw: true, files: { 'a.tcx': base64.replaceAll(/(.{20})/g, '$1\r\n') } })

            const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(success).toBe(true)
            expect(sentData(api)).toBe(base64)
        })

        test('does not rely on Buffer (not available on React Native)', async () => {
            const api = ApiMock()
            const base64 = bytes.toString('base64')
            setupMocks({ api, raw: true, files: { 'a.tcx': base64 } })
            const original = globalThis.Buffer
            Object.defineProperty(globalThis, 'Buffer', { value: undefined, configurable: true, writable: true })

            let success: boolean
            try {
                success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')
            }
            finally {
                Object.defineProperty(globalThis, 'Buffer', { value: original, configurable: true, writable: true })
            }

            expect(success).toBe(true)
            expect(sentData(api)).toBe(base64)
        })

        test('logs the type and the size of the content, never the content', async () => {
            const api = ApiMock()
            setupMocks({ api, files: { 'a.tcx': tcx } })
            const logSpy = jest.fn()
            service.on('log', logSpy)

            await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainerDay Upload file', contentType: 'string', bytes: tcx.length, isXml: true })
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain('<Id>')
        })

        test('text that is not xml (e.g. a list of bytes) is rejected with a meaningful error', async () => {
            const api = ApiMock()
            setupMocks({ api, raw: true, files: { 'a.tcx': '60,63,120,109,108' } })

            const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
            const success = await service.upload(activity as ActivityDetails, 'tcx')

            expect(success).toBe(false)
            expect(api.uploadActivity).not.toHaveBeenCalled()
            expect(activity.links?.trainerday?.error).toBe('activity file does not contain xml (content type: string)')
        })

        describe('binding that does not apply the requested encoding', () => {
            const decoded = (api: Partial<TrainerDayApi>) => {
                const data = sentData(api)
                return typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data)
            }

            // in the desktop app the content arrives via IPC as Uint8Array: toString('base64') on it returns "60,73,..."
            test('Uint8Array', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': new Uint8Array(bytes) } })

                const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(success).toBe(true)
                expect(decoded(api).toString('utf-8')).toBe(tcx)
            })

            test('Uint8Array that is a view on a part of a larger buffer', async () => {
                const api = ApiMock()
                const large = Buffer.concat([Buffer.from('xxxx'), bytes, Buffer.from('yyyy')])
                setupMocks({ api, raw: true, files: { 'a.tcx': new Uint8Array(large.buffer, large.byteOffset + 4, bytes.length) } })

                await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(decoded(api).toString('utf-8')).toBe(tcx)
            })

            test('Buffer', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': Buffer.from('  ' + tcx) } })
                const logSpy = jest.fn()
                service.on('log', logSpy)

                const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(success).toBe(true)
                expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'Buffer', isXml: true }))
            })

            test('binary content as Uint8Array is not modified (fit)', async () => {
                const api = ApiMock()
                const fit = Uint8Array.from([0x0e, 0x10, 0xff, 0x00, 0x80, 0x0a, 0x20])
                setupMocks({ api, raw: true, files: { 'a.fit': fit } })

                const success = await service.upload({ fitFileName: 'a.fit', title: 't' } as ActivityDetails, 'fit')

                expect(success).toBe(true)
                expect(decoded(api).equals(Buffer.from(fit))).toBe(true)
            })

            test('ArrayBuffer', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': new Uint8Array(bytes).buffer } })

                await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(decoded(api).toString('utf-8')).toBe(tcx)
            })

            test('Buffer that was serialized as JSON', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': { type: 'Buffer', data: [...bytes] } } })

                await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(decoded(api).toString('utf-8')).toBe(tcx)
            })

            test('plain text (not base64)', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': '<a>text</a>' } })

                const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(success).toBe(true)
                expect(decoded(api).toString('utf-8')).toBe('<a>text</a>')
            })

            test('a tcx file with a BOM is accepted', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': new Uint8Array(Buffer.from('﻿<TrainingCenterDatabase/>')) } })

                const success = await service.upload({ tcxFileName: 'a.tcx', title: 't' } as ActivityDetails, 'tcx')

                expect(success).toBe(true)
            })

            test('unsupported type: error is stored in the links, nothing is uploaded', async () => {
                const api = ApiMock()
                setupMocks({ api, raw: true, files: { 'a.tcx': { some: 'object' } } })

                const activity: Partial<ActivityDetails> = { tcxFileName: 'a.tcx', title: 't' }
                const success = await service.upload(activity as ActivityDetails, 'tcx')

                expect(success).toBe(false)
                expect(api.uploadActivity).not.toHaveBeenCalled()
                expect(activity.links?.trainerday?.error).toBe('activity file has an unsupported content type')
            })
        })
    })

    describe('getUrl', () => {
        test('returns the url of the activity on TrainerDay', () => {
            expect(service.getUrl('6afdb6974061e464d38dcb3c')).toBe('https://app.trainerday.com/activities/6afdb6974061e464d38dcb3c')
        })
    })
})
