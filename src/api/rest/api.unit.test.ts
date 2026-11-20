import http from 'node:http'
import { AddressInfo } from 'node:net'
import { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { ApiClient } from './api'
import { REDIRECT_NOT_ALLOWED } from './types'

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


describe('ApiClient redirect policy', () => {

    let api: ApiClient
    let logSpy: jest.Mock
    let seenConfig: InternalAxiosRequestConfig

    /** answers every request as if it was served from `finalUrl` (as XHR/follow-redirects report it) */
    const mockServedFrom = (finalUrl?: string, key: 'node' | 'xhr' = 'node') => {
        api.client().defaults.adapter = async (config: InternalAxiosRequestConfig) => {
            seenConfig = config
            const request = key === 'node' ? { res: { responseUrl: finalUrl } } : { responseURL: finalUrl }
            return { data: {}, status: 200, statusText: '', headers: {}, config, request }
        }
    }

    beforeEach(() => {
        api = new ApiClient()
        api.init({ appVersion: '1.0.0', version: '1.0.0', requestLog: false } as never)
        logSpy = jest.fn()
        api['logger'].logEvent = logSpy
        seenConfig = undefined
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('no policy: nothing is checked and the config is not changed', async () => {
        mockServedFrom('http://elsewhere.example.com/')

        const res = await api.client().get('https://example.com/a')

        expect(res.status).toBe(200)
        expect(seenConfig.beforeRedirect).toBeUndefined()
    })

    test('response served from the requested url: policy is not asked', async () => {
        const policy = jest.fn().mockReturnValue(false)
        mockServedFrom('https://example.com/a')

        await expect(api.client().get('https://example.com/a', { redirectPolicy: policy })).resolves.toMatchObject({ status: 200 })

        expect(policy).not.toHaveBeenCalled()
    })

    test.each(['node', 'xhr'] as const)('response served from a url that the policy refuses (%s): request fails', async (key) => {
        const policy = jest.fn().mockReturnValue(false)
        mockServedFrom('http://elsewhere.example.com/a', key)

        await expect(api.client().get('https://example.com/a', { redirectPolicy: policy }))
            .rejects.toMatchObject({ code: REDIRECT_NOT_ALLOWED })

        expect(policy).toHaveBeenCalledWith('http://elsewhere.example.com/a', 'https://example.com/a')
    })

    test('response served from a url that the policy accepts: request succeeds', async () => {
        const policy = jest.fn().mockReturnValue(true)
        mockServedFrom('https://other.example.com/a')

        await expect(api.client().get('https://example.com/a', { redirectPolicy: policy })).resolves.toMatchObject({ status: 200 })
    })

    test('final url not available: request succeeds, a message is logged', async () => {
        const policy = jest.fn().mockReturnValue(false)
        mockServedFrom(undefined)

        await expect(api.client().get('https://example.com/a', { redirectPolicy: policy })).resolves.toMatchObject({ status: 200 })

        expect(policy).not.toHaveBeenCalled()
        expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'redirect check skipped' }))
    })

    test('query parameters are part of the origin url', async () => {
        const policy = jest.fn().mockReturnValue(true)
        mockServedFrom('https://other.example.com/a')

        await api.client().get('https://example.com/a', { redirectPolicy: policy, params: { type: 'video' } })

        expect(policy).toHaveBeenCalledWith('https://other.example.com/a', 'https://example.com/a?type=video')
    })

    test('beforeRedirect: a refused redirect throws, an accepted one does not; an existing hook is kept', async () => {
        const policy = jest.fn().mockImplementation((url: string) => url.startsWith('https:'))
        const previous = jest.fn()
        mockServedFrom('https://example.com/a')

        await api.client().get('https://example.com/a', { redirectPolicy: policy, beforeRedirect: previous })

        expect(() => seenConfig.beforeRedirect({ href: 'https://other.example.com/b' }, {} as never, {} as never)).not.toThrow()
        expect(() => seenConfig.beforeRedirect({ protocol: 'http:', host: 'other.example.com', path: '/b' }, {} as never, {} as never))
            .toThrow(expect.objectContaining({ code: REDIRECT_NOT_ALLOWED }))
        expect(previous).toHaveBeenCalledTimes(2)
        expect(policy).toHaveBeenLastCalledWith('http://other.example.com/b', 'https://example.com/a')
    })

    describe('real redirects (Node)', () => {
        let server: http.Server
        let base: string

        beforeEach(async () => {
            server = http.createServer((req, res) => {
                if (req.url === '/redirect') {
                    res.writeHead(302, { Location: '/target' })
                    res.end()
                }
                else if (req.url === '/refused') {
                    res.writeHead(302, { Location: 'http://elsewhere.example.invalid/' })
                    res.end()
                }
                else {
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end('[]')
                }
            })
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
            base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        })

        afterEach(async () => {
            await new Promise(resolve => server.close(resolve))
        })

        test('an accepted redirect is followed', async () => {
            const res = await api.client().get(`${base}/redirect`, { redirectPolicy: () => true })
            expect(res.data).toEqual([])
        })

        test('a refused redirect is not followed and fails with the stable code', async () => {
            const policy = jest.fn().mockReturnValue(false)

            await expect(api.client().get(`${base}/refused`, { redirectPolicy: policy }))
                .rejects.toMatchObject({ code: REDIRECT_NOT_ALLOWED })

            expect(policy).toHaveBeenCalledWith('http://elsewhere.example.invalid/', `${base}/refused`)
        })
    })

    describe('timeout', () => {
        test('per-request timeout is passed on to the transport', async () => {
            mockServedFrom('https://example.com/a')

            await api.client().get('https://example.com/a', { timeout: 1234 })

            expect(seenConfig.timeout).toBe(1234)
        })
    })
})
