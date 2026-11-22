import crypto from 'node:crypto'
import { EventLogger } from 'gd-eventlog'
import { getBindings } from '../../api/bindings'
import type { ICryptoBinding } from '../../api/crypto/types'
import type { ILocalLinkBinding, LocalLinkEvent } from '../../api/localLink/types'
import { Inject } from '../../base/decorators'
import UserSettingsMock from '../../settings/service/mock'
import { createLinkAuthProbe, verifyLinkAuthResult } from '../auth'
import { LinkClientChannel } from '../channel'
import type { LinkClientAuthState, LinkServerMessage } from '../types'
import { LocalLinkService } from './service'

const flush = () => jest.advanceTimersByTimeAsync(500)

type Msg = LinkServerMessage

const makeLink = () => {
    let listener: ((e: LocalLinkEvent) => void) | undefined
    const sent: Record<string, string[]> = {}
    const link = {
        isSupported: jest.fn(() => true),
        getCapabilities: jest.fn(),
        getStatus: jest.fn(),
        start: jest.fn(async (o) => ({
            control: { ok: true, port: o.control?.port || 6001 }, media: { ok: true, port: o.media?.port || 6002 }, addresses: [],
        })),
        stop: jest.fn(async () => ({ ok: true })),
        setPeerPolicy: jest.fn(async () => ({ ok: true })),
        setLimits: jest.fn(async () => ({ ok: true, applied: {} })),
        announce: jest.fn(async (_a: unknown) => ({ ok: true })),
        reannounce: jest.fn(async (_a: unknown) => ({ ok: true })),
        publishMedia: jest.fn(async () => ({ ok: true, rejectedHandles: [], rejectedTokens: 0 })),
        send: jest.fn(async (id: string, payload: string) => { (sent[id] ??= []).push(payload); return { ok: true } }),
        close: jest.fn(async (_id: string, _reason?: string) => undefined),
        onEvent: jest.fn((cb) => { listener = cb; return () => { listener = undefined } }),
    }
    return { link, sent, emit: (e: LocalLinkEvent) => listener?.(e) }
}

/** The phone's end of a connection */
class Phone {
    channel = new LinkClientChannel()
    read = 0
    constructor(protected h: ReturnType<typeof makeLink>, public id = 'c1') {
        h.emit({ type: 'connection', connectionId: id, peer: { address: '192.168.1.5', port: 4000 } })
    }
    async send(t: Parameters<LinkClientChannel['encode']>[0], b: object, id?: string) {
        this.h.emit({ type: 'frame', connectionId: this.id, payload: this.channel.encode(t, b as never, id) })
        await flush()
    }
    inbox(): Msg[] {
        const all = this.h.sent[this.id] ?? []
        const res: Msg[] = []
        while (this.read < all.length) {
            const d = this.channel.decode(all[this.read++])
            if (d.ok)
                res.push(d.message)
        }
        return res
    }
    last(): Msg {
        return this.inbox().at(-1)!
    }
    async hello() {
        await this.send('hello', { role: 'client', protocol: { min: { major: 1, minor: 0 }, max: { major: 1, minor: 0 } } })
        return this.last()
    }
    async pair(pin: (p: string) => void) {
        await this.hello()
        await this.send('pair-request', { clientName: 'Pixel 8' }, 'a')
        const pending = this.last() as Msg & { b: { requestId: string } }
        pin(pending.b.requestId)
        return pending.b.requestId
    }
}

describe('LocalLinkService', () => {
    let service: LocalLinkService
    let h: ReturnType<typeof makeLink>
    let settings: UserSettingsMock
    let data: Record<string, unknown>
    let sharing: Record<string, jest.Mock>
    let savedCrypto: ICryptoBinding
    let features: Record<string, boolean>

    const bindings = getBindings() as unknown as Record<string, unknown>

    beforeEach(() => {
        jest.useFakeTimers()
        data = {}
        settings = new UserSettingsMock(data)
        Inject('UserSettings', settings)
        features = { BRIDGE_MODE: true }
        Inject('AppState', { hasFeature: (f: string) => features[f] === true })
        sharing = {
            setTokens: jest.fn(async () => true), start: jest.fn(async () => undefined), stop: jest.fn(),
            getRouteCount: jest.fn(() => 3), getCatalogVersion: jest.fn(() => 'cv1'), on: jest.fn(), off: jest.fn(),
            getDescriptor: jest.fn(async (routeKey: string) => ({ routeKey, document: 'rd-0123456789abcdef', size: 5, sha256: 'x' })),
        }
        Inject('Sharing', sharing)
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        h = makeLink()
        bindings.localLink = h.link as unknown as ILocalLinkBinding
        bindings.appInfo = { getOS: () => ({ platform: 'win32' }), getAppVersion: () => '1.0.0' }
        service = new LocalLinkService()
    })
    afterEach(() => {
        service.reset()
        Inject('UserSettings', null)
        Inject('AppState', null)
        Inject('Sharing', null)
        getBindings().crypto = savedCrypto
        delete bindings.localLink
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    const pairedClient = () => (data.localLink as { auth: { clients: Array<{ clientId: string, secret: string }> } }).auth.clients[0]

    /** pairs one phone through the full exchange; returns its secret and the linkId */
    const pairPhone = async () => {
        await service.openPairing()
        const phone = new Phone(h)
        let pin = ''
        const requestId = await phone.pair(() => { pin = service.getDisplayProps().connectWindow!.pin! })
        await phone.send('pair-verify', { requestId, pin }, 'b')
        const paired = phone.last() as Msg & { b: { secret: string, linkId: string, name: string } }
        return { phone, paired }
    }

    describe('availability', () => {
        test('inert when the feature toggle is off', async () => {
            features.BRIDGE_MODE = false
            await service.openPairing()
            expect(h.link.start).not.toHaveBeenCalled()
            expect(service.getDisplayProps().available).toBe(false)
        })
        test('inert when the shell does not support the link', async () => {
            h.link.isSupported.mockReturnValue(false)
            await service.openPairing()
            expect(h.link.start).not.toHaveBeenCalled()
        })
        test('inert without the binding', async () => {
            delete bindings.localLink
            await service.init()
            expect(service.isAvailable()).toBe(false)
        })
    })

    describe('start policy', () => {
        test('nothing starts at init with no paired client', async () => {
            await service.init()
            expect(h.link.start).not.toHaveBeenCalled()
            expect(h.link.announce).not.toHaveBeenCalled()
        })
        test('init with a paired client starts and announces, pairing stays closed', async () => {
            data.localLink = { auth: { clients: [{ clientId: 'x', clientName: 'P', pairedAt: 1, secret: 'AAAA' }], tokens: [] } }
            await service.init()
            expect(h.link.start).toHaveBeenCalled()
            expect(h.link.announce).toHaveBeenCalledWith(expect.objectContaining({ instanceName: expect.stringMatching(/^Incyclist Computer \([A-Z0-9]{4}\)$/) }))
            const props = service.getDisplayProps()
            expect(props.pairingOpen).toBe(false)
            expect(props.state).toBe('on')
        })
        test('init does not start when switched off', async () => {
            data.localLink = { off: true, auth: { clients: [{ clientId: 'x', clientName: 'P', pairedAt: 1, secret: 'AAAA' }], tokens: [] } }
            await service.init()
            expect(h.link.start).not.toHaveBeenCalled()
            expect(service.getDisplayProps().state).toBe('off')
        })
        test('openPairing starts, announces with a random host label and opens pairing', async () => {
            await service.openPairing()
            expect(h.link.setPeerPolicy).toHaveBeenCalledWith({ defaultPrivate: true })
            expect(h.link.setLimits).toHaveBeenCalledWith(expect.objectContaining({ control: expect.objectContaining({ maxFrameBytes: 16 * 1024 }) }))
            const announced = h.link.announce.mock.calls[0][0] as { hostLabel: string }
            expect(announced.hostLabel).toMatch(/^incyclist-[a-z0-9]{8}$/)
            const props = service.getDisplayProps()
            expect(props.pairingOpen).toBe(true)
            expect(props.connectWindow?.phase).toBe('waiting')
            expect(props.suffix).toMatch(/^[A-Z0-9]{4}$/)
        })
        test('stores bound ports and reuses them at the next start', async () => {
            await service.openPairing()
            expect((data.localLink as { ports: unknown }).ports).toEqual({ control: 6001, media: 6002 })
            service.reset()
            service = new LocalLinkService()
            Inject('Sharing', sharing)
            h.link.start.mockClear()
            await service.openPairing()
            expect(h.link.start).toHaveBeenCalledWith({ control: { port: 6001 }, media: { port: 6002 } })
        })
        test('falls back to port 0 when the stored port is in use', async () => {
            data.localLink = { ports: { control: 7001, media: 7002 } }
            h.link.start.mockImplementationOnce(async () => ({
                control: { ok: false, error: { code: 'EADDRINUSE' } }, media: { ok: true, port: 7002 }, addresses: [],
            }) as never)
            await service.openPairing()
            expect(h.link.start).toHaveBeenNthCalledWith(2, { control: { port: 0 } })
            expect((data.localLink as { ports: { control: number } }).ports.control).toBe(6001)
            expect(service.getDisplayProps().connectWindow?.phase).toBe('waiting')
        })
        test('reports a start failure and stops what started', async () => {
            h.link.start.mockImplementationOnce(async () => ({
                control: { ok: false, error: { code: 'EACCES' } }, media: { ok: true, port: 1 }, addresses: [],
            }) as never)
            await service.openPairing()
            const props = service.getDisplayProps()
            expect(props.connectWindow?.phase).toBe('error')
            expect(props.startError).toEqual({ code: 'EACCES' })
            expect(h.link.stop).toHaveBeenCalled()
        })
        test('closePairing keeps the listeners up while a phone is paired, and stops them when none is', async () => {
            await service.openPairing()
            await service.closePairing()
            expect(h.link.stop).toHaveBeenCalled()
            h.link.stop.mockClear()

            await pairPhone()
            await service.closePairing()
            expect(h.link.stop).not.toHaveBeenCalled()
            expect(service.getDisplayProps().pairingOpen).toBe(false)
        })
        test('switching off stops, withdraws and persists; switching on starts again', async () => {
            await pairPhone()
            await service.setEnabled(false)
            expect(h.link.announce).toHaveBeenLastCalledWith(null)
            expect(h.link.stop).toHaveBeenCalled()
            expect((data.localLink as { off: boolean }).off).toBe(true)
            expect(service.getDisplayProps().state).toBe('off')
            h.link.start.mockClear()
            await service.setEnabled(true)
            expect(h.link.start).toHaveBeenCalled()
            expect(service.getDisplayProps().state).toBe('on')
        })
        test('re-announces on network-changed and resumed', async () => {
            await service.openPairing()
            h.emit({ type: 'network-changed', addresses: [] })
            h.emit({ type: 'resumed' })
            await flush()
            expect(h.link.reannounce).toHaveBeenCalledTimes(2)
        })
        test('announces again when reannounce reports nothing announced', async () => {
            await service.openPairing()
            h.link.announce.mockClear()
            h.link.reannounce.mockResolvedValueOnce({ ok: false })
            h.emit({ type: 'resumed' })
            await flush()
            expect(h.link.announce).toHaveBeenCalledTimes(1)
        })
    })

    describe('setDisplayName', () => {
        test('rejects more than 40 characters', async () => {
            expect(await service.setDisplayName('x'.repeat(41))).toEqual({ ok: false, error: 'too-long' })
        })
        test('stores the name and re-announces with the same suffix', async () => {
            await service.openPairing()
            const suffix = service.getDisplayProps().suffix
            expect(await service.setDisplayName('Home PC')).toEqual({ ok: true, name: 'Home PC' })
            expect(h.link.announce).toHaveBeenLastCalledWith(expect.objectContaining({ instanceName: `Home PC (${suffix})` }))
        })
        test('an empty name resets to the neutral default', async () => {
            await service.setDisplayName('Home PC')
            expect(await service.setDisplayName('  ')).toEqual({ ok: true, name: 'Incyclist Computer' })
        })
        test('keeps the announced name within 63 bytes for multi-byte names', async () => {
            await service.openPairing()
            await service.setDisplayName('€'.repeat(40))
            const name = (h.link.announce.mock.calls.at(-1)![0] as { instanceName: string }).instanceName
            expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
        })
    })

    describe('handshake', () => {
        test('hello negotiates the version and reveals no identity', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            expect(await phone.hello()).toMatchObject({ t: 'hello', b: { protocol: { major: 1, minor: 0 }, pairingOpen: true } })
        })
        test('an unsupported major is refused explicitly and the connection closed', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.send('hello', { role: 'client', protocol: { min: { major: 2, minor: 0 }, max: { major: 3, minor: 0 } } })
            expect(phone.last()).toMatchObject({ t: 'error', b: { code: 'unsupported-protocol' } })
            expect(h.link.close).toHaveBeenCalledWith('c1', 'unsupported-protocol')
        })
        test('a malformed hello gets bad-request', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.send('hello', { nonsense: true })
            expect(phone.last()).toMatchObject({ t: 'error', b: { code: 'bad-request' } })
        })
        test('malformed frames get bad-request', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            h.emit({ type: 'frame', connectionId: 'c1', payload: 'not json' })
            await flush()
            expect(phone.last()).toMatchObject({ t: 'error', b: { code: 'bad-request' } })
        })
        test('only handshake, pairing and auth are accepted before authentication', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.hello()
            await phone.send('echo', { data: 1 }, 'e')
            expect(phone.last()).toMatchObject({ t: 'error', b: { code: 'not-authenticated' } })
        })
        test('pair-request before hello is refused', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.send('pair-request', { clientName: 'x' })
            expect(phone.last()).toMatchObject({ t: 'error', b: { code: 'bad-request' } })
        })
    })

    describe('pairing', () => {
        test('pairing-closed while the pairing UI is closed', async () => {
            data.localLink = { auth: { clients: [{ clientId: 'x', clientName: 'P', pairedAt: 1, secret: 'AAAA' }], tokens: [] } }
            await service.init()
            const phone = new Phone(h)
            await phone.hello()
            await phone.send('pair-request', { clientName: 'Pixel' }, 'a')
            expect(phone.last()).toMatchObject({ t: 'pair-failed', id: 'a', b: { outcome: 'pairing-closed' } })
        })
        test('PIN exchange delivers linkId, secret, name and version and persists the client under localLink.auth', async () => {
            const { paired } = await pairPhone()
            expect(paired).toMatchObject({ t: 'paired', id: 'b', b: { outcome: 'paired', name: 'Incyclist Computer', protocolVersion: { major: 1, minor: 0 } } })
            expect(Buffer.from(paired.b.secret, 'base64url')).toHaveLength(32)
            const stored = pairedClient()
            expect(stored.secret).toBe(paired.b.secret)
            expect((data.localLink as { linkId: string }).linkId).toBe(paired.b.linkId)
            const props = service.getDisplayProps()
            expect(props.state).toBe('on')
            expect(props.devices).toMatchObject([{ name: 'Pixel 8', active: false }])
            expect(props.connectWindow?.phase).toBe('connected')
        })
        test('the PIN is six digits', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.pair(() => undefined)
            expect(service.getDisplayProps().connectWindow?.pin).toMatch(/^\d{6}$/)
        })
        test('a wrong PIN answers wrong with the attempts left', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            const requestId = await phone.pair(() => undefined)
            await phone.send('pair-verify', { requestId, pin: '000000x' }, 'v')
            expect(phone.last()).toMatchObject({ t: 'pair-failed', b: { outcome: 'wrong', attemptsRemaining: 2 } })
        })
        test('deny pushes denied to the phone', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.pair(() => undefined)
            service.denyPairing()
            await flush()
            expect(phone.last()).toMatchObject({ t: 'pair-failed', b: { outcome: 'denied' } })
        })
        test('expires after 120 s', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            const requestId = await phone.pair(() => undefined)
            await jest.advanceTimersByTimeAsync(121_000)
            await phone.send('pair-verify', { requestId, pin: '123456' }, 'v')
            expect(phone.last()).toMatchObject({ t: 'pair-failed', b: { outcome: 'expired' } })
        })
        test('a second phone supersedes the first', async () => {
            await service.openPairing()
            const first = new Phone(h, 'c1')
            await first.pair(() => undefined)
            const second = new Phone(h, 'c2')
            await second.pair(() => undefined)
            expect(first.last()).toMatchObject({ t: 'pair-failed', b: { outcome: 'superseded' } })
        })
        test('requests are rate-limited', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.hello()
            for (let i = 0; i < 6; i++)
                await phone.send('pair-request', { clientName: 'x' })
            expect(phone.last()).toMatchObject({ t: 'pair-failed', b: { outcome: 'rate-limited' } })
        })
        test('the client name is sanitised', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.hello()
            await phone.send('pair-request', { clientName: `  Pix\u0000el ${'z'.repeat(80)}` })
            expect(service.getDisplayProps().connectWindow?.device).toMatch(/^Pixel z+$/)
            expect(service.getDisplayProps().connectWindow?.device).toHaveLength(40)
        })
        test('linkId is generated once', async () => {
            await service.openPairing()
            const first = (data.localLink as { linkId?: string }).linkId
            await pairPhone()
            expect((data.localLink as { linkId: string }).linkId).toBe((first ?? (data.localLink as { linkId: string }).linkId))
        })
    })

    describe('sessions', () => {
        interface Session { secret: string, linkId: string, phone: Phone }

        const connect = async (secret: string, linkId: string, id: string): Promise<{ phone: Phone, state: LinkClientAuthState }> => {
            const phone = new Phone(h, id)
            await phone.hello()
            const probe = createLinkAuthProbe([{ linkId, secret }])
            await phone.send('auth', probe.body, 'au')
            return { phone, state: probe.state }
        }

        const authenticate = async (): Promise<Session> => {
            const { paired } = await pairPhone()
            const { secret, linkId } = paired.b
            const { phone, state } = await connect(secret, linkId, 'c2')
            const res = phone.last() as Msg & { b: { ok: boolean } }
            const outcome = verifyLinkAuthResult(res.b as never, state)
            if (!outcome.ok)
                throw new Error('auth failed')
            await phone.send('auth-confirm', outcome.confirm)
            phone.channel.establish(outcome.sessionKey)
            return { secret, linkId, phone }
        }

        describe('catalog-changed push', () => {
            const catalogChanged = (version: string) => {
                const call = sharing.on.mock.calls.find(c => c[0] === 'catalog-changed')!
                call[1]({ catalogVersion: version, routeCount: 4 })
                return flush()
            }
            const pushes = (phone: Phone) => phone.inbox().filter(m => m.t === 'catalog-changed')

            test('is sent signed to every authenticated session, and to nobody else', async () => {
                const { phone, secret, linkId } = await authenticate()
                const second = await connect(secret, linkId, 'c3')
                const outcome = verifyLinkAuthResult(second.phone.last().b as never, second.state)
                if (!outcome.ok)
                    throw new Error('auth failed')
                await second.phone.send('auth-confirm', outcome.confirm)
                second.phone.channel.establish(outcome.sessionKey)
                const stranger = new Phone(h, 'c4')
                await stranger.hello()
                phone.inbox()
                second.phone.inbox()
                stranger.inbox()
                const strangerFrames = h.sent.c4.length

                await catalogChanged('cv2')

                expect(pushes(phone)).toEqual([expect.objectContaining({ t: 'catalog-changed', b: { catalogVersion: 'cv2' } })])
                expect(pushes(second.phone)).toHaveLength(1)
                expect(h.sent.c4).toHaveLength(strangerFrames)
            })

            test('is not repeated for the same version, and not for the version the session announced', async () => {
                const { phone } = await authenticate()
                phone.inbox()
                await catalogChanged('cv1')
                expect(pushes(phone)).toHaveLength(0)
                await catalogChanged('cv2')
                await catalogChanged('cv2')
                expect(pushes(phone)).toHaveLength(1)
                await catalogChanged('cv3')
                expect(pushes(phone)).toHaveLength(1)
            })
        })

        test('full handshake: auth, auth-confirm, signed session, ping and echo', async () => {
            const { phone } = await authenticate()
            const session = phone.inbox().find(m => m.t === 'session') as Msg & { b: Record<string, unknown> }
            expect(session).toBeDefined()
            expect(session.b).toMatchObject({ mediaPort: 6002, catalogVersion: 'cv1', capabilities: ['route-sharing', 'route-descriptor'] })
            expect(Buffer.from(session.b.mediaToken as string, 'base64url')).toHaveLength(32)
            expect((session.b.mediaTokenExpiresAt as number) - Date.now()).toBeGreaterThan(11.9 * 3600_000)

            await phone.send('ping', {}, 'p1')
            expect(phone.last()).toMatchObject({ t: 'pong', id: 'p1' })
            await phone.send('echo', { data: { x: 1 } }, 'e1')
            expect(phone.last()).toMatchObject({ t: 'echo', id: 'e1', b: { data: { x: 1 } } })

            expect(service.getDisplayProps().devices[0]).toMatchObject({ active: true })
            expect(pairedClient()).toHaveProperty('lastSeenAt')
        })

        test('route-descriptor: answers with the correlation id of the request', async () => {
            const { phone } = await authenticate()
            await phone.send('route-descriptor', { routeKey: 'k1' }, 'd1')
            expect(sharing.getDescriptor).toHaveBeenCalledWith('k1', expect.any(String))
            expect(phone.last()).toMatchObject({ t: 'route-descriptor', id: 'd1', b: { routeKey: 'k1', document: 'rd-0123456789abcdef' } })
        })

        test('route-descriptor without a route key is passed on as an empty key', async () => {
            const { phone } = await authenticate()
            await phone.send('route-descriptor', {} as never, 'd2')
            expect(sharing.getDescriptor).toHaveBeenCalledWith('', expect.any(String))
        })

        test('route-descriptor is refused before authentication', async () => {
            await service.openPairing()
            const phone = new Phone(h)
            await phone.hello()
            await phone.send('route-descriptor', { routeKey: 'k1' }, 'd3')
            expect(phone.last()).toMatchObject({ t: 'error', b: { code: 'not-authenticated' } })
            expect(sharing.getDescriptor).not.toHaveBeenCalled()
        })

        test('publishes only the digest of the media token, and persists only the digest', async () => {
            const { phone } = await authenticate()
            const session = phone.inbox().find(m => m.t === 'session') as Msg & { b: { mediaToken: string } }
            const digest = crypto.createHash('sha256').update(session.b.mediaToken).digest('base64url')
            const published = sharing.setTokens.mock.calls.at(-1)![0] as Array<{ digest: string }>
            expect(published.map(t => t.digest)).toEqual([digest])
            expect(JSON.stringify(data)).not.toContain(session.b.mediaToken)
        })

        test('a wrong secret gets a bare ok:false after the fixed delay', async () => {
            const { paired } = await pairPhone()
            const phone = new Phone(h, 'c3')
            await phone.hello()
            const probe = createLinkAuthProbe([{ linkId: paired.b.linkId, secret: Buffer.alloc(32, 7).toString('base64url') }])
            h.emit({ type: 'frame', connectionId: 'c3', payload: phone.channel.encode('auth', probe.body, 'au') })
            await jest.advanceTimersByTimeAsync(100)
            expect(phone.inbox().some(m => m.t === 'auth-result')).toBe(false)
            await jest.advanceTimersByTimeAsync(400)
            const result = phone.last() as Msg & { b: object }
            expect(result).toMatchObject({ t: 'auth-result', b: { ok: false } })
            expect(Object.keys(result.b)).toEqual(['ok'])
        })

        test('a wrong auth-confirm closes the connection', async () => {
            const { paired } = await pairPhone()
            const { phone } = await connect(paired.b.secret, paired.b.linkId, 'c4')
            await phone.send('auth-confirm', { proof: 'AAAA' })
            expect(h.link.close).toHaveBeenCalledWith('c4', 'auth-failed')
        })

        test('auth-confirm without a probe closes the connection', async () => {
            await service.openPairing()
            const phone = new Phone(h, 'c5')
            await phone.hello()
            await phone.send('auth-confirm', { proof: 'AAAA' })
            expect(h.link.close).toHaveBeenCalledWith('c5', 'auth-failed')
        })

        test('auth is rate-limited per peer', async () => {
            await pairPhone()
            const probe = createLinkAuthProbe([{ linkId: 'l', secret: Buffer.alloc(32, 7).toString('base64url') }])
            for (let i = 0; i < 12; i++) {
                const p = new Phone(h, `r${i}`)
                await p.hello()
                h.emit({ type: 'frame', connectionId: `r${i}`, payload: p.channel.encode('auth', probe.body) })
                await flush()
            }
            expect(h.link.close).toHaveBeenCalledWith('r10', 'rate-limited')
        })

        test('revoke republishes the digests without the token, then closes its connections', async () => {
            const { phone } = await authenticate()
            expect(phone.inbox().some(m => m.t === 'session')).toBe(true)
            const clientId = pairedClient().clientId
            const order: string[] = []
            sharing.setTokens.mockImplementation(async (t: unknown[]) => { order.push(`tokens:${t.length}`); return true })
            h.link.close.mockImplementation(async (id: string) => { order.push(`close:${id}`) })

            await service.removeClient(clientId)

            expect(order).toEqual(['tokens:0', 'close:c2'])
            expect(service.getDisplayProps().devices).toEqual([])
            expect(service.getDisplayProps().state).toBe('never-connected')
        })

        test('removing a phone deletes its secret from the settings', async () => {
            const { paired } = await pairPhone()
            await service.closePairing()
            await service.removeClient(pairedClient().clientId)
            expect(JSON.stringify(data)).not.toContain(paired.b.secret)
            expect((data.localLink as { auth: { clients: unknown[] } }).auth.clients).toEqual([])
        })

        test('removing the last phone stops the transport once pairing is closed', async () => {
            await pairPhone()
            await service.closePairing()
            h.link.stop.mockClear()
            await service.removeClient(pairedClient().clientId)
            expect(h.link.stop).toHaveBeenCalled()
        })

        test('the removed phone can no longer authenticate', async () => {
            const { secret, linkId } = await authenticate()
            await service.removeClient(pairedClient().clientId)
            await service.openPairing()
            const { phone } = await connect(secret, linkId, 'c9')
            expect(phone.last()).toMatchObject({ t: 'auth-result', b: { ok: false } })
        })

        test('connections are forgotten when the transport reports them closed', async () => {
            const { phone } = await authenticate()
            expect(phone.inbox().length).toBeGreaterThan(0)
            h.emit({ type: 'connection-closed', connectionId: 'c2', reason: 'peer' })
            expect(service.getDisplayProps().devices[0].active).toBe(false)
        })
    })

    describe('authentication deadline', () => {
        const closed = (id: string) => h.link.close.mock.calls.filter(c => c[0] === id)

        test('an idle connection is closed after 10 s', async () => {
            await service.openPairing()
            new Phone(h, 'idle')
            await jest.advanceTimersByTimeAsync(9000)
            expect(closed('idle')).toHaveLength(0)
            await jest.advanceTimersByTimeAsync(1500)
            expect(closed('idle')).toEqual([['idle', 'auth-timeout']])
        })
        test('a connection that only said hello is closed', async () => {
            data.localLink = { auth: { clients: [{ clientId: 'x', clientName: 'P', pairedAt: 1, secret: 'AAAA' }], tokens: [] } }
            await service.init()
            const phone = new Phone(h, 'hi')
            await phone.hello()
            await jest.advanceTimersByTimeAsync(10_000)
            expect(closed('hi')).toHaveLength(1)
        })
        test('a connection with a pending pair request stays open for the pairing window', async () => {
            await service.openPairing()
            const phone = new Phone(h, 'p1')
            await phone.pair(() => undefined)
            await jest.advanceTimersByTimeAsync(30_000)
            expect(closed('p1')).toHaveLength(0)
            await jest.advanceTimersByTimeAsync(100_000)
            expect(closed('p1')).toHaveLength(1)
        })
        test('an authenticated connection is not closed', async () => {
            const { paired } = await pairPhone()
            const phone = new Phone(h, 'c2')
            await phone.hello()
            const probe = createLinkAuthProbe([{ linkId: paired.b.linkId, secret: paired.b.secret }])
            await phone.send('auth', probe.body, 'au')
            const outcome = verifyLinkAuthResult((phone.last() as Msg & { b: never }).b, probe.state)
            if (!outcome.ok)
                throw new Error('auth failed')
            await phone.send('auth-confirm', outcome.confirm)
            await jest.advanceTimersByTimeAsync(60_000)
            expect(closed('c2')).toHaveLength(0)
        })
        test('closing the connection clears the timer', async () => {
            await service.openPairing()
            new Phone(h, 'gone')
            h.emit({ type: 'connection-closed', connectionId: 'gone', reason: 'peer' })
            await jest.advanceTimersByTimeAsync(20_000)
            expect(closed('gone')).toHaveLength(0)
        })
        test('stopping the transport clears the timers', async () => {
            await service.openPairing()
            new Phone(h, 'stop')
            await service.closePairing()
            h.link.close.mockClear()
            await jest.advanceTimersByTimeAsync(20_000)
            expect(closed('stop')).toHaveLength(0)
        })
    })

    describe('log filtering', () => {
        afterEach(() => EventLogger.setKeyBlackList([]))

        test('a logged settings object shows the auth key as filtered', async () => {
            const { paired } = await pairPhone()
            EventLogger.setKeyBlackList(['user', 'auth', 'cacheDir', 'baseDir', 'pageDir', 'appDir'])
            const filtered = new EventLogger('test').filterBlackList({ message: 'merge', settings: settings.getAll() }) as { settings: { localLink: Record<string, unknown> } }
            expect(filtered.settings.localLink.auth).toBe('**filtered**')
            expect(JSON.stringify(filtered)).not.toContain(paired.b.secret)
        })
    })

    describe('firewall notice', () => {
        test('flagged on Windows at the first start after a version change only', async () => {
            data.localLink = { lastRunVersion: '0.9.0', auth: { clients: [{ clientId: 'x', clientName: 'P', pairedAt: 1, secret: 'AAAA' }], tokens: [] } }
            await service.init()
            expect(service.getDisplayProps().showUpdateFirewallNotice).toBe(true)
            service.dismissFirewallNotice()
            expect(service.getDisplayProps().showUpdateFirewallNotice).toBe(false)
        })
        test('not flagged on the very first run', async () => {
            data.localLink = { auth: { clients: [{ clientId: 'x', clientName: 'P', pairedAt: 1, secret: 'AAAA' }], tokens: [] } }
            await service.init()
            expect(service.getDisplayProps().showUpdateFirewallNotice).toBe(false)
        })
    })
})
