import { ensureExpiration, formatDay, getErrorDetail, getTokenExpiration, parseExpiration } from './utils'

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

describe('getTokenExpiration / ensureExpiration', () => {
    const NOW = Date.UTC(2026, 0, 1, 10)
    const LIFETIME = 3 * 60 * 60 * 1000

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW)
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('getTokenExpiration', () => {
        test('expires_in (seconds) is preferred', () => {
            const data = { expires_in: 3600, expiration: NOW + 1000 }
            expect(getTokenExpiration(data, LIFETIME)).toEqual(new Date(NOW + 3600 * 1000))
        })

        test('expires_in as numeric string', () => {
            expect(getTokenExpiration({ expires_in: '60' }, LIFETIME)).toEqual(new Date(NOW + 60 * 1000))
        })

        test('falls back to the expiration of the auth-server', () => {
            const expiration = Date.UTC(2026, 0, 1, 12)
            expect(getTokenExpiration({ expires_in: undefined, expiration: String(expiration) }, LIFETIME)).toEqual(new Date(expiration))
        })

        test.each([null, '', 'garbage', Number.NaN])('an unusable expires_in (%p) is ignored', (value) => {
            expect(getTokenExpiration({ expires_in: value, expiration: NOW + 5000 }, LIFETIME)).toEqual(new Date(NOW + 5000))
        })

        test('expires_in of 0 means expired now', () => {
            expect(getTokenExpiration({ expires_in: 0 }, LIFETIME)).toEqual(new Date(NOW))
        })

        test.each([undefined, {}, { expires_in: null, expiration: null }, { expiration: 'garbage' }])(
            'default lifetime is assumed if nothing is usable: %p', (data) => {
                expect(getTokenExpiration(data, LIFETIME)).toEqual(new Date(NOW + LIFETIME))
            })
    })

    describe('ensureExpiration', () => {
        test('a valid date is kept', () => {
            const date = new Date(NOW + 1000)
            expect(ensureExpiration(date, LIFETIME)).toBe(date)
        })

        test.each([undefined, null, new Date('garbage')])('%p is replaced by the default lifetime', (value) => {
            expect(ensureExpiration(value, LIFETIME)).toEqual(new Date(NOW + LIFETIME))
        })
    })
})

describe('parseExpiration', () => {

    test.each([undefined, null, ''])('%p is treated as missing', (value) => {
        expect(parseExpiration(value)).toBeUndefined()
    })

    test('ISO date string', () => {
        expect(parseExpiration('2026-01-01T10:00:00.000Z')).toEqual(new Date('2026-01-01T10:00:00.000Z'))
    })

    test('epoch milliseconds as string (as sent by the auth-server)', () => {
        expect(parseExpiration(String(Date.UTC(2026, 0, 1, 10)))).toEqual(new Date('2026-01-01T10:00:00.000Z'))
    })

    test('epoch milliseconds as number', () => {
        expect(parseExpiration(Date.UTC(2026, 0, 1, 10))).toEqual(new Date('2026-01-01T10:00:00.000Z'))
    })

    test('epoch seconds as string and number (as used by the app APIs)', () => {
        const seconds = Date.UTC(2026, 0, 1, 10) / 1000
        expect(parseExpiration(String(seconds))).toEqual(new Date('2026-01-01T10:00:00.000Z'))
        expect(parseExpiration(seconds)).toEqual(new Date('2026-01-01T10:00:00.000Z'))
    })

    test.each(['garbage', '2026-13-45', Number.NaN])('invalid value %p is treated as missing instead of an invalid date', (value) => {
        expect(parseExpiration(value)).toBeUndefined()
    })

    // Everything that earlier app versions persisted for Strava was written with Date.toISOString().
    // The result must be identical to what `new Date(stored)` returned in those versions.
    test.each([
        '2024-01-01T00:00:00.000Z',
        '2025-06-30T12:34:56.789Z',
        '1999-12-31T23:59:59.999Z',
        '2030-02-28T00:00:00.000Z',
        new Date().toISOString(),
    ])('output of Date.toISOString() %s is parsed exactly like new Date()', (stored) => {
        expect(parseExpiration(stored)?.valueOf()).toBe(new Date(stored).valueOf())
    })

    test.each([
        '2024-01-01',
        '2024-01-01T10:00:00+01:00',
        '2024-01-01T10:00:00',
    ])('other date strings that new Date() accepts (%s) are parsed exactly like new Date()', (stored) => {
        expect(parseExpiration(stored)?.valueOf()).toBe(new Date(stored).valueOf())
    })
})
