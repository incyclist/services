import type { LinkServerChannel } from '../channel'
import type { LinkProtocolVersion, LinkServerAuthState, PairFailedBody, PairedClient } from '../types'

/** Overall state of the link as the desktop host UI renders it. */
export type LocalLinkState = 'never-connected' | 'on' | 'off' | 'error'

/** Phase of the connect window. Pairing is open exactly while this window is open. */
export type ConnectPhase = 'starting' | 'waiting' | 'code' | 'connected' | 'error'

/** Why the connect window went back to `waiting` (or what happened to the request). */
export type ConnectNotice = 'denied' | 'expired' | 'invalidated' | 'abandoned' | 'replaced'

export type LocalLinkPlatform = 'windows' | 'macos' | 'linux'

/** A paired phone as the host UI lists it. */
export interface LocalLinkDevice {
    id: string
    /** device model as reported by the phone */
    name: string
    connectedAt: number
    lastSeenAt?: number
    /** true while the phone has an authenticated control connection */
    active: boolean
}

export interface LocalLinkConnectWindow {
    phase: ConnectPhase
    /** the requesting device (or the one that paired / was turned down) */
    device?: string
    /** 6-digit code, only in phase `code` */
    pin?: string
    /** epoch ms at which the code expires, only in phase `code` */
    expiresAt?: number
    /** wrong tries left, only in phase `code` */
    attemptsLeft?: number
    notice?: ConnectNotice
}

/** Everything the desktop host UI renders; see `getDisplayProps()`. */
export interface LocalLinkDisplayProps {
    /** false when the feature is off or the shell lacks the transport: render nothing */
    available: boolean
    state: LocalLinkState
    computerName: string
    /** the current random suffix; present while announced */
    suffix?: string
    platform?: LocalLinkPlatform
    routeCount: number
    devices: LocalLinkDevice[]
    pairingOpen: boolean
    /** present while pairing is open */
    connectWindow?: LocalLinkConnectWindow
    listeners: { control: boolean, media: boolean }
    /** set with `state: 'error'` when a listener or the announcement failed to start */
    startError?: { code: string }
    showUpdateFirewallNotice: boolean
}

/** Result of {@link LocalLinkService.setDisplayName}. */
export type DisplayNameResult = { ok: true, name: string } | { ok: false, error: 'too-long' | 'unavailable' }

/** A paired phone as persisted under `localLink.auth`, with its pairing secret in plaintext. */
export interface StoredPairedClient extends PairedClient {
    /** 32-byte pairing secret, base64url */
    secret: string
}

/** A media token as persisted: only its digest, never the token itself. */
export interface StoredMediaToken {
    id: string
    clientId: string
    /** base64url SHA-256 of the token */
    digest: string
    expiresAt: number
}

/** Value of the settings key `localLink.auth`. */
export interface LocalLinkAuthData {
    clients: StoredPairedClient[]
    tokens: StoredMediaToken[]
}

/** State of one control connection. */
export interface LinkConnection {
    id: string
    /** in-process only; never logged */
    peerAddress: string
    channel: LinkServerChannel
    version?: LinkProtocolVersion
    authState?: LinkServerAuthState
    authBusy: boolean
    authFailures: number
    clientId?: string
    /** closes the connection if it stays unauthenticated and outside a pairing flow */
    deadline?: ReturnType<typeof setTimeout>
}

export type PairRequestResult =
    | { kind: 'pending', requestId: string, expiresIn: number }
    | { kind: 'failed', body: PairFailedBody }

export type PairVerifyResult =
    | { kind: 'accepted', clientName: string }
    | { kind: 'failed', body: PairFailedBody }

/** Events of {@link LocalLinkService}; both carry the new display props. */
export type LocalLinkEventName = 'state-changed' | 'pairing-changed'
