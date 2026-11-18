import { formatDay, fromBase64, getErrorDetail, toBase64, utf8Decode, utf8DecodeFallback, utf8Encode, utf8EncodeFallback } from './utils'

describe('TrainerDay utils', () => {

    describe('getErrorDetail', () => {
        test.each([undefined, null, ''])('no detail for %p', (data) => {
            expect(getErrorDetail(data)).toBeUndefined()
        })

        test('text is returned as it is', () => {
            expect(getErrorDetail('Bad file')).toBe('Bad file')
        })

        test('objects are serialized', () => {
            expect(getErrorDetail({ message: 'bad' })).toBe('{"message":"bad"}')
        })

        test('long texts are trimmed to 500 characters', () => {
            const detail = getErrorDetail('x'.repeat(2000))
            expect(detail).toBe('x'.repeat(500) + '...')
        })
    })

    describe('toBase64', () => {
        test.each([
            [[], ''],
            [[102], 'Zg=='],
            [[102, 111], 'Zm8='],
            [[102, 111, 111], 'Zm9v'],
            [[255, 254, 253, 252], '//79/A==']
        ])('encodes %p', (bytes, expected) => {
            expect(toBase64(new Uint8Array(bytes))).toBe(expected)
        })

        test('matches Buffer for binary content', () => {
            const bytes = new Uint8Array(1000).map((_, i) => (i * 7) % 256)
            expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
        })
    })

    describe('fromBase64', () => {
        test.each([
            ['', []],
            ['Zg==', [102]],
            ['Zm8=', [102, 111]],
            ['Zm9v', [102, 111, 111]],
            ['//79/A==', [255, 254, 253, 252]]
        ])('decodes %p', (text, expected) => {
            expect(Array.from(fromBase64(text))).toEqual(expected)
        })

        test.each([
            ['Zg', [102]],
            ['Zm8', [102, 111]],
        ])('padding is optional: %p', (text, expected) => {
            expect(Array.from(fromBase64(text))).toEqual(expected)
        })

        test('ignores line breaks', () => {
            expect(Array.from(fromBase64('Zm9v\nZm9v\r\n'))).toEqual([102, 111, 111, 102, 111, 111])
        })

        test.each([1, 2, 3, 4, 5, 255, 256, 1000])('matches Buffer for %p binary bytes', (length) => {
            const bytes = new Uint8Array(length).map((_, i) => (i * 7 + 3) % 256)
            const encoded = Buffer.from(bytes).toString('base64')

            expect(fromBase64(encoded)).toEqual(new Uint8Array(Buffer.from(encoded, 'base64')))
            expect(fromBase64(encoded)).toEqual(bytes)
        })

        test('round trip with toBase64', () => {
            const bytes = new Uint8Array(257).map((_, i) => (i * 13) % 256)
            expect(fromBase64(toBase64(bytes))).toEqual(bytes)
        })

        test('throws on characters outside of the alphabet', () => {
            expect(() => fromBase64('Zm9$')).toThrow('Invalid base64 character')
        })

        test('throws on an impossible length', () => {
            expect(() => fromBase64('Zm9vZ')).toThrow('Invalid base64 length')
        })
    })

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
            expect(utf8Decode(bytes)).toContain('\uFFFD')
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
            expect(utf8Decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x3C]))).toBe('\uFEFF<')
            expect(utf8DecodeFallback(new Uint8Array([0xEF, 0xBB, 0xBF, 0x3C]))).toBe('\uFEFF<')
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
            expect(utf8DecodeFallback(new Uint8Array([0x61, 0x80, 0x62]))).toContain('\uFFFD')
        })
    })

    describe('formatDay', () => {
        test('formats a local day', () => {
            expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05')
        })

        test('a string is passed on', () => {
            expect(formatDay('2026-02-03')).toBe('2026-02-03')
        })
    })
})
