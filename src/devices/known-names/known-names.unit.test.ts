import { KNOWN_DEVICE_NAMES } from './known-device-names'
import { getKnownDeviceNames } from './service'
import { getNameParts, isKnownDeviceName, matchesNamePart } from './matching'

describe('getNameParts', () => {
    test('drops serial numbers and MAC fragments', () => {
        expect(getNameParts('VANRYSEL-HT-c4d1')).toEqual(['vanrysel'])
        expect(getNameParts('Tacx Flux-2 30485')).toEqual(['tacx', 'flux'])
        expect(getNameParts('KICKR CORE 4D13')).toEqual(['kickr', 'core'])
        expect(getNameParts('H6M 58398')).toEqual(['h6m'])
        expect(getNameParts('HRMPro+:329608')).toEqual(['hrmpro'])
    })

    test('cuts a serial number that is glued to the name', () => {
        expect(getNameParts('AssiomaPRO12774R')).toEqual(['assiomapro'])
        expect(getNameParts('YESOUL2708033')).toEqual(['yesoul'])
        expect(getNameParts('D2Ride2121')).toEqual(['d2ride'])
    })

    test('copes with missing names', () => {
        expect(getNameParts(undefined)).toEqual([])
        expect(getNameParts('')).toEqual([])
    })
})

describe('matchesNamePart', () => {
    test('a plain entry matches an equal part only', () => {
        expect(matchesNamePart('hrm', 'hrm')).toBe(true)
        expect(matchesNamePart('hrm', 'hrm200')).toBe(false)
    })

    test('an entry ending with * is a family: it matches every part that starts with it', () => {
        expect(matchesNamePart('hrm*', 'hrm')).toBe(true)
        expect(matchesNamePart('hrm*', 'hrm200')).toBe(true)
        expect(matchesNamePart('hrm*', 'hrmpro')).toBe(true)
        expect(matchesNamePart('hrm*', 'xhrm')).toBe(false)
    })
})

describe('isKnownDeviceName', () => {
    const entries = ['tacx', 'hrm', 'assioma*']

    test('a part equal to an entry matches, in any position and spelling', () => {
        expect(isKnownDeviceName('Tacx Neo 2T', entries)).toBe(true)
        expect(isKnownDeviceName('Wahoo TACX', entries)).toBe(true)
        expect(isKnownDeviceName('Polar HRM-Dual:644478', entries)).toBe(true)
    })

    test('a plain entry only matches whole parts, a family the start of a part', () => {
        expect(isKnownDeviceName('HRMPro+', entries)).toBe(false)
        expect(isKnownDeviceName('Tacxx', entries)).toBe(false)
        expect(isKnownDeviceName('AssiomaPRO12774R', entries)).toBe(true)
        expect(isKnownDeviceName('NotAssioma', entries)).toBe(false)
    })

    test('other devices and missing names do not match', () => {
        expect(isKnownDeviceName('JBL PartyBox Club 120', entries)).toBe(false)
        expect(isKnownDeviceName(undefined, entries)).toBe(false)
    })
})

describe('the list that is shipped', () => {
    const { version, names } = KNOWN_DEVICE_NAMES

    test('has a version: a positive whole number, increased with every change of the list', () => {
        expect(Number.isInteger(version)).toBe(true)
        expect(version).toBeGreaterThanOrEqual(1)
    })

    test('is a list of lower case parts of at least 3 characters (a family: 3 before the *), without duplicates', () => {
        for (const entry of names) {
            expect(entry).toBe(entry.toLowerCase())
            expect(entry).toMatch(/^[a-z0-9]{3,}\*?$/)
        }
        expect(new Set(names).size).toBe(names.length)
    })

    test('has no redundant entries: nothing that a family of the list matches already', () => {
        const families = names.filter(e => e.endsWith('*'))
        const redundant = names.filter(entry => families.some(f => f !== entry && entry.replace('*', '').startsWith(f.slice(0, -1))))
        expect(redundant).toEqual([])
    })

    test('is sorted, so that a change shows up clearly in a review', () => {
        expect([...names]).toEqual([...names].sort())
    })

    test.each([
        'Tacx Flux-2 30485', 'KICKR CORE 4D13', 'Wahoo KICKR 7A07', 'Zwift Hub', 'Volt', 'HRM-Dual:644478', 'Polar H10 12345678',
        'ASSIOMA08675R', 'AssiomaPRO12774R', 'HRMPro+:329608', 'HRM200 1234', 'VANRYSEL-HT-c4d1', 'BkoolSmartPro2',
    ])('recognises the trainer or sensor %s', (name) => {
        expect(isKnownDeviceName(name)).toBe(true)
    })

    test.each([
        'JBL PartyBox Club 120', 'free@home', '1K1DA2502P1761', 'Galaxy Buds2 Pro LE', 'Smart TV Pro', 'Core300s',
    ])('does not recognise the noise device %s', (name) => {
        expect(isKnownDeviceName(name)).toBe(false)
    })
})

describe('getKnownDeviceNames', () => {
    test('returns the version and the names of the list', () => {
        const list = getKnownDeviceNames()
        expect(list.version).toBe(KNOWN_DEVICE_NAMES.version)
        expect(list.names).toEqual(KNOWN_DEVICE_NAMES.names)
    })

    test('returns a copy: changing it does not change the list', () => {
        const list = getKnownDeviceNames()
        list.names.push('hacked')
        list.version = 99

        expect(getKnownDeviceNames().names).not.toContain('hacked')
        expect(getKnownDeviceNames().version).toBe(KNOWN_DEVICE_NAMES.version)
    })
})
