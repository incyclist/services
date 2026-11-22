/**
 * Challenge-response authentication of a control connection.
 *
 * The phone recognises "its" computer only by proving that the peer holds the shared pairing
 * secret, and must never reveal the secret or any stable identifier to an unknown peer:
 *
 * 1. phone -> `auth {nc, kids}`: `kid_j = trunc16(HMAC(secret_j, "kid" | nc))` for every paired
 *    computer j it looks for. `nc` is fresh per attempt, so kids differ in every probe and
 *    cannot be linked across probes or networks.
 * 2. desktop: matches every kid against every paired phone (no early exit). No match ->
 *    `auth-result {ok:false}` without detail. Match -> `auth-result {ok:true, j, ns, proof}`
 *    with `proof = HMAC(secret, "server-proof" | nc | ns | linkId)`.
 * 3. phone: verifies `proof` against the `linkId` it stored for candidate j, then sends
 *    `auth-confirm {proof: HMAC(secret, "client-proof" | nc | ns)}`.
 * 4. both: `sessionKey = HMAC(secret, "session" | nc | ns)`.
 *
 * Encoding of `|`: plain byte concatenation of the ASCII label, the raw nonce bytes (decoded
 * from base64url) and, for the server proof, the UTF-8 bytes of `linkId`. This is
 * unambiguous because the labels are prefix-free, both nonces have a fixed length of 16
 * bytes and the only variable-length field comes last. All HMACs are HMAC-SHA256 keyed with
 * the raw pairing secret bytes; wire values are base64url.
 *
 * Replay: a recorded `auth-result` does not verify against a fresh `nc`, and a recorded
 * `auth-confirm` does not verify against a fresh `ns`.
 */
import { LINK_KID_BYTES, LINK_MAX_AUTH_KIDS, LINK_NONCE_BYTES } from './consts'
import type {
    AuthBody, AuthConfirmBody, AuthResultBody, LinkAuthCandidate, LinkAuthClient, LinkClientAuthOutcome,
    LinkClientAuthState, LinkServerAuthResult, LinkServerAuthState,
} from './types'
import { fromBase64Url, hmacSha256, randomBytes, timingSafeEqual, toBase64Url } from './utils'

const LABEL_KID = Buffer.from('kid', 'ascii')
const LABEL_SERVER_PROOF = Buffer.from('server-proof', 'ascii')
const LABEL_CLIENT_PROOF = Buffer.from('client-proof', 'ascii')
const LABEL_SESSION = Buffer.from('session', 'ascii')

const decodeSecret = (secret: string): Buffer => {
    const bytes = fromBase64Url(secret)
    if (!bytes?.length)
        throw new Error('local-link: invalid pairing secret')
    return bytes
}

const decodeFixed = (value: unknown, length: number): Buffer | undefined => {
    const bytes = fromBase64Url(value)
    return bytes?.length === length ? bytes : undefined
}

const decodeNonce = (value: unknown): Buffer | undefined => decodeFixed(value, LINK_NONCE_BYTES)

const requireNonce = (value: string): Buffer => {
    const bytes = decodeNonce(value)
    if (!bytes)
        throw new Error('local-link: invalid nonce')
    return bytes
}

const kidBytes = (secret: Buffer, nc: Buffer): Buffer =>
    hmacSha256(secret, LABEL_KID, nc).subarray(0, LINK_KID_BYTES)

const serverProofBytes = (secret: Buffer, nc: Buffer, ns: Buffer, linkId: string): Buffer =>
    hmacSha256(secret, LABEL_SERVER_PROOF, nc, ns, Buffer.from(linkId, 'utf8'))

const clientProofBytes = (secret: Buffer, nc: Buffer, ns: Buffer): Buffer =>
    hmacSha256(secret, LABEL_CLIENT_PROOF, nc, ns)

const sessionKeyBytes = (secret: Buffer, nc: Buffer, ns: Buffer): Buffer =>
    hmacSha256(secret, LABEL_SESSION, nc, ns)

/** Creates a fresh 16-byte nonce (`nc` or `ns`), base64url. */
export const createLinkNonce = (): string => toBase64Url(randomBytes(LINK_NONCE_BYTES))

/**
 * `trunc16(HMAC(secret, "kid" | nc))`, base64url.
 *
 * @param secret pairing secret, base64url
 * @param nc client nonce, base64url (16 bytes)
 */
export const computeLinkKid = (secret: string, nc: string): string =>
    toBase64Url(kidBytes(decodeSecret(secret), requireNonce(nc)))

/**
 * `HMAC(secret, "server-proof" | nc | ns | linkId)`, base64url.
 *
 * @param secret pairing secret, base64url
 * @param nc client nonce, base64url
 * @param ns server nonce, base64url
 * @param linkId the desktop's link id
 */
export const computeLinkServerProof = (secret: string, nc: string, ns: string, linkId: string): string =>
    toBase64Url(serverProofBytes(decodeSecret(secret), requireNonce(nc), requireNonce(ns), linkId))

/**
 * `HMAC(secret, "client-proof" | nc | ns)`, base64url.
 *
 * @param secret pairing secret, base64url
 * @param nc client nonce, base64url
 * @param ns server nonce, base64url
 */
export const computeLinkClientProof = (secret: string, nc: string, ns: string): string =>
    toBase64Url(clientProofBytes(decodeSecret(secret), requireNonce(nc), requireNonce(ns)))

/**
 * `HMAC(secret, "session" | nc | ns)`: the 32-byte key signing every frame of the session.
 *
 * @param secret pairing secret, base64url
 * @param nc client nonce, base64url
 * @param ns server nonce, base64url
 */
export const deriveLinkSessionKey = (secret: string, nc: string, ns: string): Uint8Array =>
    sessionKeyBytes(decodeSecret(secret), requireNonce(nc), requireNonce(ns))

// --- phone side ---

/**
 * Phone: builds an `auth` probe for one or more paired computers with a fresh nonce.
 * Keep the returned state until the `auth-result` arrives.
 *
 * @param candidates the paired computers the phone looks for at this address
 * @returns the `auth` body to send and the state to verify the answer with
 */
export const createLinkAuthProbe = (candidates: LinkAuthCandidate[]): { body: AuthBody, state: LinkClientAuthState } => {
    if (candidates.length === 0 || candidates.length > LINK_MAX_AUTH_KIDS)
        throw new Error(`local-link: an auth probe needs 1..${LINK_MAX_AUTH_KIDS} candidates`)
    const nc = createLinkNonce()
    const kids = candidates.map(c => computeLinkKid(c.secret, nc))
    return { body: { nc, kids }, state: { nc, candidates: [...candidates] } }
}

const matchedCandidate = (result: AuthResultBody, state: LinkClientAuthState): LinkAuthCandidate | undefined => {
    if (result?.ok !== true || !Number.isInteger(result.j))
        return undefined
    return state.candidates[result.j]
}

/**
 * Phone: verifies an `auth-result`. On success it returns the `auth-confirm` body to send and
 * the session key. On failure the phone closes the connection and may try the next address.
 *
 * @param result the received `auth-result` body
 * @param state the state returned by {@link createLinkAuthProbe}
 */
export const verifyLinkAuthResult = (result: AuthResultBody, state: LinkClientAuthState): LinkClientAuthOutcome => {
    const candidate = matchedCandidate(result, state)
    if (!candidate || result.ok !== true)
        return { ok: false }
    const ns = decodeNonce(result.ns)
    const proof = fromBase64Url(result.proof)
    if (!ns || !proof)
        return { ok: false }

    const secret = decodeSecret(candidate.secret)
    const nc = requireNonce(state.nc)
    if (!timingSafeEqual(proof, serverProofBytes(secret, nc, ns, candidate.linkId)))
        return { ok: false }

    return {
        ok: true,
        candidate,
        confirm: { proof: toBase64Url(clientProofBytes(secret, nc, ns)) },
        sessionKey: sessionKeyBytes(secret, nc, ns),
    }
}

// --- desktop side ---

const decodeProbe = (probe: AuthBody): { nc: Buffer, kids: Buffer[] } | undefined => {
    const nc = decodeNonce(probe?.nc)
    if (!nc || !Array.isArray(probe.kids) || probe.kids.length === 0 || probe.kids.length > LINK_MAX_AUTH_KIDS)
        return undefined
    const kids = probe.kids.map(kid => decodeFixed(kid, LINK_KID_BYTES))
    if (kids.some(kid => kid === undefined))
        return undefined
    return { nc, kids: kids as Buffer[] }
}

/**
 * Compares every kid with every client's expected kid without stopping at the first
 * match, so the time taken does not reveal which (or whether a) client matched.
 */
const findMatch = (nc: Buffer, kids: Buffer[], clients: LinkAuthClient[]): { client: LinkAuthClient, j: number } | undefined => {
    let match: { client: LinkAuthClient, j: number } | undefined
    for (const client of clients) {
        const secret = fromBase64Url(client.secret)
        if (!secret?.length)
            continue
        const expected = kidBytes(secret, nc)
        kids.forEach((kid, j) => {
            const equal = timingSafeEqual(kid, expected)
            if (equal && !match)
                match = { client, j }
        })
    }
    return match
}

/**
 * Desktop: answers an `auth` probe.
 *
 * Without a match (or for a malformed probe) the body is a bare `{ok:false}`: the caller
 * sends it after a fixed delay and learns nothing else from it, and neither does the peer.
 * On a match the body carries `j`, a fresh `ns` and the server proof, and `state` must be
 * kept until the `auth-confirm` arrives.
 *
 * @param probe the received `auth` body
 * @param clients every paired phone with its secret
 * @param linkId this desktop's link id
 */
export const answerLinkAuthProbe = (probe: AuthBody, clients: LinkAuthClient[], linkId: string): LinkServerAuthResult => {
    const decoded = decodeProbe(probe)
    const match = decoded ? findMatch(decoded.nc, decoded.kids, clients) : undefined
    if (!match)
        return { body: { ok: false } }

    const { client, j } = match
    const ns = createLinkNonce()
    const proof = computeLinkServerProof(client.secret, probe.nc, ns, linkId)
    return {
        body: { ok: true, j, ns, proof },
        state: { clientId: client.clientId, secret: client.secret, nc: probe.nc, ns },
    }
}

/**
 * Desktop: verifies an `auth-confirm` against the state of the matching probe.
 *
 * @param confirm the received `auth-confirm` body
 * @param state the state returned by {@link answerLinkAuthProbe}
 * @returns the session key, or `undefined` if the proof does not verify
 */
export const verifyLinkAuthConfirm = (confirm: AuthConfirmBody, state: LinkServerAuthState): Uint8Array | undefined => {
    const proof = fromBase64Url(confirm?.proof)
    if (!proof)
        return undefined
    const secret = decodeSecret(state.secret)
    const nc = requireNonce(state.nc)
    const ns = requireNonce(state.ns)
    if (!timingSafeEqual(proof, clientProofBytes(secret, nc, ns)))
        return undefined
    return sessionKeyBytes(secret, nc, ns)
}
