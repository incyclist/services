/** Repository holding one row per route and computer (key: `${linkId}:${routeKey}`). */
export const SHARED_ROUTES_REPOSITORY = 'sharedRoutes'

/** A row is pruned when the computer answered without the route in more than this many sync cycles. */
export const MAX_MISS_COUNT = 3

/** Time allowed for one request to the media server of a computer. */
export const CATALOG_TIMEOUT_MS = 10_000

/** Time allowed for the whole sync of one computer (session included). */
export const SYNC_TIMEOUT_MS = 30_000

/** Time allowed for the `HEAD` probe of a video handle. */
export const PROBE_TIMEOUT_MS = 4000

/** An automatic trigger leaves a computer that did not answer alone for this long. */
export const UNREACHABLE_TTL_MS = 60_000

/** Handles are put into URLs: only this alphabet is accepted from a computer. */
export const HANDLE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Message type with which a computer announces that its catalog changed. */
export const CATALOG_CHANGED_MESSAGE = 'catalog-changed'

/** `getRouteHash()`: MD5 as hex. */
export const ROUTE_HASH_PATTERN = /^[0-9a-f]{32}$/

/** Time allowed for the `route-descriptor` request on the control session. */
export const DESCRIPTOR_REQUEST_TIMEOUT_MS = 10_000

/** Time allowed to download a descriptor document. */
export const DESCRIPTOR_DOWNLOAD_TIMEOUT_MS = 30_000

/** Wait before the one retry after the computer answered `busy`. */
export const DESCRIPTOR_BUSY_RETRY_MS = 2000

/**
 * Free space asked for on top of the video itself before it is copied to this device: a transfer
 * that fills the volume completely would take the rest of the app down with it.
 */
export const COPY_STORAGE_MARGIN_BYTES = 500 * 1024 * 1024
