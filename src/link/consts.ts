import type { LinkClientMessageType, LinkProtocolRange, LinkServerMessageType } from './types'

/** ASCII magic that starts the preamble, in both directions. */
export const LINK_PREAMBLE_MAGIC = 'INCYLINK'

/** Framing version 1: `u32BE` length-prefixed UTF-8 JSON frames over plain TCP. */
export const LINK_FRAMING_VERSION = 1

/** Preamble length: magic plus one version byte. */
export const LINK_PREAMBLE_LENGTH = LINK_PREAMBLE_MAGIC.length + 1

/** Length of the frame header (`u32BE` payload length). */
export const LINK_FRAME_HEADER_LENGTH = 4

/** Default maximum frame payload size. */
export const LINK_DEFAULT_MAX_FRAME_BYTES = 64 * 1024

/** Hard ceiling of the frame payload size enforced by the desktop transport. */
export const LINK_MAX_FRAME_BYTES_CEILING = 1024 * 1024

/** Largest sequence number (`s` is a u32). */
export const LINK_MAX_SEQ = 0xFFFFFFFF

/** Wire protocol versions this library speaks. */
export const LINK_PROTOCOL_RANGE: LinkProtocolRange = {
    min: { major: 1, minor: 0 },
    max: { major: 1, minor: 0 },
}

/** Length of the random nonces `nc` and `ns` in bytes. */
export const LINK_NONCE_BYTES = 16

/** Length of a key identifier (`kid`) in bytes: the HMAC truncated to 16 bytes. */
export const LINK_KID_BYTES = 16

/** Upper bound of `kids` in one probe, so a probe cannot make the desktop do unbounded work. */
export const LINK_MAX_AUTH_KIDS = 32

/** Message types the phone sends. Must list every key of `LinkClientMessageBodies`. */
export const LINK_CLIENT_MESSAGE_TYPES: readonly LinkClientMessageType[] = [
    'hello', 'pair-request', 'pair-verify', 'auth', 'auth-confirm', 'ping', 'echo',
]

/** Message types the desktop sends. Must list every key of `LinkServerMessageBodies`. */
export const LINK_SERVER_MESSAGE_TYPES: readonly LinkServerMessageType[] = [
    'hello', 'error', 'pending', 'paired', 'pair-failed', 'auth-result', 'session', 'pong', 'echo',
]

/** Unsigned message types the desktop accepts before authentication. */
export const LINK_CLIENT_PRE_AUTH_TYPES: readonly LinkClientMessageType[] = [
    'hello', 'pair-request', 'pair-verify', 'auth', 'auth-confirm',
]

/** Unsigned message types the phone accepts before authentication. */
export const LINK_SERVER_PRE_AUTH_TYPES: readonly LinkServerMessageType[] = [
    'hello', 'error', 'pending', 'paired', 'pair-failed', 'auth-result',
]
