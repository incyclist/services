import { scrubError, scrubTokens } from './scrub'

describe('scrubTokens', () => {
    test('strips the query string of a URL', () => {
        expect(scrubTokens('http://192.168.1.5:6002/v/abc?t=SECRET')).toBe('http://192.168.1.5:6002/v/abc')
    })
    test('strips fragments and further parameters', () => {
        expect(scrubTokens('http://h/v/a?x=1&t=SECRET#frag')).toBe('http://h/v/a')
    })
    test('scrubs URLs inside an error message', () => {
        expect(scrubTokens('GET http://h:1/v/a?t=SECRET failed with 403 (http://h:1/t/b?t=S2)')).toBe('GET http://h:1/v/a failed with 403 (http://h:1/t/b)')
    })
    test('masks a bare t= parameter', () => {
        expect(scrubTokens('request /v/a?t=SECRET&x=1')).toBe('request /v/a?t=***&x=1')
    })
    test('leaves text without a token alone', () => {
        expect(scrubTokens('file:///d/a.mp4')).toBe('file:///d/a.mp4')
        expect(scrubTokens('plain text')).toBe('plain text')
    })
    test('non-strings pass through', () => {
        expect(scrubTokens(undefined)).toBeUndefined()
        expect(scrubTokens(5)).toBe(5)
    })
})

describe('scrubError', () => {
    test('returns an error with a scrubbed message', () => {
        const err = new TypeError('failed http://h/v/a?t=SECRET')
        const res = scrubError(err)
        expect(res.message).toBe('failed http://h/v/a')
        expect(res.name).toBe('TypeError')
        expect(err.message).toContain('SECRET')
    })
    test('returns the same error if nothing to scrub', () => {
        const err = new Error('boom')
        expect(scrubError(err)).toBe(err)
    })
})

describe('scrubTokens URL edge cases', () => {
    test.each([
        ['1http://a?x=1 z', '1http://a z'],
        ['xhttp://a#f)b', 'xhttp://a)b'],
        ['a://a://x y', 'a://a://x y'],
        ['a://a://x?q=1', 'a://a://x'],
        ['HTTP://H/p?Q=1 and ftp://x/y#z', 'HTTP://H/p and ftp://x/y'],
        ['a-b.c+d://h?q', 'a-b.c+d://h'],
        ['1a2b://h?q=1', '1a2b://h'],
        ['://x?y', '://x?y'],
        ['http://', 'http://'],
        ['http://?a', 'http://'],
        ['a://x"?q', 'a://x"?q'],
    ])('%s', (input, expected) => {
        expect(scrubTokens(input)).toBe(expected)
    })

    test('worst-case inputs are scrubbed in linear time', () => {
        const inputs = ['a'.repeat(200000), 'a1'.repeat(100000), 'a://'.repeat(50000), `${'a://'.repeat(50000)} x`]
        const start = Date.now()
        for (const input of inputs)
            expect(scrubTokens(input)).toBe(input)
        expect(Date.now() - start).toBeLessThan(2000)
    })
})
