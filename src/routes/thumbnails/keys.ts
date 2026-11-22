import { MAX_KEY_LENGTH } from './consts'
import type { ThumbnailRequest } from './types'

/** 32 bit FNV-1a hash as 8 hex digits (collision guard for sanitised names, not a security measure) */
export const hash = (text: string): string => {
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        h ^= text.codePointAt(i)!
        h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
}

/** A file name safe on every platform. The hash of the original keeps different inputs apart. */
const toName = (text: string): string => {
    const safe = text.replaceAll(/[^A-Za-z0-9_-]/g, '_').slice(0, MAX_KEY_LENGTH)
    return `${safe}-${hash(text)}`
}

export const isCacheableUrl = (url: string | undefined): url is string =>
    typeof url === 'string' && /^https?:\/\//i.test(url)

/**
 * The cache keys under which the thumbnail of a request can be stored, in the order they are looked up.
 *
 * - `https`: route identity plus a hash of the URL, so a changed thumbnail is a new entry
 * - computer: route identity only. Handles are opaque and refreshed by the computer, the media
 *   token is never part of a key
 *
 * A request without a route identity falls back to the URL alone.
 */
export const getKeys = (request: ThumbnailRequest): string[] => {
    const keys: string[] = []
    const route = request?.routeKey
    if (isCacheableUrl(request?.url))
        keys.push(route ? toName(`${route}|${request.url}`) : toName(`url|${request.url}`))
    if (route && request.link?.linkId && request.link.thumbHandle)
        keys.push(toName(`${route}|link`))
    return keys
}
