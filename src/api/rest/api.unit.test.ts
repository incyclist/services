import { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { ApiClient } from './api'

type LogEvent = Record<string, unknown>

describe('ApiClient request logging', () => {

    let api: ApiClient
    let logSpy: jest.Mock

    /** replaces the transport of axios, so that no real request is made */
    const mockServer = (status: number, data: unknown = {}) => {
        api.client().defaults.adapter = async (config: InternalAxiosRequestConfig) => {
            const response = { data, status, statusText: '', headers: {}, config }
            if (status >= 200 && status < 300)
                return response
            throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, undefined, response)
        }
    }

    const mockNetworkError = () => {
        api.client().defaults.adapter = async (config: InternalAxiosRequestConfig) => {
            throw new AxiosError('Network Error', 'ERR_NETWORK', config)
        }
    }

    const logged = (): Array<LogEvent> => logSpy.mock.calls.map(c => c[0]).filter(e => e.message === 'api call')

    beforeEach(() => {
        api = new ApiClient()
        api.init({ appVersion: '1.0.0', version: '1.0.0' } as never)
        logSpy = jest.fn()
        api['logger'].logEvent = logSpy
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('logs a successful request', async () => {
        mockServer(200)

        await api.client().request({ method: 'get', url: 'https://example.com/ok' })

        expect(logged()).toHaveLength(1)
        expect(logged()[0]).toMatchObject({ method: 'get', url: 'https://example.com/ok', status: 200 })
        expect(logged()[0].error).toBeUndefined()
    })

    test('logs a failed request with its status and still rejects with the original error', async () => {
        mockServer(400, { Message: 'secret details of the response' })

        const request = api.client().request({ method: 'post', url: 'https://example.com/fail' })

        await expect(request).rejects.toMatchObject({ message: 'Request failed with status code 400', response: { status: 400 } })
        expect(logged()).toHaveLength(1)
        expect(logged()[0]).toMatchObject({
            method: 'post', url: 'https://example.com/fail', status: 400, error: 'Request failed with status code 400'
        })
        expect(typeof logged()[0].tid).toBe('string')
        expect(typeof logged()[0].duration).toBe('number')
    })

    test('never logs the response body of a failed request', async () => {
        mockServer(500, { Message: 'secret details of the response' })

        await expect(api.client().request({ url: 'https://example.com/fail' })).rejects.toBeDefined()

        expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret details')
    })

    test('logs a request without response (e.g. network error)', async () => {
        mockNetworkError()

        await expect(api.client().request({ method: 'get', url: 'https://example.com/down' })).rejects.toMatchObject({ message: 'Network Error' })

        expect(logged()).toHaveLength(1)
        expect(logged()[0]).toMatchObject({ method: 'get', url: 'https://example.com/down', status: 'no response', error: 'Network Error' })
    })

    test('does not keep track of finished requests (successful or failed)', async () => {
        mockServer(200)
        await api.client().request({ url: 'https://example.com/ok' })
        mockServer(404)
        await expect(api.client().request({ url: 'https://example.com/missing' })).rejects.toBeDefined()

        expect(api['requests']).toHaveLength(0)
    })

    test('passes on errors that did not originate from a request of this client', async () => {
        await expect(api['onError'](new Error('some error'))).rejects.toThrow('some error')
        await expect(api['onError'](undefined)).rejects.toBeUndefined()
        expect(logged()).toHaveLength(0)
    })

    test('logging is registered only once', async () => {
        api.enableLogging()
        api.enableLogging()
        mockServer(200)

        await api.client().request({ url: 'https://example.com/ok' })

        expect(logged()).toHaveLength(1)
    })
})
