/**
 * Wire protocol of the `local-link` control channel (phone <-> desktop).
 *
 * Every frame on the TCP control channel carries one JSON envelope. Before authentication,
 * frames are unsigned and only the handshake, pairing and authentication messages are
 * accepted. After authentication, every frame in both directions carries a MAC over
 * direction, sequence number, type, correlation id and canonical body, keyed with the
 * session key. Receivers ignore message types they do not know.
 *
 * Binary values (nonces, key identifiers, MACs, the pairing secret) are base64url strings.
 * Timestamps are epoch milliseconds.
 *
 * Design rule: the channel is signed but not encrypted. It must never carry credentials,
 * third-party tokens, OAuth data or personal profile data.
 */

// --- envelope ---

/** The JSON envelope of every control-channel frame. */
export interface LinkEnvelope<T extends string = string, B = unknown> {
    /** message type */
    t: T
    /** per-direction sequence number (u32), strictly increasing */
    s: number
    /** correlation id: a response carries the id of its request */
    id?: string
    /** message body */
    b: B
    /** base64url HMAC-SHA256 over the frame; present on every frame after authentication */
    m?: string
}

// --- protocol version ---

/** Wire protocol version. Only the major version decides compatibility. */
export interface LinkProtocolVersion {
    major: number
    minor: number
}

// --- handshake ---

/** `hello` sent by the phone right after the preamble. */
export interface ClientHelloBody {
    protocol: { min: LinkProtocolVersion, max: LinkProtocolVersion }
    role: 'client'
}

/** `hello` answered by the desktop. Deliberately carries nothing identifying. */
export interface ServerHelloBody {
    protocol: LinkProtocolVersion
    capabilities: string[]
    pairingOpen: boolean
}

/** Error codes of the `error` message. */
export type LinkErrorCode = 'unsupported-protocol' | 'not-authenticated' | 'bad-request'

/** `error`: an explicit refusal, e.g. when no common major protocol version exists. */
export interface LinkErrorBody {
    code: LinkErrorCode
    /** the desktop's supported range, sent with `unsupported-protocol` */
    supported?: { min: LinkProtocolVersion, max: LinkProtocolVersion }
}

// --- pairing ---

/** `pair-request`: the phone asks to pair. `clientName` is the device model, never a person's name. */
export interface PairRequestBody {
    clientName: string
}

/** `pair-verify`: the phone submits the PIN shown on the desktop. */
export interface PairVerifyBody {
    requestId: string
    pin: string
}

/** `pending`: the PIN is shown on the desktop. */
export interface PairPendingBody {
    outcome: 'pending'
    requestId: string
    /** seconds until the PIN expires */
    expiresIn: number
}

/** `paired`: pairing succeeded. The only time the pairing secret travels. */
export interface PairedBody {
    outcome: 'paired'
    linkId: string
    /** 32-byte pairing secret, base64url */
    secret: string
    name: string
    protocolVersion: LinkProtocolVersion
}

/** `pair-failed`: every pairing outcome other than `pending` and `paired`. */
export type PairFailedBody =
    | { outcome: 'wrong', attemptsRemaining: number }
    | { outcome: 'expired' }
    | { outcome: 'denied' }
    | { outcome: 'superseded' }
    | { outcome: 'rate-limited', /** seconds */ retryAfter: number }
    | { outcome: 'pairing-closed' }

/** Every outcome the phone can distinguish during pairing. */
export type PairOutcome = PairPendingBody | PairedBody | PairFailedBody

/** Discriminant of {@link PairOutcome}. */
export type PairOutcomeType = PairOutcome['outcome']

// --- authentication (challenge-response) ---

/** `auth`: the phone's probe. Each kid is per-probe, so probes are unlinkable. */
export interface AuthBody {
    /** 16 random bytes, fresh per attempt */
    nc: string
    /** one 16-byte key identifier per paired computer the phone is looking for */
    kids: string[]
}

/** `auth-result`: no detail on failure, so a stranger learns nothing. */
export type AuthResultBody =
    | { ok: false }
    | {
        ok: true
        /** index into the probe's `kids` that matched */
        j: number
        /** 16 random bytes */
        ns: string
        /** proves the desktop holds the secret and is the computer `linkId` */
        proof: string
    }

/** `auth-confirm`: the phone's proof that it holds the secret. */
export interface AuthConfirmBody {
    proof: string
}

/** `session`: sent signed by the desktop once the session is established. */
export interface SessionBody {
    mediaPort: number
    mediaToken: string
    mediaTokenExpiresAt: number
    /** opaque; unchanged value means the catalog need not be fetched again */
    catalogVersion: string
    capabilities: string[]
}

/**
 * `catalog-changed`: pushed (signed) on an open session when the computer's route catalog
 * changed. Not a request: carries no `id`. The phone compares the version with the one it holds.
 */
export interface CatalogChangedBody {
    catalogVersion: string
}

// --- keepalive and test ---

/** Body of messages that carry no data (`ping`, `pong`). */
export type EmptyBody = Record<string, never>

/**
 * `echo`: test-only request/response without product meaning. The response repeats
 * `data` and carries the request's `id`.
 */
export interface EchoBody {
    data: unknown
}

// --- message maps ---

/** Bodies of the messages the phone sends, by message type. */
export interface LinkClientMessageBodies {
    'hello': ClientHelloBody
    'pair-request': PairRequestBody
    'pair-verify': PairVerifyBody
    'auth': AuthBody
    'auth-confirm': AuthConfirmBody
    'ping': EmptyBody
    'echo': EchoBody
}

/** Bodies of the messages the desktop sends, by message type. */
export interface LinkServerMessageBodies {
    'hello': ServerHelloBody
    'error': LinkErrorBody
    'pending': PairPendingBody
    'paired': PairedBody
    'pair-failed': PairFailedBody
    'auth-result': AuthResultBody
    'session': SessionBody
    'catalog-changed': CatalogChangedBody
    'pong': EmptyBody
    'echo': EchoBody
}

export type LinkClientMessageType = keyof LinkClientMessageBodies
export type LinkServerMessageType = keyof LinkServerMessageBodies

/** Any message the phone sends, discriminated on `t`. */
export type LinkClientMessage = {
    [K in LinkClientMessageType]: LinkEnvelope<K, LinkClientMessageBodies[K]>
}[LinkClientMessageType]

/** Any message the desktop sends, discriminated on `t`. */
export type LinkServerMessage = {
    [K in LinkServerMessageType]: LinkEnvelope<K, LinkServerMessageBodies[K]>
}[LinkServerMessageType]

// --- wire-protocol core ---

/**
 * Direction of a frame, bound into every frame MAC so that a frame cannot be reflected
 * back to its sender: `c2s` = phone -> desktop, `s2c` = desktop -> phone.
 */
export type LinkDirection = 'c2s' | 's2c'

/** Role of one end of a control connection. */
export type LinkRole = 'client' | 'server'

/** Supported wire protocol range of one end. */
export interface LinkProtocolRange {
    min: LinkProtocolVersion
    max: LinkProtocolVersion
}

/** Output of {@link LinkFrameReader.push}: one event per preamble, frame or error found. */
export type LinkFrameEvent =
    | { type: 'preamble', version: number }
    | { type: 'frame', payload: string }
    | { type: 'error', code: LinkFramingErrorCode }

/**
 * Framing errors. After an error the reader is dead and the connection must be closed:
 * the byte stream can no longer be resynchronised.
 */
export type LinkFramingErrorCode = 'bad-preamble' | 'unsupported-framing' | 'frame-too-large'

/** Options of a {@link LinkFrameReader}. */
export interface LinkFrameReaderOptions {
    /** frames larger than this are an error; capped at the transport's hard ceiling */
    maxFrameBytes?: number
    /**
     * Expect a preamble (`INCYLINK` + u8 version) before the first frame. A client reading the
     * server's answer sets this to the framing version it requested; the answered version
     * must be between 1 and this value.
     */
    preamble?: { maxVersion: number }
}

/** Result of decoding an envelope from a frame payload. */
export type LinkEnvelopeDecodeResult =
    | { ok: true, envelope: LinkEnvelope }
    | { ok: false, reason: 'malformed' }

/**
 * Why a received frame was not accepted.
 * - `malformed`: not a JSON envelope
 * - `not-allowed`: before authentication, a type outside the handshake/pairing/auth set
 * - `unsigned`: after authentication, a frame without MAC
 * - `bad-mac`: after authentication, a MAC that does not verify
 * - `replay`: `s` not strictly greater than the last accepted `s` of that direction
 * - `unknown-type`: a valid frame of a type this version does not know; ignore it
 */
export type LinkRejectReason = 'malformed' | 'not-allowed' | 'unsigned' | 'bad-mac' | 'replay' | 'unknown-type'

/** Result of {@link LinkChannel.decode}. */
export type LinkReceiveResult<M> =
    | { ok: true, message: M }
    | { ok: false, reason: LinkRejectReason }

/** A paired computer the phone probes for: its `linkId` and pairing secret. */
export interface LinkAuthCandidate {
    linkId: string
    /** pairing secret, base64url */
    secret: string
}

/** A paired phone as the desktop matches it in an `auth` probe. */
export interface LinkAuthClient {
    clientId: string
    /** pairing secret, base64url */
    secret: string
}

/** The phone's state of one authentication attempt, kept until `auth-result` arrives. */
export interface LinkClientAuthState {
    /** the probe's client nonce, base64url */
    nc: string
    /** candidates in the order of the probe's `kids` */
    candidates: LinkAuthCandidate[]
}

/** The phone's result of verifying an `auth-result`. */
export type LinkClientAuthOutcome =
    | { ok: false }
    | {
        ok: true
        /** the computer that proved its identity */
        candidate: LinkAuthCandidate
        /** body of the `auth-confirm` to send (unsigned) */
        confirm: AuthConfirmBody
        /** key for every following frame in both directions */
        sessionKey: Uint8Array
    }

/** The desktop's state of one authentication attempt, kept until `auth-confirm` arrives. */
export interface LinkServerAuthState {
    clientId: string
    secret: string
    nc: string
    ns: string
}

/** The desktop's answer to an `auth` probe. */
export interface LinkServerAuthResult {
    /** body of the `auth-result` to send (unsigned) */
    body: AuthResultBody
    /** present only on a match; needed to verify the following `auth-confirm` */
    state?: LinkServerAuthState
}

// --- records ---

/** Address of a computer's control listener. */
export interface LinkAddress {
    host: string
    controlPort: number
}

/**
 * A paired computer as the phone persists it (repository `links`, key `linkId`).
 *
 * The pairing secret is not part of this record: it lives in the phone's secure storage,
 * never in the JSON repository. See {@link LinkSecret}.
 */
export interface LinkRecord {
    /** generated once by the desktop; never broadcast, learned only in `paired` */
    linkId: string
    /** display name as supplied by the computer */
    name: string
    /** mobile-local override; a name change from the computer never overwrites it */
    localName?: string
    protocolVersion: LinkProtocolVersion
    /** from the last successful session; the media port is never stored */
    lastAddress?: LinkAddress
    pairedAt: number
    /** the only field a failed sync updates */
    lastSeenAt?: number
    /** opaque value from the computer */
    catalogVersion?: string
}

/** The pairing secret of one paired computer, held in secure storage. */
export interface LinkSecret {
    linkId: string
    /** 32-byte pairing secret, base64url */
    secret: string
}

/**
 * A paired phone as the desktop persists it in user settings. Its secret is stored
 * separately under the `auth` key, which the log filters exclude.
 */
export interface PairedClient {
    clientId: string
    /** device model, never a person's name or account id */
    clientName: string
    pairedAt: number
    lastSeenAt?: number
}
