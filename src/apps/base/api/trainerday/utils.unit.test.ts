import { formatDay, getErrorDetail } from './utils'

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

    describe('formatDay', () => {
        test('formats a local day', () => {
            expect(formatDay(new Date(2026, 0, 5))).toBe('2026-01-05')
        })

        test('a string is passed on', () => {
            expect(formatDay('2026-02-03')).toBe('2026-02-03')
        })
    })
})
