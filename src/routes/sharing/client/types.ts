import type { LinkReachability } from '../../../link/client/types'

/** Outcome of the catalog sync of one computer. */
export type SyncStatus =
    | 'synced'        // the catalog was fetched and the rows of this computer were replaced
    | 'unchanged'     // the catalog version did not change; nothing was fetched
    | 'unreachable'   // the computer did not answer: nothing was written
    | 'failed'        // the computer answered, but not with a usable catalog: nothing was written

/** Why a sync ended without writing anything. */
export type SyncFailureReason = 'unreachable' | 'media-unavailable' | 'bad-catalog' | 'timeout'

export interface SyncResult {
    linkId: string
    status: SyncStatus
    added?: number
    removed?: number
    /** `synced`: the number of routes the computer offers */
    routeCount?: number
    /** set for `unreachable` and `failed` */
    reason?: SyncFailureReason
}

/**
 * Where the catalog sync of one computer stands, as the pairing dialog and the settings list render it.
 * `media-unavailable`: this device cannot load media from a computer yet (e.g. Android without the loopback pipe).
 */
export type SyncStateName = 'idle' | 'syncing' | 'done' | 'failed' | 'media-unavailable'

export interface LinkSyncState {
    linkId: string
    state: SyncStateName
    /** `done`: the number of routes of the computer */
    routeCount?: number
    /** `failed` and `media-unavailable` */
    reason?: SyncFailureReason
}

export interface SyncOptions {
    /** fetch the catalog even if its version did not change, and ignore the unreachable memory */
    force?: boolean
}

/** What replacing the rows of one computer changed. */
export interface ReplaceResult {
    added: number
    removed: number
    kept: number
}

/** The route properties the resolver and the availability check look at. */
export interface VideoSourceInput {
    id?: string
    /** the content hash of the route: a computer's row can match by it as well as by the id */
    routeHash?: string
    hasVideo?: boolean
    isLocal?: boolean
    /** created from a computer's catalog: the video can only come from a computer */
    linkShared?: boolean
    isDownloaded?: boolean
    /** the video is not part of the route record: it is online or downloadable (a `RouteInfo` marker) */
    requiresDownload?: boolean
    /** the paired computers whose catalog offers the video of the route (a `RouteInfo` marker written by the sync) */
    linkSources?: string[]
    videoUrl?: string
    originalVideoUrl?: string
    downloadUrl?: string
}

export type ResolvedVideo =
    /** a copy on this device */
    | { source: 'local', url: string }
    /** a paired computer; `url` is ephemeral: it carries the media token and is never persisted */
    | { source: 'link', url: string, linkId: string }
    /** the route's own remote video */
    | { source: 'remote', url: string }
    | { source: 'unavailable' }

export interface ResolveOptions {
    /** computers whose video failed to load: the next candidate is used (one fallthrough) */
    skipLinks?: string[]
}

/** Where a route can be played from, according to cached state only. */
export interface VideoAvailability {
    canStart: boolean
    availability: 'local' | 'fromLink' | 'remote' | 'unavailable'
    /** the connected computer that would be used */
    linkId?: string
}

/** What materialising a computer's catalog changed on this device. */
export interface MaterializeResult {
    added: number
    updated: number
    removed: number
    /** the route exists on this device as the user's own import and was left untouched */
    skippedOwn: number
    /** a local route without a `routeHash`: not materialised */
    skippedNoHash: number
}

/**
 * What triggered the load of a route's details from a computer. `list` is a row of the route list
 * asking on its own; it does not repeat a load that failed recently, the other triggers always try.
 */
export type DescriptorTrigger = 'list' | 'details' | 'ride' | 'copy'

/** Why the details of a route could not be loaded from a computer. */
export type DescriptorFailure =
    | 'unreachable'     // no open session of a computer that has the route
    | 'unsupported'     // the computers that have the route do not offer `route-descriptor`
    | 'timeout'
    | 'busy'
    | 'unknown-route'
    | 'too-large'
    | 'http'
    | 'malformed'
    | 'hash-mismatch'

/** Why a route can not be played from anywhere right now; the view renders the copy. */
export type UnavailableReason = 'linkUnreachable' | 'linkNeverReached' | 'versionMismatch' | 'noSource'

/**
 * Where a route can be played from, as shown in the list and in Route Details. Derived from the
 * last known state of the computers only: producing it never causes a request.
 */
export interface RouteAvailabilityProps {
    availability: 'local' | 'fromLink' | 'remote' | 'unavailable'
    /**
     * Display name of the one computer that would be used (the connected one, otherwise the most
     * recently seen one). Never a count.
     */
    sourceLabel?: string
    /** set when `availability` is `unavailable` */
    unavailableReason?: UnavailableReason
}

export interface RouteAvailability extends RouteAvailabilityProps {
    canStart: boolean
    /** the connected computer that would be used */
    linkId?: string
}

/** What the availability of many routes needs from the computers; read once per list. */
export type LinkSnapshot = Map<string, {
    displayName: string
    connected: boolean
    /** the computer offers `route-descriptor` on its open session */
    descriptor: boolean
    mediaAvailable: boolean
    lastSeenAt: number
    reachability: LinkReachability
}>

/** Options of the availability check. */
export interface AvailabilityOptions {
    /** the route's details are persisted on this device */
    hasDetails?: boolean
    /** the snapshot of the computers; built from the current state if absent */
    links?: LinkSnapshot
}

/** Outcome of opening the video of a row: the ephemeral URL (with the media token), or why there is none. */
export type OpenRowResult =
    | { url: string, expiresAt: number, failure?: undefined }
    | { url?: undefined, failure: 'unreachable' | 'gone' }
