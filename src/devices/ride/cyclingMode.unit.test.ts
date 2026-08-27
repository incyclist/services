import { getLoadButtonMode, isVirtualShiftingEnabled } from './cyclingMode'

// Minimal CyclingMode-shaped stub - only the methods getLoadButtonMode()/isVirtualShiftingEnabled()
// actually read.
const makeMode = (props: { isERG?: boolean, isSIM?: boolean, isResistance?: boolean, virtshift?: string }): any => ({
    isERG: () => !!props.isERG,
    isSIM: () => !!props.isSIM,
    isResistance: () => !!props.isResistance,
    getSetting: (key: string) => (key === 'virtshift' ? props.virtshift : undefined),
})

// getLoadButtonMode()'s rule table: isERG() => power, isSIM() && isVirtualShiftingEnabled() =>
// gear, isResistance() => gear, everything else => hidden.
describe('getLoadButtonMode', () => {
    test('no mode/device active yet -> power', () => {
        expect(getLoadButtonMode(undefined as any)).toBe('power')
    })

    test('ERG mode -> power', () => {
        expect(getLoadButtonMode(makeMode({ isERG: true }))).toBe('power')
    })

    test.each(['Mixed', 'Incyclist', 'SmartTrainer', 'Enabled'])('SIM mode with virtshift=%s -> gear', (virtshift) => {
        expect(getLoadButtonMode(makeMode({ isSIM: true, virtshift }))).toBe('gear')
    })

    test('SIM mode with virtshift disabled -> hidden', () => {
        expect(getLoadButtonMode(makeMode({ isSIM: true, virtshift: 'Disabled' }))).toBe('hidden')
    })

    test('SIM mode with no virtshift setting at all -> hidden', () => {
        expect(getLoadButtonMode(makeMode({ isSIM: true }))).toBe('hidden')
    })

    test('Resistance mode -> gear unconditionally (not gated on isVirtualShiftingEnabled)', () => {
        expect(getLoadButtonMode(makeMode({ isResistance: true }))).toBe('gear')
    })

    // Covers PowerMeter (power/cadence read straight from the device, nothing controllable) and
    // any other mode that is neither ERG, SIM, nor Resistance (e.g. Daum Classic, Rower,
    // SpeedSensor).
    test('mode that is neither ERG, SIM, nor Resistance -> hidden', () => {
        expect(getLoadButtonMode(makeMode({}))).toBe('hidden')
    })
})

describe('isVirtualShiftingEnabled', () => {
    test('a mode that is neither SIM nor Resistance -> false', () => {
        expect(isVirtualShiftingEnabled(makeMode({}))).toBe(false)
    })
})
