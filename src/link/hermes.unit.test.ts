import crypto from 'node:crypto'
import { simulateHermesBuffer } from '../../__tests__/utils/hermesBuffer'
import { getBindings } from '../api/bindings'
import type { ICryptoBinding } from '../api/crypto/types'
import { answerLinkAuthProbe, createLinkAuthProbe, verifyLinkAuthConfirm, verifyLinkAuthResult } from './auth'
import { LinkClientChannel, LinkServerChannel } from './channel'
import { LinkFrameReader, encodeLinkFrame, encodeLinkPreamble } from './framing'
import { fromBase64Url, hmacSha256, sha256Base64Url, toBase64Url } from './utils'
import { randomInt } from './host/utils'

const SECRET = Buffer.alloc(32, 0xa1).toString('base64url')

describe('local-link core on Hermes (Buffer#subarray/slice return a plain Uint8Array)', () => {
    let restore: () => void
    let savedCrypto: ICryptoBinding

    beforeEach(() => {
        savedCrypto = getBindings().crypto
        getBindings().crypto = { createHmac: crypto.createHmac, createHash: crypto.createHash, randomBytes: crypto.randomBytes } as unknown as ICryptoBinding
        restore = simulateHermesBuffer()
    })
    afterEach(() => {
        restore()
        getBindings().crypto = savedCrypto
    })

    test('base64url and hmac helpers', () => {
        expect(toBase64Url(Uint8Array.of(251, 255, 1))).toBe('-_8B')
        expect(fromBase64Url('-_8B')?.[0]).toBe(251)
        expect(hmacSha256(Uint8Array.of(1), Uint8Array.of(2)).length).toBe(32)
        expect(sha256Base64Url('abc')).toHaveLength(43)
        expect(randomInt(10)).toBeLessThan(10)
    })

    test('full handshake and signed message exchange over the stream reader', () => {
        const probe = createLinkAuthProbe([{ secret: SECRET, linkId: 'link-1' }])
        expect(Buffer.from(fromBase64Url(probe.body.kids[0])!)).toHaveLength(16)

        const answer = answerLinkAuthProbe(probe.body, [{ clientId: 'c1', secret: SECRET }], 'link-1')
        expect(answer.body.ok).toBe(true)
        const outcome = verifyLinkAuthResult(answer.body as never, probe.state)
        expect(outcome.ok).toBe(true)
        if (!outcome.ok || !answer.state)
            return
        const serverKey = verifyLinkAuthConfirm(outcome.confirm, answer.state)
        expect(serverKey).toBeDefined()

        const client = new LinkClientChannel()
        const server = new LinkServerChannel()
        client.establish(outcome.sessionKey)
        server.establish(serverKey!)

        const reader = new LinkFrameReader({ preamble: { maxVersion: 1 } })
        const wire = Buffer.concat([encodeLinkPreamble(), encodeLinkFrame(client.encode('ping', {}, 'p1'))])
        const events = reader.push(wire)
        expect(events.map(e => e.type)).toEqual(['preamble', 'frame'])
        const frame = events[1] as { payload: string }
        expect(server.decode(frame.payload)).toMatchObject({ ok: true, message: { t: 'ping' } })
    })
})
