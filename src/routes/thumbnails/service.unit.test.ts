import { getBindings } from '../../api/bindings'
import { Inject } from '../../base/decorators'
import { RouteThumbnailCacheService } from './service'

describe('RouteThumbnailCacheService', () => {
    const bindings = getBindings() as unknown as Record<string, unknown>
    const savedFetch = globalThis.fetch
    let service: RouteThumbnailCacheService
    let files: Map<string, Buffer>
    let fs: Record<string, jest.Mock>
    let fetchMock: jest.Mock
    let client: { getMedia: jest.Mock }
    let respond: (url: string) => { status: number, body?: Buffer } | 'down'

    beforeEach(() => {
        files = new Map()
        fs = {
            existsFile: jest.fn(async (p: string) => files.has(p)),
            ensureDir: jest.fn(async () => undefined),
            writeFile: jest.fn(async (p: string, d: Buffer) => { files.set(p, d) }),
            unlink: jest.fn(async (p: string) => { files.delete(p) }),
        }
        bindings.fs = fs
        bindings.path = { join: (...p: string[]) => p.join('/') }
        bindings.appInfo = { getAppDir: () => '/app' }
        respond = () => ({ status: 200, body: Buffer.from('img') })
        fetchMock = jest.fn(async (url: string) => {
            const r = respond(url)
            if (r === 'down')
                throw new Error('down')
            return { status: r.status, arrayBuffer: async () => { const b = r.body ?? Buffer.alloc(0); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) } }
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch
        client = { getMedia: jest.fn(async () => ({ baseUrl: 'http://127.0.0.1:9', token: 'sec/ret', expiresAt: 1, catalogVersion: 'v' })) }
        Inject('LocalLinkClient', client)
        service = new RouteThumbnailCacheService()
    })

    afterEach(() => {
        Inject('LocalLinkClient', null)
        globalThis.fetch = savedFetch
        delete bindings.fs
        delete bindings.path
        delete bindings.appInfo
        jest.clearAllMocks()
    })

    // the service is a singleton: every test gets its own route so no state carries over
    let n = 0
    let url: { routeKey: string, url: string }
    let link: { routeKey: string, link: { linkId: string, thumbHandle: string } }
    beforeEach(() => {
        n++
        url = { routeKey: `r${n}`, url: 'https://cdn/t.jpg' }
        link = { routeKey: `r${n}`, link: { linkId: 'L', thumbHandle: 'abc' } }
    })

    describe('getCached', () => {
        test('undefined when not cached', async () => {
            expect(await service.getCached(url)).toBeUndefined()
        })

        test('returns file uri when cached', async () => {
            const uri = await service.cache(url)
            expect(uri).toMatch(/^file:\/\/\/app\/thumbnails\/.+\.img$/)
            expect(await service.getCached(url)).toBe(uri)
        })

        test('never throws', async () => {
            fs.existsFile.mockRejectedValue(new Error('x'))
            expect(await service.getCached(url)).toBeUndefined()
        })
    })

    describe('cache', () => {
        test('stores the body of an https thumbnail', async () => {
            await service.cache(url)
            expect(fetchMock).toHaveBeenCalledWith('https://cdn/t.jpg', expect.anything())
            expect([...files.values()][0].toString()).toBe('img')
        })

        test('fetches a computer thumbnail with a fresh token header and stores no token', async () => {
            const uri = await service.cache(link)
            expect(client.getMedia).toHaveBeenCalledWith('L')
            expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9/t/abc', expect.objectContaining({ headers: { Authorization: 'Bearer sec/ret' } }))
            expect(uri).not.toContain('sec')
            expect([...files.keys()].join()).not.toContain('abc')
        })

        test('a computer that is not reachable gives undefined and writes nothing', async () => {
            client.getMedia.mockResolvedValue(undefined)
            expect(await service.cache(link)).toBeUndefined()
            expect(files.size).toBe(0)
        })

        test('falls through from url to computer', async () => {
            respond = u => u.startsWith('https') ? { status: 404 } : { status: 200, body: Buffer.from('x') }
            expect(await service.cache({ ...url, ...link })).toBeDefined()
            expect(files.size).toBe(1)
        })

        test('does not store failed, empty or oversized responses', async () => {
            respond = () => ({ status: 500 })
            expect(await service.cache(url)).toBeUndefined()
            respond = () => ({ status: 200, body: Buffer.alloc(0) })
            service['failedAt'].clear()
            expect(await service.cache(url)).toBeUndefined()
            expect(files.size).toBe(0)
        })

        test('network error gives undefined', async () => {
            respond = () => 'down'
            expect(await service.cache(url)).toBeUndefined()
        })

        test('does not retry a failed source right away', async () => {
            respond = () => ({ status: 500 })
            await service.cache(url)
            await service.cache(url)
            expect(fetchMock).toHaveBeenCalledTimes(1)
        })

        test('a computer answering 410 or 404 has no thumbnail: logged, not retried even after the failure TTL', async () => {
            const logged: Array<Record<string, unknown>> = []
            jest.spyOn(service as never, 'logEvent').mockImplementation(((e: Record<string, unknown>) => { logged.push(e) }) as never)
            respond = () => ({ status: 410 })
            expect(await service.cache(link)).toBeUndefined()
            service['failedAt'].clear()
            expect(await service.cache(link)).toBeUndefined()
            expect(fetchMock).toHaveBeenCalledTimes(1)
            const ev = logged.find(e => e.httpStatus === 410)
            expect(ev).toBeDefined()
            expect(typeof ev!.durationMs).toBe('number')
            expect(JSON.stringify(logged)).not.toContain('abc')
            expect(JSON.stringify(logged)).not.toContain('sec')
        })

        test('a 410 for one handle does not block a new handle of the same route', async () => {
            respond = () => ({ status: 410 })
            await service.cache(link)
            service['failedAt'].clear()
            respond = () => ({ status: 200, body: Buffer.from('x') })
            expect(await service.cache({ routeKey: link.routeKey, link: { linkId: 'L', thumbHandle: 'def' } })).toBeDefined()
        })

        test('a 500 from a computer is retried after the failure TTL', async () => {
            respond = () => ({ status: 500 })
            await service.cache(link)
            service['failedAt'].clear()
            await service.cache(link)
            expect(fetchMock).toHaveBeenCalledTimes(2)
        })

        test('a network error is logged without the url', async () => {
            const logged: Array<Record<string, unknown>> = []
            jest.spyOn(service as never, 'logEvent').mockImplementation(((e: Record<string, unknown>) => { logged.push(e) }) as never)
            respond = () => 'down'
            await service.cache(link)
            expect(logged).toHaveLength(1)
            expect(typeof logged[0].durationMs).toBe('number')
            expect(JSON.stringify(logged)).not.toContain('127.0.0.1')
        })

        test('never has more than a few requests to a computer in flight', async () => {
            let inflight = 0
            let peak = 0
            fetchMock.mockImplementation(async () => {
                inflight++
                peak = Math.max(peak, inflight)
                await new Promise(resolve => setTimeout(resolve, 5))
                inflight--
                return { status: 200, arrayBuffer: async () => Uint8Array.from([1, 2]).buffer }
            })
            const requests = Array.from({ length: 20 }, (_, i) => ({ routeKey: `c${n}-${i}`, link: { linkId: 'L', thumbHandle: `h${i}` } }))
            const results = await Promise.all(requests.map(r => service.cache(r)))
            expect(results.every(r => r !== undefined)).toBe(true)
            expect(peak).toBeLessThanOrEqual(4)
            expect(peak).toBeGreaterThan(1)
        })

        test('does not cache local schemes', async () => {
            expect(await service.cache({ routeKey: 'r1', url: 'file:///a.jpg' })).toBeUndefined()
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('concurrent calls share one fetch', async () => {
            await Promise.all([service.cache(url), service.cache(url)])
            expect(fetchMock).toHaveBeenCalledTimes(1)
        })

        test('write error removes the partial file and gives undefined', async () => {
            fs.writeFile.mockRejectedValue(new Error('disk full'))
            expect(await service.cache(url)).toBeUndefined()
            expect(fs.unlink).toHaveBeenCalled()
        })

        test('does nothing without bindings', async () => {
            delete bindings.fs
            expect(await service.cache(url)).toBeUndefined()
            expect(fetchMock).not.toHaveBeenCalled()
        })
    })

    describe('resolve', () => {
        test('cached file is used without a fetch', async () => {
            await service.cache(url)
            fetchMock.mockClear()
            expect(await service.resolve(url)).toBeDefined()
            expect(fetchMock).not.toHaveBeenCalled()
        })

        test('fetches when not cached', async () => {
            expect(await service.resolve(url)).toBeDefined()
            expect(fetchMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('invalidate', () => {
        test('removes the cached file', async () => {
            await service.cache(url)
            await service.invalidate(url)
            expect(files.size).toBe(0)
        })
    })
})
