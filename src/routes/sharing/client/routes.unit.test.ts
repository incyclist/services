import { Route } from '../../base/model/route'
import type { CatalogEntry, SharedRouteEntry } from '../types'
import { SharedRouteMaterializer } from './routes'
import type { MaterializerRouteList } from './routes'

const HASH_A = 'a'.repeat(32)
const HASH_B = 'b'.repeat(32)

const entry = (routeKey: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
    routeKey, routeIdOnComputer: `id-${routeKey}`, title: 'T', videoHandle: 'h', videoFormat: 'mp4', size: 1, mtime: 1,
    origin: 'local', routeHash: routeKey, summary: { title: `title ${routeKey}`, distance: 1000 }, ...extra,
})

class FakeList implements MaterializerRouteList {
    routes: Route[] | undefined = []
    loading = false
    selected?: Route
    saved: Route[] = []
    removed: string[] = []
    addCalls = 0
    getAllRoutes = () => this.routes
    isStillLoading = () => this.loading
    getRoute = (id: string) => this.routes?.find(r => r.description.id === id)
    getSelected = () => this.selected
    addRoutes = jest.fn((routes: Route[]) => {
        this.addCalls++
        routes.forEach(route => {
            const i = this.routes!.findIndex(r => r.description.id === route.description.id)
            if (i === -1) this.routes!.push(route)
            else this.routes![i] = route
        })
    })
    saveRoute = jest.fn(async (route: Route) => { this.saved.push(route) })
    removeSharedRoute = jest.fn(async (route: Route) => {
        this.removed.push(route.description.id!)
        this.routes = this.routes!.filter(r => r !== route)
    })
}

describe('SharedRouteMaterializer', () => {
    let list: FakeList
    let rows: Record<string, string[]>
    let events: Array<Record<string, unknown>>
    let materializer: SharedRouteMaterializer

    beforeEach(() => {
        list = new FakeList()
        rows = {}
        events = []
        materializer = new SharedRouteMaterializer({
            getList: () => list,
            getRowsForRoute: key => (rows[key] ?? ['A']).map(linkId => ({ linkId, routeKey: key }) as SharedRouteEntry),
            log: e => events.push(e),
            logError: jest.fn(),
        })
    })

    describe('materialize', () => {
        test('creates a first-class route flagged linkShared from the summary, with one list update', async () => {
            const res = await materializer.materialize([entry(HASH_A), entry(HASH_B)])
            expect(res).toMatchObject({ added: 2, updated: 0, skippedOwn: 0, skippedNoHash: 0 })
            expect(list.addCalls).toBe(1)
            const descr = list.getRoute(HASH_A)!.description
            expect(descr).toMatchObject({
                id: HASH_A, routeHash: HASH_A, title: `title ${HASH_A}`, distance: 1000, isLocal: true, hasVideo: true, linkShared: true,
            })
            expect(typeof descr.tsImported).toBe('number')
            expect(descr.source).toBeUndefined()
            expect(descr.videoUrl).toBeUndefined()
            expect(list.saved).toHaveLength(2)
            expect(events.at(-1)).toMatchObject({ message: 'shared routes materialized', added: 2, updated: 0, removed: 0, skippedOwn: 0, skippedNoHash: 0 })
        })

        test('the same route on two computers is one route and the second sync changes nothing', async () => {
            await materializer.materialize([entry(HASH_A)])
            const first = list.getRoute(HASH_A)!.description.tsImported
            const res = await materializer.materialize([entry(HASH_A)])
            expect(res).toMatchObject({ added: 0, updated: 0 })
            expect(list.routes).toHaveLength(1)
            expect(list.getRoute(HASH_A)!.description.tsImported).toBe(first)
            expect(list.addCalls).toBe(1)
        })

        test('an update keeps tsImported and the other fields of the route', async () => {
            await materializer.materialize([entry(HASH_A)])
            const route = list.getRoute(HASH_A)!
            route.description.tsLastStart = 77
            route.description.tsImported = 5
            const res = await materializer.materialize([entry(HASH_A, { summary: { title: 'renamed', country: 'DE' } })])
            expect(res).toMatchObject({ added: 0, updated: 1 })
            const descr = list.getRoute(HASH_A)!.description
            expect(descr).toMatchObject({ title: 'renamed', country: 'DE', tsImported: 5, tsLastStart: 77, linkShared: true })
            expect(descr.distance).toBeUndefined()
        })

        test('a route the phone imported itself is left untouched', async () => {
            list.routes = [new Route({ id: HASH_A, title: 'mine', isLocal: true, hasVideo: true, videoUrl: 'file:///x.mp4' })]
            const res = await materializer.materialize([entry(HASH_A)])
            expect(res).toMatchObject({ added: 0, updated: 0, skippedOwn: 1 })
            expect(list.getRoute(HASH_A)!.description.title).toBe('mine')
            expect(list.getRoute(HASH_A)!.description.linkShared).toBeUndefined()
            expect(list.addRoutes).not.toHaveBeenCalled()
        })

        test('local routes without a hash are not materialised and do not crash', async () => {
            const res = await materializer.materialize([entry('L1:x', { routeHash: undefined, summary: undefined }), entry(HASH_A)])
            expect(res).toMatchObject({ added: 1, skippedNoHash: 1 })
            expect(list.routes).toHaveLength(1)
        })

        test('entries without a summary, official routes and a key that differs from the hash are ignored', async () => {
            const res = await materializer.materialize([
                entry(HASH_A, { summary: undefined }), entry('srv-1', { origin: 'official', routeHash: undefined, summary: undefined }), entry(HASH_B, { routeHash: HASH_A }),
            ])
            expect(res).toMatchObject({ added: 0, skippedNoHash: 0 })
            expect(list.routes).toHaveLength(0)
        })

        test('does nothing while the route list is not loaded', async () => {
            list.routes = undefined
            expect(await materializer.materialize([entry(HASH_A)])).toBeUndefined()
            list.routes = []
            list.loading = true
            expect(await materializer.materialize([entry(HASH_A)])).toBeUndefined()
            expect(list.addRoutes).not.toHaveBeenCalled()
        })

        test('removes linkShared routes that no computer has a row for', async () => {
            await materializer.materialize([entry(HASH_A), entry(HASH_B)])
            rows[HASH_A] = []
            const res = await materializer.materialize([])
            expect(res!.removed).toBe(1)
            expect(list.removed).toEqual([HASH_A])
        })
    })

    describe('removeOrphans', () => {
        const shared = (id: string, extra = {}) => new Route({ id, title: id, isLocal: true, hasVideo: true, linkShared: true, ...extra })

        test('keeps a route while any computer still has a row, even if that computer is unreachable', async () => {
            list.routes = [shared(HASH_A)]
            rows[HASH_A] = ['A']
            expect(await materializer.removeOrphans()).toBe(0)
        })

        test('keeps a route with a local copy and the route that is being ridden', async () => {
            list.routes = [shared(HASH_A, { isDownloaded: true, videoUrl: 'file:///copy.mp4' }), shared(HASH_B)]
            rows[HASH_A] = []
            rows[HASH_B] = []
            list.selected = list.routes[1]
            expect(await materializer.removeOrphans()).toBe(0)
            list.selected = undefined
            expect(await materializer.removeOrphans()).toBe(1)
            expect(list.removed).toEqual([HASH_B])
        })

        test('never removes the phone\'s own routes', async () => {
            list.routes = [new Route({ id: HASH_A, isLocal: true, hasVideo: true })]
            rows[HASH_A] = []
            expect(await materializer.removeOrphans()).toBe(0)
        })

        test('removed after the last computer was forgotten', async () => {
            list.routes = [shared(HASH_A)]
            rows[HASH_A] = ['A']
            expect(await materializer.removeOrphans()).toBe(0)
            rows[HASH_A] = []
            expect(await materializer.removeOrphans()).toBe(1)
        })

        test('a failing removal is logged, the others go on', async () => {
            list.routes = [shared(HASH_A), shared(HASH_B)]
            rows[HASH_A] = []
            rows[HASH_B] = []
            list.removeSharedRoute.mockRejectedValueOnce(new Error('x'))
            expect(await materializer.removeOrphans()).toBe(1)
        })
    })
})

