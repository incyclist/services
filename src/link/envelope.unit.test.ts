import crypto from 'node:crypto'
import { getBindings } from '../api/bindings'
import type { ICryptoBinding } from '../api/crypto/types'
import { computeLinkFrameMac, decodeLinkEnvelope, encodeLinkEnvelope, signLinkEnvelope, verifyLinkEnvelope } from './envelope'
import type { LinkEnvelope } from './types'

const KEY = Buffer.alloc(32, 0x5a)

// independent reference: HMAC over the canonical JSON array [dir, s, t, id|null, b] with sorted keys
const refMac = (input: string) => crypto.createHmac('sha256', KEY).update(Buffer.from(input, 'utf8')).digest('base64url')

describe('link envelope', () => {
    let savedCrypto: ICryptoBinding

    beforeAll(() => {
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
    })
    afterAll(() => {
        getBindings().crypto = savedCrypto
    })

    describe('encodeLinkEnvelope', () => {
        test('serialises to JSON and omits undefined fields', () => {
            expect(encodeLinkEnvelope({ t: 'ping', s: 1, id: undefined, b: {} })).toBe('{"t":"ping","s":1,"b":{}}')
        })
    })

    describe('decodeLinkEnvelope', () => {
        test('round-trips an envelope', () => {
            const env: LinkEnvelope = { t: 'echo', s: 7, id: 'r1', b: { data: [1, 'x'] }, m: 'abc' }
            expect(decodeLinkEnvelope(encodeLinkEnvelope(env))).toEqual({ ok: true, envelope: env })
        })

        test('accepts the largest u32 sequence number', () => {
            expect(decodeLinkEnvelope('{"t":"x","s":4294967295,"b":null}').ok).toBe(true)
        })

        test.each([
            ['invalid JSON', '{"t":'],
            ['empty payload', ''],
            ['array', '[1]'],
            ['null', 'null'],
            ['missing t', '{"s":1,"b":{}}'],
            ['empty t', '{"t":"","s":1,"b":{}}'],
            ['non-string t', '{"t":1,"s":1,"b":{}}'],
            ['missing s', '{"t":"x","b":{}}'],
            ['negative s', '{"t":"x","s":-1,"b":{}}'],
            ['fractional s', '{"t":"x","s":1.5,"b":{}}'],
            ['s above u32', '{"t":"x","s":4294967296,"b":{}}'],
            ['string s', '{"t":"x","s":"1","b":{}}'],
            ['missing b', '{"t":"x","s":1}'],
            ['non-string id', '{"t":"x","s":1,"b":{},"id":3}'],
            ['non-string m', '{"t":"x","s":1,"b":{},"m":{}}'],
        ])('rejects %s', (_name, payload) => {
            expect(decodeLinkEnvelope(payload)).toEqual({ ok: false, reason: 'malformed' })
        })
    })

    describe('computeLinkFrameMac', () => {
        test('matches the reference vector with id', () => {
            const env: LinkEnvelope = { t: 'echo', s: 3, id: 'r1', b: { z: 1, a: { y: 'é', x: [true] } } }
            expect(computeLinkFrameMac(KEY, 'c2s', env)).toBe(refMac('["c2s",3,"echo","r1",{"a":{"x":[true],"y":"é"},"z":1}]'))
        })

        test('matches the reference vector without id', () => {
            const env: LinkEnvelope = { t: 'pong', s: 12, b: {} }
            expect(computeLinkFrameMac(KEY, 's2c', env)).toBe(refMac('["s2c",12,"pong",null,{}]'))
        })

        test('fixed reference vector', () => {
            // pinned so that an accidental change of the MAC input encoding breaks the build
            expect(computeLinkFrameMac(KEY, 's2c', { t: 'pong', s: 12, b: {} })).toBe('UbDT54SagFs55yZFMgvdIYBetXm4D1CJEyPtRz6mdQU')
        })

        test('binds the direction', () => {
            const env: LinkEnvelope = { t: 'ping', s: 1, b: {} }
            expect(computeLinkFrameMac(KEY, 'c2s', env)).not.toBe(computeLinkFrameMac(KEY, 's2c', env))
        })

        test('ignores an existing m and key order of the body', () => {
            const a = computeLinkFrameMac(KEY, 'c2s', { t: 'x', s: 1, b: { a: 1, b: 2 }, m: 'old' })
            expect(computeLinkFrameMac(KEY, 'c2s', { t: 'x', s: 1, b: { b: 2, a: 1 } })).toBe(a)
        })
    })

    describe('signLinkEnvelope', () => {
        test('adds the MAC without changing the input', () => {
            const env: LinkEnvelope = { t: 'ping', s: 1, b: {}, m: 'stale' }
            const signed = signLinkEnvelope(KEY, 'c2s', env)
            expect(signed.m).toBe(computeLinkFrameMac(KEY, 'c2s', env))
            expect(env.m).toBe('stale')
        })
    })

    describe('verifyLinkEnvelope', () => {
        // MAC precomputed independently with node:crypto, so the table below can be built at collection time
        const sessionEnv = { t: 'session', s: 2, b: { mediaPort: 8080, capabilities: ['a'] } }
        const signed: LinkEnvelope = { ...sessionEnv, m: refMac('["s2c",2,"session",null,{"capabilities":["a"],"mediaPort":8080}]') }

        test('signLinkEnvelope agrees with the precomputed MAC', () => {
            expect(signLinkEnvelope(KEY, 's2c', sessionEnv)).toEqual(signed)
        })

        test('accepts a signed frame after a JSON round trip with reordered keys', () => {
            const wire = '{"m":"' + signed.m + '","b":{"capabilities":["a"],"mediaPort":8080},"s":2,"t":"session"}'
            const decoded = decodeLinkEnvelope(wire)
            expect(decoded.ok && verifyLinkEnvelope(KEY, 's2c', decoded.envelope)).toBe(true)
        })

        test.each([
            ['tampered body', { ...signed, b: { mediaPort: 8081, capabilities: ['a'] } }],
            ['tampered s', { ...signed, s: 3 }],
            ['tampered t', { ...signed, t: 'pong' }],
            ['added id', { ...signed, id: 'x' }],
            ['missing m', { ...signed, m: undefined }],
            ['empty m', { ...signed, m: '' }],
            ['malformed m', { ...signed, m: '***' }],
        ])('rejects %s', (_name, env) => {
            expect(verifyLinkEnvelope(KEY, 's2c', env as LinkEnvelope)).toBe(false)
        })

        test('rejects a frame reflected in the other direction', () => {
            expect(verifyLinkEnvelope(KEY, 'c2s', signed)).toBe(false)
        })

        test('rejects a frame signed with another key', () => {
            expect(verifyLinkEnvelope(Buffer.alloc(32, 1), 's2c', signed)).toBe(false)
        })
    })
})
