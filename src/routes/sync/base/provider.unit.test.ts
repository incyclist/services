import '../../../apps'
import { Inject } from '../../../base/decorators'
import { RouteInfo } from '../../base/types'
import { BaseSyncProvider } from './provider'

type TestRoute = { id: string, ts: string }

class TestProvider extends BaseSyncProvider<TestRoute, never, never> {
    result: { routes: Array<TestRoute>, done: boolean, error: boolean, incomplete?: boolean } = { routes: [], done: true, error: false }
    failure?: Error

    constructor() {
        super('TestSync')
    }
    async loadDetails() { return undefined }
    protected loadRoutesFromApi() { return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.result) }
    protected buildRouteInfo(tour: TestRoute) { return { id: 'test:' + tour.id } as RouteInfo }
    protected getRouteSyncSummary(tour: TestRoute) { return { id: tour.id, lastUpdate: tour.ts, creation: tour.ts } }
    protected getApi(): never { return undefined as never }
    protected getConnection(): never { return { getAppKey: () => 'test', isConnected: () => true } as never }
}

describe('BaseSyncProvider', () => {
    let provider: TestProvider
    const added = jest.fn()
    const deleted = jest.fn()
    const knownRoutes = jest.fn().mockReturnValue([])

    beforeEach(() => {
        Inject('AppsService', { isEnabled: jest.fn().mockReturnValue(true) })
        Inject('UserSettings', { get: jest.fn((_k, def) => def), set: jest.fn() })
        Inject('RouteListService', { getAllAppRoutes: knownRoutes })
        provider = new TestProvider()
    })

    afterEach(() => {
        Inject('AppsService', null)
        Inject('UserSettings', null)
        Inject('RouteListService', null)
        jest.clearAllMocks()
        knownRoutes.mockReturnValue([])
    })

    const run = () => new Promise<void>(resolve => {
        const observer = provider.sync()
        observer.on('added', added)
        observer.on('deleted', deleted)
        observer.once('done', () => resolve())
    })

    describe('sync', () => {
        // regression: an exception left the observer in place and never emitted done
        test('an exception ends the sync with done and releases the observer', async () => {
            provider.failure = new Error('boom')
            await run()

            provider.failure = undefined
            provider.result = { routes: [{ id: '1', ts: '2026-01-01T00:00:00Z' }], done: true, error: false }
            await run()

            expect(added).toHaveBeenCalledTimes(1)
        })

        test('incomplete list: found routes are reported, missing routes are not deleted', async () => {
            knownRoutes.mockReturnValue([{ id: 'test:9', tsLastChange: 1 }])
            provider.result = { routes: [{ id: '1', ts: '2026-01-01T00:00:00Z' }], done: true, error: false, incomplete: true }
            await run()

            expect(added).toHaveBeenCalledTimes(1)
            expect(deleted).not.toHaveBeenCalled()
        })

        test('complete list: missing routes are deleted', async () => {
            knownRoutes.mockReturnValue([{ id: 'test:9', tsLastChange: 1 }])
            provider.result = { routes: [], done: true, error: false }
            await run()

            expect(deleted).toHaveBeenCalledWith(['test:9'])
        })

        // regression: the observer was released one tick after 'done', so a sync that was started right after 'done' got the finished observer
        test('a sync that is started right after the previous one finished emits done', async () => {
            await run()

            let timer: NodeJS.Timeout | undefined
            const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 500) })
            const second = await Promise.race([run().then(() => 'done'), timeout])
            clearTimeout(timer)

            expect(second).toBe('done')
        })

        // regression: a failed load never emitted 'done', the observer stayed in place and all later syncs never finished
        test('a failed load ends the sync without reporting anything, the next sync works', async () => {
            provider.result = { routes: [{ id: '1', ts: '2026-01-01T00:00:00Z' }], done: false, error: true }
            await run()
            expect(added).not.toHaveBeenCalled()

            provider.result = { routes: [{ id: '1', ts: '2026-01-01T00:00:00Z' }], done: true, error: false }
            await run()

            expect(added).toHaveBeenCalledTimes(1)
        })
    })
})
