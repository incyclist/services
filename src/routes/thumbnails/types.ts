/**
 * Where the thumbnail of a route comes from. Every field is optional: the cache works with
 * whatever the caller knows, and never persists anything that expires.
 */
export interface ThumbnailRequest {
    /** stable identity of the route (route id / `routeKey`); keys the cached file together with the source */
    routeKey?: string
    /** `http(s)` URL of the thumbnail. Other schemes (`file:`, `video:`, `data:`) are already local and never cached */
    url?: string
    /** thumbnail served by a paired computer (`/t/<handle>`); needs a fresh media token on every fetch */
    link?: ThumbnailLinkSource
}

export interface ThumbnailLinkSource {
    linkId: string
    thumbHandle: string
}
