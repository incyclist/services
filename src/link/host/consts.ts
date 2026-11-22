import type { LocalLinkLimits } from '../../api/localLink/types'

/** Neutral display name of a computer; never derived from the OS user name or host name. */
export const DEFAULT_DISPLAY_NAME = 'Incyclist Computer'

/** Maximum length of the display name in characters. */
export const MAX_DISPLAY_NAME_LENGTH = 40

/** The announced instance name must fit 63 bytes (DNS label limit). */
export const MAX_INSTANCE_NAME_BYTES = 63

/** Characters of the random suffix that disambiguates computers with the same display name. */
export const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const SUFFIX_LENGTH = 4

/** Maximum length of a sanitised `clientName`. */
export const MAX_CLIENT_NAME_LENGTH = 40
export const DEFAULT_CLIENT_NAME = 'Phone'

export const PAIRING_TTL_SECONDS = 120
export const PAIRING_MAX_ATTEMPTS = 3
export const PIN_LENGTH = 6

/** `pair-request` rate limits (sliding window). */
export const PAIR_RATE_WINDOW_MS = 60_000
export const PAIR_RATE_PER_PEER = 5
export const PAIR_RATE_GLOBAL = 20

/** `auth` rate limit per peer (sliding window) and the fixed delay before any `auth-result`. */
export const AUTH_RATE_WINDOW_MS = 60_000
export const AUTH_RATE_PER_PEER = 10
export const AUTH_RESULT_DELAY_MS = 300
export const AUTH_MAX_FAILURES_PER_CONNECTION = 3

export const MEDIA_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
export const MEDIA_TOKEN_BYTES = 32
export const MEDIA_TOKENS_PER_CLIENT = 8
export const PAIRING_SECRET_BYTES = 32

/** `lastSeenAt` is persisted at most this often per client. */
export const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000

/** Capabilities announced in `hello` and `session`. */
export const LINK_CAPABILITIES = ['route-sharing']

/** Limit values handed to the transport (it enforces them under its own hard ceilings). */
export const LINK_LIMITS: LocalLinkLimits = {
    control: { maxConnections: 16, maxPerPeer: 4, preambleTimeoutMs: 5000, idleTimeoutMs: 60_000, maxFrameBytes: 64 * 1024, maxFramesPerSec: 20 },
    media: { maxConnections: 32, maxPerPeer: 8, maxConcurrentStreams: 8 },
}

/** Keys in user settings. The `auth` key is filtered recursively from log output. */
export const SETTINGS_KEY = {
    linkId: 'localLink.linkId',
    off: 'localLink.off',
    displayName: 'localLink.displayName',
    ports: 'localLink.ports',
    lastRunVersion: 'localLink.lastRunVersion',
    auth: 'localLink.auth',
} as const
