import type { SharedRouteEntry } from '../types'

/** Outcome of the catalog sync of one computer. */
export type SyncStatus =
    | 'synced'        // the catalog was fetched and the rows of this computer were replaced
    | 'unchanged'     // the catalog version did not change; nothing was fetched
    | 'unreachable'   // the computer did not answer: nothing was written
    | 'failed'        // the computer answered, but not with a usable catalog: nothing was written

export interface SyncResult {
    linkId: string
    status: SyncStatus
    added?: number
    removed?: number
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
    isLocal?: boolean
    isDownloaded?: boolean
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

/** What triggered the load of a route's details from a computer. */
export type DescriptorTrigger = 'details' | 'ride' | 'copy'

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
