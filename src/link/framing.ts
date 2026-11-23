import {
    LINK_DEFAULT_MAX_FRAME_BYTES, LINK_FRAME_HEADER_LENGTH, LINK_FRAMING_VERSION, LINK_MAX_FRAME_BYTES_CEILING,
    LINK_PREAMBLE_LENGTH, LINK_PREAMBLE_MAGIC,
} from './consts'
import type { LinkFrameEvent, LinkFrameReaderOptions, LinkFramingErrorCode } from './types'

// Only plain Uint8Array operations are used on byte state: on React Native (Hermes) the results of
// Buffer#subarray()/slice() are not Buffers, so Buffer methods must never be called on derived buffers.
const PREAMBLE_MAGIC_BYTES: Uint8Array = Uint8Array.from(Buffer.from(LINK_PREAMBLE_MAGIC, 'ascii'))

const EMPTY = new Uint8Array(0)

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(a.length + b.length)
    out.set(a, 0)
    out.set(b, a.length)
    return out
}

const readUInt32BE = (bytes: Uint8Array, offset: number): number =>
    ((bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>> 0

const writeUInt32BE = (bytes: Uint8Array, value: number, offset: number): void => {
    bytes[offset] = (value >>> 24) & 0xff
    bytes[offset + 1] = (value >>> 16) & 0xff
    bytes[offset + 2] = (value >>> 8) & 0xff
    bytes[offset + 3] = value & 0xff
}

const clampFrameBytes = (maxFrameBytes?: number): number => {
    const requested = maxFrameBytes ?? LINK_DEFAULT_MAX_FRAME_BYTES
    return Math.max(0, Math.min(requested, LINK_MAX_FRAME_BYTES_CEILING))
}

/**
 * Encodes the connection preamble: the ASCII bytes `INCYLINK` followed by the u8 framing
 * version. The phone sends it once, right after connecting; the desktop answers with the
 * same magic and the version it accepted.
 *
 * @param version framing version to request (default: 1)
 */
export const encodeLinkPreamble = (version: number = LINK_FRAMING_VERSION): Buffer => {
    const preamble = Buffer.alloc(LINK_PREAMBLE_LENGTH)
    preamble.set(PREAMBLE_MAGIC_BYTES, 0)
    preamble[PREAMBLE_MAGIC_BYTES.length] = version & 0xff
    return preamble
}

/**
 * Encodes one frame: `u32BE` payload length followed by the UTF-8 payload.
 *
 * @param payload the envelope JSON (or raw bytes)
 * @param maxFrameBytes payload size limit (default 64 KB, never above the 1 MB ceiling)
 * @throws if the payload exceeds the limit, because the peer would close the connection
 */
export const encodeLinkFrame = (payload: string | Uint8Array, maxFrameBytes?: number): Buffer => {
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload)
    if (body.length > clampFrameBytes(maxFrameBytes))
        throw new Error(`local-link: frame of ${body.length} bytes exceeds the frame size limit`)
    const header = Buffer.alloc(LINK_FRAME_HEADER_LENGTH)
    writeUInt32BE(header, body.length, 0)
    return Buffer.concat([header, body])
}

/**
 * Incremental parser of a control-channel byte stream.
 *
 * Socket-agnostic: feed it every chunk the socket delivers (`socket.on('data', c => reader.push(c))`),
 * in order. Chunks may split a header or payload anywhere, or carry several frames; the
 * reader buffers partial data and returns every complete frame.
 *
 * Once an error is reported the reader is dead: every later `push` returns no events and the
 * caller must close the connection.
 */
export class LinkFrameReader {
    protected buffer: Uint8Array = EMPTY
    protected preamblePending: boolean
    protected readonly maxPreambleVersion: number
    protected readonly maxFrameBytes: number
    protected failed = false

    /** @param options frame size limit and whether a preamble precedes the first frame */
    constructor(options: LinkFrameReaderOptions = {}) {
        this.maxFrameBytes = clampFrameBytes(options.maxFrameBytes)
        this.preamblePending = options.preamble !== undefined
        this.maxPreambleVersion = options.preamble?.maxVersion ?? LINK_FRAMING_VERSION
    }

    /**
     * Consumes one chunk of the byte stream.
     *
     * @param chunk the bytes received
     * @returns the preamble, frames and/or error found, in stream order
     */
    push(chunk: Uint8Array): LinkFrameEvent[] {
        if (this.failed)
            return []
        this.buffer = this.buffer.length === 0 ? Uint8Array.from(chunk) : concatBytes(this.buffer, chunk)

        const events: LinkFrameEvent[] = []
        let event = this.next()
        while (event) {
            events.push(event)
            event = this.failed ? undefined : this.next()
        }
        return events
    }

    /** true once an error was reported */
    isFailed(): boolean {
        return this.failed
    }

    protected next(): LinkFrameEvent | undefined {
        if (this.preamblePending)
            return this.readPreamble()
        return this.readFrame()
    }

    protected readPreamble(): LinkFrameEvent | undefined {
        // a wrong magic is rejected as soon as the bytes received so far differ from it
        const available = Math.min(this.buffer.length, PREAMBLE_MAGIC_BYTES.length)
        for (let i = 0; i < available; i++) {
            if (this.buffer[i] !== PREAMBLE_MAGIC_BYTES[i])
                return this.fail('bad-preamble')
        }
        if (this.buffer.length < LINK_PREAMBLE_LENGTH)
            return undefined

        const version = this.buffer[PREAMBLE_MAGIC_BYTES.length]
        if (version < 1 || version > this.maxPreambleVersion)
            return this.fail('unsupported-framing')

        this.buffer = Uint8Array.from(this.buffer.subarray(LINK_PREAMBLE_LENGTH))
        this.preamblePending = false
        return { type: 'preamble', version }
    }

    protected readFrame(): LinkFrameEvent | undefined {
        if (this.buffer.length < LINK_FRAME_HEADER_LENGTH)
            return undefined
        const length = readUInt32BE(this.buffer, 0)
        if (length > this.maxFrameBytes)
            return this.fail('frame-too-large')

        const end = LINK_FRAME_HEADER_LENGTH + length
        if (this.buffer.length < end)
            return undefined

        const payload = Buffer.from(Uint8Array.from(this.buffer.subarray(LINK_FRAME_HEADER_LENGTH, end))).toString('utf8')
        this.buffer = Uint8Array.from(this.buffer.subarray(end))
        return { type: 'frame', payload }
    }

    protected fail(code: LinkFramingErrorCode): LinkFrameEvent {
        this.failed = true
        this.buffer = EMPTY
        return { type: 'error', code }
    }
}
