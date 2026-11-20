export type RouteServerStatus = 'ok' | 'empty' | 'loading' | 'unreachable' | 'unknown'

export type RouteServerNameErrorCode = 'empty' | 'reserved-word' | 'format' | 'reserved-source' | 'duplicate'

export type RouteServerUrlErrorCode =
    | 'empty' | 'whitespace' | 'credentials' | 'not-a-url' | 'http-internet'
    | 'http-not-supported' | 'duplicate' | 'built-in'

export interface RouteServerNameContext {
    /** names of the servers that are already configured */
    existingNames?: Array<string>
    /** names that are used as a source by Incyclist itself (apps, Local, Incyclist) */
    reservedNames?: Array<string>
}

export type RouteServerNameResult =
    { valid: true, name: string } |
    { valid: false, name: string, code: RouteServerNameErrorCode, message: string }

export interface RouteServerUrlContext {
    /** whether `http://` is accepted for hosts on the home network (platform capability) */
    allowsLocalHttp?: boolean
    /** the servers that are already configured (name -> url) */
    existingServers?: Record<string, string>
    /** URLs of the built-in Incyclist server */
    builtInUrls?: Array<string>
}

export interface RouteServerUrlInfo {
    /** the address as it will be stored (`URL.href`) */
    url: string
    host: string
    /** the same address with `http://`, only set if no scheme was typed for a home-network host */
    httpFallbackUrl?: string
    schemeTyped: boolean
    isLocal: boolean
    isUnencrypted: boolean
}

export type RouteServerUrlResult =
    ({ valid: true } & RouteServerUrlInfo) |
    { valid: false, code: RouteServerUrlErrorCode, message?: string }

export type RouteServerProbeFailure = 'unreachable' | 'not-a-server' | 'server-error'

export type RouteServerProbeResult =
    { ok: true, routeCount: number, url: string, switchedToHttp?: boolean } |
    { ok: false, code: RouteServerProbeFailure, message: string, url: string }

export interface RouteServerLoadResult {
    status: Exclude<RouteServerStatus, 'loading' | 'unknown'>
    routeCount: number
}

export interface KnownRouteServer {
    id: string
    name: string
    url: string
    description: string
    operator?: string
}

export interface RouteServerDownloadInfo {
    routeCount: number
    downloadedCount: number
    /** total size of the downloaded video files in bytes; undefined if it can't be determined */
    downloadedBytes?: number
}
