import { RideWithGpsApi, RideWithGpsRoute, isOwnActiveRoute, isRoadCyclingRoute } from '../../../apps/base/api/ridewithgps'
import { RideWithGpsAppConnection } from '../../../apps/ridewithgps'
import { sleep } from '../../../utils/sleep'
import { Route } from '../../base/model/route'
import { GPXParser } from '../../base/parsers/gpx'
import { RouteInfo, RoutePoint } from '../../base/types'
import { BaseSyncProvider } from '../base/provider'
import { RouteSyncFactory } from '../factory'
import { IRouteSyncProvider, RouteSyncSummary } from '../types'

const PAGE_SIZE = 100

/**
 * Syncs the routes of the user at RideWithGPS.
 *
 * Only the own routes that are not archived are synced, and only the ones that are relevant for Incyclist
 * (road cycling, see `isRoadCyclingRoute`). New, changed and deleted routes are detected by comparing the complete list of
 * routes with the routes that are known (the incremental sync endpoint of RideWithGPS does not deliver the data of the routes).
 */
export class RideWithGpsSyncProvider
    extends BaseSyncProvider<RideWithGpsRoute, RideWithGpsApi, RideWithGpsAppConnection>
    implements IRouteSyncProvider {

    constructor() {
        super('RideWithGpsSync')
    }

    async loadDetails(route: Route): Promise<Route> {
        try {
            this.logEvent({ message: 'load route details', id: route?.description?.id, title: route?.description?.title })

            const id = this.getOriginalId(route)
            if (!id) return

            const points = await this.loadPoints(id)
            await this.applyRoutePoints(route, points)

            return route
        }
        catch (err) {
            this.logError(err, 'loadDetails', { id: route?.description?.id, title: route?.description?.title })
        }
    }

    // ------  PROTECTED MEMBERS ----------

    /**
     * Retrieves the track of the route.
     * This is the only place that knows where the track comes from: the GPX file (`getRouteAsGPX`), which is processed
     * by the existing GPX parser. To use the track points of the JSON route (`getRoute`) instead, only this method has to change.
     */
    protected async loadPoints(id: string): Promise<Array<RoutePoint>> {
        const gpx = await this.getApi().getRouteAsGPX(id)
        const parsed = await new GPXParser().parseFromString(gpx)
        return parsed.details.points
    }

    protected async loadRoutesFromApi(): Promise<{ routes: Array<RideWithGpsRoute>, done: boolean, error: boolean }> {
        const api = this.getApi()
        const userId = api.getUserId()
        let page = 1
        let done = false
        let error = false
        const routes: Array<RideWithGpsRoute> = []

        while (!done && !this.stopRequested) {
            try {
                const result = await api.getRoutes({ page, pageSize: PAGE_SIZE, archived: false })
                routes.push(...result.routes.filter(r => isOwnActiveRoute(r, userId) && isRoadCyclingRoute(r)))

                done = result.routes.length === 0 || !result.pagination?.next_page_url
                page++

                await sleep(100)
            }
            catch (err) {
                this.logEvent({ message: 'could not load routes', reason: err.message })
                done = true
                error = true
            }
        }
        return { routes, done, error }
    }

    protected getRouteSyncSummary(route: RideWithGpsRoute): RouteSyncSummary {
        return {
            id: String(route.id),
            lastUpdate: route.updated_at,
            creation: route.created_at
        }
    }

    protected buildRouteInfo(route: RideWithGpsRoute): RouteInfo {
        const info: RouteInfo = {
            hasGpx: true,
            hasVideo: false,
            id: 'ridewithgps:' + route.id,
            title: route.name,
            elevation: route.elevation_gain,
            distance: route.distance,
            category: 'external',
            source: 'ridewithgps',
            tsLastChange: new Date(route.updated_at).valueOf()
        }
        return info
    }

    // ------  EXTERNAL DEPENDENCIES  ----------
    protected getApi(): RideWithGpsApi {
        return this.getConnection().getApi()
    }

    protected getConnection(): RideWithGpsAppConnection {
        return new RideWithGpsAppConnection()
    }
}

const factory = new RouteSyncFactory()
factory.add('ridewithgps', new RideWithGpsSyncProvider())
