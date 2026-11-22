import type { LocalizedText } from '../../i18n'
import type { DaumEpp, RouteInfo, RouteInfoText, RoutePoint, RouteSegment, VideoMapping } from '../base/types'

/**
 * Route sharing over the `local-link` transport: the catalog a computer publishes and the
 * per-computer rows the phone persists from it.
 *
 * Timestamps are epoch milliseconds, sizes are bytes.
 */

/**
 * List-level description of a route that only a computer has (`origin: 'local'`), so that the
 * phone can list it while the computer is off. Never carries paths, urls or timestamps.
 */
export interface SharedRouteSummary {
    title: string
    localizedTitle?: RouteInfo['localizedTitle']
    country?: string
    distance?: number
    elevation?: number
    isLoop?: boolean
    hasGpx?: boolean
    pointsSource?: RouteInfo['pointsSource']
    videoFormat?: string
}

/** Video part of a {@link SharedRouteDescriptor}: mappings and segments, never a file or url. */
export interface SharedRouteDescriptorVideo {
    framerate: number
    width?: number
    height?: number
    format: string
    mappings: VideoMapping[]
    selectableSegments?: RouteSegment[]
    segments?: unknown
    informations?: unknown
}

/**
 * The details of a local route as the computer hands them to a phone (document body of a
 * `rd-*` document). Built from a whitelist: no path, url, origin or usage timestamp is part of it.
 */
export interface SharedRouteDescriptor {
    v: 1
    routeKey: string
    description: SharedRouteSummary & { segments?: RouteSegment[] }
    details: {
        title: string
        localizedTitle?: LocalizedText | string
        country?: string
        distance?: number
        elevation?: number
        description?: LocalizedText
        points?: RoutePoint[]
        infoTexts?: RouteInfoText[]
        epp?: DaumEpp
        gpxDisabled?: boolean
        elevationShifted?: boolean
        video?: SharedRouteDescriptorVideo
    }
}

/** Why a computer did not hand out a descriptor. */
export type RouteDescriptorError = 'unknown-route' | 'no-details' | 'busy' | 'too-large' | 'publish-failed'

/** Body of the `route-descriptor` request. */
export interface RouteDescriptorRequestBody {
    routeKey: string
}

/**
 * Body of the `route-descriptor` response. `document` is the name of a temporary document on the
 * media server; `sha256` is the base64url SHA-256 of its exact UTF-8 body.
 */
export interface RouteDescriptorResponseBody {
    routeKey: string
    document?: string
    size?: number
    sha256?: string
    error?: RouteDescriptorError
}

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
    /** `official`: a route-server route the phone already knows by `routeKey`; `local`: a route only this computer has */
    origin?: 'official' | 'local'
    /** content-derived identity of the route geometry, when the computer knows it */
    routeHash?: string
    /** list-level description of a local route that has a `routeHash` */
    summary?: SharedRouteSummary
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
