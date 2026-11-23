export const THUMBNAIL_DIR = 'thumbnails'
export const THUMBNAIL_EXT = 'img'
/** how long a failed fetch is not retried */
export const FAILURE_TTL_MS = 60_000
export const FETCH_TIMEOUT_MS = 15_000
/** thumbnails are small; anything larger is not a thumbnail and is not stored */
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024
export const MAX_KEY_LENGTH = 120
/** requests to a paired computer in flight at once; its media server answers 503 beyond its stream limit (default 8, shared with video) */
export const MAX_COMPUTER_REQUESTS = 4
