import { LINK_MAX_FRAME_BYTES_CEILING } from './consts'
import { simulateHermesBuffer } from '../../__tests__/utils/hermesBuffer'
import { LinkFrameReader, encodeLinkFrame, encodeLinkPreamble } from './framing'

const frame = (payload: string) => encodeLinkFrame(payload)

describe('link framing', () => {
    describe('encodeLinkPreamble', () => {
        test('is INCYLINK followed by the version byte', () => {
            expect(encodeLinkPreamble()).toEqual(Buffer.from([0x49, 0x4e, 0x43, 0x59, 0x4c, 0x49, 0x4e, 0x4b, 1]))
            expect(encodeLinkPreamble(2).at(-1)).toBe(2)
        })
    })

    describe('encodeLinkFrame', () => {
        test('prefixes the UTF-8 payload with its u32BE length', () => {
            const encoded = encodeLinkFrame('{"t":"é"}')
            expect(encoded.readUInt32BE(0)).toBe(10)
            expect(encoded.subarray(4).toString('utf8')).toBe('{"t":"é"}')
        })

        test('accepts raw bytes', () => {
            expect(encodeLinkFrame(Uint8Array.from([1, 2]))).toEqual(Buffer.from([0, 0, 0, 2, 1, 2]))
        })

        test('throws above the frame size limit', () => {
            expect(() => encodeLinkFrame('x'.repeat(11), 10)).toThrow('frame size limit')
            expect(encodeLinkFrame('x'.repeat(10), 10).length).toBe(14)
        })

        test('never allows more than the ceiling', () => {
            expect(() => encodeLinkFrame(Buffer.alloc(LINK_MAX_FRAME_BYTES_CEILING + 1), 10 * LINK_MAX_FRAME_BYTES_CEILING)).toThrow()
        })
    })

    describe('LinkFrameReader', () => {
        describe('push', () => {
            test('returns a complete frame', () => {
                const reader = new LinkFrameReader()
                expect(reader.push(frame('{"a":1}'))).toEqual([{ type: 'frame', payload: '{"a":1}' }])
            })

            test('handles a header split across chunks', () => {
                const reader = new LinkFrameReader()
                const bytes = frame('hello')
                expect(reader.push(bytes.subarray(0, 1))).toEqual([])
                expect(reader.push(bytes.subarray(1, 3))).toEqual([])
                expect(reader.push(bytes.subarray(3, 6))).toEqual([])
                expect(reader.push(bytes.subarray(6))).toEqual([{ type: 'frame', payload: 'hello' }])
            })

            test('handles byte-by-byte delivery including a split multi-byte character', () => {
                const reader = new LinkFrameReader()
                const bytes = Buffer.concat([frame('äöü'), frame('x')])
                const events = [...bytes].flatMap(b => reader.push(Uint8Array.of(b)))
                expect(events).toEqual([{ type: 'frame', payload: 'äöü' }, { type: 'frame', payload: 'x' }])
            })

            test('returns several frames merged into one chunk', () => {
                const reader = new LinkFrameReader()
                const bytes = Buffer.concat([frame('one'), frame(''), frame('three'), frame('fo')])
                expect(reader.push(bytes.subarray(0, bytes.length - 1))).toEqual([
                    { type: 'frame', payload: 'one' }, { type: 'frame', payload: '' }, { type: 'frame', payload: 'three' },
                ])
                expect(reader.push(bytes.subarray(bytes.length - 1))).toEqual([{ type: 'frame', payload: 'fo' }])
            })

            test('reports an oversize frame from its header and stops', () => {
                const reader = new LinkFrameReader({ maxFrameBytes: 8 })
                const header = Buffer.alloc(4)
                header.writeUInt32BE(9)
                expect(reader.push(Buffer.concat([frame('ok'), header]))).toEqual([
                    { type: 'frame', payload: 'ok' }, { type: 'error', code: 'frame-too-large' },
                ])
                expect(reader.isFailed()).toBe(true)
                expect(reader.push(frame('later'))).toEqual([])
            })

            test('accepts a frame exactly at the limit', () => {
                const reader = new LinkFrameReader({ maxFrameBytes: 8 })
                expect(reader.push(frame('12345678'))).toEqual([{ type: 'frame', payload: '12345678' }])
            })

            test('caps the limit at the ceiling', () => {
                const reader = new LinkFrameReader({ maxFrameBytes: 10 * LINK_MAX_FRAME_BYTES_CEILING })
                const header = Buffer.alloc(4)
                header.writeUInt32BE(LINK_MAX_FRAME_BYTES_CEILING + 1)
                expect(reader.push(header)).toEqual([{ type: 'error', code: 'frame-too-large' }])
            })

            test('reads the preamble before the first frame', () => {
                const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
                const bytes = Buffer.concat([encodeLinkPreamble(1), frame('a')])
                expect(reader.push(bytes)).toEqual([{ type: 'preamble', version: 1 }, { type: 'frame', payload: 'a' }])
            })

            test('handles a preamble split across chunks', () => {
                const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
                const bytes = Buffer.concat([encodeLinkPreamble(1), frame('a')])
                expect(reader.push(bytes.subarray(0, 4))).toEqual([])
                expect(reader.push(bytes.subarray(4, 9))).toEqual([{ type: 'preamble', version: 1 }])
                expect(reader.push(bytes.subarray(9))).toEqual([{ type: 'frame', payload: 'a' }])
            })

            test('rejects a bad preamble as soon as a byte differs', () => {
                const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
                expect(reader.push(Buffer.from('INCX'))).toEqual([{ type: 'error', code: 'bad-preamble' }])
                expect(reader.push(encodeLinkPreamble())).toEqual([])
            })

            test('rejects a DirectConnect-style binary header', () => {
                const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
                expect(reader.push(Buffer.from([1, 1, 0, 0, 0, 0]))).toEqual([{ type: 'error', code: 'bad-preamble' }])
            })

            test('rejects a framing version above the requested one or zero', () => {
                expect(new LinkFrameReader({ preamble: { maxVersion: 1 } }).push(encodeLinkPreamble(2)))
                    .toEqual([{ type: 'error', code: 'unsupported-framing' }])
                expect(new LinkFrameReader({ preamble: { maxVersion: 1 } }).push(encodeLinkPreamble(0)))
                    .toEqual([{ type: 'error', code: 'unsupported-framing' }])
            })

            test('accepts a lower framing version than requested', () => {
                const reader = new LinkFrameReader({ preamble: { maxVersion: 2 } })
                expect(reader.push(encodeLinkPreamble(1))).toEqual([{ type: 'preamble', version: 1 }])
            })
        })
    })
})

describe('link framing on Hermes (Buffer#subarray/slice return a plain Uint8Array)', () => {
    let restore: () => void
    beforeEach(() => { restore = simulateHermesBuffer() })
    afterEach(() => restore())

    test('the simulation really strips Buffer methods from derived buffers', () => {
        const derived = Buffer.from([1, 2, 3]).subarray(1) as unknown as { equals?: unknown, readUInt8?: unknown }
        expect(derived.equals).toBeUndefined()
        expect(derived.readUInt8).toBeUndefined()
    })

    test('reads preamble and frames, also when split byte by byte', () => {
        const stream = Buffer.concat([encodeLinkPreamble(), frame('{"a":1}'), frame('é')])
        const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
        const events = []
        for (const byte of stream)
            events.push(...reader.push(Uint8Array.of(byte)))
        expect(events).toEqual([
            { type: 'preamble', version: 1 },
            { type: 'frame', payload: '{"a":1}' },
            { type: 'frame', payload: 'é' },
        ])
    })

    test('reads several frames from one chunk and keeps a partial rest', () => {
        const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
        const stream = Buffer.concat([encodeLinkPreamble(), frame('one'), frame('two'), frame('three').subarray(0, 5) as Buffer])
        expect(reader.push(stream).map(e => e.type)).toEqual(['preamble', 'frame', 'frame'])
        expect(reader.push(Buffer.from(frame('three')).subarray(5) as Buffer)).toEqual([{ type: 'frame', payload: 'three' }])
    })

    test('reports a wrong magic and an unsupported version', () => {
        expect(new LinkFrameReader({ preamble: { maxVersion: 1 } }).push(Buffer.from('XNCY'))).toEqual([{ type: 'error', code: 'bad-preamble' }])
        expect(new LinkFrameReader({ preamble: { maxVersion: 1 } }).push(encodeLinkPreamble(9))).toEqual([{ type: 'error', code: 'unsupported-framing' }])
    })

    test('reports a frame above the limit', () => {
        const reader = new LinkFrameReader({ maxFrameBytes: 4 })
        expect(reader.push(Uint8Array.of(0, 0, 0, 9))).toEqual([{ type: 'error', code: 'frame-too-large' }])
    })

    test('reads lengths above 2^31', () => {
        const reader = new LinkFrameReader()
        expect(reader.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff))).toEqual([{ type: 'error', code: 'frame-too-large' }])
    })
})
