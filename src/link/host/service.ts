import { getBindings } from '../../api/bindings'
import type { ILocalLinkBinding, LinkListener, ListenerResult, LocalLinkEvent } from '../../api/localLink/types'
import { useAppState } from '../../appstate/service'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { useRouteSharing } from '../../routes/sharing/service'
import { useUserSettings } from '../../settings/service'
import { answerLinkAuthProbe, verifyLinkAuthConfirm } from '../auth'
import { LinkServerChannel } from '../channel'
import { LINK_PROTOCOL_RANGE } from '../consts'
import { createUnsupportedProtocolError, isLinkProtocolRange, negotiateLinkHello } from '../version'
import type {
    LinkClientMessage, LinkErrorCode, LinkRejectReason, LinkServerMessageBodies, PairFailedBody,
} from '../types'
import {
    AUTH_MAX_FAILURES_PER_CONNECTION, AUTH_RATE_PER_PEER, AUTH_RATE_WINDOW_MS, AUTH_RESULT_DELAY_MS, DEFAULT_DISPLAY_NAME,
    LAST_SEEN_PERSIST_INTERVAL_MS, LINK_CAPABILITIES, LINK_LIMITS, MEDIA_TOKEN_BYTES, MEDIA_TOKEN_TTL_MS,
    MEDIA_TOKENS_PER_CLIENT, PAIRING_SECRET_BYTES, PAIRING_TTL_SECONDS, SETTINGS_KEY, UNAUTHENTICATED_DEADLINE_MS,
} from './consts'
import { LinkPairing } from './pairing'
import { SlidingWindowLimiter } from './rate-limit'
import type {
    DisplayNameResult, LinkConnection, LocalLinkAuthData, LocalLinkDevice, LocalLinkDisplayProps, LocalLinkPlatform,
    LocalLinkState, StoredMediaToken, StoredPairedClient,
} from './types'
import {
    buildInstanceName, newId, randomHostLabel, randomPin, randomSuffix, randomToken, sanitizeClientName, tokenDigest,
    validateDisplayName,
} from './utils'

type ServerMessageType = keyof LinkServerMessageBodies & string
type PortSettings = { control?: number, media?: number }

const PLATFORMS: Record<string, LocalLinkPlatform> = { win32: 'windows', darwin: 'macos', linux: 'linux' }

/**
 * Host side of the `local-link` (desktop): decides when the transport runs, what is announced,
 * who may pair and how a paired phone authenticates. The desktop shell only provides sockets;
 * every decision and every record lives here.
 *
 * Start policy: nothing runs before the first {@link openPairing}. From then on the transport
 * starts at {@link init} whenever at least one phone is paired and the link is not switched
 * off. Pairing is open only between {@link openPairing} and {@link closePairing}.
 *
 * Emits `state-changed` and `pairing-changed`, both with the new {@link LocalLinkDisplayProps}.
 *
 * Nothing that identifies a phone's network address, a pairing secret, a media token or a
 * frame payload is ever logged.
 */
@Singleton
export class LocalLinkService extends IncyclistService {
    protected connections = new Map<string, LinkConnection>()
    protected pairing: LinkPairing
    protected authLimiter = new SlidingWindowLimiter(AUTH_RATE_PER_PEER, AUTH_RATE_WINDOW_MS)
    protected auth?: LocalLinkAuthData
    protected starting?: Promise<boolean>
    protected running = false
    protected listening = { control: false, media: false }
    protected startError?: { code: string }
    protected suffix?: string
    protected hostLabel?: string
    protected pairingWanted = false
    protected unsubscribe?: () => void
    protected tokenTimer?: ReturnType<typeof setTimeout>
    protected lastSeenPersisted = new Map<string, number>()
    protected firewallNotice = false
    protected sharingListener?: () => void
    protected pushedCatalogVersion?: string

    constructor() {
        super('LocalLink')
        this.pairing = new LinkPairing({
            generatePin: randomPin,
            newRequestId: newId,
            onChange: () => this.onPairingChanged(),
            notify: (connectionId, body) => this.pushPairFailed(connectionId, body),
        })
    }

    // --- public API ---

    /** true if the feature is enabled and the desktop shell provides the transport */
    isAvailable(): boolean {
        try {
            return this.getAppState().hasFeature('BRIDGE_MODE') === true && this.getLink()?.isSupported() === true
        }
        catch (err) {
            this.logError(err as Error, 'isAvailable')
            return false
        }
    }

    /**
     * App start: with at least one paired phone and the link not switched off, starts the
     * transport and announces it. Pairing stays closed and no UI action is involved.
     */
    async init(): Promise<void> {
        try {
            if (!this.isAvailable() || this.getClients().length === 0 || this.isOff())
                return
            await this.startTransport()
        }
        catch (err) {
            this.logError(err as Error, 'init')
        }
    }

    /**
     * "Connect your phone": starts the transport if needed, switches the link on and opens
     * pairing. The connect window shows the phase `starting` until the listeners and the
     * announcement are up, or `error` if that fails (call again to retry).
     */
    async openPairing(): Promise<void> {
        try {
            if (!this.isAvailable())
                return
            this.pairingWanted = true
            this.setOff(false)
            this.emitState()

            const ok = await this.startTransport()
            if (ok && this.pairingWanted)
                this.pairing.open()
            this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'openPairing')
        }
    }

    /**
     * The pairing UI closed: pair requests are answered `pairing-closed`. Listeners stay up
     * while at least one phone is paired; with none, the transport is stopped again.
     */
    async closePairing(): Promise<void> {
        try {
            this.pairingWanted = false
            this.pairing.close()
            if (this.getClients().length === 0 && (this.running || this.starting))
                await this.stopTransport()
            this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'closePairing')
        }
    }

    /** Turns down the outstanding pairing request. */
    denyPairing(): void {
        try {
            this.pairing.deny()
        }
        catch (err) {
            this.logError(err as Error, 'denyPairing')
        }
    }

    /** The on/off switch: off stops the transport and withdraws the announcement (persisted). */
    async setEnabled(enabled: boolean): Promise<void> {
        try {
            if (!this.isAvailable() || this.getClients().length === 0)
                return
            this.setOff(!enabled)
            if (enabled)
                await this.startTransport()
            else
                await this.stopTransport()
            this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'setEnabled')
        }
    }

    /**
     * Renames this computer (max 40 characters; empty resets to the default) and re-announces.
     * The name is visible to everyone on the network.
     */
    async setDisplayName(name: string): Promise<DisplayNameResult> {
        try {
            if (!this.isAvailable())
                return { ok: false, error: 'unavailable' }
            const valid = validateDisplayName(name)
            if (!valid.ok)
                return valid
            this.getUserSettings().set(SETTINGS_KEY.displayName, valid.name ?? null)
            if (this.running)
                await this.announce().catch(err => this.logError(err, 'setDisplayName'))
            this.emitState()
            return { ok: true, name: this.getComputerName() }
        }
        catch (err) {
            this.logError(err as Error, 'setDisplayName')
            // fallback: the name could not be applied
            return { ok: false, error: 'unavailable' }
        }
    }

    /**
     * Forgets a phone: deletes its secret and media tokens, republishes the media-token digests
     * (which aborts its streams), then closes its connections. With no phone left (and pairing
     * closed) the transport stops.
     */
    async removeClient(clientId: string): Promise<void> {
        try {
            const auth = this.getAuth()
            if (!auth.clients.some(c => c.clientId === clientId))
                return
            auth.clients = auth.clients.filter(c => c.clientId !== clientId)
            auth.tokens = auth.tokens.filter(t => t.clientId !== clientId)
            this.lastSeenPersisted.delete(clientId)
            this.saveAuth()

            if (this.running)
                await this.getSharing().setTokens(this.publishedTokens())
            await this.closeConnectionsOf(clientId, 'revoked')

            if (auth.clients.length === 0) {
                this.setOff(false)
                if (!this.pairingWanted)
                    await this.stopTransport()
            }
            this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'removeClient')
        }
    }

    /** The user acknowledged the post-update firewall notice. */
    dismissFirewallNotice(): void {
        try {
            this.firewallNotice = false
            this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'dismissFirewallNotice')
        }
    }

    /** Snapshot of everything the host UI renders. */
    getDisplayProps(): LocalLinkDisplayProps {
        try {
            const available = this.isAvailable()
            const clients = available ? this.getClients() : []
            return {
                available,
                state: this.getState(clients.length),
                computerName: this.getComputerName(),
                suffix: this.running ? this.suffix : undefined,
                platform: PLATFORMS[this.getBindings().appInfo?.getOS()?.platform],
                routeCount: available ? this.getSharing().getRouteCount() : 0,
                devices: clients.map(c => this.toDevice(c)),
                pairingOpen: this.pairing.isOpen(),
                connectWindow: available ? this.getConnectWindow() : undefined,
                listeners: { ...this.listening },
                startError: this.startError ? { ...this.startError } : undefined,
                showUpdateFirewallNotice: this.firewallNotice,
            }
        }
        catch (err) {
            this.logError(err as Error, 'getDisplayProps')
            // fallback: the feature renders as not available
            return {
                available: false, state: 'never-connected', computerName: DEFAULT_DISPLAY_NAME, routeCount: 0, devices: [],
                pairingOpen: false, listeners: { control: false, media: false }, showUpdateFirewallNotice: false,
            } as LocalLinkDisplayProps
        }
    }

    reset() {
        try {
            this.unsubscribe?.()
            this.unsubscribe = undefined
            this.sharingListener?.()
            clearTimeout(this.tokenTimer)
            this.pairing.reset()
            this.authLimiter.reset()
            this.clearConnections()
            super.reset()
        }
        catch (err) {
            this.logError(err as Error, 'reset')
        }
    }

    // --- start / stop ---

    protected startTransport(): Promise<boolean> {
        if (this.running)
            return Promise.resolve(true)
        this.starting ??= this.doStart().finally(() => { this.starting = undefined })
        return this.starting
    }

    protected async doStart(): Promise<boolean> {
        const link = this.getLink()
        this.startError = undefined
        try {
            this.subscribeToTransport(link)
            const ok = await this.startListeners(link) && await this.configure(link) && await this.announceNew()
            if (!ok) {
                await link.stop().catch(() => undefined)
                this.listening = { control: false, media: false }
                return false
            }
            await this.startSharing()
            this.running = true
            return true
        }
        catch (err) {
            this.logError(err as Error, 'start')
            this.startError = { code: 'start-failed' }
            return false
        }
        finally {
            this.emitState()
        }
    }

    protected async startListeners(link: ILocalLinkBinding): Promise<boolean> {
        const ports = this.readPorts()
        const first = await link.start({ control: { port: ports.control }, media: { port: ports.media } })
        const control = await this.retryInUse(link, 'control', first.control)
        const media = await this.retryInUse(link, 'media', first.media)
        this.listening = { control: control?.ok === true, media: media?.ok === true }

        if (control?.ok !== true || media?.ok !== true) {
            const failed = control?.ok === true ? media : control
            this.startError = { code: failed?.ok === false ? failed.error.code : 'start-failed' }
            this.logEvent({ message: 'local-link listeners failed to start', code: this.startError.code })
            return false
        }
        this.storePorts({ control: control.port, media: media.port })
        return true
    }

    /** A listener whose stored port is taken starts again on any free port. */
    protected async retryInUse(link: ILocalLinkBinding, listener: LinkListener, result?: ListenerResult): Promise<ListenerResult | undefined> {
        if (result?.ok !== false || result.error.code !== 'EADDRINUSE')
            return result
        const retry = await link.start({ [listener]: { port: 0 } })
        return retry[listener]
    }

    protected async configure(link: ILocalLinkBinding): Promise<boolean> {
        const policy = await link.setPeerPolicy({ defaultPrivate: true })
        if (!policy?.ok) {
            this.startError = { code: 'peer-policy' }
            return false
        }
        await link.setLimits(LINK_LIMITS)
        return true
    }

    protected async announceNew(): Promise<boolean> {
        this.suffix = randomSuffix()
        this.hostLabel = randomHostLabel()
        return await this.announce()
    }

    protected async announce(): Promise<boolean> {
        if (!this.suffix || !this.hostLabel)
            return false
        const res = await this.getLink().announce({
            instanceName: buildInstanceName(this.getComputerName(), this.suffix),
            hostLabel: this.hostLabel,
        })
        if (!res?.ok) {
            this.startError = { code: 'announce-failed' }
            this.logEvent({ message: 'local-link announcement failed', error: res?.error })
        }
        return res?.ok === true
    }

    protected async startSharing(): Promise<void> {
        const sharing = this.getSharing()
        this.pruneExpiredTokens()
        await sharing.setTokens(this.publishedTokens())
        this.sharingListener?.()
        const onCatalog = (e?: { catalogVersion?: string }) => this.onCatalogChanged(e?.catalogVersion)
        sharing.on('catalog-changed', onCatalog)
        this.sharingListener = () => sharing.off('catalog-changed', onCatalog)
        await sharing.start(this.getLinkId())
        // what the phones learn in `session`; only a later change is pushed
        this.pushedCatalogVersion = sharing.getCatalogVersion()
        this.scheduleTokenExpiry()
        this.checkFirewallNotice()
    }

    /**
     * A rebuilt catalog with a new version is pushed once to every authenticated session. The
     * sharing service already debounces rebuilds; the version check drops repeats.
     */
    protected onCatalogChanged(catalogVersion?: string): void {
        try {
            this.emitState()
            if (!this.running || !catalogVersion || catalogVersion === this.pushedCatalogVersion)
                return
            this.pushedCatalogVersion = catalogVersion
            for (const conn of [...this.connections.values()]) {
                if (!conn.clientId)
                    continue
                this.send(conn, 'catalog-changed', { catalogVersion })
                    .catch(err => this.logError(err as Error, 'pushCatalogChanged'))
            }
        }
        catch (err) {
            this.logError(err as Error, 'onCatalogChanged')
        }
    }

    protected async stopTransport(): Promise<void> {
        await this.starting?.catch(() => undefined)
        const link = this.getLink()
        this.running = false
        this.getSharing().stop()
        this.sharingListener?.()
        this.sharingListener = undefined
        this.pushedCatalogVersion = undefined
        clearTimeout(this.tokenTimer)
        this.clearConnections()
        this.suffix = undefined
        this.hostLabel = undefined
        this.startError = undefined
        this.listening = { control: false, media: false }
        await link.announce(null).catch(() => undefined)
        await link.stop().catch(() => undefined)
    }

    protected subscribeToTransport(link: ILocalLinkBinding): void {
        if (this.unsubscribe)
            return
        this.unsubscribe = link.onEvent(e => {
            try {
                this.onLinkEvent(e).catch(err => this.logError(err, 'onLinkEvent'))
            }
            catch (err) {
                this.logError(err as Error, 'onLinkEvent')
            }
        })
    }

    protected async reannounce(): Promise<void> {
        if (!this.running)
            return
        const res = await this.getLink().reannounce()
        if (!res?.ok)
            await this.announce()
    }

    // --- transport events ---

    protected async onLinkEvent(e: LocalLinkEvent): Promise<void> {
        switch (e.type) {
            case 'connection':
                return this.onConnection(e.connectionId, e.peer?.address)
            case 'frame':
                return await this.onFrame(e.connectionId, e.payload)
            case 'connection-closed':
                return this.onConnectionClosed(e.connectionId)
            case 'network-changed':
            case 'resumed':
                return await this.reannounce()
            case 'peer-refused':
                return this.logEvent({ message: 'local-link peer refused', listener: e.listener, addressClass: e.addressClass, count: e.count })
            case 'error':
                return this.logEvent({ message: 'local-link transport error', listener: e.listener, phase: e.phase, code: e.code })
            case 'announce-error':
                return this.logEvent({ message: 'local-link announce error', code: e.code })
            default:
                // started, stopped, announced, media-request and unknown future events
        }
    }

    protected onConnection(connectionId: string, peerAddress: string): void {
        if (!this.running) {
            this.getLink().close(connectionId, 'not-running').catch(() => undefined)
            return
        }
        const conn: LinkConnection = {
            id: connectionId, peerAddress: peerAddress ?? '', channel: new LinkServerChannel(), authBusy: false, authFailures: 0,
        }
        this.connections.set(connectionId, conn)
        this.armDeadline(conn, UNAUTHENTICATED_DEADLINE_MS)
    }

    /**
     * A connection must authenticate (or be waiting for its pairing PIN) soon after it was
     * accepted. While a pair request is pending the deadline extends to the pairing window.
     */
    protected armDeadline(conn: LinkConnection, ms: number): void {
        clearTimeout(conn.deadline)
        conn.deadline = setTimeout(() => this.onDeadline(conn), ms)
        conn.deadline.unref?.()
    }

    protected onDeadline(conn: LinkConnection): void {
        try {
            conn.deadline = undefined
            if (conn.clientId || this.connections.get(conn.id) !== conn)
                return
            if (this.pairing.hasPendingFor(conn.id))
                return this.armDeadline(conn, PAIRING_TTL_SECONDS * 1000)
            this.logEvent({ message: 'local-link connection closed', reason: 'auth-timeout' })
            this.closeConnection(conn.id, 'auth-timeout').catch(() => undefined)
        }
        catch (err) {
            this.logError(err as Error, 'onDeadline')
        }
    }

    protected dropConnection(connectionId: string): LinkConnection | undefined {
        const conn = this.connections.get(connectionId)
        clearTimeout(conn?.deadline)
        this.connections.delete(connectionId)
        return conn
    }

    protected clearConnections(): void {
        for (const conn of this.connections.values())
            clearTimeout(conn.deadline)
        this.connections.clear()
    }

    protected onConnectionClosed(connectionId: string): void {
        const conn = this.dropConnection(connectionId)
        this.pairing.connectionClosed(connectionId)
        if (conn?.clientId)
            this.emitState()
    }

    // --- frames ---

    protected async onFrame(connectionId: string, payload: string): Promise<void> {
        const conn = this.connections.get(connectionId)
        if (!conn)
            return
        const res = conn.channel.decode(payload)
        if (res.ok === false)
            return await this.rejectFrame(conn, res.reason)
        await this.dispatch(conn, res.message)
    }

    protected async rejectFrame(conn: LinkConnection, reason: LinkRejectReason): Promise<void> {
        switch (reason) {
            case 'malformed':
                return await this.sendError(conn, 'bad-request')
            case 'not-allowed':
                return await this.sendError(conn, 'not-authenticated')
            case 'unknown-type':
                return
            default:
                // unsigned, bad-mac, replay
                return await this.closeConnection(conn.id, reason)
        }
    }

    protected async dispatch(conn: LinkConnection, msg: LinkClientMessage): Promise<void> {
        switch (msg.t) {
            case 'hello':
                return await this.onHello(conn, msg.b)
            case 'pair-request':
                return await this.onPairRequest(conn, msg.b, msg.id)
            case 'pair-verify':
                return await this.onPairVerify(conn, msg.b, msg.id)
            case 'auth':
                return await this.onAuth(conn, msg.b, msg.id)
            case 'auth-confirm':
                return await this.onAuthConfirm(conn, msg.b, msg.id)
            case 'ping':
                return await this.onPing(conn, msg.id)
            case 'echo':
                return await this.send(conn, 'echo', { data: msg.b?.data }, msg.id)
            case 'route-descriptor':
                return await this.onRouteDescriptor(conn, msg.b, msg.id)
        }
    }

    protected async onRouteDescriptor(conn: LinkConnection, body: unknown, id?: string): Promise<void> {
        if (!conn.clientId)
            return
        const routeKey = (body as { routeKey?: unknown })?.routeKey
        const res = await this.getSharing().getDescriptor(typeof routeKey === 'string' ? routeKey : '', conn.id)
        await this.send(conn, 'route-descriptor', res, id)
    }

    protected async onHello(conn: LinkConnection, hello: LinkClientMessage['b']): Promise<void> {
        if (conn.clientId)
            return
        const body = hello as Parameters<typeof negotiateLinkHello>[0]
        const version = negotiateLinkHello(body)
        if (!version) {
            const wellFormed = body?.role === 'client' && isLinkProtocolRange(body.protocol)
            if (!wellFormed)
                return await this.sendError(conn, 'bad-request')
            await this.send(conn, 'error', createUnsupportedProtocolError(LINK_PROTOCOL_RANGE))
            return await this.closeConnection(conn.id, 'unsupported-protocol')
        }
        conn.version = version
        await this.send(conn, 'hello', { protocol: version, capabilities: [...LINK_CAPABILITIES], pairingOpen: this.pairing.isOpen() })
    }

    // --- pairing frames ---

    protected async onPairRequest(conn: LinkConnection, body: unknown, id?: string): Promise<void> {
        if (!conn.version || conn.clientId)
            return await this.sendError(conn, 'bad-request')
        const name = sanitizeClientName((body as { clientName?: unknown })?.clientName)
        const res = this.pairing.request(conn.id, conn.peerAddress, name)
        if (res.kind === 'pending')
            return await this.send(conn, 'pending', { outcome: 'pending', requestId: res.requestId, expiresIn: res.expiresIn }, id)
        await this.send(conn, 'pair-failed', res.body, id)
    }

    protected async onPairVerify(conn: LinkConnection, body: unknown, id?: string): Promise<void> {
        const { requestId, pin } = (body ?? {}) as { requestId?: unknown, pin?: unknown }
        if (!conn.version || conn.clientId || typeof requestId !== 'string' || typeof pin !== 'string')
            return await this.sendError(conn, 'bad-request')

        const res = this.pairing.verify(conn.id, requestId, pin)
        if (res.kind === 'failed')
            return await this.send(conn, 'pair-failed', res.body, id)
        await this.completePairing(conn, res.clientName, id)
    }

    protected async completePairing(conn: LinkConnection, clientName: string, id?: string): Promise<void> {
        const client: StoredPairedClient = {
            clientId: newId(), clientName, pairedAt: Date.now(), lastSeenAt: undefined,
            secret: randomToken(PAIRING_SECRET_BYTES),
        }
        this.getAuth().clients.push(client)
        this.saveAuth()
        this.logEvent({ message: 'local-link phone paired', clients: this.getAuth().clients.length })
        await this.send(conn, 'paired', {
            outcome: 'paired', linkId: this.getLinkId(), secret: client.secret, name: this.getComputerName(),
            protocolVersion: conn.version!,
        }, id)
        this.emitState()
    }

    protected pushPairFailed(connectionId: string, body: PairFailedBody): void {
        try {
            const conn = this.connections.get(connectionId)
            if (conn)
                this.send(conn, 'pair-failed', body).catch(err => this.logError(err, 'pushPairFailed'))
        }
        catch (err) {
            this.logError(err as Error, 'pushPairFailed')
        }
    }

    // --- authentication frames ---

    protected async onAuth(conn: LinkConnection, body: unknown, id?: string): Promise<void> {
        if (!conn.version || conn.clientId || conn.authBusy)
            return await this.sendError(conn, 'bad-request')
        if (!this.authLimiter.hit(conn.peerAddress, Date.now()).allowed)
            return await this.closeConnection(conn.id, 'rate-limited')

        conn.authBusy = true
        try {
            // fixed delay for every answer, so timing reveals neither a match nor its absence
            await new Promise(resolve => setTimeout(resolve, AUTH_RESULT_DELAY_MS))
            if (!this.connections.has(conn.id))
                return
            const result = answerLinkAuthProbe(body as Parameters<typeof answerLinkAuthProbe>[0], this.getAuth().clients, this.getLinkId())
            conn.authState = result.state
            await this.send(conn, 'auth-result', result.body, id)
            if (!result.state && ++conn.authFailures >= AUTH_MAX_FAILURES_PER_CONNECTION)
                await this.closeConnection(conn.id, 'auth-failed')
        }
        finally {
            conn.authBusy = false
        }
    }

    protected async onAuthConfirm(conn: LinkConnection, body: unknown, id?: string): Promise<void> {
        const state = conn.authState
        conn.authState = undefined
        const key = state ? this.verifyConfirm(body, state) : undefined
        const client = this.getClients().find(c => c.clientId === state?.clientId)
        if (!state || !key || !client)
            return await this.closeConnection(conn.id, 'auth-failed')

        // from here on every frame in both directions is signed
        conn.channel.establish(key)
        conn.clientId = client.clientId
        clearTimeout(conn.deadline)
        conn.deadline = undefined
        this.touch(client.clientId, true)

        const token = await this.issueToken(client.clientId)
        if (!token)
            return await this.closeConnection(conn.id, 'media-unavailable')
        await this.send(conn, 'session', {
            mediaPort: this.readPorts().media ?? 0, mediaToken: token.token, mediaTokenExpiresAt: token.expiresAt,
            catalogVersion: this.getSharing().getCatalogVersion(), capabilities: [...LINK_CAPABILITIES],
        }, id)
        this.emitState()
    }

    protected verifyConfirm(body: unknown, state: NonNullable<LinkConnection['authState']>): Uint8Array | undefined {
        try {
            return verifyLinkAuthConfirm(body as Parameters<typeof verifyLinkAuthConfirm>[0], state)
        }
        catch {
            return undefined
        }
    }

    protected async onPing(conn: LinkConnection, id?: string): Promise<void> {
        if (conn.clientId)
            this.touch(conn.clientId)
        await this.send(conn, 'pong', {}, id)
    }

    // --- media tokens ---

    protected async issueToken(clientId: string): Promise<{ token: string, expiresAt: number } | undefined> {
        const token = randomToken(MEDIA_TOKEN_BYTES)
        const expiresAt = Date.now() + MEDIA_TOKEN_TTL_MS
        const auth = this.getAuth()
        auth.tokens.push({ id: newId(), clientId, digest: tokenDigest(token), expiresAt })

        const own = auth.tokens.filter(t => t.clientId === clientId)
        if (own.length > MEDIA_TOKENS_PER_CLIENT) {
            const drop = new Set(own.slice(0, own.length - MEDIA_TOKENS_PER_CLIENT))
            auth.tokens = auth.tokens.filter(t => !drop.has(t))
        }
        this.saveAuth()
        this.scheduleTokenExpiry()
        const published = await this.getSharing().setTokens(this.publishedTokens())
        return published ? { token, expiresAt } : undefined
    }

    protected publishedTokens(): Array<{ digest: string, id: string }> {
        return this.getAuth().tokens.map(t => ({ digest: t.digest, id: t.id }))
    }

    protected pruneExpiredTokens(): boolean {
        const auth = this.getAuth()
        const now = Date.now()
        const live = auth.tokens.filter(t => t.expiresAt > now)
        const changed = live.length !== auth.tokens.length
        if (changed) {
            auth.tokens = live
            this.saveAuth()
        }
        return changed
    }

    protected scheduleTokenExpiry(): void {
        clearTimeout(this.tokenTimer)
        const next = this.getAuth().tokens.reduce<number | undefined>((min, t: StoredMediaToken) => min === undefined ? t.expiresAt : Math.min(min, t.expiresAt), undefined)
        if (next === undefined || !this.running)
            return
        this.tokenTimer = setTimeout(() => this.onTokenTimer(), Math.max(0, Math.min(next - Date.now(), 2 ** 31 - 1)))
    }

    protected onTokenTimer(): void {
        try {
            if (this.pruneExpiredTokens())
                this.getSharing().setTokens(this.publishedTokens()).catch(err => this.logError(err, 'tokenExpiry'))
            this.scheduleTokenExpiry()
        }
        catch (err) {
            this.logError(err as Error, 'tokenExpiry')
        }
    }

    // --- connections ---

    protected async send<K extends ServerMessageType>(conn: LinkConnection, t: K, b: LinkServerMessageBodies[K], id?: string): Promise<void> {
        const payload = conn.channel.encode(t, b, id)
        await this.getLink().send(conn.id, payload)
    }

    protected async sendError(conn: LinkConnection, code: LinkErrorCode): Promise<void> {
        await this.send(conn, 'error', { code })
    }

    protected async closeConnection(connectionId: string, reason: string): Promise<void> {
        this.dropConnection(connectionId)
        await this.getLink().close(connectionId, reason)
    }

    protected async closeConnectionsOf(clientId: string, reason: string): Promise<void> {
        const ids = [...this.connections.values()].filter(c => c.clientId === clientId).map(c => c.id)
        for (const id of ids)
            await this.closeConnection(id, reason)
    }

    // --- records ---

    protected getAuth(): LocalLinkAuthData {
        if (!this.auth) {
            const stored = this.readSetting<Partial<LocalLinkAuthData>>(SETTINGS_KEY.auth, {})
            this.auth = {
                clients: Array.isArray(stored?.clients) ? stored.clients : [],
                tokens: Array.isArray(stored?.tokens) ? stored.tokens : [],
            }
        }
        return this.auth
    }

    protected saveAuth(): void {
        const auth = this.getAuth()
        this.getUserSettings().set(SETTINGS_KEY.auth, {
            clients: auth.clients.map(c => ({ ...c })),
            tokens: auth.tokens.map(t => ({ ...t })),
        })
    }

    protected getClients(): StoredPairedClient[] {
        return this.getAuth().clients
    }

    /** `linkId` is generated once and persisted */
    protected getLinkId(): string {
        let linkId = this.readSetting<string | null>(SETTINGS_KEY.linkId, null)
        if (!linkId) {
            linkId = newId()
            this.getUserSettings().set(SETTINGS_KEY.linkId, linkId)
        }
        return linkId
    }

    protected touch(clientId: string, force = false): void {
        const client = this.getClients().find(c => c.clientId === clientId)
        if (!client)
            return
        const now = Date.now()
        client.lastSeenAt = now
        const persisted = this.lastSeenPersisted.get(clientId) ?? 0
        if (force || now - persisted >= LAST_SEEN_PERSIST_INTERVAL_MS) {
            this.lastSeenPersisted.set(clientId, now)
            this.saveAuth()
        }
    }

    protected isOff(): boolean {
        return this.readSetting<boolean>(SETTINGS_KEY.off, false) === true
    }

    protected setOff(off: boolean): void {
        if (this.isOff() !== off)
            this.getUserSettings().set(SETTINGS_KEY.off, off ? true : null)
    }

    protected readPorts(): PortSettings {
        return this.readSetting<PortSettings>(SETTINGS_KEY.ports, {}) ?? {}
    }

    protected storePorts(ports: PortSettings): void {
        const stored = this.readPorts()
        if (stored.control !== ports.control || stored.media !== ports.media)
            this.getUserSettings().set(SETTINGS_KEY.ports, ports)
    }

    protected getComputerName(): string {
        const name = this.readSetting<string | null>(SETTINGS_KEY.displayName, null)
        return name || DEFAULT_DISPLAY_NAME
    }

    protected readSetting<T>(key: string, def: T): T {
        try {
            return this.getUserSettings().get(key, def) as T
        }
        catch {
            return def
        }
    }

    /**
     * On Windows, the first start after an app update may raise the firewall prompt without a
     * user click: remember the running version and flag the notice once per version.
     */
    protected checkFirewallNotice(): void {
        try {
            const version = this.getBindings().appInfo?.getAppVersion()
            const last = this.readSetting<string | null>(SETTINGS_KEY.lastRunVersion, null)
            if (!version || version === last)
                return
            this.getUserSettings().set(SETTINGS_KEY.lastRunVersion, version)
            const windows = this.getBindings().appInfo?.getOS()?.platform === 'win32'
            this.firewallNotice = windows && last !== null && this.getClients().length > 0
        }
        catch (err) {
            this.logError(err as Error, 'checkFirewallNotice')
        }
    }

    // --- display state ---

    protected getState(clientCount: number): LocalLinkState {
        if (clientCount === 0)
            return 'never-connected'
        if (this.startError)
            return 'error'
        return this.isOff() ? 'off' : 'on'
    }

    protected getConnectWindow(): LocalLinkDisplayProps['connectWindow'] {
        if (!this.pairingWanted)
            return undefined
        if (this.startError)
            return { phase: 'error' }
        if (!this.running)
            return { phase: 'starting' }
        return this.pairing.getWindow() ?? { phase: 'starting' }
    }

    protected toDevice(client: StoredPairedClient): LocalLinkDevice {
        const active = [...this.connections.values()].some(c => c.clientId === client.clientId)
        return { id: client.clientId, name: client.clientName, connectedAt: client.pairedAt, lastSeenAt: client.lastSeenAt, active }
    }

    protected onPairingChanged(): void {
        this.emitProps('pairing-changed')
        this.emitState()
    }

    protected emitState(): void {
        this.emitProps('state-changed')
    }

    protected emitProps(event: 'state-changed' | 'pairing-changed'): void {
        try {
            this.emit(event, this.getDisplayProps())
        }
        catch (err) {
            this.logError(err as Error, 'emit')
        }
    }

    protected getLink(): ILocalLinkBinding {
        return this.getBindings().localLink!
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getAppState() {
        return useAppState()
    }

    @Injectable
    protected getSharing() {
        return useRouteSharing()
    }
}

/** Returns the desktop host service of the `local-link`. */
export const useLocalLink = () => new LocalLinkService()

/** App start: starts the transport if a phone is paired and the link is on. Call after the settings are loaded. */
export const initLocalLink = () => useLocalLink().init()
