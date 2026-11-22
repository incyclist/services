/**
 * Platform binding for the `local-link` transport (desktop only).
 *
 * The desktop main process provides the transport: a TCP control listener, an HTTP media
 * listener, mDNS announcements, a peer filter and network-change reporting. It holds only
 * opaque, services-supplied state in memory and persists nothing. Every decision (when to
 * listen, what to announce, who may pair, session authentication, media tokens, policy and
 * limit values) is made in services.
 *
 * This interface mirrors a transport that ships with the desktop installer and cannot be
 * hot-updated. It may only be extended additively; nothing may be removed or changed
 * incompatibly, because older shells stay installed.
 *
 * Not injected on mobile or in the browser: callers must stay inert when the binding is
 * missing or `isSupported()` returns false.
 */

/** One of the two listeners of the transport. */
export type LinkListener = 'control' | 'media'

/** A local network interface address as reported by the transport. */
export interface LocalAddress {
    address: string, family: 'IPv4' | 'IPv6', interface: string, internal: boolean, private: boolean
}

/** Snapshot of the transport state. */
export interface LocalLinkStatus {
    running: { control: boolean, media: boolean }
    ports: { control?: number, media?: number }
    addresses: LocalAddress[]
    announced: { instanceName: string } | null
    connections: number
    handleCount: number
    tokenCount: number
}

/**
 * Result of starting one listener. On failure, `error.code` carries the OS error code
 * (e.g. `EADDRINUSE`), so the caller can retry with port 0.
 */
export type ListenerResult = { ok: true, port: number, alreadyRunning?: boolean } | { ok: false, error: { code: string } }

/** Limit values supplied by services. The transport enforces them under fixed hard ceilings. */
export interface LocalLinkLimits {
    control?: { maxConnections?: number, maxPerPeer?: number, preambleTimeoutMs?: number,
                idleTimeoutMs?: number, maxFrameBytes?: number, maxFramesPerSec?: number }
    media?:   { maxConnections?: number, maxPerPeer?: number, maxConcurrentStreams?: number }
}

/**
 * Peer filter override, applied to both listeners. Precedence: deny > allow > default.
 * `allow` and `deny` are CIDR strings.
 */
export interface PeerPolicy { defaultPrivate: boolean, allow?: string[], deny?: string[] }   // CIDR strings

/** Media state published to the HTTP media listener. Replaces the previous state as a whole. */
export interface MediaState {
    documents: Record<string, { body: string | object, contentType?: string }>
    handles: Array<{ handle: string, path: string, contentType?: string }>
    tokens: Array<{ digest: string, id: string }>      // base64url SHA-256 of media tokens, opaque id
}

/** Events emitted by the transport. Consumers must ignore event types they do not know. */
export type LocalLinkEvent =
    | { type: 'started', listener: LinkListener, port: number }
    | { type: 'stopped', listener: LinkListener }
    | { type: 'error', listener?: LinkListener, phase: string, code: string }
    | { type: 'announced', instanceName: string }
    | { type: 'announce-error', code: string }
    | { type: 'network-changed', addresses: LocalAddress[] }
    | { type: 'resumed' }
    | { type: 'peer-refused', listener: LinkListener, addressClass: string, count: number }
    | { type: 'connection', connectionId: string, peer: { address: string, port: number } }
    | { type: 'frame', connectionId: string, payload: string }          // UTF-8 JSON, unparsed by main
    | { type: 'connection-closed', connectionId: string, reason: string }
    | { type: 'media-request', endpoint: string, handle?: string, status: number,
        tokenId?: string, bytes: number, completed: boolean }

/** The `local-link` transport binding, implemented by the desktop shell. */
export interface ILocalLinkBinding {
    /** false if the shell lacks `local-link` or its transportVersion major is unknown */
    isSupported(): boolean
    getCapabilities(): Promise<{ transportVersion: number, capabilities: string[] }>
    getStatus(): Promise<LocalLinkStatus>

    /** Starts the requested listeners. Idempotent per listener; the default host is `0.0.0.0`. */
    start(opts: { control?: { port?: number, host?: string }, media?: { port?: number, host?: string } })
        : Promise<{ control?: ListenerResult, media?: ListenerResult, addresses: LocalAddress[] }>
    /** Stops one listener, or both when no listener is given. */
    stop(opts?: { listener?: LinkListener }): Promise<{ ok: boolean }>

    /** Rejected as a whole if any CIDR is invalid. */
    setPeerPolicy(policy: PeerPolicy): Promise<{ ok: boolean, error?: string }>
    /** Returns the values actually applied after clamping to the hard ceilings. */
    setLimits(limits: LocalLinkLimits): Promise<{ ok: boolean, applied: LocalLinkLimits }>

    /** Publishes the mDNS announcement (port defaults to the control port); `null` withdraws it. */
    announce(a: { instanceName: string, hostLabel: string, port?: number } | null)
        : Promise<{ ok: boolean, error?: string }>
    /** Recreates the mDNS responder and republishes the current announcement on the current interfaces. */
    reannounce(): Promise<{ ok: boolean }>

    /** Atomically replaces the published documents, handles and media-token digests. */
    publishMedia(state: MediaState): Promise<{ ok: boolean, rejectedHandles: string[], rejectedTokens: number }>

    /** Sends one frame (UTF-8 JSON) on a control connection. */
    send(connectionId: string, payload: string): Promise<{ ok: boolean }>
    close(connectionId: string, reason?: string): Promise<void>

    /** Subscribes to transport events. Returns a function that removes the subscription. */
    onEvent(cb: (e: LocalLinkEvent) => void): () => void
}
