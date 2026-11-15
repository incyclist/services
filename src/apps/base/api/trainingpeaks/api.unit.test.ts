import { TrainingPeaksApi } from './api'
import { TrainingPeaksConfig, TrainingPeaksDuplicateError } from './types'

describe('TrainingPeaks API', () => {
    let api
    let restClient
    let settings

    const NOW = new Date('2026-01-01T10:00:00Z').valueOf()

    const initialConfig: TrainingPeaksConfig = {
        id: '42',
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        expiration: new Date(NOW + 60_000)
    }

    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(NOW)

        api = new TrainingPeaksApi()
        restClient = { request: jest.fn() }
        settings = { get: jest.fn((_key, def) => def) }

        api.getApi = jest.fn(() => restClient)
        api.getUserSettings = jest.fn(() => settings)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('init', () => {
        test('returns an observer and authenticates', () => {
            const observer = api.init({ ...initialConfig })
            expect(observer).toBeDefined()
            expect(api.isAuthenticated()).toBe(true)
        })
    })

    describe('update', () => {
        test('merges the new config', () => {
            api.init({ ...initialConfig })
            api.update({ accessToken: 'new' })
            expect(api.config).toMatchObject({ id: '42', accessToken: 'new', refreshToken: 'old-refresh-token' })
        })

        test('throws if not initialized', () => {
            expect(() => api.update({ accessToken: 'new' })).toThrow('update not allowed before init')
        })
    })

    describe('isAuthenticated', () => {
        test('false before init', () => {
            expect(api.isAuthenticated()).toBe(false)
        })

        test('false after init with undefined (disconnect)', () => {
            api.init(undefined)
            expect(api.isAuthenticated()).toBe(false)
        })

        test('false without access token', () => {
            api.init({ ...initialConfig, accessToken: undefined })
            expect(api.isAuthenticated()).toBe(false)
        })
    })

    describe('get', () => {
        test('throws if not authenticated', async () => {
            await expect(api.get('/v1/athlete/profile')).rejects.toThrow('not authenticated')
            expect(restClient.request).not.toHaveBeenCalled()
        })

        test('sends the bearer token without refreshing while the token is valid', async () => {
            api.init({ ...initialConfig })
            restClient.request.mockResolvedValue({ data: { ok: true } })

            const response = await api.get('/v1/athlete/profile')

            expect(restClient.request).toHaveBeenCalledTimes(1)
            expect(restClient.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'get',
                url: 'https://api.trainingpeaks.com/v1/athlete/profile',
                headers: { Authorization: 'Bearer old-access-token' }
            }))
            expect(response.data).toEqual({ ok: true })
        })

        test('uses the API url from the user settings (sandbox)', async () => {
            settings.get.mockImplementation((key, def) => key === 'TP_API' ? 'https://api.sandbox.trainingpeaks.com' : def)
            api.init({ ...initialConfig })
            restClient.request.mockResolvedValue({ data: {} })

            await api.get('/v1/athlete/profile')

            expect(restClient.request.mock.calls[0][0].url).toBe('https://api.sandbox.trainingpeaks.com/v1/athlete/profile')
        })

        test('refreshes an expired token first and uses the new one', async () => {
            api.init({ ...initialConfig, expiration: new Date(NOW - 1000) })
            restClient.request
                .mockResolvedValueOnce({ data: { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 600 } })
                .mockResolvedValueOnce({ data: {} })

            await api.get('/v1/athlete/profile')

            expect(restClient.request).toHaveBeenCalledTimes(2)
            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.incyclist.com/trainingpeaks/refresh')
            expect(restClient.request.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer new-access-token' })
        })

        test('refreshes if there is no expiration', async () => {
            api.init({ ...initialConfig, expiration: undefined })
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.get('/v1/athlete/profile')

            expect(restClient.request.mock.calls[0][0].url).toContain('/trainingpeaks/refresh')
        })

        test('throws and does not call TrainingPeaks if the refresh failed', async () => {
            api.init({ ...initialConfig, expiration: new Date(NOW - 1000) })
            restClient.request.mockRejectedValue({ response: { status: 401, statusText: 'Unauthorized' } })

            await expect(api.get('/v1/athlete/profile')).rejects.toThrow('token refresh failed')
            expect(restClient.request).toHaveBeenCalledTimes(1)
        })
    })

    describe('refreshToken', () => {
        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('calls the auth-server, not TrainingPeaks directly, and sends only the refresh token', async () => {
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            const request = restClient.request.mock.calls[0][0]
            expect(request.method).toBe('post')
            expect(request.url).toBe('https://auth.incyclist.com/trainingpeaks/refresh')
            expect(request.data).toEqual({ refresh_token: 'old-refresh-token' })
        })

        test('updates tokens and expiration and emits token.updated', async () => {
            restClient.request.mockResolvedValue({ data: { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 600 } })
            const tokenUpdated = jest.fn()
            api.observer.on('token.updated', tokenUpdated)

            await api.refreshToken()

            expect(api.config.accessToken).toBe('new-access-token')
            expect(api.config.refreshToken).toBe('new-refresh-token')
            expect(api.config.expiration).toEqual(new Date(NOW + 600_000))
            expect(tokenUpdated).toHaveBeenCalledWith(expect.objectContaining({
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token'
            }))
        })

        test('falls back to the expiration calculated by the auth-server', async () => {
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expiration: String(NOW + 123_000) } })

            await api.refreshToken()

            expect(api.config.expiration).toEqual(new Date(NOW + 123_000))
        })

        test('uses the auth-server url from the user settings', async () => {
            settings.get.mockImplementation((key, def) => key === 'TP_AUTH_SERVER_URL' ? 'https://auth.staging.incyclist.com' : def)
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.staging.incyclist.com/trainingpeaks/refresh')
        })

        test('falls back to the default urls if the user settings are not available', async () => {
            settings.get.mockImplementation(() => { throw new Error('not initialized') })
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.incyclist.com/trainingpeaks/refresh')
            expect(api.getBaseUrl()).toBe('https://api.trainingpeaks.com')
        })

        test('rethrows on failure, keeps the old tokens and does not emit', async () => {
            restClient.request.mockRejectedValue(new Error('ECONNRESET'))
            const tokenUpdated = jest.fn()
            api.observer.on('token.updated', tokenUpdated)

            await expect(api.refreshToken()).rejects.toThrow('ECONNRESET')

            expect(api.config.accessToken).toBe('old-access-token')
            expect(api.config.refreshToken).toBe('old-refresh-token')
            expect(tokenUpdated).not.toHaveBeenCalled()
        })
    })

    describe('getWorkouts', () => {
        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('requests the workouts of the range (local days) and returns them', async () => {
            const workouts = [{ Id: 1, WorkoutDay: '2026-01-05T00:00:00', WorkoutType: 'Bike' }]
            restClient.request.mockResolvedValue({ data: workouts })

            const result = await api.getWorkouts(new Date(2026, 0, 5), new Date(2026, 1, 3))

            expect(result).toEqual(workouts)
            const request = restClient.request.mock.calls[0][0]
            expect(request.method).toBe('get')
            expect(request.url).toBe('https://api.trainingpeaks.com/v2/workouts/2026-01-05/2026-02-03')
            expect(request.headers).toEqual({ Authorization: 'Bearer old-access-token' })
        })

        test('returns an empty list if there is no data', async () => {
            restClient.request.mockResolvedValue({ data: undefined })

            expect(await api.getWorkouts(new Date(2026, 0, 5), new Date(2026, 0, 6))).toEqual([])
        })

        test('rejects a range of more than 45 days without calling TrainingPeaks', async () => {
            await expect(api.getWorkouts(new Date(2026, 0, 1), new Date(2026, 2, 1))).rejects.toThrow('invalid range')
            expect(restClient.request).not.toHaveBeenCalled()
        })

        test('rejects an end date before the start date', async () => {
            await expect(api.getWorkouts(new Date(2026, 0, 10), new Date(2026, 0, 1))).rejects.toThrow('invalid range')
        })

        test('only accepts successful responses (a 403 must not be treated as success)', async () => {
            restClient.request.mockResolvedValue({ data: [] })

            await api.getWorkouts(new Date(2026, 0, 5), new Date(2026, 0, 6))

            const { validateStatus } = restClient.request.mock.calls[0][0]
            expect(validateStatus(200)).toBe(true)
            expect(validateStatus(202)).toBe(true)
            expect(validateStatus(403)).toBe(false)
            expect(validateStatus(422)).toBe(false)
        })

        test('refreshes an expired token first', async () => {
            api.init({ ...initialConfig, expiration: new Date(NOW - 1000) })
            restClient.request
                .mockResolvedValueOnce({ data: { access_token: 'new-at', refresh_token: 'new-rt', expires_in: 600 } })
                .mockResolvedValueOnce({ data: [] })

            await api.getWorkouts(new Date(2026, 0, 5), new Date(2026, 0, 6))

            expect(restClient.request.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer new-at' })
        })
    })

    describe('getWorkoutFile', () => {
        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('downloads the file as text in the requested format', async () => {
            restClient.request.mockResolvedValue({ data: '<workout_file/>' })

            const result = await api.getWorkoutFile(12345, 'zwo')

            expect(result).toBe('<workout_file/>')
            const request = restClient.request.mock.calls[0][0]
            expect(request.url).toBe('https://api.trainingpeaks.com/v2/workouts/wod/file/12345/?format=zwo')
            expect(request.responseType).toBe('text')
        })

        test('uses zwo by default', async () => {
            restClient.request.mockResolvedValue({ data: '' })

            await api.getWorkoutFile('99')

            expect(restClient.request.mock.calls[0][0].url).toContain('format=zwo')
        })
    })

    describe('upload', () => {
        const props = { fileName: 'ride.tcx', data: 'QUJD', title: 'My Ride', comment: 'test', type: 'bike' }

        beforeEach(() => {
            api.init({ ...initialConfig })
            api.waitForReady = jest.fn().mockResolvedValue(undefined)
        })

        const accepted = (location = 'https://api.trainingpeaks.com/v3/status/abc-123') =>
            ({ status: 202, headers: { location }, data: undefined })

        test('posts the file as json, polls the status url and returns the id of the created workout', async () => {
            restClient.request
                .mockResolvedValueOnce(accepted())
                .mockResolvedValueOnce({ data: { Completed: true, Status: 'Success', WorkoutIds: [777] } })

            const result = await api.upload(props)

            expect(result).toEqual({ trainingPeaksId: '777' })

            const post = restClient.request.mock.calls[0][0]
            expect(post.method).toBe('post')
            expect(post.url).toBe('https://api.trainingpeaks.com/v3/file')
            expect(post.headers).toEqual({ Authorization: 'Bearer old-access-token' })
            expect(post.data).toEqual({
                UploadClient: 'Incyclist',
                Filename: 'ride.tcx',
                Data: 'QUJD',
                Title: 'My Ride',
                Comment: 'test',
                Type: 'bike'
            })

            const status = restClient.request.mock.calls[1][0]
            expect(status.method).toBe('get')
            expect(status.url).toBe('https://api.trainingpeaks.com/v3/status/abc-123')
        })

        describe('content of the file', () => {
            const padded = '<?xml version="1.0"?>\n<Activity>\n      <Id>\n      2026-11-15T06:00:00.000Z\n    </Id>\n    </Activity>'
            const trimmed = '<?xml version="1.0"?><Activity><Id>2026-11-15T06:00:00.000Z</Id></Activity>'

            const uploadedData = async (fileName: string, content: Buffer) => {
                restClient.request
                    .mockResolvedValueOnce(accepted())
                    .mockResolvedValueOnce({ data: { Completed: true, WorkoutIds: [1] } })

                await api.upload({ fileName, data: content.toString('base64') })

                return Buffer.from(restClient.request.mock.calls[0][0].data.Data, 'base64')
            }

            test.each(['ride.tcx', 'RIDE.TCX', 'Ride.Tcx'])('tcx file %s: the padding around the values is removed', async (fileName) => {
                const data = await uploadedData(fileName, Buffer.from(padded, 'utf-8'))

                expect(data.toString('utf-8')).toBe(trimmed)
            })

            test('logs the size of the file before and after the preparation (no content, no file name)', async () => {
                const logSpy = jest.fn()
                api.logger.logEvent = logSpy

                await uploadedData('My Ride.tcx', Buffer.from(padded, 'utf-8'))

                expect(logSpy).toHaveBeenCalledWith({
                    message: 'TrainingPeaks upload', format: 'tcx',
                    bytes: Buffer.byteLength(padded), bytesSent: Buffer.byteLength(trimmed)
                })
            })

            test('fit file is sent unmodified (binary content)', async () => {
                const fit = Buffer.from([0x0e, 0x10, 0xff, 0x00, 0x20, 0x0a, 0x20, 0x80])

                const data = await uploadedData('ride.fit', fit)

                expect(data.equals(fit)).toBe(true)
            })

            test('a file that is not a tcx file is not modified, even if it looks like xml', async () => {
                const data = await uploadedData('ride.pwx', Buffer.from(padded, 'utf-8'))

                expect(data.toString('utf-8')).toBe(padded)
            })
        })

        test.each([
            ['list of bytes (a Uint8Array converted with toString)', '60,73,100,62,120,60,47,73,100,62'],
            ['content that is not encoded', '<Id>2026</Id>'],
            ['empty', ''],
        ])('data that is not base64 encoded is rejected without calling TrainingPeaks: %s', async (_name, data) => {
            await expect(api.upload({ fileName: 'ride.tcx', data })).rejects.toThrow('data is not base64 encoded')
            expect(restClient.request).not.toHaveBeenCalled()
        })

        test('waits until the processing is completed', async () => {
            restClient.request
                .mockResolvedValueOnce(accepted())
                .mockResolvedValueOnce({ data: { Completed: false } })
                .mockResolvedValueOnce({ data: { Completed: false } })
                .mockResolvedValueOnce({ data: { Completed: true, WorkoutIds: [5] } })

            const result = await api.upload(props)

            expect(result.trainingPeaksId).toBe('5')
            expect(restClient.request).toHaveBeenCalledTimes(4)
            expect(api.waitForReady).toHaveBeenCalledTimes(2)
        })

        test('handles a status url with trailing slash and query', async () => {
            restClient.request
                .mockResolvedValueOnce(accepted('https://api.trainingpeaks.com/v3/status/xyz/?x=1'))
                .mockResolvedValueOnce({ data: { Completed: true, WorkoutIds: [1] } })

            await api.upload(props)

            expect(restClient.request.mock.calls[1][0].url).toBe('https://api.trainingpeaks.com/v3/status/xyz')
        })

        test('fails with the status text if the processing completed without creating a workout', async () => {
            restClient.request
                .mockResolvedValueOnce(accepted())
                .mockResolvedValueOnce({ data: { Completed: true, Status: 'File could not be parsed', WorkoutIds: [] } })

            await expect(api.upload(props)).rejects.toThrow('Upload failed, reason: File could not be parsed')
        })

        test('fails if the processing does not finish in time', async () => {
            restClient.request.mockResolvedValueOnce(accepted())
            restClient.request.mockResolvedValue({ data: { Completed: false } })

            await expect(api.upload(props)).rejects.toThrow('Upload failed, reason: timeout')
            // 1 upload + 30 status checks (60s timeout / 2s interval)
            expect(restClient.request).toHaveBeenCalledTimes(31)
        })

        test('fails if no status url was received', async () => {
            restClient.request.mockResolvedValueOnce({ status: 202, headers: {} })

            await expect(api.upload(props)).rejects.toThrow('no status url received')
        })

        test.each([
            [422, 'Activity already exists in TrainingPeaks'],
            [415, 'File format is not supported by TrainingPeaks'],
        ])('maps a rejected upload (%i) to a readable error', async (status, message) => {
            restClient.request.mockRejectedValueOnce({ message: 'Request failed', response: { status } })

            await expect(api.upload(props)).rejects.toThrow(message)
        })

        test('a duplicate (422) is signalled with a typed error', async () => {
            restClient.request.mockRejectedValueOnce({ message: 'Request failed', response: { status: 422, data: 'File already processed.' } })

            const error = await api.upload(props).catch(e => e)

            expect(error).toBeInstanceOf(TrainingPeaksDuplicateError)
            expect(error).toBeInstanceOf(Error)
            expect(error.message).toBe('Activity already exists in TrainingPeaks')
        })

        test('other rejections (e.g. 400) report the status and the explanation of TrainingPeaks', async () => {
            restClient.request.mockRejectedValueOnce({
                message: 'Request failed with status code 400',
                response: { status: 400, data: { Message: 'The field Filename is invalid' } }
            })

            await expect(api.upload(props)).rejects.toThrow('Upload rejected by TrainingPeaks (HTTP 400): {"Message":"The field Filename is invalid"}')
        })

        test('a text explanation is reported as it is', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 400, data: 'Bad filename' } })

            await expect(api.upload(props)).rejects.toThrow('Upload rejected by TrainingPeaks (HTTP 400): Bad filename')
        })

        test('a very long explanation is shortened', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 400, data: 'x'.repeat(2000) } })

            const error = await api.upload(props).catch(e => e)

            expect(error.message.length).toBeLessThan(600)
            expect(error.message.endsWith('...')).toBe(true)
        })

        test('no explanation: reports the status only', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 503, data: '' } })

            await expect(api.upload(props)).rejects.toThrow(/^Upload rejected by TrainingPeaks \(HTTP 503\)$/)
        })

        test('passes on any other error', async () => {
            restClient.request.mockRejectedValueOnce(new Error('ECONNRESET'))

            await expect(api.upload(props)).rejects.toThrow('ECONNRESET')
        })

        test('is not possible if not authenticated', async () => {
            api.init(undefined)

            await expect(api.upload(props)).rejects.toThrow('not authenticated')
            expect(restClient.request).not.toHaveBeenCalled()
        })
    })

    describe('getCalendarUrl', () => {
        test('production', () => {
            expect(api.getCalendarUrl()).toBe('https://app.trainingpeaks.com/#calendar')
        })

        test('sandbox api', () => {
            settings.get.mockImplementation((key, def) => key === 'TP_API' ? 'https://api.sandbox.trainingpeaks.com' : def)

            expect(api.getCalendarUrl()).toBe('https://app.sandbox.trainingpeaks.com/#calendar')
        })

        test('user settings not available', () => {
            settings.get.mockImplementation(() => { throw new Error('not initialized') })

            expect(api.getCalendarUrl()).toBe('https://app.trainingpeaks.com/#calendar')
        })
    })

    describe('findWorkout', () => {
        // start of the activity (UTC). Tests run in UTC, the athlete's time zone is expressed by the start time of the workouts
        const start = new Date('2026-11-15T07:10:13.303Z')

        const workout = (id: number, startTime: string | undefined, props: object = {}) => ({
            Id: id, WorkoutType: 'Bike', Completed: true, WorkoutDay: '2026-11-15T00:00:00', StartTime: startTime, ...props
        })

        const find = async (workouts: Array<object>, activityStart = start) => {
            restClient.request.mockResolvedValue({ data: workouts })
            return await api.findWorkout(activityStart)
        }

        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('requests the day of the activity and the days before and after', async () => {
            await find([])

            expect(restClient.request.mock.calls[0][0].url).toBe('https://api.trainingpeaks.com/v2/workouts/2026-11-14/2026-11-16')
        })

        test.each([
            ['same time zone as UTC', '2026-11-15T07:10:13.303'],
            ['UTC+2 (as in the sandbox)', '2026-11-15T09:10:13.303'],
            ['UTC+1', '2026-11-15T08:10:13.303'],
            ['UTC-5', '2026-11-15T02:10:13.303'],
            ['UTC+5:30', '2026-11-15T12:40:13.303'],
            ['UTC+5:45', '2026-11-15T12:55:13.303'],
            ['UTC+14', '2026-11-15T21:10:13.303'],
            ['UTC-12', '2026-11-14T19:10:13.303'],
            ['milliseconds cut by TrainingPeaks', '2026-11-15T09:10:13'],
            ['milliseconds rounded', '2026-11-15T09:10:14.000'],
        ])('finds the workout independent of the time zone of the athlete: %s', async (_name, startTime) => {
            expect((await find([workout(1, startTime)]))?.Id).toBe(1)
        })

        test('the activity starts on another day in the time zone of the athlete', async () => {
            const lateStart = new Date('2026-11-15T22:30:05.250Z')

            const result = await find([workout(7, '2026-11-16T00:30:05.250', { WorkoutDay: '2026-11-16T00:00:00' })], lateStart)

            expect(result?.Id).toBe(7)
        })

        test('returns the workout with the smallest deviation', async () => {
            const result = await find([
                workout(1, '2026-11-15T09:10:13.903'),
                workout(2, '2026-11-15T09:10:13.310'),
                workout(3, '2026-11-15T09:10:12.600'),
            ])

            expect(result?.Id).toBe(2)
        })

        test('ignores workouts with other seconds (not the same activity)', async () => {
            expect(await find([workout(1, '2026-11-15T09:10:20.303'), workout(2, '2026-11-15T09:11:13.303'), workout(3, '2026-11-15T09:15:13.903')])).toBeUndefined()
        })

        test('ignores workouts whose start differs by more than a time zone offset', async () => {
            expect(await find([workout(1, '2026-11-17T09:10:13.303'), workout(2, '2026-11-16T07:10:13.303')])).toBeUndefined()
        })

        test('ignores planned (not completed) workouts and other sports', async () => {
            const result = await find([
                workout(1, '2026-11-15T09:10:13.303', { Completed: false }),
                workout(2, '2026-11-15T09:10:13.303', { Completed: undefined }),
                workout(3, '2026-11-15T09:10:13.303', { WorkoutType: 'Run' }),
                workout(4, '2026-11-15T09:10:13.303', { WorkoutType: 'Brick' }),
                workout(5, '2026-11-15T09:10:13.303', { WorkoutType: 'bike' }),
            ])

            expect(result?.Id).toBe(5)
        })

        test('ignores workouts without a valid start time', async () => {
            expect(await find([workout(1, undefined), workout(2, 'garbage'), workout(3, '')])).toBeUndefined()
        })

        test('a start time that contains a time zone is used as it is', async () => {
            expect((await find([workout(1, '2026-11-15T07:10:13.303Z')]))?.Id).toBe(1)
            expect((await find([workout(2, '2026-11-15T09:10:13.303+02:00')]))?.Id).toBe(2)
        })

        test('no workouts', async () => {
            expect(await find([])).toBeUndefined()
        })

        test('passes on a failing request', async () => {
            restClient.request.mockRejectedValue(new Error('ECONNRESET'))

            await expect(api.findWorkout(start)).rejects.toThrow('ECONNRESET')
        })
    })
})
