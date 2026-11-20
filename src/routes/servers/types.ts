export type RouteServerStatus = 'ok' | 'empty' | 'loading' | 'unreachable' | 'unknown'

export type RouteServerNameErrorCode = 'empty' | 'reserved-word' | 'format' | 'reserved-source' | 'duplicate'

export type RouteServerUrlErrorCode =
    | 'empty' | 'whitespace' | 'credentials' | 'not-a-url' | 'http-internet'
    | 'http-not-supported' | 'duplicate' | 'built-in' | 'query'

export interface RouteServerNameContext {
    /** names of the servers that are already configured */
    existingNames?: Array<string>
    /** names that are used as a source by Incyclist itself (apps, Local, Incyclist) */
    reservedNames?: Array<string>
}

// The results are flat interfaces (not unions), as the library is not compiled with strict null checks,
// which discriminated unions on a boolean rely on.
export interface RouteServerNameResult {
    valid: boolean
    name: string
    /** only set if `valid` is false */
    code?: RouteServerNameErrorCode
    message?: string
}

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

export interface RouteServerUrlResult extends Partial<RouteServerUrlInfo> {
    valid: boolean
    /** only set if `valid` is false. A missing message means: nothing to show (e.g. empty address) */
    code?: RouteServerUrlErrorCode
    message?: string
}

export type RouteServerProbeFailure = 'unreachable' | 'not-a-server' | 'server-error'

export interface RouteServerProbeResult {
    ok: boolean
    url: string
    routeCount?: number
    switchedToHttp?: boolean
    /** only set if `ok` is false */
    code?: RouteServerProbeFailure
    message?: string
}

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
