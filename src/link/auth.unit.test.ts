import crypto from 'node:crypto'
import { getBindings } from '../api/bindings'
import type { ICryptoBinding } from '../api/crypto/types'
import {
    answerLinkAuthProbe, computeLinkClientProof, computeLinkKid, computeLinkServerProof, createLinkAuthProbe,
    createLinkNonce, deriveLinkSessionKey, verifyLinkAuthConfirm, verifyLinkAuthResult,
} from './auth'
import type { AuthResultBody, LinkAuthCandidate, LinkAuthClient } from './types'

// --- independent reference implementation (node:crypto only) ---
const b64u = (b: Buffer) => b.toString('base64url')
const raw = (s: string) => Buffer.from(s, 'base64url')
const refHmac = (secret: string, ...parts: Buffer[]) =>
    crypto.createHmac('sha256', raw(secret)).update(Buffer.concat(parts)).digest()

const SECRET_A = b64u(Buffer.alloc(32, 0xa1))
const SECRET_B = b64u(Buffer.alloc(32, 0xb2))
const SECRET_C = b64u(Buffer.alloc(32, 0xc3))
const NC = b64u(Buffer.from('00112233445566778899aabbccddeeff', 'hex'))
const NS = b64u(Buffer.from('ffeeddccbbaa99887766554433221100', 'hex'))
const LINK_A = 'link-a'
const LINK_B = 'link-b'

// deterministic stand-in for the platform's random source
let counter = 0
const deterministicRandom = (size: number) => Buffer.alloc(size, ++counter)

describe('link auth', () => {
    let savedCrypto: ICryptoBinding

    beforeEach(() => {
        counter = 0
        savedCrypto = getBindings().crypto
        getBindings().crypto = { createHmac: crypto.createHmac, randomBytes: jest.fn(deterministicRandom) } as unknown as ICryptoBinding
    })
    afterEach(() => {
        getBindings().crypto = savedCrypto
        jest.clearAllMocks()
    })

    describe('MAC vectors', () => {
        test('kid = trunc16(HMAC(secret, "kid" | nc))', () => {
            const expected = refHmac(SECRET_A, Buffer.from('kid'), raw(NC)).subarray(0, 16)
            expect(computeLinkKid(SECRET_A, NC)).toBe(b64u(expected))
            expect(raw(computeLinkKid(SECRET_A, NC)).length).toBe(16)
        })

        test('server proof = HMAC(secret, "server-proof" | nc | ns | linkId)', () => {
            const expected = refHmac(SECRET_A, Buffer.from('server-proof'), raw(NC), raw(NS), Buffer.from(LINK_A, 'utf8'))
            expect(computeLinkServerProof(SECRET_A, NC, NS, LINK_A)).toBe(b64u(expected))
        })

        test('client proof = HMAC(secret, "client-proof" | nc | ns)', () => {
            const expected = refHmac(SECRET_A, Buffer.from('client-proof'), raw(NC), raw(NS))
            expect(computeLinkClientProof(SECRET_A, NC, NS)).toBe(b64u(expected))
        })

        test('session key = HMAC(secret, "session" | nc | ns)', () => {
            const expected = refHmac(SECRET_A, Buffer.from('session'), raw(NC), raw(NS))
            expect(Buffer.from(deriveLinkSessionKey(SECRET_A, NC, NS)).equals(expected)).toBe(true)
        })

        test('fixed reference vectors', () => {
            // pinned so that an accidental change of the encoding breaks the build, not the field
            // (secret = 32 x 0xa1, nc = 00112233..ff, ns = ffeedd..00, linkId = 'link-a')
            expect(computeLinkKid(SECRET_A, NC)).toBe('48mtbmA6m5KYt1GrVm6VHg')
            expect(computeLinkServerProof(SECRET_A, NC, NS, LINK_A)).toBe('3oSbOp2NdHYBIt87WEHxgr0c49P2zfZpvqKy3k5Slso')
            expect(computeLinkClientProof(SECRET_A, NC, NS)).toBe('TTVsINe--Hrj-MKi7gUZNtlUBqOcoM0VOFkchdn8qx4')
            expect(b64u(Buffer.from(deriveLinkSessionKey(SECRET_A, NC, NS)))).toBe('keFsHcZspO-sNorDvmeufkbWP9gFid3Op6zPq98M8_E')
        })

        test('rejects malformed nonces and secrets', () => {
            expect(() => computeLinkKid(SECRET_A, b64u(Buffer.alloc(15)))).toThrow('nonce')
            expect(() => computeLinkKid('', NC)).toThrow('secret')
            expect(() => computeLinkKid('not+base64', NC)).toThrow('secret')
        })
    })

    describe('createLinkNonce', () => {
        test('returns 16 bytes from the crypto binding', () => {
            expect(raw(createLinkNonce()).equals(Buffer.alloc(16, 1))).toBe(true)
            expect(getBindings().crypto.randomBytes).toHaveBeenCalledWith(16)
        })
    })

    describe('createLinkAuthProbe', () => {
        const candidates: LinkAuthCandidate[] = [{ linkId: LINK_A, secret: SECRET_A }, { linkId: LINK_B, secret: SECRET_B }]

        test('derives one kid per candidate from a fresh nonce', () => {
            const { body, state } = createLinkAuthProbe(candidates)
            expect(raw(body.nc).length).toBe(16)
            expect(body.kids).toEqual([computeLinkKid(SECRET_A, body.nc), computeLinkKid(SECRET_B, body.nc)])
            expect(state).toEqual({ nc: body.nc, candidates })
        })

        test('two probes for the same computer are unlinkable', () => {
            const first = createLinkAuthProbe([candidates[0]]).body
            const second = createLinkAuthProbe([candidates[0]]).body
            expect(first.nc).not.toBe(second.nc)
            expect(first.kids[0]).not.toBe(second.kids[0])
        })

        test('never puts the secret or linkId on the wire', () => {
            const { body } = createLinkAuthProbe(candidates)
            const wire = JSON.stringify(body)
            for (const value of [SECRET_A, SECRET_B, LINK_A, LINK_B])
                expect(wire).not.toContain(value)
        })

        test('rejects an empty candidate list', () => {
            expect(() => createLinkAuthProbe([])).toThrow()
        })
    })

    describe('answerLinkAuthProbe', () => {
        const clients: LinkAuthClient[] = [{ clientId: 'phone-1', secret: SECRET_A }, { clientId: 'phone-2', secret: SECRET_B }]

        test('matches a single kid', () => {
            const probe = { nc: NC, kids: [computeLinkKid(SECRET_B, NC)] }
            const { body, state } = answerLinkAuthProbe(probe, clients, LINK_A)
            expect(body.ok).toBe(true)
            if (!body.ok) return
            expect(body.j).toBe(0)
            expect(raw(body.ns).length).toBe(16)
            expect(body.proof).toBe(computeLinkServerProof(SECRET_B, NC, body.ns, LINK_A))
            expect(state).toEqual({ clientId: 'phone-2', secret: SECRET_B, nc: NC, ns: body.ns })
        })

        test('matches the right kid among several paired computers in one probe', () => {
            const probe = { nc: NC, kids: [computeLinkKid(SECRET_C, NC), computeLinkKid(SECRET_A, NC)] }
            const { body, state } = answerLinkAuthProbe(probe, clients, LINK_A)
            expect(body).toMatchObject({ ok: true, j: 1 })
            expect(state?.clientId).toBe('phone-1')
        })

        test('wrong secret gets a bare ok:false', () => {
            const probe = { nc: NC, kids: [computeLinkKid(SECRET_C, NC)] }
            const result = answerLinkAuthProbe(probe, clients, LINK_A)
            expect(result).toEqual({ body: { ok: false } })
            expect(Object.keys(result.body)).toEqual(['ok'])
        })

        test('a kid computed for another nonce does not match', () => {
            const otherNc = b64u(Buffer.alloc(16, 7))
            const probe = { nc: NC, kids: [computeLinkKid(SECRET_A, otherNc)] }
            expect(answerLinkAuthProbe(probe, clients, LINK_A).body).toEqual({ ok: false })
        })

        test('malformed probes get a bare ok:false', () => {
            const kid = computeLinkKid(SECRET_A, NC)
            const probes = [
                { nc: 'short', kids: [kid] },
                { nc: NC, kids: [] },
                { nc: NC, kids: ['abc'] },
                { nc: NC, kids: Array.from({ length: 33 }, () => kid) },
                { nc: NC },
                null,
            ]
            for (const probe of probes)
                expect(answerLinkAuthProbe(probe as never, clients, LINK_A)).toEqual({ body: { ok: false } })
        })

        test('skips clients with an unusable stored secret', () => {
            const probe = { nc: NC, kids: [computeLinkKid(SECRET_A, NC)] }
            const result = answerLinkAuthProbe(probe, [{ clientId: 'broken', secret: '' }, ...clients], LINK_A)
            expect(result.state?.clientId).toBe('phone-1')
        })

        test('no paired clients gets ok:false', () => {
            const probe = { nc: NC, kids: [computeLinkKid(SECRET_A, NC)] }
            expect(answerLinkAuthProbe(probe, [], LINK_A).body).toEqual({ ok: false })
        })
    })

    describe('verifyLinkAuthResult', () => {
        const state = { nc: NC, candidates: [{ linkId: LINK_A, secret: SECRET_A }, { linkId: LINK_B, secret: SECRET_B }] }
        const resultFor = (j: number, secret: string, linkId: string): AuthResultBody =>
            ({ ok: true, j, ns: NS, proof: computeLinkServerProof(secret, NC, NS, linkId) })

        test('accepts the proof of the matched candidate and returns confirm and session key', () => {
            const outcome = verifyLinkAuthResult(resultFor(1, SECRET_B, LINK_B), state)
            expect(outcome.ok).toBe(true)
            if (!outcome.ok) return
            expect(outcome.candidate.linkId).toBe(LINK_B)
            expect(outcome.confirm).toEqual({ proof: computeLinkClientProof(SECRET_B, NC, NS) })
            expect(Buffer.from(outcome.sessionKey).equals(Buffer.from(deriveLinkSessionKey(SECRET_B, NC, NS)))).toBe(true)
        })

        test('rejects a proof for another linkId (right secret, wrong computer)', () => {
            expect(verifyLinkAuthResult(resultFor(0, SECRET_A, LINK_B), state)).toEqual({ ok: false })
        })

        test('rejects a proof made with another secret', () => {
            expect(verifyLinkAuthResult(resultFor(0, SECRET_C, LINK_A), state)).toEqual({ ok: false })
        })

        test('rejects a replayed auth-result from an earlier probe', () => {
            const recorded = resultFor(0, SECRET_A, LINK_A)
            const fresh = { ...state, nc: b64u(Buffer.alloc(16, 9)) }
            expect(verifyLinkAuthResult(recorded, fresh)).toEqual({ ok: false })
        })

        test('rejects ok:false, bad index and malformed fields', () => {
            const good = resultFor(0, SECRET_A, LINK_A)
            const results = [
                { ok: false },
                { ...good, j: 2 },
                { ...good, j: -1 },
                { ...good, j: 0.5 },
                { ...good, ns: 'short' },
                { ...good, proof: '+++' },
                null,
            ]
            for (const result of results)
                expect(verifyLinkAuthResult(result as never, state)).toEqual({ ok: false })
        })
    })

    describe('verifyLinkAuthConfirm', () => {
        const state = { clientId: 'phone-1', secret: SECRET_A, nc: NC, ns: NS }

        test('accepts the client proof and returns the session key', () => {
            const key = verifyLinkAuthConfirm({ proof: computeLinkClientProof(SECRET_A, NC, NS) }, state)
            expect(key && Buffer.from(key).equals(Buffer.from(deriveLinkSessionKey(SECRET_A, NC, NS)))).toBe(true)
        })

        test('rejects a proof made with a wrong secret', () => {
            expect(verifyLinkAuthConfirm({ proof: computeLinkClientProof(SECRET_B, NC, NS) }, state)).toBeUndefined()
        })

        test('rejects a replayed auth-confirm from an earlier session', () => {
            const recorded = { proof: computeLinkClientProof(SECRET_A, NC, NS) }
            expect(verifyLinkAuthConfirm(recorded, { ...state, ns: b64u(Buffer.alloc(16, 5)) })).toBeUndefined()
        })

        test('does not accept the server proof as client proof', () => {
            expect(verifyLinkAuthConfirm({ proof: computeLinkServerProof(SECRET_A, NC, NS, '') }, state)).toBeUndefined()
        })

        test('rejects malformed bodies', () => {
            expect(verifyLinkAuthConfirm({ proof: '' }, state)).toBeUndefined()
            expect(verifyLinkAuthConfirm({} as never, state)).toBeUndefined()
            expect(verifyLinkAuthConfirm(null as never, state)).toBeUndefined()
        })
    })

    describe('full exchange', () => {
        test('phone and desktop derive the same session key for the matching computer', () => {
            const phone = createLinkAuthProbe([{ linkId: LINK_B, secret: SECRET_B }, { linkId: LINK_A, secret: SECRET_A }])
            const desktop = answerLinkAuthProbe(phone.body, [{ clientId: 'phone-1', secret: SECRET_A }], LINK_A)
            const outcome = verifyLinkAuthResult(desktop.body, phone.state)
            expect(outcome.ok).toBe(true)
            if (!outcome.ok || !desktop.state) return
            expect(outcome.candidate.linkId).toBe(LINK_A)
            const desktopKey = verifyLinkAuthConfirm(outcome.confirm, desktop.state)
            expect(desktopKey && Buffer.from(desktopKey).equals(Buffer.from(outcome.sessionKey))).toBe(true)
        })
    })
})
