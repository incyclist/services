/**
 * Route sharing over the `local-link` transport: the catalog a computer publishes and the
 * per-computer rows the phone persists from it.
 *
 * Timestamps are epoch milliseconds, sizes are bytes.
 */

/** One route in a computer's catalog. */
export interface CatalogEntry {
    /**
     * Cross-computer identity: the route-server id for official routes, `routeHash` for
     * local routes, `${linkId}:${routeIdOnComputer}` when neither exists.
     */
    routeKey: string
    /** the route's id as that computer knows it */
    routeIdOnComputer: string
    title: string
    /** opaque handle for `/v/<handle>` */
    videoHandle: string
    /** opaque handle for `/t/<handle>`; absent when the route has no thumbnail */
    thumbHandle?: string
    videoFormat: string
    size: number
    mtime: number
}

/** The catalog document served by a computer's media listener. */
export interface CatalogDocument {
    /** opaque; matches the `catalogVersion` of the `session` message */
    catalogVersion: string
    routes: CatalogEntry[]
}

/**
 * One catalog row as the phone persists it (repository `sharedRoutes`,
 * key `${linkId}:${routeKey}`). Only that computer's own catalog response may write its rows.
 */
export interface SharedRouteEntry {
    /** owning computer; never null */
    linkId: string
    routeKey: string
    routeIdOnComputer: string
    videoHandle: string
    thumbHandle?: string
    videoFormat: string
    size: number
    mtime: number
    lastConfirmedAt: number
    /** sync cycles in which this computer answered without the route; drives pruning */
    missCount: number
}
