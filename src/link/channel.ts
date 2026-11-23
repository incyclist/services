import {
    LINK_CLIENT_MESSAGE_TYPES, LINK_CLIENT_PRE_AUTH_TYPES, LINK_MAX_SEQ, LINK_SERVER_MESSAGE_TYPES,
    LINK_SERVER_PRE_AUTH_TYPES,
} from './consts'
import { decodeLinkEnvelope, encodeLinkEnvelope, signLinkEnvelope, verifyLinkEnvelope } from './envelope'
import type {
    LinkClientMessageBodies, LinkClientMessage, LinkDirection, LinkEnvelope, LinkReceiveResult, LinkRole,
    LinkServerMessage, LinkServerMessageBodies,
} from './types'

/**
 * Message-level state of one control connection, for either end.
 *
 * - Sequence numbers: one counter per direction and connection, starting at 1 and covering
 *   every frame (unsigned handshake frames as well as signed session frames). A received
 *   frame is accepted only if its `s` is strictly greater than the last accepted one.
 * - Before {@link establish}: frames are sent unsigned, and only the handshake, pairing and
 *   auth types are accepted (anything else is `not-allowed`).
 * - After {@link establish}: every frame is signed with the session key and every received
 *   frame must carry a valid MAC for the peer's direction (`unsigned`, `bad-mac`).
 * - Frames of a type this version does not know are reported as `unknown-type` after all
 *   other checks passed; the caller ignores them.
 *
 * The channel does not validate bodies; that is up to the message handlers.
 */
export abstract class LinkChannel<TSend extends object, TReceive extends LinkEnvelope> {
    protected sessionKey: Uint8Array | undefined
    protected sendSeq = 0
    protected lastReceivedSeq = 0
    protected readonly sendDir: LinkDirection
    protected readonly receiveDir: LinkDirection

    protected constructor(
        role: LinkRole,
        protected readonly knownTypes: readonly string[],
        protected readonly preAuthTypes: readonly string[]
    ) {
        this.sendDir = role === 'client' ? 'c2s' : 's2c'
        this.receiveDir = role === 'client' ? 's2c' : 'c2s'
    }

    /**
     * Switches the channel to signed mode. Call it on the phone right after sending
     * `auth-confirm`, and on the desktop right after verifying it.
     *
     * @param sessionKey the derived session key
     */
    establish(sessionKey: Uint8Array): void {
        this.sessionKey = Uint8Array.from(sessionKey)
    }

    /** true once {@link establish} was called */
    isEstablished(): boolean {
        return this.sessionKey !== undefined
    }

    /**
     * Builds the next frame payload: assigns the next sequence number and, once
     * established, signs it.
     *
     * @param t message type
     * @param b message body
     * @param id correlation id (a response repeats the request's id)
     * @returns the UTF-8 JSON text for one frame
     * @throws when the sequence number space is exhausted; the connection must be re-established
     */
    encode<K extends keyof TSend & string>(t: K, b: TSend[K], id?: string): string {
        if (this.sendSeq >= LINK_MAX_SEQ)
            throw new Error('local-link: sequence numbers exhausted')
        this.sendSeq++
        const envelope: LinkEnvelope = id === undefined ? { t, s: this.sendSeq, b } : { t, s: this.sendSeq, id, b }
        const frame = this.sessionKey ? signLinkEnvelope(this.sessionKey, this.sendDir, envelope) : envelope
        return encodeLinkEnvelope(frame)
    }

    /**
     * Parses and checks a received frame payload.
     *
     * @param payload the frame payload
     * @returns the message, or why it was rejected
     */
    decode(payload: string): LinkReceiveResult<TReceive> {
        const decoded = decodeLinkEnvelope(payload)
        if (!decoded.ok)
            return { ok: false, reason: 'malformed' }
        const envelope = decoded.envelope

        const rejected = this.sessionKey ? this.checkSigned(envelope, this.sessionKey) : this.checkUnsigned(envelope)
        if (rejected)
            return { ok: false, reason: rejected }
        if (envelope.s <= this.lastReceivedSeq)
            return { ok: false, reason: 'replay' }

        this.lastReceivedSeq = envelope.s
        if (!this.knownTypes.includes(envelope.t))
            return { ok: false, reason: 'unknown-type' }
        return { ok: true, message: envelope as TReceive }
    }

    protected checkUnsigned(envelope: LinkEnvelope): 'not-allowed' | undefined {
        return this.preAuthTypes.includes(envelope.t) ? undefined : 'not-allowed'
    }

    protected checkSigned(envelope: LinkEnvelope, sessionKey: Uint8Array): 'unsigned' | 'bad-mac' | undefined {
        if (envelope.m === undefined)
            return 'unsigned'
        return verifyLinkEnvelope(sessionKey, this.receiveDir, envelope) ? undefined : 'bad-mac'
    }
}

/** The phone's end of a control connection: sends client messages, receives server messages. */
export class LinkClientChannel extends LinkChannel<LinkClientMessageBodies, LinkServerMessage> {
    constructor() {
        super('client', LINK_SERVER_MESSAGE_TYPES, LINK_SERVER_PRE_AUTH_TYPES)
    }
}

/** The desktop's end of a control connection: sends server messages, receives client messages. */
export class LinkServerChannel extends LinkChannel<LinkServerMessageBodies, LinkClientMessage> {
    constructor() {
        super('server', LINK_CLIENT_MESSAGE_TYPES, LINK_CLIENT_PRE_AUTH_TYPES)
    }
}
