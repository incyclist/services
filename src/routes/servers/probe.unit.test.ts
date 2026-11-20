import { EventLogger } from 'gd-eventlog'
import { checkRouteServer, mapProbeError, probeRouteServer } from './probe'

describe('route server probe', () => {

    beforeEach(() => {
        jest.spyOn(EventLogger.prototype, 'logEvent').mockImplementation()
    })
    afterEach(() => { jest.restoreAllMocks() })

    const apiReturning = (result: () => Promise<unknown>) => jest.fn().mockReturnValue({ getRouteDescriptions: jest.fn().mockImplementation(result) })

    describe('probeRouteServer', () => {
        test('json array: ok with the route count, queries video routes and throws on error', async () => {
            const getRouteDescriptions = jest.fn().mockResolvedValue([{ id: '1' }, { id: '2' }])
            const createApi = jest.fn().mockReturnValue({ getRouteDescriptions })

            const res = await probeRouteServer('https://a.org/', createApi)

            expect(res).toEqual({ ok: true, routeCount: 2, url: 'https://a.org/' })
            expect(createApi).toHaveBeenCalledWith('https://a.org/')
            expect(getRouteDescriptions).toHaveBeenCalledWith({ type: 'video' }, true)
        })

        test('empty array: ok with 0 routes', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(async () => []))
            expect(res).toMatchObject({ ok: true, routeCount: 0 })
        })

        test('not an array (html page): not a route server', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(async () => '<html></html>'))
            expect(res).toMatchObject({ ok: false, code: 'not-a-server', message: "This address answered, but it isn't a route server. Check you copied the full address." })
        })

        test('404: not a route server', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(async () => { throw { response: { status: 404 } } }))
            expect(res).toMatchObject({ ok: false, code: 'not-a-server' })
        })

        test('5xx: server error', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(async () => { throw { response: { status: 503 } } }))
            expect(res).toMatchObject({ ok: false, code: 'server-error', message: "The server didn't respond properly. Try again later, or ask its operator." })
        })

        test('no response: unreachable', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(async () => { throw new Error('Network Error') }))
            expect(res).toMatchObject({ ok: false, code: 'unreachable', message: "Couldn't reach this address. Check it, and check that you're online." })
        })

        test('refused redirect: not a route server', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(async () => { throw Object.assign(new Error('x'), { code: 'ERR_REDIRECT_NOT_ALLOWED' }) }))
            expect(res).toMatchObject({ ok: false, code: 'not-a-server' })
        })

        test('no answer in time: unreachable', async () => {
            const res = await probeRouteServer('https://a.org/', apiReturning(() => new Promise(() => { /* never */ })), 20)
            expect(res).toMatchObject({ ok: false, code: 'unreachable' })
        })

        test('api that can not be created: unreachable', async () => {
            const res = await probeRouteServer('https://a.org/', () => { throw new Error('boom') })
            expect(res).toMatchObject({ ok: false, code: 'unreachable' })
        })
    })

    describe('mapProbeError', () => {
        test('error without response is unreachable', () => {
            expect(mapProbeError(undefined)).toBe('unreachable')
        })
    })

    describe('checkRouteServer', () => {
        const apiByUrl = (answers: Record<string, () => Promise<unknown>>) => jest.fn().mockImplementation((url: string) => ({ getRouteDescriptions: () => answers[url]() }))

        test('https works: no fallback', async () => {
            const createApi = apiByUrl({ 'https://nas:8080/': async () => [{}], 'http://nas:8080/': async () => [{}] })
            const res = await checkRouteServer('https://nas:8080/', 'http://nas:8080/', createApi)
            expect(res).toEqual({ ok: true, routeCount: 1, url: 'https://nas:8080/' })
            expect(createApi).toHaveBeenCalledTimes(1)
        })

        test('https unreachable, http works: switched to http', async () => {
            const createApi = apiByUrl({ 'https://nas:8080/': async () => { throw new Error('Network Error') }, 'http://nas:8080/': async () => [{}, {}] })
            const res = await checkRouteServer('https://nas:8080/', 'http://nas:8080/', createApi)
            expect(res).toEqual({ ok: true, routeCount: 2, url: 'http://nas:8080/', switchedToHttp: true })
        })

        test('https answers with an http error: no fallback', async () => {
            const createApi = apiByUrl({ 'https://nas:8080/': async () => { throw { response: { status: 404 } } }, 'http://nas:8080/': async () => [{}] })
            const res = await checkRouteServer('https://nas:8080/', 'http://nas:8080/', createApi)
            expect(res).toMatchObject({ ok: false, code: 'not-a-server' })
            expect(createApi).toHaveBeenCalledTimes(1)
        })

        test('both fail: reports the first attempt', async () => {
            const createApi = apiByUrl({ 'https://nas:8080/': async () => { throw new Error('Network Error') }, 'http://nas:8080/': async () => { throw { response: { status: 500 } } } })
            const res = await checkRouteServer('https://nas:8080/', 'http://nas:8080/', createApi)
            expect(res).toMatchObject({ ok: false, code: 'unreachable', url: 'https://nas:8080/' })
        })

        test('no fallback offered: unreachable stays unreachable', async () => {
            const createApi = apiByUrl({ 'https://a.org/': async () => { throw new Error('Network Error') } })
            const res = await checkRouteServer('https://a.org/', undefined, createApi)
            expect(res).toMatchObject({ ok: false, code: 'unreachable' })
            expect(createApi).toHaveBeenCalledTimes(1)
        })
    })
})
