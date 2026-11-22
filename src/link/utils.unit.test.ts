import crypto from 'node:crypto'
import { getBindings } from '../api/bindings'
import type { ICryptoBinding } from '../api/crypto/types'
import { canonicalJson, fromBase64Url, getLinkCrypto, hmacSha256, timingSafeEqual, toBase64Url } from './utils'

describe('link utils', () => {
    let savedCrypto: ICryptoBinding

    beforeAll(() => {
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
    })
    afterAll(() => {
        getBindings().crypto = savedCrypto
    })

    describe('toBase64Url', () => {
        test('encodes without padding and with url-safe alphabet', () => {
            const bytes = Buffer.from([0xfb, 0xff, 0xbf, 0x01])
            expect(toBase64Url(bytes)).toBe(bytes.toString('base64url'))
            expect(toBase64Url(bytes)).not.toMatch(/[+/=]/)
        })

        test('encodes the empty array', () => {
            expect(toBase64Url(new Uint8Array(0))).toBe('')
        })
    })

    describe('fromBase64Url', () => {
        test('round-trips every length', () => {
            for (let len = 0; len < 40; len++) {
                const bytes = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff))
                expect(fromBase64Url(toBase64Url(bytes))?.equals(bytes)).toBe(true)
            }
        })

        test('rejects non-base64url input', () => {
            expect(fromBase64Url('ab+c')).toBeUndefined()
            expect(fromBase64Url('ab/c')).toBeUndefined()
            expect(fromBase64Url('abc=')).toBeUndefined()
            expect(fromBase64Url('abcde')).toBeUndefined()
            expect(fromBase64Url(42)).toBeUndefined()
            expect(fromBase64Url(undefined)).toBeUndefined()
        })
    })

    describe('timingSafeEqual', () => {
        test('compares content', () => {
            expect(timingSafeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true)
            expect(timingSafeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false)
        })

        test('returns false for different lengths', () => {
            expect(timingSafeEqual(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false)
        })
    })

    describe('canonicalJson', () => {
        test('sorts keys recursively and drops whitespace', () => {
            const value = { b: 1, a: { d: [3, { z: true, y: null }], c: 'x' } }
            expect(canonicalJson(value)).toBe('{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}')
        })

        test('is independent of insertion order', () => {
            expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }))
        })

        test('sorts by UTF-16 code units, not locale', () => {
            expect(canonicalJson({ b: 1, B: 2, a: 3, 'ä': 4 })).toBe('{"B":2,"a":3,"b":1,"ä":4}')
        })

        test('follows JSON.stringify semantics for edge values', () => {
            const value = { u: undefined, f: () => 1, n: Number.NaN, i: Infinity, arr: [undefined, () => 1], d: new Date(0), s: 'q"\n' }
            expect(canonicalJson(value)).toBe('{"arr":[null,null],"d":"1970-01-01T00:00:00.000Z","i":null,"n":null,"s":"q\\"\\n"}')
            expect(canonicalJson(undefined)).toBe('null')
        })

        test('equals the canonical form of its own JSON round trip', () => {
            const value = { t: 'x', b: { list: [1.5, -0, 1e21, 'é'], nested: { k: undefined, j: false } } }
            expect(canonicalJson(JSON.parse(JSON.stringify(value)))).toBe(canonicalJson(value))
        })
    })

    describe('getLinkCrypto', () => {
        test('throws without crypto binding', () => {
            getBindings().crypto = undefined as unknown as ICryptoBinding
            try {
                expect(() => getLinkCrypto()).toThrow('crypto binding')
            }
            finally {
                getBindings().crypto = crypto as unknown as ICryptoBinding
            }
        })
    })

    describe('hmacSha256', () => {
        test('hashes the concatenation of all parts', () => {
            const key = Buffer.from('key')
            const expected = crypto.createHmac('sha256', key).update('abcdef').digest()
            expect(hmacSha256(key, Buffer.from('ab'), Buffer.from('cd'), Buffer.from('ef')).equals(expected)).toBe(true)
        })
    })
})
