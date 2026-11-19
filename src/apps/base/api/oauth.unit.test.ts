import { OAuthAppApiBase } from './oauth'
import { OAuthApiProps, OAuthAppConfig } from './types'

class TestApi extends OAuthAppApiBase {
    constructor(props: OAuthApiProps) {
        super('TestApi', props)
    }
    protected getExpiration(): Date {
        return new Date(Date.now() + 1000)
    }
    call(method: 'get' | 'post' | 'put' = 'get') {
        return this.request(method, '/test')
    }
}

describe('OAuthAppApiBase', () => {

    const NOW = new Date('2026-01-01T10:00:00Z').valueOf()
    const base = { name: 'Test', defaultApiUrl: 'https://api.test', apiUrlSetting: 'TEST_API', authUrlSetting: 'TEST_AUTH' }

    let restClient: { request: jest.Mock }

    const create = (props: OAuthApiProps, config?: OAuthAppConfig) => {
        const api = new TestApi(props)
        api['getApi'] = jest.fn(() => restClient) as never
        api['getUserSettings'] = jest.fn(() => ({ isInitialized: true, get: (_k: string, def: unknown) => def })) as never
        api.init(config)
        return api
    }

    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(NOW)
        restClient = { request: jest.fn().mockResolvedValue({ data: {} }) }
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('apps with refresh token', () => {
        const props = { ...base, refreshPath: '/test/refresh' }

        test('an expired token is refreshed', async () => {
            const api = create(props, { accessToken: 'a', refreshToken: 'r', expiration: new Date(NOW - 1) })
            restClient.request
                .mockResolvedValueOnce({ data: { access_token: 'a2', refresh_token: 'r2', expires_in: 60 } })
                .mockResolvedValueOnce({ data: {} })

            await api.call()

            expect(restClient.request.mock.calls[0][0].url).toBe('https://auth.incyclist.com/test/refresh')
            expect(restClient.request.mock.calls[1][0].headers).toEqual({ Authorization: 'Bearer a2' })
        })

        test('a missing expiration is treated as expired', async () => {
            const api = create(props, { accessToken: 'a', refreshToken: 'r' })
            restClient.request.mockResolvedValueOnce({ data: { access_token: 'a2', refresh_token: 'r2', expires_in: 60 } })

            await api.call()

            expect(restClient.request).toHaveBeenCalledTimes(2)
        })

        test('a 401 does not emit auth.failed', async () => {
            const api = create(props, { accessToken: 'a', refreshToken: 'r', expiration: new Date(NOW + 1000) })
            const onFailed = jest.fn()
            api.init({ accessToken: 'a', refreshToken: 'r', expiration: new Date(NOW + 1000) }).on('auth.failed', onFailed)
            restClient.request.mockRejectedValue({ response: { status: 401 } })

            await expect(api.call()).rejects.toBeDefined()
            expect(onFailed).not.toHaveBeenCalled()
        })
    })

    describe('apps with non-expiring token', () => {

        test('never refreshes, no matter whether there is an expiration', async () => {
            const api = create(base, { accessToken: 'a' })

            await api.call()
            await api.call('put')

            expect(restClient.request).toHaveBeenCalledTimes(2)
            expect(restClient.request).toHaveBeenLastCalledWith(expect.objectContaining({
                method: 'put', url: 'https://api.test/test', headers: { Authorization: 'Bearer a' }
            }))
        })

        test('ignores an expiration in the past', async () => {
            const api = create(base, { accessToken: 'a', expiration: new Date(NOW - 1000) })

            await api.call()

            expect(restClient.request).toHaveBeenCalledTimes(1)
        })

        test('a 401 emits auth.failed once and rethrows the error', async () => {
            const api = create(base, { accessToken: 'a' })
            const onFailed = jest.fn()
            api.init({ accessToken: 'a' }).on('auth.failed', onFailed)
            restClient.request.mockRejectedValue({ response: { status: 401 } })

            await expect(api.call()).rejects.toEqual({ response: { status: 401 } })

            expect(onFailed).toHaveBeenCalledTimes(1)
            expect(restClient.request).toHaveBeenCalledTimes(1)
        })

        test('other errors do not emit auth.failed', async () => {
            const api = create(base, { accessToken: 'a' })
            const onFailed = jest.fn()
            api.init({ accessToken: 'a' }).on('auth.failed', onFailed)
            restClient.request.mockRejectedValue({ response: { status: 500 } })

            await expect(api.call()).rejects.toBeDefined()
            expect(onFailed).not.toHaveBeenCalled()
        })

        test('throws if not authenticated', async () => {
            const api = create(base, undefined)
            await expect(api.call()).rejects.toThrow('not authenticated')
        })
    })
})
