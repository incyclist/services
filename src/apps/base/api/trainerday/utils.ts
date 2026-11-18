import { parseExpiration } from '../../utils'

const MAX_ERROR_DETAIL = 500

/** TrainerDay access tokens are valid for 6 hours */
export const DEFAULT_TOKEN_LIFETIME_MS = 6 * 60 * 60 * 1000

const isValidDate = (date: unknown): date is Date => date instanceof Date && !Number.isNaN(date.valueOf())

/** `Number(null)` is 0, which must not be mistaken for "expires now" */
const toFiniteNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '')
        return undefined
    const num = Number(value)
    return Number.isFinite(num) ? num : undefined
}

/**
 * Returns the point in time when the access token expires, as delivered by the refresh endpoint of the auth-server:
 * `expires_in` (seconds from now) is preferred, then `expiration` (calculated by the auth-server).
 * If none of them is usable, the default lifetime of a TrainerDay token (6 hours) is assumed. Never returns an invalid Date.
 */
export const getTokenExpiration = (data?: { expires_in?: unknown, expiration?: unknown }): Date => {
    const expiresIn = toFiniteNumber(data?.expires_in)
    if (expiresIn !== undefined)
        return new Date(Date.now() + expiresIn * 1000)

    const expiration = parseExpiration(data?.expiration as string | number | null | undefined)
    return expiration ?? new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS)
}

/**
 * Makes sure that an expiration can be used (and persisted): an invalid or missing date is replaced by the default
 * lifetime of a TrainerDay token (6 hours from now)
 */
export const ensureExpiration = (expiration?: Date | null): Date =>
    isValidDate(expiration) ? expiration : new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS)

/**
 * Converts the body of an error response into a short text that explains why a request was rejected
 * @returns the text (at most 500 characters, longer texts end with `...`) or `undefined` if there is no body
 */
export const getErrorDetail = (data: unknown): string | undefined => {
    if (data === undefined || data === null || data === '')
        return undefined

    const text = typeof data === 'string' ? data : JSON.stringify(data)
    return text.length > MAX_ERROR_DETAIL ? text.substring(0, MAX_ERROR_DETAIL) + '...' : text
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Encodes binary data as base64 (portable: does not rely on `Buffer` or `btoa`, as this library also runs on React Native)
 */
export const toBase64 = (bytes: Uint8Array): string => {
    let result = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]
        const b1 = bytes[i + 1]
        const b2 = bytes[i + 2]
        const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0)

        result += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63]
        result += b1 === undefined ? '=' : BASE64_CHARS[(n >> 6) & 63]
        result += b2 === undefined ? '=' : BASE64_CHARS[n & 63]
    }
    return result
}

const BASE64_LOOKUP: Record<string, number> = Object.fromEntries([...BASE64_CHARS].map((c, i) => [c, i]))

/**
 * Decodes base64 data (portable: does not rely on `Buffer` or `atob`). Padding is optional, line breaks and other whitespace are ignored.
 * @throws if the string contains characters that are not part of the base64 alphabet
 */
export const fromBase64 = (base64: string): Uint8Array => {
    const clean = base64.replaceAll(/\s/g, '').replace(/=+$/, '')
    if (clean.length % 4 === 1)
        throw new Error('Invalid base64 length')

    const bytes = new Uint8Array(Math.floor(clean.length * 3 / 4))
    let acc = 0
    let bits = 0
    let pos = 0

    for (const char of clean) {
        const value = BASE64_LOOKUP[char]
        if (value === undefined)
            throw new Error('Invalid base64 character')

        acc = ((acc << 6) | value) & 0xFFFFFF
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes[pos++] = (acc >> bits) & 0xFF
        }
    }
    return bytes
}

/**
 * Encodes text as UTF-8 without relying on `TextEncoder` or `Buffer` (fallback for platforms that do not provide `TextEncoder`).
 * Slow for large texts, as every character is handled separately
 */
export const utf8EncodeFallback = (text: string): Uint8Array => {
    const bytes: number[] = []
    for (const char of text) {
        const cp = char.codePointAt(0)
        if (cp < 0x80)
            bytes.push(cp)
        else if (cp < 0x800)
            bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 63))
        else if (cp < 0x10000)
            bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
        else
            bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    }
    return new Uint8Array(bytes)
}

/** @returns the number of continuation bytes that follow a UTF-8 lead byte (-1 if it is not a lead byte) */
const getUtf8Extra = (lead: number): number => {
    if (lead < 0x80) return 0
    if (lead >= 0xF0 && lead < 0xF8) return 3
    if (lead >= 0xE0 && lead < 0xF0) return 2
    if (lead >= 0xC0 && lead < 0xE0) return 1
    return -1
}

/**
 * Decodes UTF-8 bytes to text without relying on `TextDecoder` or `Buffer` (fallback for platforms that do not provide `TextDecoder`).
 * Invalid sequences are replaced by U+FFFD.
 */
export const utf8DecodeFallback = (bytes: Uint8Array): string => {
    const parts: string[] = []
    let i = 0

    while (i < bytes.length) {
        const lead = bytes[i]
        const extra = getUtf8Extra(lead)
        let cp = extra > 0 ? lead & (0x3F >> extra) : lead
        let valid = extra >= 0 && i + extra < bytes.length

        for (let k = 1; valid && k <= extra; k++) {
            valid = (bytes[i + k] & 0xC0) === 0x80
            cp = (cp << 6) | (bytes[i + k] & 0x3F)
        }

        if (valid && cp <= 0x10FFFF) {
            parts.push(String.fromCodePoint(cp))
            i += extra + 1
        }
        else {
            parts.push('\uFFFD')
            i++
        }
    }
    return parts.join('')
}

/**
 * Encodes text as UTF-8 (portable: uses `TextEncoder` if the platform provides it, otherwise a hand-written encoder)
 */
export const utf8Encode = (text: string): Uint8Array => {
    return typeof globalThis.TextEncoder === 'function'
        ? new globalThis.TextEncoder().encode(text)
        : utf8EncodeFallback(text)
}

/**
 * Decodes UTF-8 bytes to text (portable: uses `TextDecoder` if the platform provides it, otherwise a hand-written decoder).
 * A byte order mark is kept, invalid sequences are replaced by U+FFFD.
 */
export const utf8Decode = (bytes: Uint8Array): string => {
    return typeof globalThis.TextDecoder === 'function'
        ? new globalThis.TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
        : utf8DecodeFallback(bytes)
}

/**
 * Formats a day as `YYYY-MM-DD`
 * @param day a Date (local day) or a string that is already formatted
 */
export const formatDay = (day: string | Date): string => {
    if (typeof day === 'string')
        return day

    const month = String(day.getMonth() + 1).padStart(2, '0')
    const date = String(day.getDate()).padStart(2, '0')
    return `${day.getFullYear()}-${month}-${date}`
}
