import { EventEmitter } from 'node:events'
import { encodeLinkFrame, encodeLinkPreamble, LinkFrameReader } from '../../src/link/framing'
import { LinkServerChannel } from '../../src/link/channel'
import type { LocalLinkEvent } from '../../src/api/localLink/types'
import type { LinkClientMessage } from '../../src/link/types'

/** The server's end of a fake connection. */
export interface ServerWire {
    send(bytes: Buffer): void
    close(): void
}

/** What a listener does with the bytes of one accepted connection. */
export interface ServerHandler {
    onBytes(bytes: Buffer): void
    onClientClosed(): void
}

/** A listener at an address of the fake network. */
export interface Endpoint {
    accept(wire: ServerWire): ServerHandler
}

const microtask = (fn: () => void) => { Promise.resolve().then(fn).catch(() => undefined) }

/** A socket of the fake network: same surface as the socket of the mobile `wifi.net` binding. */
export class FakeSocket extends EventEmitter {
    destroyed = false
    protected handler?: ServerHandler

    constructor(protected net: FakeNetwork) {
        super()
    }

    connect(port: number, host: string) {
        this.net.connects.push(`${host}:${port}`)
        microtask(() => {
            if (this.destroyed)
                return
            const endpoint = this.net.endpoints.get(`${host}:${port}`)
            if (!endpoint) {
                this.emit('error', new Error('ECONNREFUSED'))
                this.emit('close')
                return
            }
            this.handler = endpoint.accept({
                send: bytes => microtask(() => { if (!this.destroyed) this.emit('data', bytes) }),
                close: () => microtask(() => { if (!this.destroyed) this.emit('close') }),
            })
            this.emit('connect')
        })
        return this
    }

    write(data: Buffer): boolean {
        this.net.written.push(Buffer.from(data))
        this.handler?.onBytes(Buffer.from(data))
        return true
    }

    destroy(): void {
        if (this.destroyed)
            return
        this.destroyed = true
        this.handler?.onClientClosed()
    }
}

/** An in-memory network: sockets connect to the endpoints registered under `host:port`. */
export class FakeNetwork {
    endpoints = new Map<string, Endpoint>()
    connects: string[] = []
    /** every chunk the phone wrote, in order */
    written: Buffer[] = []

    createSocket = () => new FakeSocket(this)
}

/**
 * Adapts a fake `ILocalLinkBinding` (the one the real desktop `LocalLinkService` drives) to an
 * endpoint of the fake network: framing and preamble are handled like the desktop transport does.
 */
export const makeHostLink = (opts: { samePeer?: string } = {}) => {
    let listener: ((e: LocalLinkEvent) => void) | undefined
    const wires = new Map<string, ServerWire>()
    let seq = 0

    const link = {
        isSupported: jest.fn(() => true),
        getCapabilities: jest.fn(),
        getStatus: jest.fn(),
        start: jest.fn(async (o: { control?: { port?: number }, media?: { port?: number } }) => ({
            control: { ok: true, port: o.control?.port || 6001 }, media: { ok: true, port: o.media?.port || 6002 }, addresses: [],
        })),
        stop: jest.fn(async () => ({ ok: true })),
        setPeerPolicy: jest.fn(async () => ({ ok: true })),
        setLimits: jest.fn(async () => ({ ok: true, applied: {} })),
        announce: jest.fn(async (_a: unknown) => ({ ok: true })),
        reannounce: jest.fn(async () => ({ ok: true })),
        publishMedia: jest.fn(async () => ({ ok: true, rejectedHandles: [], rejectedTokens: 0 })),
        send: jest.fn(async (id: string, payload: string) => {
            wires.get(id)?.send(encodeLinkFrame(payload))
            return { ok: true }
        }),
        close: jest.fn(async (id: string, _reason?: string) => {
            wires.get(id)?.close()
            wires.delete(id)
        }),
        onEvent: jest.fn((cb: (e: LocalLinkEvent) => void) => { listener = cb; return () => { listener = undefined } }),
    }

    const endpoint: Endpoint = {
        accept(wire) {
            const id = `c${++seq}`
            wires.set(id, wire)
            const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
            listener?.({ type: 'connection', connectionId: id, peer: { address: opts.samePeer ?? `10.0.0.${seq}`, port: 40000 + seq } })
            return {
                onBytes(bytes) {
                    for (const event of reader.push(bytes)) {
                        if (event.type === 'preamble')
                            wire.send(encodeLinkPreamble(event.version))
                        else if (event.type === 'frame')
                            listener?.({ type: 'frame', connectionId: id, payload: event.payload })
                    }
                },
                onClientClosed() {
                    wires.delete(id)
                    listener?.({ type: 'connection-closed', connectionId: id, reason: 'closed' })
                },
            }
        },
    }
    return { link, endpoint }
}

/** Sends a message of the scripted computer. */
export type RogueSend = (t: ServerType, b: ServerBody, id?: string) => void
type ServerType = Parameters<LinkServerChannel['encode']>[0]
type ServerBody = Parameters<LinkServerChannel['encode']>[1]

/**
 * A scripted computer: answers `hello`, refuses every `auth` (it holds no secret of any phone),
 * records every frame it receives, and hands every message to an optional handler so that a test
 * can script pairing answers.
 */
export class RogueEndpoint implements Endpoint {
    received: LinkClientMessage[] = []
    payloads: string[] = []
    connections = 0
    send?: RogueSend

    constructor(protected opts: { pairingOpen?: boolean, refuseVersion?: boolean, handler?: (msg: LinkClientMessage, send: RogueSend) => void } = {}) {}

    accept(wire: ServerWire): ServerHandler {
        this.connections++
        const channel = new LinkServerChannel()
        const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
        const send: RogueSend = (t, b, id) => wire.send(encodeLinkFrame(channel.encode(t, b as never, id)))
        this.send = send
        return {
            onBytes: bytes => {
                for (const event of reader.push(bytes)) {
                    if (event.type === 'preamble')
                        wire.send(encodeLinkPreamble(event.version))
                    else if (event.type === 'frame')
                        this.onFrame(channel, event.payload, send)
                }
            },
            onClientClosed: () => undefined,
        }
    }

    protected onFrame(channel: LinkServerChannel, payload: string, send: RogueSend): void {
        this.payloads.push(payload)
        const res = channel.decode(payload)
        if (!res.ok)
            return
        const msg = res.message
        this.received.push(msg)
        if (msg.t === 'hello' && this.opts.refuseVersion)
            send('error', { code: 'unsupported-protocol' }, msg.id)
        else if (msg.t === 'hello')
            send('hello', { protocol: { major: 1, minor: 0 }, capabilities: [], pairingOpen: this.opts.pairingOpen ?? false }, msg.id)
        else if (msg.t === 'auth')
            send('auth-result', { ok: false }, msg.id)
        this.opts.handler?.(msg, send)
    }
}

/** An in-memory `IJsonRepositoryBinding`. */
export const makeMemoryDb = () => {
    const files = new Map<string, unknown>()
    const access = {
        read: jest.fn(async (name: string) => files.get(name) ?? {}),
        write: jest.fn(async (name: string, data: unknown) => { files.set(name, JSON.parse(JSON.stringify(data))); return true }),
        delete: jest.fn(async (name: string) => files.delete(name)),
        list: jest.fn(async () => [...files.keys()].map(k => `${k}.json`)),
    }
    const db = {
        create: jest.fn(async () => access),
        get: jest.fn(async () => access),
        release: jest.fn(async () => true),
        getPath: jest.fn(() => ''),
    }
    return { db, files }
}

/** An in-memory `ISecureStorageBinding`. */
export const makeMemorySecureStorage = () => {
    const values = new Map<string, string>()
    return {
        values,
        binding: {
            get: jest.fn(async (key: string) => values.get(key)),
            set: jest.fn(async (key: string, value: string) => { values.set(key, value); return true }),
            delete: jest.fn(async (key: string) => { values.delete(key); return true }),
        },
    }
}
