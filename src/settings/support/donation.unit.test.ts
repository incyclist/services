import { getDonationChannels, getDonationMode } from './donation'

describe('getDonationMode', () => {
    const withOS = (getOS: () => unknown) => ({ appInfo: { getOS } }) as never

    test('ios uses website mode', () => {
        expect(getDonationMode(withOS(() => ({ platform: 'ios' })))).toBe('website')
    })

    test.each(['android', 'darwin', 'win32', 'linux'])('%s uses direct mode', (platform) => {
        expect(getDonationMode(withOS(() => ({ platform })))).toBe('direct')
    })

    test('missing OS uses direct mode', () => {
        expect(getDonationMode(withOS(() => undefined))).toBe('direct')
        expect(getDonationMode({} as never)).toBe('direct')
    })

    test('getOS throwing uses direct mode', () => {
        expect(getDonationMode(withOS(() => { throw new Error('x') }))).toBe('direct')
    })
})

describe('getDonationChannels', () => {
    afterEach(() => {
        delete process.env.SPONSOR_URL
    })

    test('PayPal is primary, followed by GitHub Sponsors', () => {
        const ch = getDonationChannels()
        expect(ch.map(c => c.id)).toEqual(['paypal', 'github-sponsors'])
        expect(ch.map(c => c.primary)).toEqual([true, false])
        expect(ch[1].url).toBe('https://github.com/sponsors/incyclist')
    })

    test('urls can be overridden', () => {
        process.env.SPONSOR_URL = 'https://example.com/s'
        expect(getDonationChannels()[1].url).toBe('https://example.com/s')
    })
})
