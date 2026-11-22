import type { PairFailedBody } from '../types'
import {
    PAIR_RATE_GLOBAL, PAIR_RATE_PER_PEER, PAIR_RATE_WINDOW_MS, PAIRING_MAX_ATTEMPTS, PAIRING_TTL_SECONDS,
} from './consts'
import { SlidingWindowLimiter } from './rate-limit'
import type { ConnectNotice, LocalLinkConnectWindow, PairRequestResult, PairVerifyResult } from './types'

interface PendingRequest {
    requestId: string
    connectionId: string
    clientName: string
    pin: string
    expiresAt: number
    attempts: number
    timer?: ReturnType<typeof setTimeout>
}

export interface LinkPairingHooks {
    generatePin(): string
    newRequestId(): string
    /** the pairing state changed (window content, notice, pending request) */
    onChange(): void
    /** an outcome the phone did not ask for (deny, superseded, expired): push it on its connection */
    notify(connectionId: string, body: PairFailedBody): void
    now?(): number
}

const MAX_TERMINAL_OUTCOMES = 16

/**
 * The pairing state machine. Pairing is open only while the pairing UI is open; there is at most
 * one outstanding request (a new one supersedes it); a request expires after 120 s or after three
 * wrong PINs. It knows nothing about sockets, secrets or persistence.
 */
export class LinkPairing {
    protected opened = false
    protected pending?: PendingRequest
    protected terminal = new Map<string, PairFailedBody>()
    protected notice?: ConnectNotice
    protected lastDevice?: string
    protected connected = false
    protected peerLimiter = new SlidingWindowLimiter(PAIR_RATE_PER_PEER, PAIR_RATE_WINDOW_MS)
    protected globalLimiter = new SlidingWindowLimiter(PAIR_RATE_GLOBAL, PAIR_RATE_WINDOW_MS)

    constructor(protected hooks: LinkPairingHooks) {}

    isOpen(): boolean {
        return this.opened
    }

    /** true while pairing is open and a request of this connection is waiting for its PIN */
    hasPendingFor(connectionId: string): boolean {
        return this.opened && this.pending?.connectionId === connectionId
    }

    open(): void {
        if (this.opened)
            return
        this.opened = true
        this.clearWindowState()
        this.hooks.onChange()
    }

    close(): void {
        if (!this.opened)
            return
        if (this.pending)
            this.finish(this.pending, { outcome: 'pairing-closed' })
        this.opened = false
        this.clearWindowState()
        this.hooks.onChange()
    }

    /** The user turned the pending request down. */
    deny(): void {
        const pending = this.pending
        if (!pending)
            return
        this.finish(pending, { outcome: 'denied' })
        this.notice = 'denied'
        this.hooks.notify(pending.connectionId, { outcome: 'denied' })
        this.hooks.onChange()
    }

    /** A control connection closed: an unanswered request of that connection is abandoned. */
    connectionClosed(connectionId: string): void {
        const pending = this.pending
        if (pending?.connectionId !== connectionId)
            return
        this.finish(pending, { outcome: 'expired' })
        this.notice = 'abandoned'
        this.hooks.onChange()
    }

    request(connectionId: string, peer: string, clientName: string): PairRequestResult {
        if (!this.opened)
            return { kind: 'failed', body: { outcome: 'pairing-closed' } }

        const now = this.now()
        const limited = this.checkRate(peer, now)
        if (limited)
            return { kind: 'failed', body: limited }

        const replaced = this.supersede(connectionId)
        const pending: PendingRequest = {
            requestId: this.hooks.newRequestId(), connectionId, clientName, pin: this.hooks.generatePin(),
            expiresAt: now + PAIRING_TTL_SECONDS * 1000, attempts: 0,
        }
        pending.timer = setTimeout(() => this.expire(pending), PAIRING_TTL_SECONDS * 1000)
        this.pending = pending
        this.lastDevice = clientName
        this.connected = false
        this.notice = replaced ? 'replaced' : undefined
        this.hooks.onChange()
        return { kind: 'pending', requestId: pending.requestId, expiresIn: PAIRING_TTL_SECONDS }
    }

    verify(connectionId: string, requestId: string, pin: string): PairVerifyResult {
        if (!this.opened)
            return { kind: 'failed', body: { outcome: 'pairing-closed' } }

        const terminal = this.terminal.get(requestId)
        if (terminal)
            return { kind: 'failed', body: terminal }

        const pending = this.pending
        if (pending?.requestId !== requestId || pending.connectionId !== connectionId)
            return { kind: 'failed', body: { outcome: 'expired' } }
        if (this.now() >= pending.expiresAt) {
            this.expire(pending)
            return { kind: 'failed', body: { outcome: 'expired' } }
        }
        return this.check(pending, pin)
    }

    /** What the connect window shows for the pairing part; `undefined` while pairing is closed. */
    getWindow(): LocalLinkConnectWindow | undefined {
        if (!this.opened)
            return undefined
        const pending = this.pending
        if (pending) {
            return {
                phase: 'code', device: pending.clientName, pin: pending.pin, expiresAt: pending.expiresAt,
                attemptsLeft: PAIRING_MAX_ATTEMPTS - pending.attempts, notice: this.notice,
            }
        }
        return { phase: this.connected ? 'connected' : 'waiting', device: this.lastDevice, notice: this.notice }
    }

    reset(): void {
        if (this.pending?.timer)
            clearTimeout(this.pending.timer)
        this.pending = undefined
        this.opened = false
        this.terminal.clear()
        this.peerLimiter.reset()
        this.globalLimiter.reset()
        this.clearWindowState()
    }

    protected check(pending: PendingRequest, pin: string): PairVerifyResult {
        if (this.pinMatches(pending.pin, pin)) {
            this.finish(pending, { outcome: 'expired' })
            this.connected = true
            this.notice = undefined
            this.hooks.onChange()
            return { kind: 'accepted', clientName: pending.clientName }
        }

        pending.attempts++
        const attemptsRemaining = PAIRING_MAX_ATTEMPTS - pending.attempts
        if (attemptsRemaining <= 0) {
            this.finish(pending, { outcome: 'expired' })
            this.notice = 'invalidated'
        }
        this.hooks.onChange()
        return { kind: 'failed', body: { outcome: 'wrong', attemptsRemaining: Math.max(0, attemptsRemaining) } }
    }

    /** Constant-time comparison; a malformed PIN is just a wrong one. */
    protected pinMatches(expected: string, given: unknown): boolean {
        if (typeof given !== 'string' || given.length !== expected.length)
            return false
        let diff = 0
        for (let i = 0; i < expected.length; i++)
            diff |= expected.codePointAt(i)! ^ given.codePointAt(i)!
        return diff === 0
    }

    protected checkRate(peer: string, now: number): PairFailedBody | undefined {
        const peerHit = this.peerLimiter.hit(peer, now)
        if ('retryAfter' in peerHit)
            return { outcome: 'rate-limited', retryAfter: peerHit.retryAfter }
        const globalHit = this.globalLimiter.hit('*', now)
        if ('retryAfter' in globalHit)
            return { outcome: 'rate-limited', retryAfter: globalHit.retryAfter }
        return undefined
    }

    /** Replaces the outstanding request; returns true if there was one from another connection or request. */
    protected supersede(connectionId: string): boolean {
        const previous = this.pending
        if (!previous)
            return false
        this.finish(previous, { outcome: 'superseded' })
        if (previous.connectionId !== connectionId)
            this.hooks.notify(previous.connectionId, { outcome: 'superseded' })
        return true
    }

    protected expire(pending: PendingRequest): void {
        if (this.pending !== pending)
            return
        this.finish(pending, { outcome: 'expired' })
        this.notice = 'expired'
        this.hooks.notify(pending.connectionId, { outcome: 'expired' })
        this.hooks.onChange()
    }

    /** Ends a request; later `pair-verify` calls for it get `outcome`. */
    protected finish(pending: PendingRequest, outcome: PairFailedBody): void {
        if (pending.timer)
            clearTimeout(pending.timer)
        if (this.pending === pending)
            this.pending = undefined
        this.terminal.set(pending.requestId, outcome)
        if (this.terminal.size > MAX_TERMINAL_OUTCOMES)
            this.terminal.delete(this.terminal.keys().next().value as string)
    }

    protected clearWindowState(): void {
        this.notice = undefined
        this.lastDevice = undefined
        this.connected = false
    }

    protected now(): number {
        return this.hooks.now?.() ?? Date.now()
    }
}
