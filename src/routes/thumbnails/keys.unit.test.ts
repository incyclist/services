import { getKeys, hash, isCacheableUrl } from './keys'

describe('keys', () => {
    describe('isCacheableUrl', () => {
        test('accepts http and https only', () => {
            expect(isCacheableUrl('https://a/b.jpg')).toBe(true)
            expect(isCacheableUrl('http://a/b.jpg')).toBe(true)
            expect(isCacheableUrl('file:///a.jpg')).toBe(false)
            expect(isCacheableUrl('video:///a.jpg')).toBe(false)
            expect(isCacheableUrl(undefined)).toBe(false)
        })
    })

    describe('hash', () => {
        test('is stable and distinguishes inputs', () => {
            expect(hash('a')).toBe(hash('a'))
            expect(hash('a')).not.toBe(hash('b'))
            expect(hash('a')).toHaveLength(8)
        })
    })

    describe('getKeys', () => {
        test('url key depends on route and url', () => {
            const a = getKeys({ routeKey: 'r1', url: 'https://a/1.jpg' })
            const b = getKeys({ routeKey: 'r1', url: 'https://a/2.jpg' })
            expect(a).toHaveLength(1)
            expect(a[0]).not.toBe(b[0])
        })

        test('keys are safe file names', () => {
            const [k] = getKeys({ routeKey: 'x/../y:z', url: 'https://a/1.jpg' })
            expect(k).toMatch(/^[A-Za-z0-9_-]+$/)
        })

        test('computer key never contains handle or token', () => {
            const keys = getKeys({ routeKey: 'r1', link: { linkId: 'L', thumbHandle: 'handle123' } })
            expect(keys).toHaveLength(1)
            expect(keys[0]).not.toContain('handle123')
        })

        test('computer key is independent of the handle', () => {
            const a = getKeys({ routeKey: 'r1', link: { linkId: 'L', thumbHandle: 'h1' } })
            const b = getKeys({ routeKey: 'r1', link: { linkId: 'M', thumbHandle: 'h2' } })
            expect(a).toEqual(b)
        })

        test('no key without a cacheable source', () => {
            expect(getKeys({ routeKey: 'r1', url: 'file:///a.jpg' })).toEqual([])
            expect(getKeys({ url: 'https://a' }).length).toBe(1)
            expect(getKeys({ link: { linkId: 'L', thumbHandle: 'h' } })).toEqual([])
        })

        test('url and computer sources give url key first', () => {
            expect(getKeys({ routeKey: 'r1', url: 'https://a/1.jpg', link: { linkId: 'L', thumbHandle: 'h' } })).toHaveLength(2)
        })
    })
})
