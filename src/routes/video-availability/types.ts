/**
 * Types describing whether a route's video file can actually be played right now, and what the
 * app is doing about it (downloading it, waiting for a network, or asking the user for access).
 *
 * Inert on every platform without the `fileAccess` binding: the state is then always 'unknown'
 * and nothing is gated.
 */

export type RouteVideoState =
    | 'checking' | 'ready' | 'unknown'
    | 'not-downloaded' | 'downloading' | 'downloading-external' | 'waiting-for-network'
    | 'cancelled' | 'not-enough-storage' | 'download-failed'
    | 'access-lost' | 'not-found'

/** Whether a downloaded video is kept afterwards, or removed again after the ride. */
export type VideoKeepChoice = 'keep' | 'this-ride'

/** The only two states worth a badge on a route list card. */
export type VideoListPill = 'downloading' | 'in-icloud'

export interface RouteVideoStatus {
    routeId: string
    state: RouteVideoState
    transient?: boolean
    thisRide?: boolean
    choice?: VideoKeepChoice
    isICloud: boolean
    sizeBytes?: number
    freeBytes?: number
    requiredBytes?: number
    startedAt?: number
    /** Total number of video files this route needs. */
    fileCount: number
    notDownloadedCount: number
    /** Index of the first segment whose video is unavailable, for multi-video routes. */
    affectedSegment?: number
    confirmedThisSession: boolean
}

/** A row on the Downloads list contributed by this service (as opposed to a server download). */
export interface VideoDownloadRow {
    routeId: string
    title: string
    state: RouteVideoState
    choice?: VideoKeepChoice
    sizeBytes?: number
    requiredBytes?: number
    freeBytes?: number
    startedAt?: number
}

/**
 * Persisted record of a download this app started, keyed by canonical file path. It is the only
 * thing that authorises the app to evict a file again - without an entry, nothing is removed.
 */
export interface VideoDownloadJournalEntry {
    path: string
    routeId: string
    choice: VideoKeepChoice
    status: 'downloading' | 'stopping' | 'awaiting-ride' | 'removal-due'
    startedAt: number
    stoppedAt?: number
    dueAt?: number
    evictAttempts: number
    appVersion?: string
}
