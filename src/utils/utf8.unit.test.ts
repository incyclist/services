import { utf8Decode, utf8DecodeFallback, utf8Encode, utf8EncodeFallback } from './utf8'

describe('utf8', () => {

    describe('utf8Encode / utf8Decode', () => {
        test.each([
            ['ascii', '<Id>2024-03-10</Id>'],
            ['two byte characters', 'Köln Zürich'],
            ['three byte characters', 'Tour de € 日本語'],
            ['four byte characters (emoji)', 'Ride 🚴 done'],
            ['empty', ''],
        ])('%s: matches Buffer and round trips', (_name, text) => {
            const bytes = utf8Encode(text)

            expect(bytes).toEqual(new Uint8Array(Buffer.from(text, 'utf-8')))
            expect(utf8Decode(bytes)).toBe(text)
            expect(utf8Decode(new Uint8Array(Buffer.from(text, 'utf-8')))).toBe(text)
        })

        test.each([
            ['lone continuation byte', [0x61, 0x80, 0x62]],
            ['truncated sequence', [0x61, 0xE2, 0x82]],
            ['bad continuation', [0xE2, 0x41, 0x42]],
            ['invalid lead byte', [0xFF, 0x61]],
        ])('invalid input is replaced like Buffer does: %s', (_name, input) => {
            const bytes = new Uint8Array(input)
            expect(utf8Decode(bytes)).toContain('�')
            expect(utf8Decode(bytes).length).toBeGreaterThan(0)
        })
    })

    describe('utf8Encode / utf8Decode: platform support', () => {
        const samples = ['<Id>2024-03-10</Id>', 'Köln Zürich', 'Tour de € 日本語', 'Ride 🚴 done', '']

        afterEach(() => {
            jest.restoreAllMocks()
        })

        test('uses TextEncoder and TextDecoder if the platform provides them', () => {
            const encode = jest.spyOn(globalThis.TextEncoder.prototype, 'encode')
            const decode = jest.spyOn(globalThis.TextDecoder.prototype, 'decode')

            const bytes = utf8Encode('abc')
            utf8Decode(bytes)

            expect(encode).toHaveBeenCalledWith('abc')
            expect(decode).toHaveBeenCalledTimes(1)
        })

        test('keeps a byte order mark', () => {
            expect(utf8Decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x3C]))).toBe('﻿<')
            expect(utf8DecodeFallback(new Uint8Array([0xEF, 0xBB, 0xBF, 0x3C]))).toBe('﻿<')
        })

        test.each(samples)('falls back to the hand-written code without TextEncoder/TextDecoder: %p', (text) => {
            const { TextEncoder: encoder, TextDecoder: decoder } = globalThis
            const encode = jest.spyOn(encoder.prototype, 'encode')
            const decode = jest.spyOn(decoder.prototype, 'decode')
            Object.defineProperty(globalThis, 'TextEncoder', { value: undefined, configurable: true, writable: true })
            Object.defineProperty(globalThis, 'TextDecoder', { value: undefined, configurable: true, writable: true })

            try {
                const bytes = utf8Encode(text)
                expect(bytes).toEqual(new Uint8Array(Buffer.from(text, 'utf-8')))
                expect(utf8Decode(bytes)).toBe(text)
                expect(encode).not.toHaveBeenCalled()
                expect(decode).not.toHaveBeenCalled()
            }
            finally {
                Object.defineProperty(globalThis, 'TextEncoder', { value: encoder, configurable: true, writable: true })
                Object.defineProperty(globalThis, 'TextDecoder', { value: decoder, configurable: true, writable: true })
            }
        })

        test.each(samples)('fallback and native implementation agree: %p', (text) => {
            expect(utf8EncodeFallback(text)).toEqual(utf8Encode(text))
            expect(utf8DecodeFallback(utf8Encode(text))).toBe(utf8Decode(utf8Encode(text)))
        })

        test('fallback replaces invalid input', () => {
            expect(utf8DecodeFallback(new Uint8Array([0x61, 0x80, 0x62]))).toContain('�')
        })
    })
})
