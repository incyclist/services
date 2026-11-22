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
import { LocalLinkClientService } from './service'
import type { LinkPairingState, LocalLinkClientDisplayProps } from './types'

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
    let secure: ReturnType<typeof makeMemorySecureStorage>
    let access: FakeAccess
    let devicePairing: { isScanning: jest.Mock, isPairing: jest.Mock }
    let rideState: string
    let features: Record<string, boolean>
    let announced: Announcement[]
    let mdns: { connect: jest.Mock, disconnect: jest.Mock, find: jest.Mock }
    let platform: string
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
        mdns = {
            connect: jest.fn(), disconnect: jest.fn(),
            find: jest.fn((_opts: unknown, cb: (a: Announcement) => void) => { announced.forEach(a => cb(a)) }),
        }
        platform = 'ios'

        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        bindings.wifi = { net, mdns }
        bindings.db = mem.db
        bindings.secureStorage = secure.binding
        bindings.appInfo = { getOS: () => ({ platform }), getAppVersion: () => '1.0.0' }

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
        Inject('Sharing', {
            setTokens: jest.fn(async () => true), start: jest.fn(async () => undefined), stop: jest.fn(),
            getRouteCount: jest.fn(() => 3), getCatalogVersion: jest.fn(() => 'cv1'), on: jest.fn(), off: jest.fn(),
        })
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
            expect(mdns.disconnect).toHaveBeenCalled()
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
            expect(client.getSession(linkId)).toMatchObject({ mediaPort: 6002, catalogVersion: 'cv1', capabilities: ['route-sharing'] })
            expect((mem.files.get(linkId) as { lastSeenAt?: number }).lastSeenAt).toEqual(expect.any(Number))
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

            expect(mdns.find).toHaveBeenCalledTimes(1)
            expect(access.pauseBackgroundActivity).toHaveBeenCalledWith('local-link')
            expect(client.getSession(linkId)).toMatchObject({ host: '192.168.1.77' })
            expect((mem.files.get(linkId) as { lastAddress: unknown }).lastAddress).toEqual({ host: '192.168.1.77', controlPort: 6001 })
            expect(props().searchBlocked).toBeUndefined()
        })
        test('at most once per 10 minutes and 3 times per session', async () => {
            await run(client.check())
            expect(mdns.find).toHaveBeenCalledTimes(1)

            await run(client.check())
            expect(mdns.find).toHaveBeenCalledTimes(1)
            expect(props().searchBlocked).toEqual({ reason: 'rate-limited', automatic: true })
            expect(props().recovery).toMatchObject({ autoBrowsesUsed: 1, autoBrowsesMax: 3, nextAutoBrowseAt: expect.any(Number) })

            await jest.advanceTimersByTimeAsync(10 * 60_000 + 1000)
            await run(client.check())
            expect(mdns.find).toHaveBeenCalledTimes(2)

            await jest.advanceTimersByTimeAsync(10 * 60_000 + 1000)
            await run(client.check())
            expect(mdns.find).toHaveBeenCalledTimes(3)

            await jest.advanceTimersByTimeAsync(10 * 60_000 + 1000)
            await run(client.check())
            expect(mdns.find).toHaveBeenCalledTimes(3)
            expect(props().recovery).toMatchObject({ autoBrowsesUsed: 3, nextAutoBrowseAt: undefined })
            expect(props().searchBlocked).toEqual({ reason: 'rate-limited', automatic: true })
        })
        test('"check again" bypasses the window and the count', async () => {
            await run(client.check())
            expect(mdns.find).toHaveBeenCalledTimes(1)
            for (let i = 0; i < 5; i++)
                await run(client.check({ manual: true }))
            expect(mdns.find).toHaveBeenCalledTimes(6)
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
            expect(mdns.find).not.toHaveBeenCalled()
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
            expect(mdns.find).toHaveBeenCalledTimes(1)
            expect(props().searchBlocked).toBeUndefined()
        })
        test('a search by the user starts the 10-minute window as well', async () => {
            await run(client.startSearch())
            mdns.find.mockClear()
            await run(client.check())
            expect(mdns.find).not.toHaveBeenCalled()
            expect(props().searchBlocked).toEqual({ reason: 'rate-limited', automatic: true })
        })
        test('the secret is never sent to a candidate that does not prove to be the computer', async () => {
            const secret = secure.values.get(`localLink.secret.${linkId}`)!
            const rogue = new RogueEndpoint()
            net.endpoints.set(`${ROGUE_ADDRESS}:${ROGUE_PORT}`, rogue)
            announced = [{ type: 'incyclist', name: 'Den PC (AAAA)', address: ROGUE_ADDRESS, port: ROGUE_PORT }]

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
            mdns.find.mockClear()

            // the desktop closes the connection (e.g. its window reloaded)
            const ids = hostLink.link.send.mock.calls.length
            expect(ids).toBeGreaterThan(0)
            await hostLink.link.close('c2', 'renderer-gone')
            await until(() => client.getSession(linkId) === undefined || client.getSession(linkId)!.mediaToken !== before.mediaToken)
            await until(() => client.getSession(linkId) !== undefined && client.getSession(linkId)!.mediaToken !== before.mediaToken)
            expect(mdns.find).not.toHaveBeenCalled()
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
            await client.init()
            expect(props().links).toMatchObject([{ linkId, reachability: 'not-reachable' }])
            expect(net.connects).toEqual([])
            expect(mdns.find).toHaveBeenCalledTimes(1)
        })
        test('skips malformed records', async () => {
            mem.files.set('broken', { nonsense: true })
            await client.init()
            expect(props().links).toEqual([])
        })
    })
})
