import { getBindings } from '../api/bindings'
import type { ICryptoBinding } from '../api/crypto/types'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

/**
 * Encodes bytes as unpadded base64url.
 *
 * Implemented on top of plain base64, because the Buffer polyfill on React Native does not
 * reliably support the `base64url` encoding.
 */
export const toBase64Url = (bytes: Uint8Array): string => {
    const base64 = Buffer.from(bytes).toString('base64')
    let end = base64.length
    while (end > 0 && base64[end - 1] === '=')
        end--
    return base64.slice(0, end).replaceAll('+', '-').replaceAll('/', '_')
}

/**
 * Decodes unpadded base64url. Returns `undefined` for anything that is not strict base64url,
 * so that malformed wire values are rejected instead of silently decoded.
 */
export const fromBase64Url = (text: unknown): Buffer | undefined => {
    if (typeof text !== 'string' || !BASE64URL_PATTERN.test(text) || text.length % 4 === 1)
        return undefined
    const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return Buffer.from(padded, 'base64')
}

/**
 * Compares two byte arrays in time that depends only on their lengths, not on their content.
 * Lengths are not secret in this protocol (all MACs and key identifiers have fixed lengths).
 */
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length !== b.length)
        return false
    let diff = 0
    for (let i = 0; i < a.length; i++) {
        diff |= a[i] ^ b[i]
    }
    return diff === 0
}

const isOmitted = (value: unknown): boolean =>
    value === undefined || typeof value === 'function' || typeof value === 'symbol'

const toJsonValue = (value: unknown): unknown => {
    const withToJson = value as { toJSON?: () => unknown }
    if (value !== null && typeof value === 'object' && typeof withToJson.toJSON === 'function')
        return withToJson.toJSON()
    return value
}

const canonicalArray = (items: unknown[]): string =>
    '[' + items.map(item => isOmitted(item) ? 'null' : canonicalJson(item)).join(',') + ']'

const canonicalObject = (obj: Record<string, unknown>): string => {
    const keys = Object.keys(obj).filter(key => !isOmitted(obj[key])).sort((a, b) => {
        if (a < b) return -1
        return a > b ? 1 : 0
    })
    return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(obj[key])).join(',') + '}'
}

/**
 * Deterministic JSON serialisation: object keys sorted by UTF-16 code units, no whitespace.
 *
 * Follows `JSON.stringify` semantics for everything else (omitted `undefined` properties,
 * `null` for non-finite numbers, `toJSON`), so a value and its JSON round trip serialise to
 * the same string. Both ends compute frame MACs over this form: the sender over the body it
 * sends, the receiver over the body it parsed.
 *
 * @param value any JSON-compatible value; `undefined` at top level serialises as `null`
 * @returns the canonical JSON text
 */
export const canonicalJson = (value: unknown): string => {
    const v = toJsonValue(value)
    if (isOmitted(v) || v === null)
        return 'null'
    if (Array.isArray(v))
        return canonicalArray(v)
    if (typeof v === 'object')
        return canonicalObject(v as Record<string, unknown>)
    return JSON.stringify(v)
}

/** Returns the crypto binding, failing loudly if the app did not inject one. */
export const getLinkCrypto = (): ICryptoBinding => {
    const crypto = getBindings()?.crypto
    if (!crypto)
        throw new Error('local-link: crypto binding not available')
    return crypto
}

/** HMAC-SHA256 of the concatenated message parts. */
export const hmacSha256 = (key: Uint8Array, ...parts: Uint8Array[]): Buffer => {
    const hmac = getLinkCrypto().createHmac('sha256', Buffer.from(key))
    for (const part of parts) {
        hmac.update(Buffer.from(part))
    }
    return Buffer.from(hmac.digest())
}

/** Fresh random bytes from the crypto binding. */
export const randomBytes = (size: number): Buffer => Buffer.from(getLinkCrypto().randomBytes(size))
