import { TrainingPeaksApi } from './api'
import { TrainingPeaksConfig } from './types'

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
})
