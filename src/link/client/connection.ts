import { EventEmitter } from 'node:events'
import { EventLogger } from 'gd-eventlog'
import { createLinkAuthProbe, verifyLinkAuthResult } from '../auth'
import { LinkClientChannel } from '../channel'
import { LINK_FRAMING_VERSION, LINK_PROTOCOL_RANGE } from '../consts'
import { encodeLinkFrame, encodeLinkPreamble, LinkFrameReader } from '../framing'
import type {
    LinkAuthCandidate, LinkClientMessageBodies, LinkRejectReason, LinkServerMessage, SessionBody,
} from '../types'
import { getLinkCrypto } from '../utils'
import { isLinkProtocolAccepted } from '../version'
import { ANSWER_TIMEOUT_MS, CONNECT_TIMEOUT_MS, MAX_FRAME_BYTES, PING_INTERVAL_MS, SILENCE_TIMEOUT_MS } from './consts'
import type { LinkConnectionErrorCode, LinkHelloResult, LinkSocket } from './types'

/** Thrown by {@link LinkClientConnection} operations and passed to `close` listeners. */
export class LinkConnectionError extends Error {
    constructor(public readonly code: LinkConnectionErrorCode, message?: string) {
        super(message ?? code)
        this.name = 'LinkConnectionError'
    }
}

/** Result of {@link LinkClientConnection.authenticate}. */
export type LinkAuthenticated =
    | { ok: true, candidate: LinkAuthCandidate, session: SessionBody }
    | { ok: false }

interface Pending {
    reject: (err: LinkConnectionError) => void
    timer: ReturnType<typeof setTimeout>
}

interface OutstandingRequest {
    type: string
    resolve: (msg: LinkServerMessage) => void
    reject: (err: LinkConnectionError) => void
    timer: ReturnType<typeof setTimeout>
}

const REJECTIONS_TO_IGNORE = new Set<LinkRejectReason>(['unknown-type'])

/**
 * The phone's end of one control connection: a socket, the framing and the message channel.
 *
 * Request/response use: `send()` then `receive()`, which returns the next message. Event use
 * (after the handshake): `listen()` makes every received message arrive as a `message` event.
 * A connection that failed or was closed rejects every waiting `receive()` and emits `close`
 * once, with the {@link LinkConnectionError} or `undefined` for a close requested locally.
 *
 * The pairing secret never reaches this class except as input to the challenge-response of
 * {@link authenticate}, which sends only MACs over fresh nonces.
 */
export class LinkClientConnection extends EventEmitter {
    protected channel = new LinkClientChannel()
    protected reader = new LinkFrameReader({ maxFrameBytes: MAX_FRAME_BYTES, preamble: { maxVersion: LINK_FRAMING_VERSION } })
    protected queue: LinkServerMessage[] = []
    protected deliver?: (msg: LinkServerMessage) => void
    protected pending?: Pending
    protected listening = false
    protected closed = false
    protected failure?: LinkConnectionError
    protected connected = false
    protected pingTimer?: ReturnType<typeof setInterval>
    protected lastReceivedAt = Date.now()
    protected requests = new Map<string, OutstandingRequest>()
    protected logger = new EventLogger('LinkClientConnection')

    constructor(protected socket: LinkSocket) {
        super()
    }

    protected logError(err: Error, fn: string): void {
        this.logger.logEvent({ message: 'Error', fn, error: err?.message, stack: err?.stack })
    }

    /** true once the connection was closed or failed */
    isClosed(): boolean {
        return this.closed
    }

    /**
     * Connects and sends the preamble.
     *
     * @throws LinkConnectionError `unreachable` if the TCP connection fails or takes too long
     */
    async connect(host: string, port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
        this.attach()
        await this.wait<void>(timeoutMs, 'unreachable', resolve => {
            this.socket.once('connect', () => {
                this.connected = true
                this.write(encodeLinkPreamble())
                resolve()
            })
            this.socket.connect(port, host)
        })
    }

    /**
     * `hello` exchange.
     *
     * @throws LinkConnectionError `version` if no common protocol version exists, `protocol` for anything unexpected
     */
    async hello(): Promise<LinkHelloResult> {
        this.send('hello', { protocol: LINK_PROTOCOL_RANGE, role: 'client' })
        const msg = await this.receive(ANSWER_TIMEOUT_MS)
        if (msg.t === 'error' && msg.b.code === 'unsupported-protocol')
            throw new LinkConnectionError('version')
        if (msg.t !== 'hello')
            throw new LinkConnectionError('protocol', `unexpected ${msg.t} after hello`)
        if (!isLinkProtocolAccepted(msg.b.protocol))
            throw new LinkConnectionError('version')
        return { version: msg.b.protocol, hello: msg.b }
    }

    /**
     * Sends one message.
     *
     * @throws LinkConnectionError when the connection is closed
     */
    send<K extends keyof LinkClientMessageBodies>(t: K, b: LinkClientMessageBodies[K], id?: string): void {
        if (this.closed)
            throw this.failure ?? new LinkConnectionError('closed')
        this.write(encodeLinkFrame(this.channel.encode(t, b, id), MAX_FRAME_BYTES))
    }

    /**
     * The next received message.
     *
     * @throws LinkConnectionError `timeout` if nothing arrives in time, `closed` (or the failure) if the connection ends
     */
    receive(timeoutMs = ANSWER_TIMEOUT_MS): Promise<LinkServerMessage> {
        const queued = this.queue.shift()
        if (queued)
            return Promise.resolve(queued)
        if (this.closed)
            return Promise.reject(this.failure ?? new LinkConnectionError('closed'))
        return this.wait<LinkServerMessage>(timeoutMs, 'timeout', resolve => { this.deliver = resolve })
    }

    /**
     * Sends a request with a fresh correlation id and resolves with the first received message of
     * the same type and id. That reply is not emitted as `message`; every other message still is.
     * Call after the handshake, once {@link listen} was called.
     *
     * @throws LinkConnectionError `timeout` if no reply arrives in time, `closed` (or the failure) if the connection ends
     */
    request<K extends keyof LinkClientMessageBodies>(t: K, b: LinkClientMessageBodies[K], timeoutMs: number): Promise<Extract<LinkServerMessage, { t: K }>> {
        return new Promise((resolve, reject) => {
            const id = Buffer.from(getLinkCrypto().randomBytes(8)).toString('hex')
            const timer = setTimeout(() => {
                this.requests.delete(id)
                reject(new LinkConnectionError('timeout'))
            }, timeoutMs)
            this.requests.set(id, { type: t, resolve: resolve as OutstandingRequest['resolve'], reject, timer })
            try {
                this.send(t, b, id)
            }
            catch (err) {
                clearTimeout(timer)
                this.requests.delete(id)
                reject(err)
            }
        })
    }

    /** From now on every received message is emitted as `message`; messages already queued are emitted first. */
    listen(): void {
        try {
            this.listening = true
            for (const msg of this.queue.splice(0))
                this.emit('message', msg)
        }
        catch (err) {
            this.logError(err as Error, 'listen')
        }
    }

    /**
     * Challenge-response: proves to the phone that the peer holds the secret of one of the
     * candidates (and is the computer with that `linkId`), then proves the phone's side and
     * returns the signed `session`. The secrets are never sent: the probe carries one
     * per-probe key identifier per candidate, the rest are MACs over fresh nonces.
     *
     * Call after {@link hello}. On `{ok:false}` the peer is not a computer of any candidate;
     * the caller closes the connection.
     *
     * @throws LinkConnectionError when the connection fails or the peer breaks the protocol
     */
    async authenticate(candidates: LinkAuthCandidate[]): Promise<LinkAuthenticated> {
        const probe = createLinkAuthProbe(candidates)
        this.send('auth', probe.body)
        const answer = await this.receive(ANSWER_TIMEOUT_MS)
        if (answer.t !== 'auth-result')
            throw new LinkConnectionError('protocol', `unexpected ${answer.t} after auth`)

        const outcome = verifyLinkAuthResult(answer.b, probe.state)
        if (!outcome.ok)
            return { ok: false }

        this.send('auth-confirm', outcome.confirm)
        this.channel.establish(outcome.sessionKey)
        const session = await this.receive(ANSWER_TIMEOUT_MS)
        if (session.t !== 'session')
            throw new LinkConnectionError('protocol', `unexpected ${session.t} after auth-confirm`)
        return { ok: true, candidate: outcome.candidate, session: session.b }
    }

    /** Pings every 15 s; 45 s without any received frame closes the connection with `timeout`. */
    startKeepalive(): void {
        try {
            this.stopKeepalive()
            this.lastReceivedAt = Date.now()
            this.pingTimer = setInterval(() => this.keepaliveTick(), PING_INTERVAL_MS)
        }
        catch (err) {
            this.logError(err as Error, 'startKeepalive')
        }
    }

    /** Closes the connection. Idempotent. */
    close(): void {
        try {
            this.end(undefined)
        }
        catch (err) {
            this.logError(err as Error, 'close')
        }
    }

    protected keepaliveTick(): void {
        try {
            if (Date.now() - this.lastReceivedAt >= SILENCE_TIMEOUT_MS)
                return this.end(new LinkConnectionError('timeout', 'keepalive'))
            this.send('ping', {})
        }
        catch (err) {
            // a ping on a connection that is already closed is expected; anything else is logged
            if (!(err instanceof LinkConnectionError))
                this.logError(err as Error, 'keepaliveTick')
        }
    }

    protected stopKeepalive(): void {
        clearInterval(this.pingTimer)
        this.pingTimer = undefined
    }

    protected attach(): void {
        this.socket.on('data', (chunk: Buffer) => this.onData(chunk))
        this.socket.on('error', () => this.onSocketEnded(this.connected ? 'closed' : 'unreachable'))
        this.socket.on('close', () => this.onSocketEnded('closed'))
    }

    protected onSocketEnded(code: LinkConnectionErrorCode): void {
        try {
            this.end(new LinkConnectionError(code))
        }
        catch (err) {
            this.logError(err as Error, 'onSocketEnded')
        }
    }

    protected write(data: Buffer): void {
        this.socket.write(data)
    }

    protected onData(chunk: Buffer): void {
        try {
            if (this.closed)
                return
            for (const event of this.reader.push(chunk)) {
                if (event.type === 'error')
                    return this.end(new LinkConnectionError(event.code === 'bad-preamble' ? 'not-a-link' : 'protocol', event.code))
                if (event.type === 'frame' && !this.onFrame(event.payload))
                    return
            }
        }
        catch (err) {
            // an unexpected failure while handling received bytes: the stream can no longer be trusted
            this.logError(err as Error, 'onData')
            this.onSocketEnded('protocol')
        }
    }

    /** @returns false if the connection was closed because of the frame */
    protected onFrame(payload: string): boolean {
        const res = this.channel.decode(payload)
        if (res.ok === false) {
            if (REJECTIONS_TO_IGNORE.has(res.reason))
                return true
            this.end(new LinkConnectionError('protocol', res.reason))
            return false
        }
        this.lastReceivedAt = Date.now()
        this.dispatch(res.message)
        return true
    }

    protected dispatch(msg: LinkServerMessage): void {
        try {
            if (this.resolveRequest(msg))
                return
            if (this.listening) {
                if (msg.t !== 'pong')
                    this.emit('message', msg)
                return
            }
            const deliver = this.deliver
            this.deliver = undefined
            if (deliver)
                deliver(msg)
            else
                this.queue.push(msg)
        }
        catch (err) {
            // a listener failed: that must not end the connection or stop the following frames
            this.logError(err as Error, 'dispatch')
        }
    }

    /** @returns true if the message is the reply of an outstanding request */
    protected resolveRequest(msg: LinkServerMessage): boolean {
        const request = msg.id === undefined ? undefined : this.requests.get(msg.id)
        if (request?.type !== msg.t)
            return false
        this.requests.delete(msg.id!)
        clearTimeout(request.timer)
        request.resolve(msg)
        return true
    }

    protected wait<T>(timeoutMs: number, timeoutCode: LinkConnectionErrorCode, start: (resolve: (v: T) => void) => void): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending = undefined
                this.deliver = undefined
                reject(new LinkConnectionError(timeoutCode))
            }, timeoutMs)
            this.pending = { reject, timer }
            start(value => {
                clearTimeout(timer)
                this.pending = undefined
                resolve(value)
            })
        })
    }

    protected end(failure: LinkConnectionError | undefined): void {
        if (this.closed)
            return
        this.closed = true
        this.failure = failure
        this.stopKeepalive()
        this.deliver = undefined
        if (this.pending) {
            clearTimeout(this.pending.timer)
            this.pending.reject(failure ?? new LinkConnectionError('closed'))
            this.pending = undefined
        }
        for (const request of this.requests.values()) {
            clearTimeout(request.timer)
            request.reject(failure ?? new LinkConnectionError('closed'))
        }
        this.requests.clear()
        try {
            this.socket.destroy()
        }
        catch {
            // already gone
        }
        try {
            this.emit('close', failure)
        }
        catch (err) {
            this.logError(err as Error, 'end')
        }
    }
}
