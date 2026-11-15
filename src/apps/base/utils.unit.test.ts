import { parseExpiration } from './utils'

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
