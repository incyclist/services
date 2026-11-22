import { v4 as uuid } from 'uuid'
import {
    DEFAULT_CLIENT_NAME, DEFAULT_DISPLAY_NAME, MAX_CLIENT_NAME_LENGTH, MAX_DISPLAY_NAME_LENGTH, MAX_INSTANCE_NAME_BYTES,
    PIN_LENGTH, SUFFIX_ALPHABET, SUFFIX_LENGTH,
} from './consts'
import { randomBytes, sha256Base64Url, toBase64Url } from '../utils'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

const codePoints = (text: string): string[] => Array.from(text)

/** Removes control characters and surrounding blanks. */
export const cleanText = (text: unknown): string =>
    typeof text === 'string' ? text.replaceAll(CONTROL_CHARS, '').trim() : ''

/** The phone's `clientName` as shown on the desktop: control characters removed, length capped. */
export const sanitizeClientName = (name: unknown): string => {
    const cleaned = codePoints(cleanText(name)).slice(0, MAX_CLIENT_NAME_LENGTH).join('').trim()
    return cleaned || DEFAULT_CLIENT_NAME
}

/** Validates a display name; an empty name resets to the default. */
export const validateDisplayName = (name: unknown): { ok: true, name: string | undefined } | { ok: false, error: 'too-long' } => {
    const cleaned = cleanText(name)
    if (cleaned === '' || cleaned === DEFAULT_DISPLAY_NAME)
        return { ok: true, name: undefined }
    if (codePoints(cleaned).length > MAX_DISPLAY_NAME_LENGTH)
        return { ok: false, error: 'too-long' }
    return { ok: true, name: cleaned }
}

/**
 * `<display name> (<suffix>)`, shortened so that it fits the 63-byte limit of an mDNS
 * instance name even for multi-byte characters.
 */
export const buildInstanceName = (displayName: string, suffix: string): string => {
    const tail = ` (${suffix})`
    const chars = codePoints(displayName)
    while (chars.length > 1 && Buffer.byteLength(chars.join('') + tail, 'utf8') > MAX_INSTANCE_NAME_BYTES)
        chars.pop()
    return chars.join('') + tail
}

/** Unbiased random integer in `[0, max)`. */
export const randomInt = (max: number): number => {
    const range = 0x100000000
    const limit = range - (range % max)
    for (;;) {
        const value = randomBytes(4).readUInt32BE(0)
        if (value < limit)
            return value % max
    }
}

export const randomPin = (): string => String(randomInt(10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0')

export const randomSuffix = (): string =>
    Array.from({ length: SUFFIX_LENGTH }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join('')

/** Random mDNS host label; never derived from the OS host name. */
export const randomHostLabel = (): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    return 'incyclist-' + Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join('')
}

export const newId = (): string => uuid()

/** Fresh random value of `bytes` bytes as base64url. */
export const randomToken = (bytes: number): string => toBase64Url(randomBytes(bytes))

/** base64url SHA-256 of a media token: what the transport compares presented tokens against. */
export const tokenDigest = (token: string): string => sha256Base64Url(token)
