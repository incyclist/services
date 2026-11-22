import { LINK_MIN_NATIVE_VERSION, meetsNativeVersion } from './native-requirements'

describe('meetsNativeVersion', () => {
    const min = { ios: '1.8.0', android: '1.9.2' }

    test.each([
        ['ios', '1.7.9', false], ['ios', '1.8.0', true], ['ios', '1.8.1', true], ['ios', '2.0.0', true], ['ios', '1.10.0', true],
        ['android', '1.9.1', false], ['android', '1.9.2', true], ['android', '1.10.0', true], ['android', '1.8.0', false],
    ] as const)('%s %s -> %p', (platform, version, expected) => {
        expect(meetsNativeVersion(platform, version, min)).toBe(expected)
    })

    test('two-part versions are compared as x.y.0', () => {
        expect(meetsNativeVersion('ios', '1.8', min)).toBe(true)
        expect(meetsNativeVersion('ios', '1.7', min)).toBe(false)
    })

    test('undefined minimum fails closed, per platform', () => {
        expect(meetsNativeVersion('ios', '99.0.0', { ios: undefined, android: '1.0.0' })).toBe(false)
        expect(meetsNativeVersion('android', '99.0.0', { ios: undefined, android: '1.0.0' })).toBe(true)
    })

    test('unreadable minimum fails closed', () => {
        expect(meetsNativeVersion('ios', '2.0.0', { ios: 'soon', android: undefined })).toBe(false)
    })

    test.each([undefined, null, 5, '', ' ', 'abc', '1.x.0', '1.8.0-beta.1', 'v1.8.0', '1.8.0.1'])('unreadable installed version %p fails closed', (v) => {
        expect(meetsNativeVersion('ios', v, min)).toBe(false)
    })

    test('unknown platform fails closed', () => {
        expect(meetsNativeVersion('other', '99.0.0', { ios: '1.0.0', android: '1.0.0' })).toBe(false)
    })

    test('ships with both thresholds unreleased', () => {
        expect(LINK_MIN_NATIVE_VERSION).toEqual({ ios: undefined, android: undefined })
        expect(meetsNativeVersion('ios', '99.0.0')).toBe(false)
        expect(meetsNativeVersion('android', '99.0.0')).toBe(false)
    })
})
