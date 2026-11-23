import { LINK_MAX_SEQ } from './consts'
import type { LinkDirection, LinkEnvelope, LinkEnvelopeDecodeResult } from './types'
import { canonicalJson, fromBase64Url, hmacSha256, timingSafeEqual, toBase64Url } from './utils'

const isSeq = (s: unknown): s is number =>
    typeof s === 'number' && Number.isInteger(s) && s >= 0 && s <= LINK_MAX_SEQ

const isOptionalString = (value: unknown): boolean =>
    value === undefined || typeof value === 'string'

const isEnvelope = (value: unknown): value is LinkEnvelope => {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false
    const env = value as Record<string, unknown>
    return typeof env.t === 'string' && env.t.length > 0
        && isSeq(env.s)
        && 'b' in env
        && isOptionalString(env.id)
        && isOptionalString(env.m)
}

const frameMacBytes = (sessionKey: Uint8Array, dir: LinkDirection, envelope: LinkEnvelope): Buffer => {
    const input = canonicalJson([dir, envelope.s, envelope.t, envelope.id ?? null, envelope.b])
    return hmacSha256(sessionKey, Buffer.from(input, 'utf8'))
}

/**
 * Serialises an envelope into a frame payload (UTF-8 JSON text).
 *
 * @param envelope the envelope; `undefined` properties are omitted
 * @returns the JSON text to put into one frame
 */
export const encodeLinkEnvelope = (envelope: LinkEnvelope): string => JSON.stringify(envelope)

/**
 * Parses a frame payload into an envelope and checks its shape (`t` non-empty string,
 * `s` u32, `b` present, `id`/`m` strings if present). The body itself is not validated.
 *
 * @param payload the frame payload
 */
export const decodeLinkEnvelope = (payload: string): LinkEnvelopeDecodeResult => {
    let parsed: unknown
    try {
        parsed = JSON.parse(payload)
    }
    catch {
        return { ok: false, reason: 'malformed' }
    }
    return isEnvelope(parsed) ? { ok: true, envelope: parsed } : { ok: false, reason: 'malformed' }
}

/**
 * Computes the MAC of a signed frame:
 * `base64url(HMAC-SHA256(sessionKey, canonical([dir, s, t, id ?? null, b])))`.
 *
 * The fields are encoded as one canonical JSON array rather than concatenated raw, so
 * field boundaries are unambiguous (no `t`/`id` value can shift bytes into a neighbour).
 * `dir` is `c2s` for frames the phone sends and `s2c` for frames the desktop sends, so a
 * frame cannot be reflected back to the end that sent it.
 *
 * @param sessionKey the session key derived during authentication
 * @param dir direction of the frame
 * @param envelope the frame; `m` is ignored
 */
export const computeLinkFrameMac = (sessionKey: Uint8Array, dir: LinkDirection, envelope: LinkEnvelope): string =>
    toBase64Url(frameMacBytes(sessionKey, dir, envelope))

/**
 * Returns a copy of the envelope carrying its MAC in `m`.
 *
 * @param sessionKey the session key
 * @param dir direction of the frame (the sender's direction)
 * @param envelope the frame to sign
 */
export const signLinkEnvelope = <E extends LinkEnvelope>(sessionKey: Uint8Array, dir: LinkDirection, envelope: E): E => {
    const unsigned: E = { ...envelope }
    delete unsigned.m
    return { ...unsigned, m: computeLinkFrameMac(sessionKey, dir, unsigned) }
}

/**
 * Verifies the MAC of a received frame in constant time.
 *
 * @param sessionKey the session key
 * @param dir direction of the frame (the sender's direction)
 * @param envelope the received frame
 * @returns false if `m` is missing, malformed or wrong
 */
export const verifyLinkEnvelope = (sessionKey: Uint8Array, dir: LinkDirection, envelope: LinkEnvelope): boolean => {
    const received = fromBase64Url(envelope.m)
    if (!received?.length)
        return false
    return timingSafeEqual(received, frameMacBytes(sessionKey, dir, envelope))
}
