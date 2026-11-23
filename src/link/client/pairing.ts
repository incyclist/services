import { EventLogger } from 'gd-eventlog'
import type { LinkServerMessage, PairedBody, PairFailedBody } from '../types'
import { LinkClientConnection, LinkConnectionError } from './connection'
import { PAIRING_IDLE_TIMEOUT_MS } from './consts'
import type { LinkPairingFailure, LinkPairingRecovery, LinkPairingState } from './types'

/** The computer a pairing attempt targets: the address found by the search, never searched for again. */
export interface PairTarget {
    id: string
    name: string
    host: string
    port: number
}

/** What the pairing flow needs from the service that owns it. */
export interface LinkPairingHost {
    /** a new, unconnected control connection */
    createConnection(): LinkClientConnection
    /** the device model sent as `clientName` */
    getClientName(): string
    now(): number
    /** the state changed */
    onChange(): void
    /**
     * `paired` arrived: save the record and the secret.
     *
     * @returns the failure to show, or `undefined` if the computer is saved
     */
    onPaired(target: PairTarget, body: PairedBody): Promise<LinkPairingFailure | undefined>
    log(message: string, data?: Record<string, unknown>): void
}

const RECOVERY: Record<LinkPairingFailure, LinkPairingRecovery> = {
    'invalidated': 'get-new-code',
    'expired': 'get-new-code',
    'denied': 'back',
    'superseded': 'try-again',
    'rate-limited': 'try-again',
    'connection-lost': 'try-again',
    'unreachable': 'try-again',
    'version-mismatch': 'back',
    'storage-unavailable': 'back',
}

const PIN_PATTERN = /^\d{6}$/

/**
 * The phone's side of pairing one computer: connect to the given address, `hello`,
 * `pair-request`, the code the user enters, and the outcome. All eight outcomes of the
 * desktop are distinguished. A retry (new code, try again) is a fresh `pair-request` on the
 * same address and never a new search.
 *
 * The pairing connection is unsigned and stays open while the user types the code, so the
 * desktop's pushes (`denied`, `superseded`, `expired`) arrive while waiting.
 */
export class LinkPairingFlow {
    protected state: LinkPairingState = { step: 'idle' }
    protected target?: PairTarget
    protected conn?: LinkClientConnection
    protected requestId?: string
    protected idleTimer?: ReturnType<typeof setTimeout>
    protected logger = new EventLogger('LinkPairingFlow')

    constructor(protected host: LinkPairingHost) {}

    getState(): LinkPairingState {
        return this.state
    }

    protected logError(err: Error, fn: string): void {
        this.logger.logEvent({ message: 'Error', fn, error: err?.message, stack: err?.stack })
    }

    /** Starts (or restarts) pairing with a computer. */
    async start(target: PairTarget): Promise<void> {
        let conn: LinkClientConnection | undefined
        try {
            this.close()
            this.target = target
            this.set({ step: 'connecting', computerId: target.id, name: target.name })

            conn = this.host.createConnection()
            this.conn = conn
            await conn.connect(target.host, target.port)
            const { hello } = await conn.hello()
            if (this.conn !== conn)
                return
            if (!hello.pairingOpen)
                return this.notReady(conn)
            conn.send('pair-request', { clientName: this.host.getClientName() })
            const first = await conn.receive()
            conn.listen()
            const active = conn
            conn.on('message', (msg: LinkServerMessage) => { this.onMessage(active, msg).catch(err => this.logError(err, 'onMessage')) })
            conn.on('close', () => this.onClose(active))
            this.armIdleTimer(conn)
            await this.onMessage(conn, first)
        }
        catch (err) {
            this.onStartFailed(conn, err)
        }
    }

    protected onStartFailed(conn: LinkClientConnection | undefined, err: unknown): void {
        try {
            if (conn)
                this.onError(conn, err)
            else
                this.fail('unreachable')
        }
        catch (e) {
            this.logError(e as Error, 'start')
        }
    }

    /** Submits the code the user read from the computer. Ignored unless a code is expected. */
    submit(pin: string): void {
        try {
            const conn = this.conn
            if (!conn || this.state.step !== 'code' || !this.requestId || !PIN_PATTERN.test(pin))
                return
            try {
                conn.send('pair-verify', { requestId: this.requestId, pin })
            }
            catch (err) {
                this.onError(conn, err)
            }
        }
        catch (err) {
            this.logError(err as Error, 'submit')
        }
    }

    /** A new request on the address of the last attempt. Ignored while a rate limit applies. */
    async retry(): Promise<void> {
        try {
            const target = this.target
            if (!target)
                return
            const state = this.state
            if (state.step === 'failed' && state.retryAt !== undefined && this.host.now() < state.retryAt)
                return
            await this.start(target)
        }
        catch (err) {
            this.logError(err as Error, 'retry')
        }
    }

    /** The computer is already paired with this device: ends in `connected` without a pairing exchange. */
    markConnected(linkId: string, name: string, already: boolean): void {
        try {
            this.close()
            this.set({ step: 'connected', linkId, name, already })
        }
        catch (err) {
            this.logError(err as Error, 'markConnected')
        }
    }

    /** Ends pairing without a result, or acknowledges the end of a finished one. */
    cancel(): void {
        try {
            this.close()
            this.target = undefined
            this.set({ step: 'idle' })
        }
        catch (err) {
            this.logError(err as Error, 'cancel')
        }
    }

    protected close(): void {
        clearTimeout(this.idleTimer)
        this.idleTimer = undefined
        this.requestId = undefined
        const conn = this.conn
        this.conn = undefined
        conn?.close()
    }

    protected set(state: LinkPairingState): void {
        this.state = state
        this.host.onChange()
    }

    protected armIdleTimer(conn: LinkClientConnection): void {
        clearTimeout(this.idleTimer)
        this.idleTimer = setTimeout(() => {
            try {
                if (this.conn === conn)
                    this.fail('connection-lost')
            }
            catch (err) {
                this.logError(err as Error, 'idleTimer')
            }
        }, PAIRING_IDLE_TIMEOUT_MS)
    }

    protected notReady(conn: LinkClientConnection): void {
        const target = this.target!
        if (this.conn === conn)
            this.close()
        this.set({ step: 'not-ready', computerId: target.id, name: target.name })
    }

    protected fail(reason: LinkPairingFailure, retryAfterSeconds?: number): void {
        const target = this.target
        this.close()
        if (!target)
            return
        this.set({
            step: 'failed', computerId: target.id, name: target.name, reason, recovery: RECOVERY[reason],
            retryAt: retryAfterSeconds === undefined ? undefined : this.host.now() + retryAfterSeconds * 1000,
        })
    }

    protected onError(conn: LinkClientConnection, err: unknown): void {
        if (this.conn !== conn)
            return
        const code = err instanceof LinkConnectionError ? err.code : 'closed'
        this.host.log('pairing failed', { code })
        if (code === 'version')
            return this.fail('version-mismatch')
        this.fail(code === 'unreachable' || code === 'not-a-link' ? 'unreachable' : 'connection-lost')
    }

    protected onClose(conn: LinkClientConnection): void {
        try {
            if (this.conn === conn)
                this.fail('connection-lost')
        }
        catch (err) {
            this.logError(err as Error, 'onClose')
        }
    }

    protected async onMessage(conn: LinkClientConnection, msg: LinkServerMessage): Promise<void> {
        if (this.conn !== conn)
            return
        switch (msg.t) {
            case 'pending':
                this.requestId = msg.b.requestId
                return this.set({ step: 'code', computerId: this.target!.id, name: this.target!.name })
            case 'pair-failed':
                return this.onFailed(conn, msg.b)
            case 'paired':
                return await this.onPaired(conn, msg.b)
            case 'error':
                return this.fail(msg.b.code === 'unsupported-protocol' ? 'version-mismatch' : 'connection-lost')
            default:
                // other messages carry no pairing outcome
        }
    }

    protected onFailed(conn: LinkClientConnection, body: PairFailedBody): void {
        switch (body.outcome) {
            case 'wrong':
                if (body.attemptsRemaining <= 0)
                    return this.fail('invalidated')
                return this.set({
                    step: 'code', computerId: this.target!.id, name: this.target!.name, wrong: true, attemptsLeft: body.attemptsRemaining,
                })
            case 'pairing-closed':
                return this.notReady(conn)
            case 'rate-limited':
                return this.fail('rate-limited', body.retryAfter)
            default:
                return this.fail(body.outcome)
        }
    }

    protected async onPaired(conn: LinkClientConnection, body: PairedBody): Promise<void> {
        const target = this.target!
        // the exchange is over: close the connection first, so that its close is not a failure
        if (this.conn === conn)
            this.close()
        let failure: LinkPairingFailure | undefined
        try {
            failure = await this.host.onPaired(target, body)
        }
        catch (err) {
            this.logError(err as Error, 'onPaired')
            failure = 'storage-unavailable'
        }
        if (failure)
            return this.fail(failure)
        this.set({ step: 'connected', linkId: body.linkId, name: body.name || target.name })
    }
}
