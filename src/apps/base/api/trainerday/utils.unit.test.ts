import { formatDay, getErrorDetail, toBase64 } from './utils'

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

    describe('formatDay', () => {
        test('formats a local day', () => {
            expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05')
        })

        test('a string is passed on', () => {
            expect(formatDay('2026-02-03')).toBe('2026-02-03')
        })
    })
})
