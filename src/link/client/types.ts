import type { EventEmitter } from 'node:events'
import type { LinkProtocolVersion, ServerHelloBody } from '../types'

// --- structural types of the mobile wifi binding (the DirectConnect plumbing) ---

/** The TCP socket of the mobile `wifi.net` binding. */
export interface LinkSocket extends EventEmitter {
    connect(port: number, host: string): unknown
    destroy(): void
    write(data: Buffer): boolean
}

/** One service the mDNS binding reported. */
export interface LinkMdnsAnnouncement {
    type?: string
    name?: string
    address: string
    port: number
}

/** The part of the mobile `wifi` binding the link client uses. */
export interface LinkWifiBinding {
    net: { createSocket(): LinkSocket }
    mdns: {
        connect(): void
        disconnect(): void
        find(opts: { type?: string, protocol?: 'tcp' | 'udp' } | null, onup?: (service: LinkMdnsAnnouncement) => void): void
        /**
         * Stops the browser of one service type and leaves all others running. Optional: a binding
         * without it can only be released as a whole (`disconnect`), which the passive watch does
         * not do, so the watch does not run on such a binding.
         */
        stopFind?(type: string, protocol?: 'tcp' | 'udp'): void
    }
}

/** What brought a computer back: the passive watch, an on-demand trigger (page, foreground, check) or the short retry after a lost session. */
export type LinkReconnectSource = 'watch' | 'on-demand' | 'reconnect'

export type LinkClientPlatform = 'ios' | 'android' | 'other'

// --- connection ---

/** Why a connection attempt or an established connection failed. */
export type LinkConnectionErrorCode =
    | 'unreachable'      // TCP connect failed or timed out
    | 'timeout'          // no answer within the time allowed
    | 'closed'           // the peer or the socket closed
    | 'not-a-link'       // the peer does not speak the control protocol
    | 'protocol'         // the peer broke the protocol (bad frame, bad signature, unexpected message)
    | 'version'          // no common protocol version

/** Result of the `hello` exchange. */
export interface LinkHelloResult {
    version: LinkProtocolVersion
    hello: ServerHelloBody
}

// --- discovery ---

/** Why a search or a recovery browse did not run. */
export type SearchBlockedReason = 'ride' | 'device-scan' | 'device-pairing' | 'search-running' | 'rate-limited' | 'unsupported'

/** A computer announced on the network, as found by the search. */
export interface DiscoveredComputer {
    /** `host:port`, stable for the app session */
    id: string
    /** the announced instance name, e.g. `Home PC (K3F9)` */
    name: string
    /** the instance name without the random suffix */
    displayName: string
    /** the random suffix, e.g. `K3F9` */
    suffix?: string
    /** true if another result has the same display name: show the suffix then */
    ambiguous: boolean
    host: string
    port: number
    /** set when the recognition exchange showed that this is an already paired computer */
    linkId?: string
    /** true while that recognition is running */
    recognizing: boolean
}

export type DiscoveryState =
    | { phase: 'idle' }
    | { phase: 'blocked', reason: SearchBlockedReason }
    | { phase: 'searching', computers: DiscoveredComputer[], expiresAt: number }
    | {
        phase: 'done'
        computers: DiscoveredComputer[]
        /** the search ended without a result */
        noneFound: boolean
        /** iOS only: show the Local Network permission remedy (never when the app is too old for the feature) */
        showLocalNetworkHint: boolean
    }

// --- pairing ---

/** Why pairing ended without a paired computer. */
export type LinkPairingFailure =
    | 'invalidated'          // three wrong codes
    | 'expired'
    | 'denied'
    | 'superseded'
    | 'rate-limited'
    | 'connection-lost'
    | 'unreachable'
    | 'version-mismatch'
    | 'storage-unavailable'  // the pairing secret could not be stored

/** What the user can do next after a pairing failure. */
export type LinkPairingRecovery = 'get-new-code' | 'try-again' | 'back'

export type LinkPairingState =
    | { step: 'idle' }
    | { step: 'connecting', computerId: string, name: string }
    /** the computer's connect window is not open (`pairing-closed`, or `pairingOpen: false`) */
    | { step: 'not-ready', computerId: string, name: string }
    /** the code is shown on the computer; `wrong` is set after a wrong try */
    | { step: 'code', computerId: string, name: string, wrong?: boolean, attemptsLeft?: number }
    | {
        step: 'failed'
        computerId: string
        name: string
        reason: LinkPairingFailure
        recovery: LinkPairingRecovery
        /** `rate-limited`: epoch ms from which a new try is accepted */
        retryAt?: number
    }
    /** paired and saved; `already` if the search had recognised the computer before */
    | { step: 'connected', linkId: string, name: string, already?: boolean }

// --- links and display ---

export type LinkReachability = 'checking' | 'reachable' | 'not-reachable' | 'never-reached' | 'version-mismatch'

/** One paired computer as the settings list renders it. */
export interface LinkClientLink {
    linkId: string
    /** `localName ?? name`: what every user-visible string shows */
    displayName: string
    name: string
    localName?: string
    reachability: LinkReachability
    pairedAt: number
    lastSeenAt?: number
    catalogVersion?: string
    /** true while an authenticated session is open */
    connected: boolean
    /** false if media cannot be played on this platform (e.g. Android without the loopback pipe) */
    mediaAvailable: boolean
}

/** Bounded recovery state, exposed so that the UI can say truthfully why no search ran. */
export interface LinkRecoveryInfo {
    autoBrowsesUsed: number
    autoBrowsesMax: number
    /** epoch ms from which an automatic browse is allowed again; absent if allowed now */
    nextAutoBrowseAt?: number
}

export interface LocalLinkClientDisplayProps {
    /** false: render nothing (toggle off, bindings missing, or the app is not supported) */
    available: boolean
    links: LinkClientLink[]
    /** a `check()` is running */
    checking: boolean
    /** set when a search that was needed was not allowed; rows keep their last state */
    searchBlocked?: { reason: SearchBlockedReason, automatic: boolean }
    recovery: LinkRecoveryInfo
    discovery: DiscoveryState
    pairing: LinkPairingState
}

/** An open authenticated session, as other services use it. Never logged. */
export interface LinkClientSession {
    linkId: string
    host: string
    controlPort: number
    mediaPort: number
    mediaToken: string
    mediaTokenExpiresAt: number
    catalogVersion: string
    capabilities: string[]
}

/** What a media request needs. `baseUrl` has no trailing slash and carries no token. */
export interface LinkMediaAccess {
    baseUrl: string
    token: string
    expiresAt: number
    catalogVersion: string
}

/** Events of the client service. */
export type LocalLinkClientEventName = 'state-changed' | 'session-changed' | 'link-forgotten' | 'push'
