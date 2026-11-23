/** mDNS service type of a computer, as the mDNS binding expects it (without underscore and protocol). */
export const LINK_MDNS_TYPE = 'incyclist'

/** Length of one scoped browse. */
export const BROWSE_TIMEOUT_MS = 10_000

/** Automatic recovery browses: at most one per window and this many per app session. */
export const RECOVERY_WINDOW_MS = 10 * 60_000
export const RECOVERY_MAX_PER_SESSION = 3

/** TCP connect, and the wait for each answer of the desktop during the handshake. */
export const CONNECT_TIMEOUT_MS = 4000
export const ANSWER_TIMEOUT_MS = 4000

/** A pairing connection stays open while the user types the code (valid 120 s on the desktop). */
export const PAIRING_IDLE_TIMEOUT_MS = 130_000

/** Keepalive: ping every 15 s, silence of 45 s ends the session. */
export const PING_INTERVAL_MS = 15_000
export const SILENCE_TIMEOUT_MS = 45_000

/** A media token that expires within this margin is replaced by a new session before use. */
export const MEDIA_TOKEN_MARGIN_MS = 5 * 60_000

/** Delays of the reconnect attempts after an established session was lost (no browse involved). */
export const RECONNECT_DELAYS_MS = [1000, 3000, 10_000]

/**
 * Passive reconnect watch: while the app is in the foreground and a paired computer has no
 * open session, the phone listens for the computer's announcement. Without a trainer rotation to
 * join, the browse is duty-cycled: on for WATCH_ON_MS of every WATCH_PERIOD_MS, so that the
 * Android multicast lock is not held permanently. The same period is the interval at which the
 * watch re-checks its own conditions and re-arms itself.
 */
export const WATCH_ON_MS = 4000
export const WATCH_PERIOD_MS = 20_000

/**
 * Probes caused by announcements. An announcement that does not turn out to be a paired computer
 * is not probed again for WATCH_NEGATIVE_TTL_MS (WATCH_UNREACHABLE_TTL_MS if it did not answer),
 * and one address is probed at most WATCH_MAX_PROBES_PER_ADDRESS times per WATCH_ADDRESS_WINDOW_MS,
 * so that a foreign Incyclist computer is not probed on every scan round. These probes do not
 * count against the recovery browse limits.
 */
export const WATCH_NEGATIVE_TTL_MS = 30 * 60_000
export const WATCH_UNREACHABLE_TTL_MS = 30_000
export const WATCH_MAX_PROBES_PER_ADDRESS = 3
export const WATCH_ADDRESS_WINDOW_MS = 10 * 60_000
export const WATCH_CACHE_MAX_ENTRIES = 100

export const MAX_LOCAL_NAME_LENGTH = 40
export const DEFAULT_PHONE_NAME = 'Phone'
export const MAX_FRAME_BYTES = 64 * 1024

/** Repository holding one `LinkRecord` per paired computer (key: `linkId`). Never holds a secret. */
export const LINKS_REPOSITORY = 'links'

/** Key prefix of the pairing secrets in secure storage; the key is `<prefix><linkId>`. */
export const SECRET_KEY_PREFIX = 'localLink.secret.'
