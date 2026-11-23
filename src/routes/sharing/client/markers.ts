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

/**
 * THE rule that decides which saved rows of the computers offer a route: the row is keyed by the id
 * or by the `routeHash` of the route, and it was not missed in the last sync of its computer.
 * The marker, the playback and the availability all use it, so the list and the player agree.
 * A computer that has the route by id and by hash is returned once per key.
 */
export const selectCandidateRows = (rows: SharedRouteEntry[], id: string | undefined, routeHash?: string): SharedRouteEntry[] => {
    const seen = new Set<string>()
    return rows.filter(row => {
        if (row.missCount > 0 || !(row.routeKey === id || (!!routeHash && row.routeKey === routeHash)))
            return false
        const key = `${row.linkId}\u0000${row.routeKey}`
        if (seen.has(key))
            return false
        seen.add(key)
        return true
    })
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
        return this.run(false)
    }

    /**
     * Removes the markers of all routes (route sharing is not available on this device, so nothing
     * must stay persisted in the descriptions).
     *
     * @returns the number of routes that changed, `undefined` if the route list is not loaded yet. Never throws.
     */
    clear(): number | undefined {
        return this.run(true)
    }

    protected run(clear: boolean): number | undefined {
        try {
            const list = this.deps.getList()
            const routes = list.getAllRoutes()
            if (routes === undefined || list.isStillLoading())
                return undefined

            const rows = clear ? [] : this.deps.getRows()
            const byKey = new Map<string, SharedRouteEntry[]>()
            for (const row of rows)
                byKey.set(row.routeKey, [...(byKey.get(row.routeKey) ?? []), row])
            const updates: Array<{ id: string, linkSources: string[] }> = []
            for (const route of routes) {
                const descr = route?.description
                if (!descr?.id || descr.linkShared)
                    continue
                const wanted = this.getWanted(byKey, descr.id, descr.routeHash)
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

    /** the sorted computers that offer a route; only the rows of its two keys are looked at */
    protected getWanted(byKey: Map<string, SharedRouteEntry[]>, id: string, routeHash?: string): string[] {
        const candidates = [...(byKey.get(id) ?? []), ...(routeHash ? byKey.get(routeHash) ?? [] : [])]
        return [...new Set(selectCandidateRows(candidates, id, routeHash).map(r => r.linkId))].sort()
    }
}
