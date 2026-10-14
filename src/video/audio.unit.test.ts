import { isAudibleRate, AUDIO_RATE_MIN, AUDIO_RATE_MAX } from './audio'

describe('isAudibleRate', () => {

    test('audible within the range, including the limits', () => {
        expect(isAudibleRate(1)).toBe(true)
        expect(isAudibleRate(AUDIO_RATE_MIN)).toBe(true)
        expect(isAudibleRate(AUDIO_RATE_MAX)).toBe(true)
    })

    test('muted below the minimum and above the maximum', () => {
        expect(isAudibleRate(0.4)).toBe(false)
        expect(isAudibleRate(2.1)).toBe(false)
    })

    test('once muted, stays muted until the rate is clearly back in range', () => {
        expect(isAudibleRate(0.52, false)).toBe(false)
        expect(isAudibleRate(0.56, false)).toBe(true)
        expect(isAudibleRate(1.9, false)).toBe(false)
        expect(isAudibleRate(1.75, false)).toBe(true)
    })

    test('paused or invalid rate keeps the previous state', () => {
        expect(isAudibleRate(0, true)).toBe(true)
        expect(isAudibleRate(0, false)).toBe(false)
        expect(isAudibleRate(Number.NaN, false)).toBe(false)
    })
})
