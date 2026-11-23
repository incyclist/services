import { Route } from '../../base/model/route'
import type { RouteInfo } from '../../base/types'
import type { CatalogEntry, SharedRouteEntry, SharedRouteSummary } from '../types'
import type { MaterializeResult } from './types'

/** The parts of the route list the materialiser needs. */
export interface MaterializerRouteList {
    getAllRoutes(): Route[] | undefined
    isStillLoading(): boolean
    getRoute(id: string): Route | undefined
    getSelected(): Route | undefined
    addRoutes(routes: Route[], source: 'system'): void
    saveRoute(route: Route): Promise<void>
    removeSharedRoute(route: Route): Promise<boolean | void>
}

export interface MaterializerDeps {
    getList: () => MaterializerRouteList
    getRowsForRoute: (routeKey: string) => SharedRouteEntry[]
    log: (event: Record<string, unknown>) => void
    logError: (err: Error, fn: string) => void
}

const SUMMARY_KEYS: Array<keyof SharedRouteSummary> = [
    'title', 'localizedTitle', 'country', 'distance', 'elevation', 'isLoop', 'hasGpx', 'pointsSource', 'videoFormat',
]

const sameSummary = (descr: RouteInfo, summary: SharedRouteSummary): boolean =>
    SUMMARY_KEYS.every(key => JSON.stringify(descr[key]) === JSON.stringify(summary[key]))

const hasLocalCopy = (descr: RouteInfo): boolean =>
    !!descr.isDownloaded && !!descr.videoUrl && !descr.videoUrl.startsWith('http')

/**
 * Keeps the routes of a paired computer's catalog as first-class routes of this device
 * (`linkShared`): created from the catalog summary, with the details arriving lazily.
 *
 * - The phone's own route wins: a route with the same id that is not `linkShared` is left alone.
 * - Routes without a `routeHash` are not materialised: without points they can not be ridden.
 * - A `linkShared` route is removed only when no computer has a row for it any more and it has no
 *   local copy and is not being ridden. Rows only disappear through the pruning of a sync or by
 *   forgetting a computer, so a computer that does not answer removes nothing.
 */
export class SharedRouteMaterializer {
    constructor(protected deps: MaterializerDeps) {}

    /** @returns `undefined` if the route list is not loaded yet (call again when it is) */
    async materialize(entries: CatalogEntry[]): Promise<MaterializeResult | undefined> {
        const list = this.deps.getList()
        if (list.getAllRoutes() === undefined || list.isStillLoading())
            return undefined

        const result: MaterializeResult = { added: 0, updated: 0, removed: 0, skippedOwn: 0, skippedNoHash: 0 }
        const changed: Route[] = []
        for (const entry of entries) {
            if (entry.origin !== 'local')
                continue
            if (!entry.routeHash) {
                result.skippedNoHash++
                continue
            }
            const route = this.build(list, entry, result)
            if (route)
                changed.push(route)
        }

        if (changed.length > 0) {
            list.addRoutes(changed, 'system')
            await this.save(list, changed)
        }
        result.removed = await this.removeOrphans()
        this.deps.log({ message: 'shared routes materialized', ...result })
        return result
    }

    /**
     * Removes the `linkShared` routes that no computer has a row for, except those with a local copy
     * and the one that is selected for a ride.
     *
     * @returns the number of routes removed
     */
    async removeOrphans(): Promise<number> {
        const list = this.deps.getList()
        const selectedId = list.getSelected()?.description?.id
        const orphans = (list.getAllRoutes() ?? []).filter(route => {
            const descr = route.description
            return descr?.linkShared && descr.id !== selectedId && !hasLocalCopy(descr) && this.deps.getRowsForRoute(descr.id!).length === 0
        })
        let removed = 0
        for (const route of orphans) {
            try {
                if (await list.removeSharedRoute(route) !== false)
                    removed++
            }
            catch (err) {
                this.deps.logError(err as Error, 'removeOrphans')
            }
        }
        return removed
    }

    protected build(list: MaterializerRouteList, entry: CatalogEntry, result: MaterializeResult): Route | undefined {
        const { routeKey, summary } = entry
        if (!summary || entry.routeHash !== routeKey)
            return undefined

        const existing = list.getRoute(routeKey)
        if (!existing) {
            result.added++
            const descr: RouteInfo = {
                ...summary, id: routeKey, routeHash: routeKey, isLocal: true, hasVideo: true, linkShared: true, tsImported: Date.now(),
            }
            return new Route(descr)
        }
        if (!existing.description.linkShared) {
            result.skippedOwn++
            return undefined
        }
        if (sameSummary(existing.description, summary))
            return undefined
        result.updated++
        const descr: RouteInfo = { ...existing.description, ...summary }
        for (const key of SUMMARY_KEYS) {
            if (summary[key] === undefined)
                delete descr[key]
        }
        return new Route(descr)
    }

    protected async save(list: MaterializerRouteList, routes: Route[]): Promise<void> {
        for (const route of routes) {
            try {
                await list.saveRoute(route)
            }
            catch (err) {
                this.deps.logError(err as Error, 'save')
            }
        }
    }
}
