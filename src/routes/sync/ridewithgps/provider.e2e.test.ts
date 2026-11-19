import dotenv from 'dotenv'
// the apps module has to be loaded first (it registers the uploaders/providers and depends on the factories)
import '../../../apps'
import { Inject } from '../../../base/decorators'
import { RideWithGpsApi, isSyncedCollection } from '../../../apps/base/api/ridewithgps'
import { Route } from '../../base/model/route'
import { RouteInfo } from '../../base/types'
import { RideWithGpsSyncProvider } from './provider'

/**
 * E2E test of the RideWithGPS route sync provider against the real account of the user (read only).
 * It runs the real sync twice: the second run must not report any change and must not request any route detail or GPX again.
 *
 * Only executed on purpose (`npm run test:e2e`). Configure in the (git-ignored) `.env` file:
 *
 *   RWGPS_ACCESS_TOKEN=...       required
 *   RWGPS_USER_ID=...            optional: id of the user
 *   RWGPS_API=...                default: https://ridewithgps.com
 *
 * The routes of the pinned routes and the bucket list are synced as well (counts of the sources are logged, never names).
 * The details (GPX) are loaded for the first 3 routes only.
 */

dotenv.config()

jest.setTimeout(90_000)

const accessToken = process.env.RWGPS_ACCESS_TOKEN
const userId = process.env.RWGPS_USER_ID
const apiUrl = process.env.RWGPS_API ?? 'https://ridewithgps.com'
const MAX_DETAILS = 3

type SyncResult = { added: Array<RouteInfo>, updated: Array<Route>, deleted: Array<string> }

// Note: plain describe()/test() (no aliases, no conditional skip), otherwise the VS Code Jest extension skips everything
describe('RideWithGpsSyncProvider (real RideWithGPS)', () => {
    let provider: RideWithGpsSyncProvider
    let api: RideWithGpsApi
    const stored: Array<{ id: string, tsLastChange: number }> = []

    beforeAll(() => {
        if (!accessToken)
            throw new Error('RWGPS_ACCESS_TOKEN is not set (see the description at the top of this file)')

        api = new RideWithGpsApi()
        api['getUserSettings'] = jest.fn().mockReturnValue({
            isInitialized: true,
            get: (key: string, defValue: unknown) => key === 'RWGPS_API' ? apiUrl : defValue
        }) as never
        // the user id is only passed if set explicitly: a wrong id would filter out all own routes
        api.init(userId ? { id: userId, accessToken } : { accessToken })

        jest.spyOn(api, 'getRoute')
        jest.spyOn(api, 'getCollection')
        jest.spyOn(api, 'getRouteAsGPX')

        Inject('AppsService', { isEnabled: () => true })
        Inject('UserSettings', { isInitialized: true, get: (_key: string, def: unknown) => def, set: jest.fn() })
        Inject('Countries', { getIsoFromLatLng: async () => 'DE' })
        // the list of the routes that were stored so far (filled from the result of the sync)
        Inject('RouteListService', { getAllAppRoutes: () => stored })

        provider = new RideWithGpsSyncProvider()
        // make the (error) events of the provider visible: they never contain tokens
        const logger = provider as unknown as { logEvent: (event: unknown) => void, logError: (err: Error, fn: string) => void }
        jest.spyOn(logger, 'logEvent').mockImplementation(event => { console.log('provider event', JSON.stringify(event)) })
        jest.spyOn(logger, 'logError').mockImplementation((err, fn) => { console.log('provider error', fn, err?.message) })
        provider['getConnection'] = jest.fn().mockReturnValue({ isConnected: () => true, getAppKey: () => 'ridewithgps', getApi: () => api }) as never
    })

    afterAll(() => {
        Inject('AppsService', null)
        Inject('UserSettings', null)
        Inject('Countries', null)
        Inject('RouteListService', null)
        provider?.reset()
        jest.restoreAllMocks()
    })

    const syncOnce = (): Promise<SyncResult> => new Promise<SyncResult>((resolve, reject) => {
        try {
            const observer = provider.sync()
            const result: SyncResult = { added: [], updated: [], deleted: [] }
            observer.on('added', (routes: Array<RouteInfo>) => { result.added.push(...routes) })
            observer.on('updated', (routes: Array<Route>) => { result.updated.push(...routes) })
            observer.on('deleted', (ids: Array<string>) => { result.deleted.push(...ids) })
            observer.once('done', () => {
                console.log(`sync done: added ${result.added.length}, updated ${result.updated.length}, deleted ${result.deleted.length}`)
                resolve(result)
            })
        }
        catch (err) {
            console.log(`sync failed: ${err.message}`)
            reject(err)
        }
    })

    const logDetails = async (info: RouteInfo) => {
        try {
            const route = await provider.loadDetails(new Route(info))
            const points = route?.details?.points ?? []
            // never print the name: it can be private
            console.log(`route ${info.id}: points ${points.length}, elevation present ${points.some(p => p.elevation !== undefined)}, ` +
                `distance ${Math.round(route?.description?.distance ?? 0)} m (list: ${Math.round(info.distance ?? 0)} m), ` +
                `elevation gain ${Math.round(route?.description?.elevation ?? 0)} m`)
            return route
        }
        catch (err) {
            console.log(`route ${info.id}: load details failed: ${err.message}`)
            throw err
        }
    }

    const countSources = async () => {
        const ownRoutes = (await api.getRoutes({ pageSize: 200, archived: false })).routes
        const own = new Set(ownRoutes.map(r => r.id))
        // ids only, never names
        console.log(`own route ids (archived flag): ${ownRoutes.map(r => `${r.id}(${r.archived})`).join(', ')}`)
        const counts = { own: own.size, pinned: 0, bucketList: 0 }
        const collections = await api.getCollections()
        for (const collection of collections.filter(isSyncedCollection)) {
            const routes = (await api.getCollection(collection.id)).routes ?? []
            console.log(`collection ${collection.id} route ids (archived flag): ${routes.map(r => `${r.id}(${r.archived})`).join(', ')}`)
            const count = routes.filter(r => !own.has(r.id)).length
            if (collection.name.toLowerCase() === 'pinned') counts.pinned = count
            else counts.bucketList = count
        }
        return counts
    }

    test('the second sync does not report any change or request any detail again', async () => {
        const first = await syncOnce()
        console.log(`first sync: ${first.added.length} routes, getRoute calls: ${(api.getRoute as jest.Mock).mock.calls.length}`)
        // counts only, never names
        const collectionCalls = (api.getCollection as jest.Mock).mock.calls.length
        console.log(`collections read: ${collectionCalls}`)
        const sources = await countSources()
        console.log(`routes by source: own ${sources.own}, pinned ${sources.pinned}, bucket list ${sources.bucketList}, in the sync result: ${first.added.length}`)
        console.log(`added route ids: ${first.added.map(r => r.id).join(', ')}`)
        first.added.forEach(info => stored.push({ id: info.id, tsLastChange: info.tsLastChange as number }))

        for (const info of first.added.slice(0, MAX_DETAILS))
            await logDetails(info)

        const detailCalls = (api.getRoute as jest.Mock).mock.calls.length
        const gpxCalls = (api.getRouteAsGPX as jest.Mock).mock.calls.length
        console.log(`calls after the first run: getRoute ${detailCalls}, getRouteAsGPX ${gpxCalls}`)

        const second = await syncOnce()

        expect(second.added).toHaveLength(0)
        expect(second.updated).toHaveLength(0)
        expect(second.deleted).toHaveLength(0)
        expect((api.getRoute as jest.Mock).mock.calls.length).toBe(detailCalls)
        expect((api.getRouteAsGPX as jest.Mock).mock.calls.length).toBe(gpxCalls)
    })
})
