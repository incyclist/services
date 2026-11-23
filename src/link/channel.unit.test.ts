import crypto from 'node:crypto'
import { getBindings } from '../api/bindings'
import type { ICryptoBinding } from '../api/crypto/types'
import { answerLinkAuthProbe, createLinkAuthProbe, verifyLinkAuthConfirm, verifyLinkAuthResult } from './auth'
import { LinkClientChannel, LinkServerChannel } from './channel'
import { LINK_CLIENT_MESSAGE_TYPES, LINK_MAX_SEQ, LINK_SERVER_MESSAGE_TYPES } from './consts'
import { computeLinkFrameMac, decodeLinkEnvelope, encodeLinkEnvelope } from './envelope'
import { LinkFrameReader, encodeLinkFrame, encodeLinkPreamble } from './framing'
import { negotiateLinkHello } from './version'
import type { LinkClientMessageType, LinkEnvelope, LinkServerMessageType } from './types'

const KEY = Buffer.alloc(32, 0x42)
const SECRET = Buffer.alloc(32, 0x17).toString('base64url')

let counter = 0
const deterministicRandom = (size: number) => Buffer.alloc(size, ++counter)

const withMac = (env: LinkEnvelope, dir: 'c2s' | 's2c', key: Uint8Array = KEY) =>
    encodeLinkEnvelope({ ...env, m: computeLinkFrameMac(key, dir, env) })

describe('link channel', () => {
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

    test('message type lists cover every message type', () => {
        // compile-time: adding a type to the body maps without listing it here fails typecheck
        const client: Record<LinkClientMessageType, true> = {
            'hello': true, 'pair-request': true, 'pair-verify': true, 'auth': true, 'auth-confirm': true, 'ping': true, 'echo': true, 'route-descriptor': true,
        }
        const server: Record<LinkServerMessageType, true> = {
            'hello': true, 'error': true, 'pending': true, 'paired': true, 'pair-failed': true, 'auth-result': true,
            'session': true, 'catalog-changed': true, 'pong': true, 'echo': true, 'route-descriptor': true,
        }
        expect([...LINK_CLIENT_MESSAGE_TYPES].sort()).toEqual(Object.keys(client).sort())
        expect([...LINK_SERVER_MESSAGE_TYPES].sort()).toEqual(Object.keys(server).sort())
    })

    describe('encode', () => {
        test('numbers frames from 1 and sends them unsigned before establish', () => {
            const channel = new LinkClientChannel()
            expect(JSON.parse(channel.encode('hello', { role: 'client', protocol: { min: { major: 1, minor: 0 }, max: { major: 1, minor: 0 } } })))
                .toEqual({ t: 'hello', s: 1, b: { role: 'client', protocol: { min: { major: 1, minor: 0 }, max: { major: 1, minor: 0 } } } })
            expect(JSON.parse(channel.encode('pair-request', { clientName: 'Pixel 8' }, 'r1')))
                .toEqual({ t: 'pair-request', s: 2, id: 'r1', b: { clientName: 'Pixel 8' } })
        })

        test('continues the counter and signs after establish', () => {
            const channel = new LinkServerChannel()
            channel.encode('hello', { protocol: { major: 1, minor: 0 }, capabilities: [], pairingOpen: false })
            channel.establish(KEY)
            const env = JSON.parse(channel.encode('pong', {}, 'p1'))
            expect(env.s).toBe(2)
            expect(env.m).toBe(computeLinkFrameMac(KEY, 's2c', { t: 'pong', s: 2, id: 'p1', b: {} }))
        })

        test('throws when the sequence space is exhausted', () => {
            const channel = new LinkClientChannel() as unknown as { sendSeq: number, encode: LinkClientChannel['encode'] }
            channel.sendSeq = LINK_MAX_SEQ - 1
            expect(() => channel.encode('ping', {})).not.toThrow()
            expect(() => channel.encode('ping', {})).toThrow('exhausted')
        })
    })

    describe('decode', () => {
        describe('before establish', () => {
            test('accepts handshake, pairing and auth messages', () => {
                const server = new LinkServerChannel()
                const types = ['hello', 'pair-request', 'pair-verify', 'auth', 'auth-confirm']
                types.forEach((t, i) => {
                    expect(server.decode(encodeLinkEnvelope({ t, s: i + 1, b: {} }))).toMatchObject({ ok: true, message: { t } })
                })
            })

            test('rejects session messages as not-allowed', () => {
                const server = new LinkServerChannel()
                expect(server.decode(encodeLinkEnvelope({ t: 'ping', s: 1, b: {} }))).toEqual({ ok: false, reason: 'not-allowed' })
                expect(server.decode(encodeLinkEnvelope({ t: 'echo', s: 2, b: { data: 1 } }))).toEqual({ ok: false, reason: 'not-allowed' })
                const client = new LinkClientChannel()
                expect(client.decode(encodeLinkEnvelope({ t: 'session', s: 1, b: {} }))).toEqual({ ok: false, reason: 'not-allowed' })
            })

            test('rejects unknown types as not-allowed', () => {
                expect(new LinkServerChannel().decode(encodeLinkEnvelope({ t: 'whatever', s: 1, b: {} })))
                    .toEqual({ ok: false, reason: 'not-allowed' })
            })

            test('rejects a frame that repeats a sequence number', () => {
                const server = new LinkServerChannel()
                const confirm = encodeLinkEnvelope({ t: 'auth-confirm', s: 1, b: { proof: 'x' } })
                expect(server.decode(confirm).ok).toBe(true)
                expect(server.decode(confirm)).toEqual({ ok: false, reason: 'replay' })
                expect(server.decode(encodeLinkEnvelope({ t: 'hello', s: 0, b: {} }))).toEqual({ ok: false, reason: 'replay' })
            })

            test('rejects malformed payloads', () => {
                expect(new LinkClientChannel().decode('not json')).toEqual({ ok: false, reason: 'malformed' })
            })
        })

        describe('after establish', () => {
            const established = () => {
                const client = new LinkClientChannel()
                client.establish(KEY)
                return client
            }

            test('accepts frames signed for the peer direction', () => {
                const client = established()
                const env = { t: 'session', s: 1, b: { mediaPort: 1 } }
                expect(client.decode(withMac(env, 's2c'))).toEqual({ ok: true, message: { ...env, m: computeLinkFrameMac(KEY, 's2c', env) } })
            })

            test('accepts gaps in the sequence', () => {
                const client = established()
                expect(client.decode(withMac({ t: 'pong', s: 5, b: {} }, 's2c')).ok).toBe(true)
                expect(client.decode(withMac({ t: 'pong', s: 9, b: {} }, 's2c')).ok).toBe(true)
            })

            test('rejects unsigned frames, including a replayed auth-result', () => {
                const client = established()
                expect(client.decode(encodeLinkEnvelope({ t: 'auth-result', s: 1, b: { ok: false } })))
                    .toEqual({ ok: false, reason: 'unsigned' })
            })

            test('rejects a bad MAC', () => {
                const client = established()
                const payload = withMac({ t: 'pong', s: 1, b: {} }, 's2c').replace('"pong"', '"echo"')
                expect(client.decode(payload)).toEqual({ ok: false, reason: 'bad-mac' })
            })

            test('rejects a frame signed with a key of another session', () => {
                const client = established()
                expect(client.decode(withMac({ t: 'pong', s: 1, b: {} }, 's2c', Buffer.alloc(32, 1))))
                    .toEqual({ ok: false, reason: 'bad-mac' })
            })

            test('rejects its own frame reflected back', () => {
                const client = established()
                const sent = client.encode('ping', {})
                expect(client.decode(sent)).toEqual({ ok: false, reason: 'bad-mac' })
            })

            test('rejects a replayed or older signed frame', () => {
                const client = established()
                const second = withMac({ t: 'pong', s: 2, b: {} }, 's2c')
                expect(client.decode(second).ok).toBe(true)
                expect(client.decode(second)).toEqual({ ok: false, reason: 'replay' })
                expect(client.decode(withMac({ t: 'pong', s: 1, b: {} }, 's2c'))).toEqual({ ok: false, reason: 'replay' })
            })

            test('keeps the sequence of the unsigned phase', () => {
                const server = new LinkServerChannel()
                expect(server.decode(encodeLinkEnvelope({ t: 'auth-confirm', s: 3, b: { proof: 'x' } })).ok).toBe(true)
                server.establish(KEY)
                expect(server.decode(withMac({ t: 'ping', s: 3, b: {} }, 'c2s'))).toEqual({ ok: false, reason: 'replay' })
                expect(server.decode(withMac({ t: 'ping', s: 4, b: {} }, 'c2s')).ok).toBe(true)
            })

            test('reports a signed unknown type as unknown-type and still advances the sequence', () => {
                const client = established()
                const unknown = withMac({ t: 'some-future-type', s: 1, b: {} }, 's2c')
                expect(client.decode(unknown)).toEqual({ ok: false, reason: 'unknown-type' })
                expect(client.decode(unknown)).toEqual({ ok: false, reason: 'replay' })
            })
        })
    })

    describe('full session over framed bytes', () => {
        test('phone and desktop negotiate, authenticate and exchange signed frames', () => {
            const phone = new LinkClientChannel()
            const desktop = new LinkServerChannel()
            const desktopReader = new LinkFrameReader({ preamble: { maxVersion: 1 } })   // stands in for desktop main
            const phoneReader = new LinkFrameReader({ preamble: { maxVersion: 1 } })

            const toDesktop = (payload: string) => {
                const events = desktopReader.push(encodeLinkFrame(payload))
                expect(events).toHaveLength(1)
                return desktop.decode((events[0] as { payload: string }).payload)
            }
            const toPhone = (payload: string) => {
                const events = phoneReader.push(encodeLinkFrame(payload))
                return phone.decode((events.at(-1) as { payload: string }).payload)
            }

            expect(desktopReader.push(encodeLinkPreamble())).toEqual([{ type: 'preamble', version: 1 }])
            phoneReader.push(encodeLinkPreamble(1))

            // hello
            const hello = toDesktop(phone.encode('hello', { role: 'client', protocol: { min: { major: 1, minor: 0 }, max: { major: 1, minor: 0 } } }))
            expect(hello.ok && hello.message.t === 'hello').toBe(true)
            if (!hello.ok || hello.message.t !== 'hello') return
            const chosen = negotiateLinkHello(hello.message.b)
            expect(chosen).toEqual({ major: 1, minor: 0 })
            expect(toPhone(desktop.encode('hello', { protocol: chosen!, capabilities: [], pairingOpen: false })).ok).toBe(true)

            // auth
            const probe = createLinkAuthProbe([{ linkId: 'L1', secret: SECRET }])
            const auth = toDesktop(phone.encode('auth', probe.body, 'a1'))
            if (!auth.ok || auth.message.t !== 'auth') throw new Error('auth not received')
            const answer = answerLinkAuthProbe(auth.message.b, [{ clientId: 'c1', secret: SECRET }], 'L1')
            const result = toPhone(desktop.encode('auth-result', answer.body, auth.message.id))
            if (!result.ok || result.message.t !== 'auth-result') throw new Error('auth-result not received')
            const outcome = verifyLinkAuthResult(result.message.b, probe.state)
            if (!outcome.ok) throw new Error('auth failed')

            const confirmPayload = phone.encode('auth-confirm', outcome.confirm)
            phone.establish(outcome.sessionKey)
            const confirm = toDesktop(confirmPayload)
            if (!confirm.ok || confirm.message.t !== 'auth-confirm') throw new Error('auth-confirm not received')
            const key = verifyLinkAuthConfirm(confirm.message.b, answer.state!)
            expect(key).toBeDefined()
            desktop.establish(key!)

            // a replayed auth-confirm is rejected once the session is signed
            expect(desktop.decode(confirmPayload)).toEqual({ ok: false, reason: 'unsigned' })

            // signed session traffic
            const session = toPhone(desktop.encode('session', {
                mediaPort: 8123, mediaToken: 't', mediaTokenExpiresAt: 1, catalogVersion: 'v1', capabilities: [],
            }))
            expect(session).toMatchObject({ ok: true, message: { t: 'session', b: { mediaPort: 8123 } } })
            const echo = toDesktop(phone.encode('echo', { data: { z: 1, a: [1, 2] } }, 'e1'))
            expect(echo).toMatchObject({ ok: true, message: { t: 'echo', id: 'e1', b: { data: { z: 1, a: [1, 2] } } } })
            const decoded = decodeLinkEnvelope(desktop.encode('echo', { data: 1 }, 'e1'))
            expect(decoded.ok && decoded.envelope.m).toBeTruthy()
        })
    })
})
