import { EventLogger } from 'gd-eventlog'
import { REDIRECT_NOT_ALLOWED } from '../../api/rest/types'
import IncyclistRoutesApi from '../base/api/api'
import type { IIncyclistRoutesApi } from '../base/api/types'
import { SERVER_MESSAGES as MSG } from './messages'
import { isAllowedRedirectTarget } from './validator'
import type { RouteServerProbeFailure, RouteServerProbeResult } from './types'

export const PROBE_TIMEOUT_MS = 10000

export type ProbeApiFactory = (url: string) => IIncyclistRoutesApi

const logger = new EventLogger('RouteServerProbe')

const FAILURE_MESSAGES: Record<RouteServerProbeFailure, string> = {
    'unreachable': MSG.probeUnreachable,
    'not-a-server': MSG.probeNotAServer,
    'server-error': MSG.probeServerError,
}

const createProbeApi: ProbeApiFactory = (url) => {
    const api = new IncyclistRoutesApi(url)
    api.setRequestOptions({ timeout: PROBE_TIMEOUT_MS, redirectPolicy: isAllowedRedirectTarget })
    return api
}

/** Maps a failed request to what is shown to the user: no status codes, no technical text */
export const mapProbeError = (err): RouteServerProbeFailure => {
    if (err?.code === REDIRECT_NOT_ALLOWED)
        return 'not-a-server'

    const status = err?.response?.status
    if (typeof status === 'number')
        return status >= 500 ? 'server-error' : 'not-a-server'

    return 'unreachable'
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms)
    })
    return Promise.race([promise, timeout]).finally(() => { clearTimeout(timer) })
}

const failure = (code: RouteServerProbeFailure, url: string): RouteServerProbeResult => {
    return { ok: false, code, message: FAILURE_MESSAGES[code], url }
}

/**
 * Checks a candidate route server without saving it: it has to answer the request for video
 * route descriptions with a JSON array. The route count is the length of that array.
 *
 * @param url       address of the server
 * @param createApi factory of the (throwaway) api client; only needed for tests
 * @param timeoutMs maximum time to wait for the answer
 */
export const probeRouteServer = async (url: string, createApi: ProbeApiFactory = createProbeApi, timeoutMs = PROBE_TIMEOUT_MS): Promise<RouteServerProbeResult> => {
    try {
        const api = createApi(url)
        const descriptions = await withTimeout(api.getRouteDescriptions({ type: 'video' }, true), timeoutMs)

        if (!Array.isArray(descriptions)) {
            logger.logEvent({ message: 'route server probe failed', result: 'not-a-server', reason: 'no json array' })
            return failure('not-a-server', url)
        }

        logger.logEvent({ message: 'route server probe done', result: 'ok', routeCount: descriptions.length })
        return { ok: true, routeCount: descriptions.length, url }
    }
    catch (err) {
        const code = mapProbeError(err)
        logger.logEvent({ message: 'route server probe failed', result: code, reason: err?.message, status: err?.response?.status })
        return failure(code, url)
    }
}

/**
 * Probes the address and, if no scheme was typed for a home-network host, tries `http://` once after
 * `https://` failed at connection level (not after a valid HTTP error response).
 *
 * @param url              the address to check (as returned by the validator)
 * @param httpFallbackUrl  the `http://` variant to try if `url` is unreachable
 */
export const checkRouteServer = async (url: string, httpFallbackUrl?: string, createApi?: ProbeApiFactory, timeoutMs?: number): Promise<RouteServerProbeResult> => {
    const result = await probeRouteServer(url, createApi, timeoutMs)
    if (result.ok || result.code !== 'unreachable' || !httpFallbackUrl)
        return result

    const fallback = await probeRouteServer(httpFallbackUrl, createApi, timeoutMs)
    if (fallback.ok) {
        logger.logEvent({ message: 'route server probe switched to http', routeCount: fallback.routeCount })
        return { ...fallback, switchedToHttp: true }
    }

    // report the problem of the first attempt: the one the user typed
    return result
}
