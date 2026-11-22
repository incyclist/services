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
