import type { Route } from '../../base/model/route'
import type { SharedRouteEntry } from '../types'

/** The parts of the route list the marker needs. */
export interface MarkerRouteList {
    getAllRoutes(): Route[] | undefined
    isStillLoading(): boolean
    /** sets the `linkSources` marker of the routes, description only; @returns the number of routes that changed */
    updateLinkSources(updates: Array<{ id: string, linkSources: string[] }>): number
}

export interface MarkerDeps {
    getList: () => MarkerRouteList
    /** the saved rows of all paired computers */
    getRows: () => SharedRouteEntry[]
    log: (event: Record<string, unknown>) => void
    logError: (err: Error, fn: string) => void
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Writes the `linkSources` marker into the description of the routes of this device: the `linkId`s of
 * the paired computers whose catalog offers the video of the route. The list prepares its availability
 * from this marker, without loading any route details.
 *
 * It is a marker-only update: no other field of a route changes, and a route is never created, replaced
 * or removed (the phone's own route always wins; routes that exist only because a computer shares them
 * carry no marker, their rows are the truth). A route is matched by its id or by its `routeHash`.
 *
 * The marker is derived from the saved rows of the computers, so it is the same after a sync, after a
 * computer was forgotten and when the route list finished loading after the sync. A row that was missed
 * in the last sync of its computer does not count.
 */
export class RouteLinkMarker {
    constructor(protected deps: MarkerDeps) {}

    /**
     * Brings the markers of all routes in line with the saved rows.
     *
     * @returns the number of routes that changed, `undefined` if the route list is not loaded yet
     * (call again when it is). Never throws.
     */
    reconcile(): number | undefined {
        try {
            const list = this.deps.getList()
            const routes = list.getAllRoutes()
            if (routes === undefined || list.isStillLoading())
                return undefined

            const sources = this.getSources()
            const updates: Array<{ id: string, linkSources: string[] }> = []
            for (const route of routes) {
                const descr = route?.description
                if (!descr?.id || descr.linkShared)
                    continue
                const wanted = this.getWanted(sources, descr.id, descr.routeHash)
                if (!sameList(wanted, [...(descr.linkSources ?? [])].sort()))
                    updates.push({ id: descr.id, linkSources: wanted })
            }
            const changed = updates.length > 0 ? list.updateLinkSources(updates) : 0
            if (changed > 0)
                this.deps.log({ message: 'route link sources updated', routes: changed })
            return changed
        }
        catch (err) {
            this.deps.logError(err as Error, 'reconcile')
            return undefined
        }
    }

    /** the computers that offer a route, by the route key of the rows */
    protected getSources(): Map<string, Set<string>> {
        const sources = new Map<string, Set<string>>()
        for (const row of this.deps.getRows()) {
            if (row.missCount > 0)
                continue
            const linkIds = sources.get(row.routeKey) ?? new Set<string>()
            linkIds.add(row.linkId)
            sources.set(row.routeKey, linkIds)
        }
        return sources
    }

    protected getWanted(sources: Map<string, Set<string>>, id: string, routeHash?: string): string[] {
        const byId = sources.get(id)
        const byHash = routeHash ? sources.get(routeHash) : undefined
        if (!byId && !byHash)
            return []
        return [...new Set([...(byId ?? []), ...(byHash ?? [])])].sort()
    }
}
