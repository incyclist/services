import { TrainerDayApi } from './api'
import { toBase64, fromBase64 } from '../../../../utils/base64'
import { utf8Encode, utf8Decode } from '../../../../utils/utf8'
import { TrainerDayConfig } from './types'

describe('TrainerDay API', () => {
    let api
    let restClient
    let settings

    const NOW = new Date('2026-01-01T10:00:00Z').valueOf()
    const API = 'https://api.trainerday.com'

    const initialConfig: TrainerDayConfig = {
        id: '42',
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        expiration: new Date(NOW + 60_000)
    }

    const settingsWith = (values: Record<string, string>) => ({
        isInitialized: true,
        get: jest.fn((key: string, def: unknown) => values[key] ?? def)
    })

    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(NOW)

        api = new TrainerDayApi()
        restClient = { request: jest.fn() }
        settings = settingsWith({})

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

    describe('request', () => {
        test('throws if not authenticated', async () => {
            await expect(api.getCalendar('2026-01-05', '2026-02-01')).rejects.toThrow('not authenticated')
            expect(restClient.request).not.toHaveBeenCalled()
        })

        test('sends the bearer token without refreshing while the token is valid', async () => {
            api.init({ ...initialConfig })
            restClient.request.mockResolvedValue({ data: [] })

            await api.getCalendar('2026-01-05', '2026-02-01')

            expect(restClient.request).toHaveBeenCalledTimes(1)
            expect(restClient.request).toHaveBeenCalledWith(expect.objectContaining({
                method: 'get',
                url: API + '/api/v2/calendar',
                headers: { Authorization: 'Bearer old-access-token' }
            }))
        })

        test('only accepts successful responses (a 403 must not be treated as success)', async () => {
            api.init({ ...initialConfig })
            restClient.request.mockResolvedValue({ data: [] })

            await api.getCalendar('2026-01-05', '2026-02-01')

            const { validateStatus } = restClient.request.mock.calls[0][0]
            expect(validateStatus(200)).toBe(true)
            expect(validateStatus(204)).toBe(true)
            expect(validateStatus(403)).toBe(false)
            expect(validateStatus(404)).toBe(false)
        })

        test('uses the API url from the user settings', async () => {
            settings = settingsWith({ TRAINERDAY_API: 'https://api.sandbox.trainerday.test' })
            api.init({ ...initialConfig })
            restClient.request.mockResolvedValue({ data: [] })

            await api.getCalendar('2026-01-05', '2026-02-01')

            expect(restClient.request.mock.calls[0][0].url).toBe('https://api.sandbox.trainerday.test/api/v2/calendar')
        })

        test('refreshes an expired token first and uses the new one', async () => {
            api.init({ ...initialConfig, expiration: new Date(NOW - 1000) })
            restClient.request
                .mockResolvedValueOnce({ data: { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 21600 } })
                .mockResolvedValueOnce({ data: [] })

            await api.getCalendar('2026-01-05', '2026-02-01')

            expect(restClient.request).toHaveBeenCalledTimes(2)
            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.incyclist.com/trainerday/refresh')
            expect(restClient.request.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer new-access-token' })
        })

        test('refreshes if there is no expiration', async () => {
            api.init({ ...initialConfig, expiration: undefined })
            restClient.request
                .mockResolvedValueOnce({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })
                .mockResolvedValueOnce({ data: [] })

            await api.getCalendar('2026-01-05', '2026-02-01')

            expect(restClient.request.mock.calls[0][0].url).toContain('/trainerday/refresh')
        })

        test('throws and does not call TrainerDay if the refresh failed', async () => {
            api.init({ ...initialConfig, expiration: new Date(NOW - 1000) })
            restClient.request.mockRejectedValue({ response: { status: 401, statusText: 'Unauthorized' } })

            await expect(api.getCalendar('2026-01-05', '2026-02-01')).rejects.toThrow('token refresh failed')
            expect(restClient.request).toHaveBeenCalledTimes(1)
        })
    })

    describe('concurrent requests with an expired token', () => {
        const REFRESH_URL = 'https://auth.incyclist.com/trainerday/refresh'
        const refreshCalls = () => restClient.request.mock.calls.filter(c => c[0].url === REFRESH_URL)

        beforeEach(() => {
            api.init({ ...initialConfig, expiration: new Date(NOW - 1000) })
        })

        test('trigger only one refresh and all succeed with the new token', async () => {
            let resolveRefresh
            restClient.request.mockImplementation((req) => {
                if (req.url === REFRESH_URL)
                    return new Promise(resolve => { resolveRefresh = () => resolve({ data: { access_token: 'new-at', refresh_token: 'new-rt', expires_in: 600 } }) })
                return Promise.resolve({ data: [] })
            })
            const tokenUpdated = jest.fn()
            api.observer.on('token.updated', tokenUpdated)

            const first = api.getCalendar('2026-01-05', '2026-02-01')
            const second = api.getCalendar('2026-01-05', '2026-02-01')
            await Promise.resolve()
            resolveRefresh()

            await expect(Promise.all([first, second])).resolves.toEqual([[], []])

            expect(refreshCalls()).toHaveLength(1)
            expect(tokenUpdated).toHaveBeenCalledTimes(1)
            const calls = restClient.request.mock.calls.filter(c => c[0].url !== REFRESH_URL)
            expect(calls).toHaveLength(2)
            calls.forEach(c => expect(c[0].headers).toEqual({ Authorization: 'Bearer new-at' }))
        })

        test('failure: all reject with "token refresh failed" and a later request can refresh again', async () => {
            let fail = true
            restClient.request.mockImplementation((req) => {
                if (req.url !== REFRESH_URL)
                    return Promise.resolve({ data: [] })
                return fail
                    ? Promise.reject({ response: { status: 400, statusText: 'invalid_grant' } })
                    : Promise.resolve({ data: { access_token: 'new-at', refresh_token: 'new-rt', expires_in: 600 } })
            })

            const results = await Promise.allSettled([
                api.getCalendar('2026-01-05', '2026-02-01'),
                api.getCalendar('2026-01-05', '2026-02-01')
            ])

            expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
            results.forEach(r => expect((r as PromiseRejectedResult).reason.message).toBe('token refresh failed'))
            expect(refreshCalls()).toHaveLength(1)

            fail = false
            await expect(api.getCalendar('2026-01-05', '2026-02-01')).resolves.toEqual([])
            expect(refreshCalls()).toHaveLength(2)
        })
    })

    describe('refreshToken', () => {
        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('calls the auth-server, not TrainerDay directly, and sends only the refresh token', async () => {
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            const request = restClient.request.mock.calls[0][0]
            expect(request.method).toBe('post')
            expect(request.url).toBe('https://auth.incyclist.com/trainerday/refresh')
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

        test.each([
            ['no expires_in and no expiration', {}],
            ['expires_in null', { expires_in: null }],
            ['expires_in not a number', { expires_in: 'soon' }],
            ['expiration not a date', { expiration: 'garbage' }],
            ['expiration null', { expires_in: null, expiration: null }],
        ])('falls back to 6 hours if the expiration is unusable: %s', async (_name, extra) => {
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', ...extra } })

            await api.refreshToken()

            expect(api.config.expiration).toEqual(new Date(NOW + 6 * 3600 * 1000))
        })

        test('expires_in null does not mean "expires immediately"', async () => {
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: null } })

            await api.refreshToken()

            expect(api.isTokenStillValid()).toBe(true)
        })

        test('uses the TRAINERDAY_AUTH_SERVER_URL from the user settings', async () => {
            settings = settingsWith({ TRAINERDAY_AUTH_SERVER_URL: 'https://auth.staging.incyclist.com', oauthUrl: 'https://other' })
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.staging.incyclist.com/trainerday/refresh')
        })

        test('falls back to the oauthUrl setting', async () => {
            settings = settingsWith({ oauthUrl: 'http://localhost:5001/auth' })
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            expect(restClient.request.mock.calls[0][0].url).toBe('http://localhost:5001/auth/trainerday/refresh')
        })

        test('falls back to the default urls if the user settings throw', async () => {
            settings.get.mockImplementation(() => { throw new Error('not initialized') })
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.incyclist.com/trainerday/refresh')
            expect(api.getBaseUrl()).toBe(API)
        })

        test('falls back to the default urls if the user settings are not initialized yet', async () => {
            settings.isInitialized = false
            restClient.request.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'b', expires_in: 600 } })

            await api.refreshToken()

            expect(settings.get).not.toHaveBeenCalled()
            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.incyclist.com/trainerday/refresh')
            expect(api.getBaseUrl()).toBe(API)
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

    describe('getCalendar', () => {
        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('requests the range and returns the workouts', async () => {
            restClient.request.mockResolvedValue({ data: [{ workoutId: 1, title: 'Test' }] })

            const result = await api.getCalendar('2026-01-05', '2026-02-01')

            expect(result).toEqual([{ workoutId: 1, title: 'Test' }])
            const request = restClient.request.mock.calls[0][0]
            expect(request.method).toBe('get')
            expect(request.url).toBe(API + '/api/v2/calendar')
            expect(request.params).toEqual({ startDate: '2026-01-05', endDate: '2026-02-01' })
        })

        test('formats dates as local days', async () => {
            restClient.request.mockResolvedValue({ data: [] })

            await api.getCalendar(new Date(2026, 0, 5), new Date(2026, 1, 3))

            expect(restClient.request.mock.calls[0][0].params).toEqual({ startDate: '2026-01-05', endDate: '2026-02-03' })
        })

        test.each([{ workouts: [] }, 'text', null])('throws if the response is not an array (%p)', async (data) => {
            restClient.request.mockResolvedValue({ data })

            await expect(api.getCalendar('2026-01-05', '2026-02-01')).rejects.toThrow('expected an array')
        })
    })

    describe('uploadActivity', () => {
        const props = { name: 'ride', dataType: 'tcx', data: new Uint8Array([1, 2, 3]) }

        beforeEach(() => {
            api.init({ ...initialConfig })
        })

        test('posts a JSON body with base64 encoded data and returns the activity id', async () => {
            restClient.request.mockResolvedValue({ status: 200, data: { activityId: 'abc' } })

            const result = await api.uploadActivity({ ...props, externalId: '1234', sportType: 'bike' })

            expect(result).toEqual({ activityId: 'abc' })
            const request = restClient.request.mock.calls[0][0]
            expect(request.method).toBe('post')
            expect(request.url).toBe(API + '/api/v1/activities/upload')
            expect(request.headers).toEqual({ Authorization: 'Bearer old-access-token' })
            expect(request.data).toEqual({ name: 'ride', dataType: 'tcx', data: 'AQID', externalId: '1234', sportType: 'bike' })
        })

        test('a duplicate (HTTP 200 with duplicate: true) returns the id of the existing activity', async () => {
            restClient.request.mockResolvedValue({ status: 200, data: { duplicate: true, id: 'existing-1' } })

            const result = await api.uploadActivity(props as never)

            expect(result).toEqual({ activityId: 'existing-1', duplicate: true })
        })

        test('a response with duplicate: false is a normal upload', async () => {
            restClient.request.mockResolvedValue({ status: 200, data: { duplicate: false, activityId: 'new-1' } })

            const result = await api.uploadActivity(props as never)

            expect(result).toEqual({ activityId: 'new-1' })
        })

        test('a string is expected to be base64 already and passed on as it is', async () => {
            restClient.request.mockResolvedValue({ status: 200, data: { activityId: 'abc' } })

            await api.uploadActivity({ ...props, dataType: 'fit', data: 'AQID' })

            expect(restClient.request.mock.calls[0][0].data.data).toBe('AQID')
            expect(restClient.request.mock.calls[0][0].data.dataType).toBe('fit')
        })

        describe('XML normalisation', () => {
            const PADDED_TCX = '<?xml version="1.0" encoding="utf-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n      <Activities>\n      <Activity Sport="Biking">\n      <Id>\n      2024-03-10T18:36:06.114Z\n    </Id><Lap StartTime="2024-03-10T18:36:06.114Z">\n      <TotalTimeSeconds>\n      19.899\n    </TotalTimeSeconds><Notes>\n      Tour K\u00F6ln \u20AC \uD83D\uDEB4\n    </Notes>\n    </Lap>\n    </Activity>\n    </Activities>\n    </TrainingCenterDatabase>'
            const TRIMMED_TCX = '<?xml version="1.0" encoding="utf-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Biking"><Id>2024-03-10T18:36:06.114Z</Id><Lap StartTime="2024-03-10T18:36:06.114Z"><TotalTimeSeconds>19.899</TotalTimeSeconds><Notes>Tour K\u00F6ln \u20AC \uD83D\uDEB4</Notes></Lap></Activity></Activities></TrainingCenterDatabase>'
            const PADDED_GPX = '<?xml version="1.0"?>\n<gpx version="1.1">\n      <trk>\n      <name>\n      Morning ride\n    </name>\n    </trk>\n    </gpx>'
            const TRIMMED_GPX = '<?xml version="1.0"?><gpx version="1.1"><trk><name>Morning ride</name></trk></gpx>'

            const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64')
            const sentData = () => restClient.request.mock.calls[0][0].data.data

            beforeEach(() => {
                restClient.request.mockResolvedValue({ status: 200, data: { activityId: 'abc' } })
            })

            test('padded TCX (base64 string) is trimmed', async () => {
                await api.uploadActivity({ name: 'ride', dataType: 'tcx', data: b64(PADDED_TCX) })

                expect(sentData()).toBe(b64(TRIMMED_TCX))
            })

            test('padded TCX (bytes) is trimmed', async () => {
                await api.uploadActivity({ name: 'ride', dataType: 'tcx', data: new Uint8Array(Buffer.from(PADDED_TCX, 'utf-8')) })

                expect(sentData()).toBe(b64(TRIMMED_TCX))
            })

            test('padded GPX is trimmed (string and bytes)', async () => {
                await api.uploadActivity({ name: 'ride', dataType: 'gpx', data: b64(PADDED_GPX) })
                await api.uploadActivity({ name: 'ride', dataType: 'gpx', data: new Uint8Array(Buffer.from(PADDED_GPX, 'utf-8')) })

                expect(restClient.request.mock.calls[0][0].data.data).toBe(b64(TRIMMED_GPX))
                expect(restClient.request.mock.calls[1][0].data.data).toBe(b64(TRIMMED_GPX))
            })

            test('already trimmed TCX is unchanged', async () => {
                await api.uploadActivity({ name: 'ride', dataType: 'tcx', data: b64(TRIMMED_TCX) })

                expect(sentData()).toBe(b64(TRIMMED_TCX))
            })

            test('the trimmed content decodes to valid UTF-8 text', async () => {
                await api.uploadActivity({ name: 'ride', dataType: 'tcx', data: b64(PADDED_TCX) })

                expect(utf8Decode(fromBase64(sentData()))).toBe(TRIMMED_TCX)
                expect(toBase64(utf8Encode(TRIMMED_TCX))).toBe(sentData())
            })

            test('FIT bytes are passed through byte-identical', async () => {
                const bytes = new Uint8Array(512).map((_, i) => (i * 31 + 7) % 256)

                await api.uploadActivity({ name: 'ride', dataType: 'fit', data: bytes })

                expect(sentData()).toBe(Buffer.from(bytes).toString('base64'))
            })

            test('FIT base64 is passed through unchanged, even if it looks like padded XML', async () => {
                const data = b64(PADDED_TCX)

                await api.uploadActivity({ name: 'ride', dataType: 'fit', data })

                expect(sentData()).toBe(data)
            })
        })

        test('rejection: reports the status and the explanation of TrainerDay', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 400, data: { msg: 'bad file' } } })

            await expect(api.uploadActivity(props)).rejects.toThrow('Upload rejected by TrainerDay (HTTP 400): {"msg":"bad file"}')
        })

        test('a text explanation is reported as it is', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 409, data: 'Already exists' } })

            await expect(api.uploadActivity(props)).rejects.toThrow('Upload rejected by TrainerDay (HTTP 409): Already exists')
        })

        test('a very long explanation is shortened', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 400, data: 'x'.repeat(2000) } })

            const error = await api.uploadActivity(props).catch(e => e)

            expect(error.message.length).toBeLessThan(600)
            expect(error.message.endsWith('...')).toBe(true)
        })

        test('no explanation: reports the status only', async () => {
            restClient.request.mockRejectedValueOnce({ response: { status: 503, data: '' } })

            await expect(api.uploadActivity(props)).rejects.toThrow(/^Upload rejected by TrainerDay \(HTTP 503\)$/)
        })

        test('passes on errors without a response', async () => {
            restClient.request.mockRejectedValueOnce(new Error('ECONNRESET'))

            await expect(api.uploadActivity(props)).rejects.toThrow('ECONNRESET')
        })

        test('is not possible if not authenticated', async () => {
            api.init(undefined)

            await expect(api.uploadActivity(props)).rejects.toThrow('not authenticated')
            expect(restClient.request).not.toHaveBeenCalled()
        })
    })
})
