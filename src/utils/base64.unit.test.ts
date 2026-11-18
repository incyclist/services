import { base64Size, fromBase64, isBase64, toBase64 } from './base64'

describe('base64', () => {

    describe('isBase64', () => {
        test.each(['Zg==', 'Zm8=', 'Zm9v', '//79/A==', 'abc+/AZ09', 'Zg'])('accepts %p', (value) => {
            expect(isBase64(value)).toBe(true)
        })

        test.each(['', '=', 'Zg===', 'Zm9$', 'Zm 9v', 'Zm9v\n', 'Zg=a', '-_', '<xml/>'])('rejects %p', (value) => {
            expect(isBase64(value)).toBe(false)
        })
    })

    describe('base64Size', () => {
        test.each([
            ['', 0],
            ['Zm9v', 3],
            ['Zm9vZm9v', 6],
            ['Zm8=', 2],
            ['Zg==', 1],
            ['Zm9vZm8=', 5],
            ['Zm9vZg==', 4],
        ])('size of %p is %p', (value, expected) => {
            expect(base64Size(value)).toBe(expected)
        })

        test.each([0, 1, 2, 3, 4, 5, 255, 256, 1000])('matches the length of the decoded content for %p bytes', (length) => {
            const bytes = new Uint8Array(length).map((_, i) => (i * 7 + 3) % 256)
            expect(base64Size(toBase64(bytes))).toBe(length)
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
})
