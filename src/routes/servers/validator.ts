import { pascalCase, trimTrailingSlashes } from '../../utils/string'
import { SERVER_MESSAGES as MSG } from './messages'
import type {
    RouteServerUrlErrorCode, RouteServerNameContext, RouteServerNameResult, RouteServerUrlContext, RouteServerUrlInfo, RouteServerUrlResult
} from './types'

const MAX_URL_LENGTH = 2048
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} -]{0,23}$/u
const RESERVED_WORDS = ['constructor', 'prototype', '__proto__', 'local', 'incyclist']
const HIDDEN_CHARS = /[\s\p{Cc}\p{Cf}]/u
const FORBIDDEN_RAW_CHARS = /["\\<>{}|^`]/
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The identity of a source: `pascalCase(name)`, compared without regard to case.
 * "alpine videos", "Alpine-Videos" and "AlpineVideos" are the same source.
 */
export const toSourceKey = (name: string): string => pascalCase(name)?.toLowerCase()

/**
 * The value of a Source filter option for a source (internal, not meant to be shown for route servers: they are shown
 * with the name the user typed). Names with a separator are pascal-cased ("Alpine Videos" -> "AlpineVideos"), anything
 * else only gets a leading capital, so a value that was formatted already stays as it is.
 */
export const toSourceLabel = (name: string): string => {
    if (!name?.length)
        return name
    if (/[-_ ]/.test(name))
        return pascalCase(name)
    return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Checks and normalises a route server name (the name is the settings key and the source label).
 *
 * The rules are an allowlist: anything outside it is rejected, never silently stripped. The only
 * silent changes are Unicode normalisation (NFC) and trimming/collapsing of spaces.
 */
export const validateRouteServerName = (input: string, context: RouteServerNameContext = {}): RouteServerNameResult => {
    const name = (input ?? '').normalize('NFC').trim().replaceAll(/ {2,}/g, ' ')

    if (name.length === 0)
        return { valid: false, name, code: 'empty', message: MSG.nameEmpty }

    if (['constructor', 'prototype', '__proto__'].includes(name.toLowerCase()))
        return { valid: false, name, code: 'reserved-word', message: MSG.nameReservedWord }

    if (!NAME_PATTERN.test(name))
        return { valid: false, name, code: 'format', message: MSG.nameFormat }

    const key = toSourceKey(name)
    if (!key)
        return { valid: false, name, code: 'format', message: MSG.nameFormat }

    const reserved = [...RESERVED_WORDS, ...(context.reservedNames ?? [])].map(toSourceKey)
    if (reserved.includes(key))
        return { valid: false, name, code: 'reserved-source', message: MSG.nameReservedSource(name) }

    const existing = (context.existingNames ?? []).find(n => toSourceKey(n) === key)
    if (existing !== undefined)
        return { valid: false, name, code: 'duplicate', message: MSG.nameDuplicate(existing) }

    return { valid: true, name }
}

const isStrictIPv4 = (host: string): Array<number> | undefined => {
    const parts = host.split('.')
    if (parts.length !== 4)
        return undefined
    const values: Array<number> = []
    for (const part of parts) {
        if (!/^(0|[1-9]\d{0,2})$/.test(part))
            return undefined
        const v = Number(part)
        if (v > 255)
            return undefined
        values.push(v)
    }
    return values
}

const isPrivateIPv4 = ([a, b]: Array<number>): boolean => {
    return a === 127 || a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
}

const isMdnsName = (host: string): boolean => {
    if (!host.endsWith('.local'))
        return false
    const labels = host.split('.')
    if (labels.length < 2)
        return false
    if (!labels.every(l => LABEL_PATTERN.test(l)))
        return false
    return !/^\d+$/.test(labels.at(-2))
}

const isSingleLabelName = (host: string): boolean => {
    return !host.includes('.') && LABEL_PATTERN.test(host) && /[a-z]/.test(host)
}

/**
 * Splits the authority (`host[:port]`) from an address, without relying on URL parsing.
 * `authority` is what follows `://` (or the whole input if no scheme was typed) up to the first `/`, `?` or `#`.
 */
const getRawAuthority = (input: string): string => {
    const rest = SCHEME_PATTERN.test(input) ? input.replace(SCHEME_PATTERN, '') : input
    const end = rest.search(/[/?#]/)
    return end === -1 ? rest : rest.slice(0, end)
}

const getRawHost = (authority: string): string => {
    const lower = authority.toLowerCase()
    if (lower.startsWith('[')) {
        const close = lower.indexOf(']')
        return close === -1 ? lower : lower.slice(0, close + 1)
    }
    return lower.replace(/:\d*$/, '')
}

/**
 * Classifies a host as being on the home network. Fails closed: whatever is not positively
 * identified counts as the internet.
 *
 * @param rawHost  the host as typed (without port, lower case)
 * @param hostname the host as parsed by `URL`
 */
export const isHomeNetworkHost = (rawHost: string, hostname: string): boolean => {
    // alternative spellings (decimal, hex, octal, short forms, punycode) are rewritten by URL()
    if (rawHost !== hostname)
        return false

    if (hostname === 'localhost' || hostname === '[::1]')
        return true

    const ip = isStrictIPv4(hostname)
    if (ip)
        return isPrivateIPv4(ip)

    return isMdnsName(hostname) || isSingleLabelName(hostname)
}

/** Normalised form used to detect duplicates: lower case host, default port and trailing `/` dropped */
export const normalizeRouteServerUrl = (url: string): string => {
    try {
        const u = new URL(url)
        const path = trimTrailingSlashes(u.pathname)
        return `${u.protocol}//${u.host}${path}${u.search}`
    }
    catch {
        return trimTrailingSlashes((url ?? '').trim().toLowerCase())
    }
}

type UrlFailure = { valid: false, code: RouteServerUrlErrorCode, message?: string }

const fail = (code: UrlFailure['code'], message?: string): UrlFailure => ({ valid: false, code, message })

const checkRawInput = (input: string): UrlFailure | undefined => {
    if (input.length === 0)
        return fail('empty')
    if (input.length > MAX_URL_LENGTH)
        return fail('not-a-url', MSG.urlNotAUrl)
    if (HIDDEN_CHARS.test(input))
        return fail('whitespace', MSG.urlWhitespace)
    if (FORBIDDEN_RAW_CHARS.test(input) || input.includes('#'))
        return fail('not-a-url', MSG.urlNotAUrl)
    // the api appends its own query (`/?type=video`), so a query string in the address would break every request
    if (input.includes('?'))
        return fail('query', MSG.urlQuery)
    if (getRawAuthority(input).includes('@'))
        return fail('credentials', MSG.urlCredentials)
}

const findDuplicate = (href: string, context: RouteServerUrlContext): UrlFailure | undefined => {
    const normalized = normalizeRouteServerUrl(href)

    if ((context.builtInUrls ?? []).some(u => normalizeRouteServerUrl(u) === normalized))
        return fail('built-in', MSG.urlBuiltIn)

    const existing = Object.entries(context.existingServers ?? {})
        .find(([, url]) => normalizeRouteServerUrl(url) === normalized)
    if (existing)
        return fail('duplicate', MSG.urlDuplicate(existing[0]))
}

const checkScheme = (u: URL, isLocal: boolean, context: RouteServerUrlContext): UrlFailure | undefined => {
    if (u.protocol === 'https:')
        return
    if (u.protocol !== 'http:')
        return fail('not-a-url', MSG.urlNotAUrl)
    if (!isLocal)
        return fail('http-internet', MSG.urlHttpInternet)
    if (!context.allowsLocalHttp)
        return fail('http-not-supported', MSG.urlHttpNotSupported)
}

/**
 * Checks and normalises the address of a route server (URL rules in order: whitespace and
 * characters, scheme, parsing, host classification, duplicates).
 */
export const validateRouteServerUrl = (input: string, context: RouteServerUrlContext = {}): RouteServerUrlResult => {
    const trimmed = (input ?? '').trim()

    const rawFailure = checkRawInput(trimmed)
    if (rawFailure)
        return rawFailure

    const schemeTyped = SCHEME_PATTERN.test(trimmed)
    const candidate = schemeTyped ? trimmed : `https://${trimmed}`

    let u: URL
    try {
        u = new URL(candidate)
    }
    catch {
        return fail('not-a-url', MSG.urlNotAUrl)
    }

    const rawHost = getRawHost(getRawAuthority(candidate))
    if (!rawHost || !u.hostname || u.username || u.password || u.hash)
        return fail('not-a-url', MSG.urlNotAUrl)

    const isLocal = isHomeNetworkHost(rawHost, u.hostname)
    const schemeFailure = checkScheme(u, isLocal, context)
    if (schemeFailure)
        return schemeFailure

    if (u.href.length > MAX_URL_LENGTH)
        return fail('not-a-url', MSG.urlNotAUrl)

    const duplicate = findDuplicate(u.href, context)
    if (duplicate)
        return duplicate

    const info: RouteServerUrlInfo = {
        url: u.href,
        host: u.host,
        schemeTyped,
        isLocal,
        isUnencrypted: u.protocol === 'http:',
    }
    if (!schemeTyped && isLocal && context.allowsLocalHttp)
        info.httpFallbackUrl = u.href.replace(/^https:/, 'http:')

    return { valid: true, ...info }
}

/** the address without query string and fragment (the part of a request URL that the address rules apply to) */
const withoutQuery = (url: string): string | undefined => {
    try {
        const u = new URL(url)
        u.search = ''
        u.hash = ''
        return u.href
    }
    catch {
        return undefined
    }
}

/**
 * Whether a request to a route server may end up at `finalUrl` after redirects. The target has to pass the URL
 * rules itself (no https to http downgrade on the internet, ...). On top of that, the class of the origin counts:
 * a home-network target is only acceptable if the origin was a home-network host as well. A server on the internet
 * must not be able to send the app to a host on the home network.
 *
 * @param finalUrl  where the request is redirected to (query string is ignored)
 * @param originUrl the address that was requested (query string is ignored)
 */
export const isAllowedRedirectTarget = (finalUrl: string, originUrl: string): boolean => {
    const target = withoutQuery(finalUrl)
    if (!target)
        return false

    const targetInfo = validateRouteServerUrl(target, { allowsLocalHttp: true })
    if (!targetInfo.valid)
        return false
    if (!targetInfo.isLocal)
        return true

    const origin = withoutQuery(originUrl)
    const originInfo = origin ? validateRouteServerUrl(origin, { allowsLocalHttp: true }) : undefined
    return originInfo?.valid === true && originInfo.isLocal === true
}
