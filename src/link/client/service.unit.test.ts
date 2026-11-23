import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { getBindings } from '../../api/bindings'
import type { ICryptoBinding } from '../../api/crypto/types'
import type { ILocalLinkBinding } from '../../api/localLink/types'
import { Inject } from '../../base/decorators'
import UserSettingsMock from '../../settings/service/mock'
import {
    FakeNetwork, makeHostLink, makeMemoryDb, makeMemorySecureStorage, RogueEndpoint,
} from '../../../__tests__/utils/linkFakes'
import { LocalLinkService } from '../host/service'
import { LinkClientConnection } from './connection'
import * as consts from './consts'
import { LocalLinkClientService } from './service'
import type { LinkPairingState, LocalLinkClientDisplayProps } from './types'

// the global uuid stub returns counters; the pairing record check needs real UUIDs
jest.mock('uuid', () => ({ v4: () => jest.requireActual('node:crypto').randomUUID() }))

const HOST_ADDRESS = '192.168.1.20'
const HOST_ID = `${HOST_ADDRESS}:6001`
const ROGUE_ADDRESS = '192.168.1.99'
const ROGUE_PORT = 7000

type Announcement = { type: string, name: string, address: string, port: number }

const hostAnnouncement = (suffix = 'ABCD'): Announcement => ({ type: 'incyclist', name: `Incyclist Computer (${suffix})`, address: HOST_ADDRESS, port: 6001 })

/** Advances the fake clock in small steps until the condition holds. */
const until = async (cond: () => boolean, maxSteps = 400) => {
    for (let i = 0; i < maxSteps && !cond(); i++)
        await jest.advanceTimersByTimeAsync(50)
    expect(cond()).toBe(true)
}

/** Advances the fake clock until the promise settled. */
const run = async <T>(promise: Promise<T>): Promise<T> => {
    let done = false
    let error: unknown
    let value: T | undefined
    promise.then(v => { done = true; value = v }, e => { done = true; error = e })
    await until(() => done)
    if (error)
        throw error
    return value as T
}

class FakeAccess extends EventEmitter {
    scanning = false
    /** the WiFi (Direct Connect) interface is connected: a trainer rotation runs that the watch can join */
    wifiConnected = false
    getInterface = (name: string) => name === 'wifi' ? { isConnected: () => this.wifiConnected } : undefined
    isScanning = () => this.scanning
    pauseBackgroundActivity = jest.fn(async (_owner?: string) => undefined)
    resumeBackgroundActivity = jest.fn(async (_owner?: string) => undefined)
}

// the repository instance is cached for the whole test file, so the in-memory database is too
const mem = makeMemoryDb()

describe('LocalLinkClientService', () => {
    const bindings = getBindings() as unknown as Record<string, unknown>
    let client: LocalLinkClientService
    let host: LocalLinkService
    let net: FakeNetwork
    let hostLink: ReturnType<typeof makeHostLink>
    let sharing: Record<string, jest.Mock>
    let secure: ReturnType<typeof makeMemorySecureStorage>
    let access: FakeAccess
    let devicePairing: { isScanning: jest.Mock, isPairing: jest.Mock }
    let rideState: string
    let features: Record<string, boolean>
    let announced: Announcement[]
    let mdns: { connect: jest.Mock, disconnect: jest.Mock, find: jest.Mock, stopFind?: jest.Mock }
    let finders: Array<{ type?: string, cb: (a: Announcement) => void }>
    let platform: string
    let nativeFeatures: string[]
    let hasNativeFeature: ((name: string) => boolean) | undefined
    let savedCrypto: ICryptoBinding

    const props = (): LocalLinkClientDisplayProps => client.getDisplayProps()
    const pairingState = (): LinkPairingState => props().pairing
    const stepIs = (step: string) => () => pairingState().step === step

    const newClient = () => {
        client = new LocalLinkClientService()
        return client
    }

    /** pairs the phone with the real desktop service through the whole exchange */
    const pairPhone = async (): Promise<string> => {
        await host.openPairing()
        announced = [hostAnnouncement()]
        await run(client.startSearch())
        await run(client.selectComputer(HOST_ID))
        await until(stepIs('code'))
        client.submitCode(host.getDisplayProps().connectWindow!.pin!)
        await until(stepIs('connected'))
        const linkId = (pairingState() as { linkId: string }).linkId
        await until(() => client.getSession(linkId) !== undefined)
        return linkId
    }

    /** the phone's app is restarted and the computer is gone from the network */
    const restartPhoneWithoutHost = async () => {
        client.reset()
        net.endpoints.delete(HOST_ID)
        announced = []
        newClient()
        await client.init()
    }

    const startScan = (...states: string[]) => states.forEach(s => access.emit('scanstate-changed', s))

    beforeEach(() => {
        jest.useFakeTimers()
        mem.files.clear()
        secure = makeMemorySecureStorage()
        net = new FakeNetwork()
        announced = []
        finders = []
        mdns = {
            connect: jest.fn(), disconnect: jest.fn(), stopFind: jest.fn(),
            find: jest.fn((opts: { type?: string }, cb: (a: Announcement) => void) => {
                finders.push({ type: opts?.type, cb })
                announced.forEach(a => cb(a))
            }),
        }
        platform = 'ios'

        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        bindings.wifi = { net, mdns }
        bindings.db = mem.db
        bindings.secureStorage = secure.binding
        nativeFeatures = ['local-link']
        hasNativeFeature = (name: string) => nativeFeatures.includes(name)
        bindings.appInfo = { getOS: () => ({ platform }), hasNativeFeature: (name: string) => hasNativeFeature?.(name) }

        features = { BRIDGE_MODE: true }
        rideState = 'Idle'
        access = new FakeAccess()
        devicePairing = { isScanning: jest.fn(() => false), isPairing: jest.fn(() => false) }
        Inject('AppState', { hasFeature: (f: string) => features[f] === true })
        Inject('DeviceAccess', access)
        Inject('DevicePairing', devicePairing)
        Inject('RideDisplay', { getState: () => rideState })

        // the desktop side: the real host service behind a fake transport
        Inject('UserSettings', new UserSettingsMock({}))
        sharing = {
            setTokens: jest.fn(async () => true), start: jest.fn(async () => undefined), stop: jest.fn(),
            getRouteCount: jest.fn(() => 3), getCatalogVersion: jest.fn(() => 'cv1'), on: jest.fn(), off: jest.fn(),
        }
        Inject('Sharing', sharing)
        hostLink = makeHostLink()
        bindings.localLink = hostLink.link as unknown as ILocalLinkBinding
        net.endpoints.set(HOST_ID, hostLink.endpoint)
        host = new LocalLinkService()
        newClient()
    })

    afterEach(() => {
        client.reset()
        host.reset()
        for (const key of ['AppState', 'DeviceAccess', 'DevicePairing', 'RideDisplay', 'UserSettings', 'Sharing'])
            Inject(key, null)
        getBindings().crypto = savedCrypto
        for (const key of ['wifi', 'db', 'secureStorage', 'appInfo', 'localLink'])
            delete bindings[key]
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('isSupported', () => {
        test('true with the toggle on and the bindings present', () => {
            expect(client.isSupported()).toBe(true)
            expect(props().available).toBe(true)
        })
        test('false with the toggle off: nothing is rendered and searching is blocked', async () => {
            features.BRIDGE_MODE = false
            expect(client.isSupported()).toBe(false)
            expect(props().available).toBe(false)
            expect(props().links).toEqual([])
            const state = await client.startSearch()
            expect(state).toEqual({ phase: 'blocked', reason: 'unsupported' })
            expect(mdns.find).not.toHaveBeenCalled()
        })
        test.each(['wifi', 'secureStorage', 'db', 'crypto'])('false without the %s binding', (key) => {
            const saved = bindings[key]
            delete bindings[key]
            expect(client.isSupported()).toBe(false)
            bindings[key] = saved
        })
        test('check does nothing when unsupported', async () => {
            features.BRIDGE_MODE = false
            await client.check()
            expect(net.connects).toEqual([])
        })

        describe('native capability', () => {
            test('reports local-link: supported', () => {
                expect(client.isSupported()).toBe(true)
            })
            test('does not report local-link: unsupported', () => {
                nativeFeatures = ['local-link-media']
                expect(client.isSupported()).toBe(false)
            })
            test('old binary without hasNativeFeature: unsupported', () => {
                hasNativeFeature = undefined
                bindings.appInfo = { getOS: () => ({ platform }) }
                expect(client.isSupported()).toBe(false)
            })
            test('hasNativeFeature throws: unsupported', () => {
                hasNativeFeature = () => { throw new Error('boom') }
                expect(client.isSupported()).toBe(false)
            })
            test('unsupported: nothing is listed, search is blocked and gives no permission hint', async () => {
                nativeFeatures = []
                expect(props().available).toBe(false)
                expect(props().links).toEqual([])
                const state = await client.startSearch()
                expect(state).toEqual({ phase: 'blocked', reason: 'unsupported' })
                expect(mdns.find).not.toHaveBeenCalled()
            })
        })
    })

    describe('startSearch', () => {
        test('browses _incyclist._tcp, lists the computers and ends after the time box', async () => {
            announced = [hostAnnouncement()]
            const search = client.startSearch()
            await until(() => props().discovery.phase === 'searching' || props().discovery.phase === 'done')
            expect(mdns.find).toHaveBeenCalledWith({ type: 'incyclist', protocol: 'tcp' }, expect.any(Function))
            const state = await run(search)
            expect(state).toMatchObject({
                phase: 'done', noneFound: false,
                computers: [{ id: HOST_ID, displayName: 'Incyclist Computer', suffix: 'ABCD', ambiguous: false, host: HOST_ADDRESS, port: 6001 }],
            })
            expect(mdns.stopFind).toHaveBeenCalledWith('incyclist', 'tcp')
            expect(mdns.disconnect).not.toHaveBeenCalled()
        })
        test('shows the suffix of computers that share a display name', async () => {
            announced = [hostAnnouncement('ABCD'), { ...hostAnnouncement('WXYZ'), address: '192.168.1.21' }]
            const state = await run(client.startSearch()) as { computers: Array<{ ambiguous: boolean }> }
            expect(state.computers.map(c => c.ambiguous)).toEqual([true, true])
        })
        test('ignores announcements of another type', async () => {
            announced = [{ ...hostAnnouncement(), type: 'wahoo-fitness-tnp' }]
            const state = await run(client.startSearch())
            expect(state).toMatchObject({ phase: 'done', noneFound: true })
        })
        test('no result on iOS: the Local Network remediation', async () => {
            const state = await run(client.startSearch())
            expect(state).toEqual({ phase: 'done', computers: [], noneFound: true, showLocalNetworkHint: true })
        })
        test('no result on Android: no iOS remediation', async () => {
            platform = 'android'
            const state = await run(client.startSearch())
            expect(state).toEqual({ phase: 'done', computers: [], noneFound: true, showLocalNetworkHint: false })
        })
        test('exclusive use of network discovery: paused during the browse and given back after', async () => {
            const search = client.startSearch()
            await until(() => access.pauseBackgroundActivity.mock.calls.length > 0)
            expect(access.pauseBackgroundActivity).toHaveBeenCalledWith('local-link')
            expect(access.resumeBackgroundActivity).not.toHaveBeenCalled()
            await run(search)
            expect(access.resumeBackgroundActivity).toHaveBeenCalledWith('local-link')
        })
        test.each([
            ['ride', () => { rideState = 'Active' }],
            ['device-scan', () => { access.scanning = true }],
            ['device-pairing', () => { devicePairing.isPairing.mockReturnValue(true) }],
            ['device-pairing', () => { devicePairing.isScanning.mockReturnValue(true) }],
        ])('not allowed while busy (%s): says so instead of "none found", and does not touch mDNS', async (reason, makeBusy) => {
            makeBusy()
            const state = await client.startSearch()
            expect(state).toEqual({ phase: 'blocked', reason })
            expect(mdns.connect).not.toHaveBeenCalled()
            expect(mdns.find).not.toHaveBeenCalled()
            expect(access.pauseBackgroundActivity).not.toHaveBeenCalled()
        })
        test('a device scan that starts during the browse ends it; with no result that is "blocked", not "none found"', async () => {
            const search = client.startSearch()
            await until(() => mdns.find.mock.calls.length > 0)
            startScan('start-requested')
            expect(await run(search)).toEqual({ phase: 'blocked', reason: 'device-scan' })
            expect(access.resumeBackgroundActivity).toHaveBeenCalledWith('local-link')
        })
        test('a second search while one runs shares it', async () => {
            const first = client.startSearch()
            const second = client.startSearch()
            await run(Promise.all([first, second]))
            expect(mdns.find).toHaveBeenCalledTimes(1)
        })
        test('cancelSearch ends the search with what was found', async () => {
            announced = [hostAnnouncement()]
            const search = client.startSearch()
            await until(() => mdns.find.mock.calls.length > 0)
            client.cancelSearch()
            expect(await search).toMatchObject({ phase: 'done', noneFound: false })
        })
    })

    describe('pairing', () => {
        test('PIN exchange saves the record, keeps the secret out of the repository and opens the session', async () => {
            const linkId = await pairPhone()

            const record = mem.files.get(linkId) as Record<string, unknown>
            expect(record).toMatchObject({
                linkId, name: 'Incyclist Computer', protocolVersion: { major: 1, minor: 0 },
                lastAddress: { host: HOST_ADDRESS, controlPort: 6001 },
            })
            expect(typeof record.pairedAt).toBe('number')
            expect(JSON.stringify([...mem.files.values()])).not.toContain('secret')
            expect(secure.values.get(`localLink.secret.${linkId}`)).toMatch(/^[A-Za-z0-9_-]{43}$/)
            expect(secure.values.size).toBe(1)

            expect(props().links).toMatchObject([{ linkId, displayName: 'Incyclist Computer', reachability: 'reachable', connected: true }])
            expect(client.getSession(linkId)).toMatchObject({ mediaPort: 6002, catalogVersion: 'cv1', capabilities: ['route-sharing', 'route-descriptor'] })
            expect((mem.files.get(linkId) as { lastSeenAt?: number }).lastSeenAt).toEqual(expect.any(Number))
        })
        describe('paired record from a computer', () => {
            const rogueUrl = `${ROGUE_ADDRESS}:${ROGUE_PORT}`
            const pairWithRogue = async (linkId: unknown, secret = 'A'.repeat(43)) => {
                const rogue = new RogueEndpoint({
                    pairingOpen: true,
                    handler: (msg, send) => {
                        if (msg.t === 'pair-request')
                            send('pending', { outcome: 'pending', requestId: 'r1', expiresIn: 120 }, msg.id)
                        if (msg.t === 'pair-verify')
                            send('paired', { outcome: 'paired', linkId: linkId as string, secret, name: 'Rogue', protocolVersion: { major: 1, minor: 0 } }, msg.id)
                    },
                })
                net.endpoints.set(rogueUrl, rogue)
                announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]
                await run(client.startSearch())
                await run(client.selectComputer(rogueUrl))
                await until(stepIs('code'))
                client.submitCode('123456')
                await until(stepIs('failed'))
            }

            test.each([['not a UUID', 'abc'], ['path-like', '../x'], ['empty', ''], ['not a string', 42]])('a linkId that is %s fails the pairing and stores nothing', async (_n, linkId) => {
                await pairWithRogue(linkId)
                expect(pairingState()).toMatchObject({ reason: 'connection-lost', recovery: 'try-again' })
                expect(mem.files.size).toBe(0)
                expect(secure.values.size).toBe(0)
            })
            // A computer that answers with a linkId we already hold must not replace that record or its
            // secret, even with a valid-looking exchange. The failure reuses `connection-lost`.
            test('a linkId that is already paired is refused; record and secret stay untouched', async () => {
                const linkId = await pairPhone()
                const record = JSON.stringify(mem.files.get(linkId))
                const secretKey = `localLink.secret.${linkId}`
                const secret = secure.values.get(secretKey)

                await pairWithRogue(linkId, 'B'.repeat(43))

                expect(pairingState()).toMatchObject({ reason: 'connection-lost', recovery: 'try-again' })
                expect(secure.values.get(secretKey)).toBe(secret)
                expect(JSON.stringify(mem.files.get(linkId))).toBe(record)
                expect(mem.files.size).toBe(1)
            })
        })
        test('the pairing request carries a generic device name, not a person name', async () => {
            await pairPhone()
            expect(host.getDisplayProps().devices.map(d => d.name)).toEqual(['iOS device'])
        })
        test('wrong code: stays on the code step with the tries left; the third wrong one invalidates the code', async () => {
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))
            const pin = host.getDisplayProps().connectWindow!.pin!
            const wrong = pin === '000000' ? '111111' : '000000'

            client.submitCode(wrong)
            await until(() => (pairingState() as { wrong?: boolean }).wrong === true)
            expect(pairingState()).toMatchObject({ step: 'code', wrong: true, attemptsLeft: 2 })
            client.submitCode(wrong)
            await until(() => (pairingState() as { attemptsLeft?: number }).attemptsLeft === 1)
            client.submitCode(wrong)
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'invalidated', recovery: 'get-new-code' })
        })
        test('get a new code: a fresh request on the cached address, no new search', async () => {
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))
            const firstPin = host.getDisplayProps().connectWindow!.pin!
            // the code expires on the desktop and is pushed to the phone
            await jest.advanceTimersByTimeAsync(121_000)
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'expired', recovery: 'get-new-code' })

            mdns.find.mockClear()
            await run(client.retryPairing())
            await until(stepIs('code'))
            expect(mdns.find).not.toHaveBeenCalled()
            expect(host.getDisplayProps().connectWindow!.pin).toBeDefined()
            expect(firstPin).toMatch(/^\d{6}$/)
        })
        test('denied on the desktop: back to the results only', async () => {
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))
            host.denyPairing()
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'denied', recovery: 'back' })
        })
        test('superseded by another device: try again', async () => {
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))

            const other = new LinkClientConnection(net.createSocket() as never)
            await run(other.connect(HOST_ADDRESS, 6001))
            await run(other.hello())
            other.send('pair-request', { clientName: 'Other' })
            await run(other.receive())
            other.close()

            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'superseded', recovery: 'try-again' })
        })
        test('closed connect window: not ready (hello says so), try again goes to the same address', async () => {
            const rogue = new RogueEndpoint({ pairingOpen: false })
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]
            await run(client.startSearch())
            await run(client.selectComputer(`${ROGUE_ADDRESS}:${ROGUE_PORT}`))
            await until(stepIs('not-ready'))
            expect(pairingState()).toMatchObject({ step: 'not-ready', name: 'Den PC' })
            expect(rogue.received.map(m => m.t)).toEqual(['hello'])

            mdns.find.mockClear()
            await run(client.retryPairing())
            await until(stepIs('not-ready'))
            expect(mdns.find).not.toHaveBeenCalled()
        })
        test('pair-request answered pairing-closed: not ready', async () => {
            const rogue = new RogueEndpoint({
                pairingOpen: true,
                handler: (msg, send) => { if (msg.t === 'pair-request') send('pair-failed', { outcome: 'pairing-closed' }, msg.id) },
            })
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]
            await run(client.startSearch())
            await run(client.selectComputer(`${ROGUE_ADDRESS}:${ROGUE_PORT}`))
            await until(stepIs('not-ready'))
        })
        test('rate-limited: a retry is refused until retryAfter has elapsed', async () => {
            const rogue = new RogueEndpoint({
                pairingOpen: true,
                handler: (msg, send) => { if (msg.t === 'pair-request') send('pair-failed', { outcome: 'rate-limited', retryAfter: 30 }, msg.id) },
            })
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]
            await run(client.startSearch())
            await run(client.selectComputer(`${ROGUE_ADDRESS}:${ROGUE_PORT}`))
            await until(stepIs('failed'))
            const state = pairingState() as { reason: string, retryAt: number, recovery: string }
            expect(state).toMatchObject({ reason: 'rate-limited', recovery: 'try-again' })
            expect(state.retryAt).toBeGreaterThan(Date.now() + 29_000)

            await client.retryPairing()
            expect(rogue.connections).toBe(1)

            await jest.advanceTimersByTimeAsync(31_000)
            await run(client.retryPairing())
            expect(rogue.connections).toBe(2)
        })
        test('a computer that cannot be reached', async () => {
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            net.endpoints.delete(HOST_ID)
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'unreachable', recovery: 'try-again' })
        })
        test('losing the connection while the code is shown', async () => {
            const rogue = new RogueEndpoint({
                pairingOpen: true,
                handler: (msg, send) => { if (msg.t === 'pair-request') send('pending', { outcome: 'pending', requestId: 'r1', expiresIn: 120 }, msg.id) },
            })
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]
            await run(client.startSearch())
            await run(client.selectComputer(`${ROGUE_ADDRESS}:${ROGUE_PORT}`))
            await until(stepIs('code'))
            // the desktop closes the connection
            ;(client as unknown as { pairingFlow: { conn: { socket: { emit: (e: string) => void } } } }).pairingFlow.conn.socket.emit('close')
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'connection-lost', recovery: 'try-again' })
        })
        test('a computer with an incompatible protocol major version: back', async () => {
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, new RogueEndpoint({ refuseVersion: true }))
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]
            await run(client.startSearch())
            await run(client.selectComputer(`${ROGUE_ADDRESS}:${ROGUE_PORT}`))
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'version-mismatch', recovery: 'back' })
        })
        test('fails closed when the secret cannot be stored', async () => {
            secure.binding.set.mockResolvedValueOnce(false)
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))
            client.submitCode(host.getDisplayProps().connectWindow!.pin!)
            await until(stepIs('failed'))
            expect(pairingState()).toMatchObject({ reason: 'storage-unavailable', recovery: 'back' })
            expect(mem.files.size).toBe(0)
            expect(props().links).toEqual([])
        })
        test('cancelPairing closes the connection and returns to idle', async () => {
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))
            client.cancelPairing()
            expect(pairingState()).toEqual({ step: 'idle' })
            await until(() => hostLink.link.close.mock.calls.length > 0 || host.getDisplayProps().connectWindow?.notice === 'abandoned')
        })
        test('submitCode ignores anything but six digits', async () => {
            await host.openPairing()
            announced = [hostAnnouncement()]
            await run(client.startSearch())
            await run(client.selectComputer(HOST_ID))
            await until(stepIs('code'))
            client.submitCode('12ab56')
            client.submitCode('123')
            await jest.advanceTimersByTimeAsync(500)
            expect(pairingState()).toMatchObject({ step: 'code' })
            expect((pairingState() as { wrong?: boolean }).wrong).toBeUndefined()
        })
    })

    describe('recognising a paired computer', () => {
        test('the search marks an already paired computer and selecting it does not pair again', async () => {
            const linkId = await pairPhone()
            client.cancelPairing()
            const clientsBefore = host.getDisplayProps().devices.length

            const search = await run(client.startSearch()) as { computers: Array<{ linkId?: string }> }
            await until(() => props().discovery.phase === 'done' && !(props().discovery as { computers: Array<{ recognizing: boolean }> }).computers[0].recognizing)
            const computers = (props().discovery as { computers: Array<{ linkId?: string }> }).computers
            expect(computers[0].linkId).toBe(linkId)
            expect(search.computers).toHaveLength(1)

            await run(client.selectComputer(HOST_ID))
            expect(pairingState()).toMatchObject({ step: 'connected', linkId, already: true })
            expect(host.getDisplayProps().devices.length).toBe(clientsBefore)
        })
    })

    describe('check', () => {
        test('reconnects on the saved address with challenge-response and no browse', async () => {
            const linkId = await pairPhone()
            const secret = secure.values.get(`localLink.secret.${linkId}`)!
            const first = client.getSession(linkId)!
            await restartPhoneWithoutHost()
            net.endpoints.set(HOST_ID, hostLink.endpoint)
            expect(props().links[0].reachability).toBe('not-reachable')

            mdns.find.mockClear()
            await run(client.check())

            const second = client.getSession(linkId)!
            expect(second.mediaToken).not.toBe(first.mediaToken)
            expect(props().links[0]).toMatchObject({ reachability: 'reachable', connected: true })
            expect(mdns.find).not.toHaveBeenCalled()
            // the secret never travels
            expect(Buffer.concat(net.written).toString('latin1')).not.toContain(secret)
        })
        test('a wrong secret: the computer proves nothing and no session opens', async () => {
            const linkId = await pairPhone()
            const secret = secure.values.get(`localLink.secret.${linkId}`)!
            await restartPhoneWithoutHost()
            net.endpoints.set(HOST_ID, hostLink.endpoint)
            const wrong = crypto.randomBytes(32).toString('base64url')
            secure.values.set(`localLink.secret.${linkId}`, wrong)

            await run(client.check())

            expect(client.getSession(linkId)).toBeUndefined()
            expect(props().links[0].reachability).toBe('not-reachable')
            const wire = Buffer.concat(net.written).toString('latin1')
            expect(wire).not.toContain(secret)
            expect(wire).not.toContain(wrong)
        })
        test('a link without a secret is never reached', async () => {
            const linkId = await pairPhone()
            await restartPhoneWithoutHost()
            net.endpoints.set(HOST_ID, hostLink.endpoint)
            secure.values.delete(`localLink.secret.${linkId}`)
            await run(client.check())
            expect(client.getSession(linkId)).toBeUndefined()
        })
        test('a computer with a different protocol major version is reported as such, without a browse', async () => {
            const linkId = await pairPhone()
            await restartPhoneWithoutHost()
            net.endpoints.set(HOST_ID, new RogueEndpoint({ refuseVersion: true }))
            mdns.find.mockClear()
            await run(client.check())
            expect(client.getSession(linkId)).toBeUndefined()
            expect(props().links[0].reachability).toBe('version-mismatch')
            expect(mdns.find).not.toHaveBeenCalled()
        })
        test('a running check is shared', async () => {
            await pairPhone()
            await restartPhoneWithoutHost()
            net.endpoints.set(HOST_ID, hostLink.endpoint)
            const a = client.check()
            const b = client.check()
            expect(b).toBe(a)
            await run(a)
        })
    })

    describe('bounded automatic recovery', () => {
        let linkId: string
        /** watch listening is not a browse: only an exclusive use of the discovery counts */
        const browses = () => access.pauseBackgroundActivity.mock.calls.filter(c => c[0] === 'local-link').length

        beforeEach(async () => {
            linkId = await pairPhone()
            await restartPhoneWithoutHost()
            announced = []
            mdns.find.mockClear()
            mdns.connect.mockClear()
            access.pauseBackgroundActivity.mockClear()
        })

        test('after a failed saved address, one idle-only browse finds the computer at its new address', async () => {
            net.endpoints.set('192.168.1.77:6001', hostLink.endpoint)
            announced = [{ ...hostAnnouncement(), address: '192.168.1.77' }]

            await run(client.check())

            expect(browses()).toBe(1)
            expect(access.pauseBackgroundActivity).toHaveBeenCalledWith('local-link')
            expect(client.getSession(linkId)).toMatchObject({ host: '192.168.1.77' })
            expect((mem.files.get(linkId) as { lastAddress: unknown }).lastAddress).toEqual({ host: '192.168.1.77', controlPort: 6001 })
            expect(props().searchBlocked).toBeUndefined()
        })
        test('at most once per 10 minutes and 3 times per session', async () => {
            await run(client.check())
            expect(browses()).toBe(1)

            await run(client.check())
            expect(browses()).toBe(1)
            expect(props().searchBlocked).toEqual({ reason: 'rate-limited', automatic: true })
            expect(props().recovery).toMatchObject({ autoBrowsesUsed: 1, autoBrowsesMax: 3, nextAutoBrowseAt: expect.any(Number) })

            await jest.advanceTimersByTimeAsync(10 * 60_000 + 1000)
            await run(client.check())
            expect(browses()).toBe(2)

            await jest.advanceTimersByTimeAsync(10 * 60_000 + 1000)
            await run(client.check())
            expect(browses()).toBe(3)

            await jest.advanceTimersByTimeAsync(10 * 60_000 + 1000)
            await run(client.check())
            expect(browses()).toBe(3)
            expect(props().recovery).toMatchObject({ autoBrowsesUsed: 3, nextAutoBrowseAt: undefined })
            expect(props().searchBlocked).toEqual({ reason: 'rate-limited', automatic: true })
        })
        test('"check again" bypasses the window and the count', async () => {
            await run(client.check())
            expect(browses()).toBe(1)
            for (let i = 0; i < 5; i++)
                await run(client.check({ manual: true }))
            expect(browses()).toBe(6)
            expect(props().recovery.autoBrowsesUsed).toBe(1)
        })
        test.each([
            ['ride', () => { rideState = 'Started' }],
            ['device-scan', () => { access.scanning = true }],
            ['device-pairing', () => { devicePairing.isPairing.mockReturnValue(true) }],
        ])('never while busy (%s), not even for "check again", and the state says so', async (reason, makeBusy) => {
            makeBusy()
            await run(client.check())
            await run(client.check({ manual: true }))
            expect(browses()).toBe(0)
            expect(access.pauseBackgroundActivity).not.toHaveBeenCalled()
            expect(props().searchBlocked).toEqual({ reason, automatic: false })
            // rows keep their last state
            expect(props().links[0].reachability).toBe('not-reachable')
        })
        test('a blocked browse does not use up the allowance', async () => {
            rideState = 'Active'
            await run(client.check())
            expect(props().searchBlocked).toEqual({ reason: 'ride', automatic: true })
            expect(props().recovery.autoBrowsesUsed).toBe(0)

            rideState = 'Idle'
            await run(client.check())
            expect(browses()).toBe(1)
            expect(props().searchBlocked).toBeUndefined()
        })
        test('a search by the user starts the 10-minute window as well', async () => {
            await run(client.startSearch())
            access.pauseBackgroundActivity.mockClear()
            await run(client.check())
            expect(browses()).toBe(0)
            expect(props().searchBlocked).toEqual({ reason: 'rate-limited', automatic: true })
        })
        test('the secret is never sent to a candidate that does not prove to be the computer', async () => {
            const secret = secure.values.get(`localLink.secret.${linkId}`)!
            const rogue = new RogueEndpoint()
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]

            // the passive watch would probe the announcement as well: this test is about the browse
            client.onBackground()
            await run(client.check({ manual: true }))
            await run(client.check({ manual: true }))

            expect(client.getSession(linkId)).toBeUndefined()
            const probes = rogue.received.filter(m => m.t === 'auth') as Array<{ b: { nc: string, kids: string[] } }>
            expect(probes).toHaveLength(2)
            expect(probes[0].b.kids).toHaveLength(1)
            // key identifiers differ in every probe: the phone cannot be tracked by them
            expect(probes[0].b.nc).not.toBe(probes[1].b.nc)
            expect(probes[0].b.kids[0]).not.toBe(probes[1].b.kids[0])
            expect(rogue.payloads.join('')).not.toContain(secret)
            expect(rogue.received.every(m => m.t === 'hello' || m.t === 'auth')).toBe(true)
        })
    })

    describe('session', () => {
        test('pings every 15 s and the computer answers', async () => {
            const linkId = await pairPhone()
            hostLink.link.send.mockClear()
            await jest.advanceTimersByTimeAsync(15_100)
            const types = hostLink.link.send.mock.calls.map(c => JSON.parse(c[1] as string).t)
            expect(types).toContain('pong')
            expect(client.getSession(linkId)).toBeDefined()
        })
        test('45 s of silence end the session; the state says not reachable', async () => {
            const linkId = await pairPhone()
            const events: unknown[] = []
            client.on('session-changed', e => events.push(e))
            hostLink.link.send.mockImplementation(async () => ({ ok: true }))

            await jest.advanceTimersByTimeAsync(46_000)

            expect(client.getSession(linkId)).toBeUndefined()
            expect(props().links[0].reachability).toBe('not-reachable')
            expect(events).toContainEqual({ linkId, session: undefined })
        })
        test('a lost session is re-established on the saved address without a browse', async () => {
            const linkId = await pairPhone()
            const before = client.getSession(linkId)!
            access.pauseBackgroundActivity.mockClear()

            // the desktop closes the connection (e.g. its window reloaded)
            const ids = hostLink.link.send.mock.calls.length
            expect(ids).toBeGreaterThan(0)
            await hostLink.link.close('c2', 'renderer-gone')
            await until(() => client.getSession(linkId) === undefined || client.getSession(linkId)!.mediaToken !== before.mediaToken)
            await until(() => client.getSession(linkId) !== undefined && client.getSession(linkId)!.mediaToken !== before.mediaToken)
            expect(access.pauseBackgroundActivity).not.toHaveBeenCalledWith('local-link')
        })
        test('forwards pushed messages', async () => {
            const linkId = await pairPhone()
            const pushed: unknown[] = []
            client.on('push', e => pushed.push(e))
            const conn = [...hostLink.link.send.mock.calls].length
            expect(conn).toBeGreaterThan(0)
            // the host answers echo (signed): it arrives like any other push
            const active = (client as unknown as { sessions: Map<string, { conn: LinkClientConnection }> }).sessions.get(linkId)!
            active.conn.send('echo', { data: 'x' }, 'e1')
            await until(() => pushed.length > 0)
            expect(pushed[0]).toMatchObject({ linkId, message: { t: 'echo', id: 'e1', b: { data: 'x' } } })
        })
    })

    describe('request', () => {
        test('the reply resolves the request and is not emitted as a push; other messages still are', async () => {
            const linkId = await pairPhone()
            const pushed: Array<{ message: { t: string, id?: string } }> = []
            client.on('push', e => pushed.push(e))

            const handler = sharing.on.mock.calls.find(c => c[0] === 'catalog-changed')![1]
            handler({ catalogVersion: 'cv9', routeCount: 1 })
            const reply = await client.request(linkId, 'echo', { data: 42 }, 5000)

            expect(reply).toMatchObject({ t: 'echo', b: { data: 42 } })
            expect(reply!.id).toMatch(/^[0-9a-f]{16}$/)
            await until(() => pushed.some(p => p.message.t === 'catalog-changed'))
            expect(pushed.some(p => p.message.t === 'echo')).toBe(false)
        })
        test('without an open session there is no request and nothing is connected', async () => {
            const linkId = await pairPhone()
            await client.forget(linkId)
            expect(await client.request(linkId, 'echo', { data: 1 }, 1000)).toBeUndefined()
        })
    })

    describe('catalog-changed push', () => {
        test('a rebuilt catalog on the computer reaches the phone as a signed push', async () => {
            const linkId = await pairPhone()
            const pushed: Array<{ linkId: string, message: { t: string, b: unknown } }> = []
            client.on('push', e => pushed.push(e))

            const handler = sharing.on.mock.calls.find(c => c[0] === 'catalog-changed')![1]
            handler({ catalogVersion: 'cv2', routeCount: 4 })

            await until(() => pushed.length > 0)
            expect(pushed[0]).toMatchObject({ linkId, message: { t: 'catalog-changed', b: { catalogVersion: 'cv2' } } })
        })
    })

    describe('media', () => {
        let pipe: { start: jest.Mock, stop: jest.Mock }

        beforeEach(() => {
            pipe = {
                start: jest.fn(async (_o: { upstreamHost: string, upstreamPort: number }) => ({ port: 54321 })),
                stop: jest.fn(async (_port?: number) => undefined),
            }
        })
        afterEach(() => {
            delete bindings.loopbackPipe
        })

        test('iOS: direct http://host:mediaPort, no pipe', async () => {
            bindings.loopbackPipe = pipe
            const linkId = await pairPhone()
            expect(await client.getMediaBaseUrl(linkId)).toBe(`http://${HOST_ADDRESS}:6002`)
            expect(pipe.start).not.toHaveBeenCalled()
            const media = await client.getMedia(linkId)
            expect(media).toMatchObject({ baseUrl: `http://${HOST_ADDRESS}:6002`, catalogVersion: 'cv1' })
            expect(media!.token).toEqual(expect.any(String))
        })
        test('iOS: through the pipe when it is switched on', async () => {
            bindings.loopbackPipe = pipe
            const linkId = await pairPhone()
            client.setMediaPipeEnabled(true)
            expect(await client.getMediaBaseUrl(linkId)).toBe('http://127.0.0.1:54321')
            expect(pipe.start).toHaveBeenCalledWith({ upstreamHost: HOST_ADDRESS, upstreamPort: 6002 })
        })
        test('iOS: switched on but no pipe binding falls back to direct', async () => {
            const linkId = await pairPhone()
            client.setMediaPipeEnabled(true)
            expect(await client.getMediaBaseUrl(linkId)).toBe(`http://${HOST_ADDRESS}:6002`)
        })
        test('Android: always through the loopback pipe, to the session upstream', async () => {
            platform = 'android'
            bindings.loopbackPipe = pipe
            const linkId = await pairPhone()
            expect(await client.getMediaBaseUrl(linkId)).toBe('http://127.0.0.1:54321')
            expect(await client.getMediaBaseUrl(linkId)).toBe('http://127.0.0.1:54321')
            expect(pipe.start).toHaveBeenCalledTimes(1)
            expect(pipe.start).toHaveBeenCalledWith({ upstreamHost: HOST_ADDRESS, upstreamPort: 6002 })
            expect(client.isMediaAvailable()).toBe(true)

            await client.releaseMedia(linkId)
            expect(pipe.stop).toHaveBeenCalledWith(54321)
        })
        test('Android without the pipe binding: media is unavailable, control still works', async () => {
            platform = 'android'
            const linkId = await pairPhone()
            expect(client.isMediaAvailable()).toBe(false)
            expect(await client.getMediaBaseUrl(linkId)).toBeUndefined()
            expect(await client.getMedia(linkId)).toBeUndefined()
            expect(props().links[0]).toMatchObject({ reachability: 'reachable', mediaAvailable: false })
        })
        test('a media token that expires soon is replaced by a new session first', async () => {
            const linkId = await pairPhone()
            const before = await client.getMedia(linkId)
            jest.setSystemTime(Date.now() + 12 * 3600_000 - 60_000)

            const after = await run(client.getMedia(linkId))

            expect(after!.token).not.toBe(before!.token)
            expect(after!.expiresAt).toBeGreaterThan(before!.expiresAt)
        })
        test('a computer that does not answer has no media', async () => {
            const linkId = await pairPhone()
            await restartPhoneWithoutHost()
            expect(await run(client.getMedia(linkId))).toBeUndefined()
        })
    })

    describe('on-demand retries and the passive reconnect watch', () => {
        let linkId: string
        let events: Array<Record<string, unknown>>
        const connects = () => net.connects.length
        const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms)
        const watchFinds = () => mdns.find.mock.calls.filter(c => c[0]?.type === 'incyclist').length
        const announce = (a: Announcement = hostAnnouncement()) => { finders.filter(f => f.type === 'incyclist').at(-1)?.cb(a) }
        const watch = () => (client as unknown as { watch: { isArmed(): boolean, isRunning(): boolean } }).watch
        const internals = () => client as unknown as {
            shouldWatch: () => boolean, getBusyReason: () => unknown, getRetryTargets: () => unknown,
            connectKnown: () => Promise<boolean>, watchStats: { probes: number, suppressed: number },
        }
        const reconnected = () => events.filter(e => e.message === 'local-link reconnected')

        beforeEach(async () => {
            linkId = await pairPhone()
            await restartPhoneWithoutHost()
            events = []
            jest.spyOn(client as unknown as { logEvent: (e: Record<string, unknown>) => void }, 'logEvent').mockImplementation(e => { events.push(e) })
            mdns.find.mockClear()
            mdns.connect.mockClear()
            mdns.stopFind?.mockClear()
            access.pauseBackgroundActivity.mockClear()
            net.connects.length = 0
        })

        describe('timers', () => {
            test('there is no background retry: nothing is tried while time passes, nothing browses', async () => {
                await advance(10 * 60_000)
                expect(connects()).toBe(0)
                expect(access.pauseBackgroundActivity).not.toHaveBeenCalledWith('local-link')
            })
            test('the background retry delays are gone, the short retry after a lost session stays', () => {
                expect('BACKGROUND_RECONNECT_DELAYS_MS' in consts).toBe(false)
                expect(consts.RECONNECT_DELAYS_MS).toEqual([1000, 3000, 10_000])
            })
        })

        describe('on-demand triggers', () => {
            test('retryNow tries immediately', async () => {
                client.retryNow()
                await advance(1)
                expect(connects()).toBe(1)
            })
            test('no attempt while the app is in the background, one right away when it returns', async () => {
                client.onBackground()
                client.retryNow()
                await advance(10 * 60_000)
                expect(connects()).toBe(0)
                client.onForeground()
                await advance(1)
                expect(connects()).toBe(1)
            })
            test('a change of the phone network tries the saved address and re-arms the watch', async () => {
                client.onNetworkChange()
                await advance(1)
                expect(connects()).toBe(1)
                expect(watch().isRunning()).toBe(true)
            })
            test('no attempt during a ride, a device scan or a device pairing, an attempt when idle again', async () => {
                rideState = 'Active'
                client.retryNow()
                access.scanning = true
                rideState = 'Idle'
                client.retryNow()
                access.scanning = false
                devicePairing.isPairing.mockReturnValue(true)
                client.retryNow()
                await advance(1)
                expect(connects()).toBe(0)
                devicePairing.isPairing.mockReturnValue(false)
                client.retryNow()
                await advance(1)
                expect(connects()).toBeGreaterThan(0)
            })
            test('a forgotten computer is not retried, and the watch ends', async () => {
                await client.forget(linkId)
                client.retryNow()
                await advance(5 * 60_000)
                expect(connects()).toBe(0)
                expect(watch().isRunning()).toBe(false)
            })
            test('no attempt when the feature is off', async () => {
                features.BRIDGE_MODE = false
                client.retryNow()
                client.onNetworkChange()
                await advance(5 * 60_000)
                expect(connects()).toBe(0)
            })
            test('attempts never overlap', async () => {
                let release: () => void = () => undefined
                const spy = jest.spyOn(internals(), 'connectKnown')
                    .mockImplementation(() => new Promise<boolean>(resolve => { release = () => resolve(false) }))
                client.retryNow()
                await advance(1)
                expect(spy).toHaveBeenCalledTimes(1)
                client.retryNow()
                client.onForeground()
                client.onNetworkChange()
                await advance(5 * 60_000)
                expect(spy).toHaveBeenCalledTimes(1)
                release()
                await advance(1)
                client.retryNow()
                await advance(1)
                expect(spy).toHaveBeenCalledTimes(2)
                release()
            })
            test('never throws, also when the checks fail', async () => {
                jest.spyOn(internals(), 'getBusyReason').mockImplementation(() => { throw new Error('boom') })
                expect(() => { client.retryNow(); client.onForeground(); client.onBackground(); client.onNetworkChange() }).not.toThrow()
                jest.spyOn(internals(), 'getRetryTargets').mockImplementation(() => { throw new Error('boom') })
                expect(() => { client.retryNow(); client.onForeground(); client.onBackground(); client.onNetworkChange() }).not.toThrow()
                await expect(advance(60_000)).resolves.not.toThrow()
            })
        })

        describe('when the watch runs', () => {
            test('foreground, idle, a computer without a session', () => {
                expect(watch().isRunning()).toBe(true)
                expect(watch().isArmed()).toBe(true)
            })
            test('not in the background; again, and armed again, in the foreground', () => {
                client.onBackground()
                expect(watch().isRunning()).toBe(false)
                expect(mdns.stopFind).toHaveBeenCalledWith('incyclist', 'tcp')
                expect(mdns.disconnect).not.toHaveBeenCalled()
                mdns.find.mockClear()
                client.onForeground()
                expect(watch().isRunning()).toBe(true)
                expect(watchFinds()).toBe(1)
            })
            test('not during a ride', () => {
                rideState = 'Active'
                client.onNetworkChange()
                expect(watch().isRunning()).toBe(false)
                expect(mdns.stopFind).toHaveBeenCalledWith('incyclist', 'tcp')
                announce()
                expect(connects()).toBe(0)
                rideState = 'Idle'
                client.onNetworkChange()
                expect(watch().isRunning()).toBe(true)
            })
            test('not when every computer has a session', async () => {
                net.endpoints.set(HOST_ID, hostLink.endpoint)
                client.retryNow()
                await until(() => client.getSession(linkId) !== undefined)
                expect(watch().isRunning()).toBe(false)
                expect(mdns.stopFind).toHaveBeenCalledWith('incyclist', 'tcp')
            })
            test('not on a binding without stopFind', () => {
                client.onBackground()
                mdns.stopFind = undefined
                mdns.find.mockClear()
                client.onForeground()
                expect(watch().isRunning()).toBe(false)
                expect(watchFinds()).toBe(0)
            })
            test('not when the native app does not carry the feature (iOS: no Bonjour service declared)', () => {
                client.onBackground()
                nativeFeatures = []
                mdns.find.mockClear()
                client.onForeground()
                expect(watch().isRunning()).toBe(false)
                expect(watchFinds()).toBe(0)
                announce()
                expect(connects()).toBe(0)
            })
            test('not while an Add Computer browse has the discovery, armed again right after it', async () => {
                const search = client.startSearch()
                await until(() => access.pauseBackgroundActivity.mock.calls.length > 0)
                expect(watch().isRunning()).toBe(false)
                await run(search)
                expect(watch().isRunning()).toBe(true)
                expect(watch().isArmed()).toBe(true)
                const lastFind = mdns.find.mock.invocationCallOrder.at(-1) as number
                expect(lastFind).toBeGreaterThan(access.resumeBackgroundActivity.mock.invocationCallOrder.at(-1) as number)
            })
        })

        describe('duty cycle and joined rotation', () => {
            test('without a trainer rotation: 4 s on, every 20 s', async () => {
                // the watch started in init(): on at 0
                await advance(3999)
                expect(mdns.stopFind).not.toHaveBeenCalled()
                await advance(1)
                expect(mdns.stopFind).toHaveBeenCalledTimes(1)
                expect(watch().isArmed()).toBe(false)
                expect(watch().isRunning()).toBe(true)
                await advance(15_999)
                expect(watchFinds()).toBe(0)
                await advance(1)
                expect(watchFinds()).toBe(1)
                expect(watch().isArmed()).toBe(true)
                await advance(4000)
                expect(mdns.stopFind).toHaveBeenCalledTimes(2)
            })
            test('with a trainer rotation: joins it, never stops its own browser, re-arms every 20 s', async () => {
                access.wifiConnected = true
                client.onNetworkChange()
                expect(watchFinds()).toBe(1)
                mdns.stopFind?.mockClear()
                await advance(19_999)
                expect(mdns.stopFind).not.toHaveBeenCalled()
                expect(watchFinds()).toBe(1)
                await advance(1)
                expect(watchFinds()).toBe(2)
                expect(mdns.stopFind).not.toHaveBeenCalled()
                expect(mdns.disconnect).not.toHaveBeenCalled()
            })
            test('switches from one to the other when the trainer rotation starts or ends', async () => {
                await advance(5000)
                expect(watch().isArmed()).toBe(false)
                access.wifiConnected = true
                await advance(20_000)
                expect(watch().isArmed()).toBe(true)
                await advance(60_000)
                expect(watch().isArmed()).toBe(true)
                access.wifiConnected = false
                await advance(20_000)
                await advance(4000)
                expect(watch().isArmed()).toBe(false)
            })
            test('a binding that was reset is re-armed by the next periodic check', async () => {
                access.wifiConnected = true
                client.onNetworkChange()
                mdns.find.mockClear()
                await advance(20_000)
                expect(watchFinds()).toBe(1)
            })
        })

        describe('announcements', () => {
            test('the computer announces itself: reconnected within the round, no browse, no budget used', async () => {
                net.endpoints.set(HOST_ID, hostLink.endpoint)
                announce()
                await until(() => client.getSession(linkId) !== undefined)
                expect(props().links[0]).toMatchObject({ reachability: 'reachable', connected: true })
                expect(access.pauseBackgroundActivity).not.toHaveBeenCalled()
                expect(props().recovery.autoBrowsesUsed).toBe(0)
                expect(reconnected()).toEqual([{ message: 'local-link reconnected', source: 'watch', msSinceUnreachable: expect.any(Number) }])
                expect(events).toContainEqual(expect.objectContaining({ message: 'local-link watch probe', outcome: 'session' }))
                expect(watch().isRunning()).toBe(false)
            })
            test('watch probes do not use up the browse budget', async () => {
                for (const suffix of ['AAAA', 'BBBB', 'CCCC']) {
                    announce(hostAnnouncement(suffix))
                    await advance(100)
                }
                expect(connects()).toBe(3)
                expect(props().recovery.autoBrowsesUsed).toBe(0)
                await run(client.check())
                expect(access.pauseBackgroundActivity).toHaveBeenCalledWith('local-link')
                expect(props().recovery.autoBrowsesUsed).toBe(1)
            })
            test('the announcement of every scan round is probed once: in-flight and known announcements are skipped', async () => {
                announce()
                announce()
                await advance(100)
                announce()
                await advance(5000)
                announce()
                expect(connects()).toBe(1)
                expect(internals().watchStats.suppressed).toBe(3)
            })
            test('an announcement that did not answer is probed again after 30 s; a new suffix is a new announcement', async () => {
                announce()
                await advance(100)
                await advance(30_000)
                announce()
                await advance(100)
                expect(connects()).toBe(2)
                announce(hostAnnouncement('WXYZ'))
                await advance(100)
                expect(connects()).toBe(3)
            })
            test('one address is probed at most 3 times in 10 minutes', async () => {
                for (const suffix of ['AAAA', 'BBBB', 'CCCC', 'DDDD']) {
                    announce(hostAnnouncement(suffix))
                    await advance(100)
                }
                expect(connects()).toBe(3)
                await advance(10 * 60_000)
                announce(hostAnnouncement('EEEE'))
                await advance(100)
                expect(connects()).toBe(4)
            })
            test('a foreign computer is not probed again, not even later', async () => {
                const rogue = new RogueEndpoint({ refuseVersion: true })
                net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
                const foreign: Announcement = { type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }
                announce(foreign)
                await advance(1000)
                expect(rogue.connections).toBe(1)
                announce(foreign)
                await advance(10 * 60_000)
                announce(foreign)
                await advance(1000)
                expect(rogue.connections).toBe(1)
                expect(events).toContainEqual(expect.objectContaining({ message: 'local-link watch probe', outcome: 'version' }))
            })
            test('an address that already has a session is skipped', async () => {
                net.endpoints.set(HOST_ID, hostLink.endpoint)
                announce()
                await until(() => client.getSession(linkId) !== undefined)
                net.connects.length = 0
                jest.spyOn(internals(), 'shouldWatch').mockReturnValue(true)
                announce(hostAnnouncement('NEWS'))
                await advance(100)
                expect(connects()).toBe(0)
                expect(internals().watchStats.suppressed).toBeGreaterThan(0)
            })
            test('announcements of other types or without an address are ignored; nothing throws', async () => {
                announce({ type: 'wahoo', name: 'x', address: HOST_ADDRESS, port: 6001 })
                await advance(100)
                expect(connects()).toBe(0)
                announce({ type: 'incyclist', name: 'x', address: '', port: 0 })
                announce(null as unknown as Announcement)
                await advance(100)
                expect(connects()).toBe(0)
            })
        })

        describe('reconnect event', () => {
            test('on-demand: source and the time since the computer was unreachable', async () => {
                await advance(7000)
                net.endpoints.set(HOST_ID, hostLink.endpoint)
                client.retryNow()
                await until(() => client.getSession(linkId) !== undefined)
                expect(reconnected()).toEqual([{ message: 'local-link reconnected', source: 'on-demand', msSinceUnreachable: expect.any(Number) }])
                expect((reconnected()[0].msSinceUnreachable as number)).toBeGreaterThanOrEqual(7000)
            })
            test('after a lost session the short retry reports source reconnect', async () => {
                net.endpoints.set(HOST_ID, hostLink.endpoint)
                client.retryNow()
                await until(() => client.getSession(linkId) !== undefined)
                events.length = 0
                const sessions = (client as unknown as { sessions: Map<string, { intentional: boolean, conn: { close: () => void } }> }).sessions
                const active = sessions.get(linkId)!
                active.intentional = false
                active.conn.close()
                await until(() => reconnected().length > 0)
                expect(reconnected()).toEqual([{ message: 'local-link reconnected', source: 'reconnect', msSinceUnreachable: expect.any(Number) }])
                expect(client.getSession(linkId)).toBeDefined()
            })
        })
    })

    describe('rename and forget', () => {
        test('rename sets localName; every name shown uses it; empty resets', async () => {
            const linkId = await pairPhone()
            await client.rename(linkId, '  Study PC ')
            expect(props().links[0]).toMatchObject({ displayName: 'Study PC', name: 'Incyclist Computer', localName: 'Study PC' })
            expect((mem.files.get(linkId) as { localName: string }).localName).toBe('Study PC')

            await client.rename(linkId, '')
            expect(props().links[0]).toMatchObject({ displayName: 'Incyclist Computer', localName: undefined })
        })
        test('rename caps the name at 40 characters', async () => {
            const linkId = await pairPhone()
            await client.rename(linkId, 'x'.repeat(60))
            expect(props().links[0].localName).toHaveLength(40)
        })
        test('pairing again with the same computer keeps the local name', async () => {
            const linkId = await pairPhone()
            await client.rename(linkId, 'Study PC')
            client.cancelPairing()
            // the same computer pairs again (e.g. after the phone was removed on the desktop)
            await host.removeClient((host as unknown as { getClients: () => Array<{ clientId: string }> }).getClients()[0].clientId)
            await until(() => client.getSession(linkId) === undefined)
            const again = await pairPhone()
            expect(again).toBe(linkId)
            expect(props().links[0].localName).toBe('Study PC')
        })
        test('forget deletes record and secret, closes the session and tells listeners', async () => {
            const linkId = await pairPhone()
            const forgotten: string[] = []
            client.on('link-forgotten', id => forgotten.push(id))

            await client.forget(linkId)

            expect(mem.files.size).toBe(0)
            expect(secure.values.size).toBe(0)
            expect(client.getSession(linkId)).toBeUndefined()
            expect(props().links).toEqual([])
            expect(forgotten).toEqual([linkId])
            // no reconnect after an intentional close
            await jest.advanceTimersByTimeAsync(20_000)
            expect(client.getSession(linkId)).toBeUndefined()
        })
    })

    describe('init', () => {
        test('loads the records from the repository without touching the network', async () => {
            const linkId = await pairPhone()
            net.connects.length = 0
            client.reset()
            newClient()
            access.pauseBackgroundActivity.mockClear()
            announced = []
            await client.init()
            expect(props().links).toMatchObject([{ linkId, reachability: 'not-reachable' }])
            expect(net.connects).toEqual([])
            // the passive watch is armed, nothing else browses
            expect(mdns.find).toHaveBeenCalledTimes(2)
            expect(mdns.find).toHaveBeenLastCalledWith({ type: 'incyclist', protocol: 'tcp' }, expect.any(Function))
            expect(access.pauseBackgroundActivity).not.toHaveBeenCalledWith('local-link')
        })
        test('skips malformed records', async () => {
            mem.files.set('broken', { nonsense: true })
            await client.init()
            expect(props().links).toEqual([])
        })
    })
})
