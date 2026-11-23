import { getBindings } from '../../api/bindings'
import { useAppState } from '../../appstate/service'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { useDeviceAccess } from '../../devices/access/service'
import { useDevicePairing } from '../../devices/pairing/service'
import { useRideDisplay } from '../../ride/display/service'
import type { CurrentRideState } from '../../ride/base/types'
import { LINK_MAX_AUTH_KIDS } from '../consts'
import type { LinkAuthCandidate, LinkClientMessageBodies, LinkProtocolVersion, LinkRecord, LinkServerMessage, PairedBody, SessionBody } from '../types'
import { fromBase64Url } from '../utils'
import { LinkBrowse, parseInstanceName } from './browse'
import type { BrowseResult } from './browse'
import { LinkClientConnection, LinkConnectionError } from './connection'
import {
    BROWSE_TIMEOUT_MS, DEFAULT_PHONE_NAME, MEDIA_TOKEN_MARGIN_MS, RECONNECT_DELAYS_MS, RECOVERY_MAX_PER_SESSION,
    WATCH_ADDRESS_WINDOW_MS, WATCH_CACHE_MAX_ENTRIES, WATCH_MAX_PROBES_PER_ADDRESS, WATCH_NEGATIVE_TTL_MS, WATCH_UNREACHABLE_TTL_MS,
} from './consts'
import { LinkMediaPath } from './media'
import { LinkPairingFlow } from './pairing'
import type { PairTarget } from './pairing'
import { LinkRecoveryGate } from './recovery'
import { cleanLocalName, LinkStore } from './store'
import type {
    DiscoveredComputer, DiscoveryState, LinkClientLink, LinkClientPlatform, LinkClientSession, LinkMdnsAnnouncement, LinkMediaAccess,
    LinkReachability, LinkReconnectSource, LinkWifiBinding, LocalLinkClientDisplayProps, LinkPairingFailure, SearchBlockedReason,
} from './types'
import { LinkWatch } from './watch'

const BUSY_RIDE_STATES: CurrentRideState[] = ['Starting', 'Started', 'Active', 'Paused', 'Closing']
const EXCLUSIVE_OWNER = 'local-link'
/** native capability: control connection and discovery are available in the installed native app */
const NATIVE_FEATURE_LOCAL_LINK = 'local-link'
// 'local-link-media' (Android loopback pipe / network config) is reserved: media availability is decided by the pipe binding

interface ActiveSession {
    conn: LinkClientConnection
    info: LinkClientSession
    intentional: boolean
}

type ProbeResult =
    | { kind: 'session', link: LinkRecord, conn: LinkClientConnection, session: SessionBody, version: LinkProtocolVersion, host: string, port: number }
    | { kind: 'no-match' | 'version' | 'unreachable' }

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

type BrowseOutcome = { ok: true, results: BrowseResult[], interrupted: boolean } | { ok: false, reason: SearchBlockedReason }

type SearchPhase =
    | { phase: 'idle' }
    | { phase: 'blocked', reason: SearchBlockedReason }
    | { phase: 'searching', expiresAt: number }
    | { phase: 'done', noneFound: boolean, showLocalNetworkHint: boolean }

/**
 * Phone side of the `local-link`: finds the computers that share their routes, pairs with them,
 * recognises them again (challenge-response) and keeps an authenticated, signed session.
 *
 * - Searching is user-initiated, time-boxed and exclusive: never during a ride, a trainer or WiFi
 *   scan or a device pairing (it takes over network discovery through the device access service).
 *   Found computers are cached for the app session; every pairing retry uses the cached address.
 * - A paired computer is recognised by proving that the peer holds its pairing secret. The secret
 *   is never sent: a candidate that does not prove it gets nothing but key identifiers that are
 *   different in every probe.
 * - When the saved address fails, one idle-only browse looks for the computer on the network, at
 *   most once per 10 minutes and 3 times per app session. {@link check} with `manual` bypasses the
 *   window and the count but never the idleness rule. When a browse is not allowed the state says so.
 * - While the app is in the foreground and a paired computer has no session, the phone listens for
 *   the computer's announcement (passive watch, joins the trainer discovery or is duty-cycled) and
 *   probes it on an announcement. Watch probes are not browses and do not count against those limits.
 *   There are no polling timers: the other triggers are the page, the foreground, "check again"
 *   and a change of the phone's network.
 * - Pairing secrets live in secure storage, records in the `links` repository.
 *
 * Media: {@link getMedia} gives the base URL (direct on iOS, through the loopback pipe on Android),
 * the media token and the catalog version, re-establishing the session when the token is about
 * to expire.
 *
 * Emits `state-changed` (with {@link LocalLinkClientDisplayProps}), `session-changed`
 * (`{linkId, session}`; `session` is `undefined` when it ended), `link-forgotten` (`linkId`) and
 * `push` (`{linkId, message}` for every signed message the computer pushes).
 *
 * Addresses, secrets, media tokens and frame payloads are never logged.
 */
@Singleton
export class LocalLinkClientService extends IncyclistService {
    protected store = new LinkStore()
    protected gate = new LinkRecoveryGate()
    protected media = new LinkMediaPath(() => this.getPlatform())
    protected pairingFlow: LinkPairingFlow
    protected sessions = new Map<string, ActiveSession>()
    protected connecting = new Map<string, Promise<boolean>>()
    protected reconnects = new Map<string, { attempt: number, timer?: ReturnType<typeof setTimeout> }>()
    protected discovered = new Map<string, DiscoveredComputer>()
    protected searchResults: DiscoveredComputer[] = []
    protected recognitions = new Map<string, Promise<void>>()
    protected searchPhase: SearchPhase = { phase: 'idle' }
    protected searching?: Promise<DiscoveryState>
    protected browse?: LinkBrowse
    protected checkRun?: Promise<void>
    protected checkingLinks = new Set<string>()
    protected mismatched = new Set<string>()
    protected searchBlocked?: LocalLinkClientDisplayProps['searchBlocked']
    protected loading?: Promise<void>
    protected foreground = true
    protected retrying = false
    protected unreachableSince = new Map<string, number>()
    protected watchNegative = new Map<string, number>()
    protected watchProbes = new Map<string, number[]>()
    protected watchInFlight = new Set<string>()
    protected watchStats = { probes: 0, suppressed: 0 }
    protected watch = new LinkWatch({
        getWifi: () => getBindings()?.wifi as LinkWifiBinding | undefined,
        canRun: () => this.shouldWatch(),
        isJoined: () => this.isTrainerRotationRunning(),
        onAnnouncement: service => this.onWatchAnnouncement(service),
    })

    constructor() {
        super('LocalLinkClient')
        this.pairingFlow = new LinkPairingFlow({
            createConnection: () => this.createConnection(),
            getClientName: () => this.getClientName(),
            now: () => Date.now(),
            onChange: () => this.emitState(),
            onPaired: (target, body) => this.savePaired(target, body),
            log: (message, data) => this.logPairing(message, data),
        })
    }

    // --- public API ---

    /**
     * true if the feature is on and the platform provides what the client needs (mDNS, TCP,
     * crypto, repository and secure storage).
     */
    isSupported(): boolean {
        try {
            return this.getAppState().hasFeature('BRIDGE_MODE') === true && this.hasBindings() && this.meetsNativeRequirements()
        }
        catch (err) {
            this.logError(err as Error, 'isSupported')
            return false
        }
    }

    /** Loads the paired computers. No network access happens here. Safe to call repeatedly. */
    async init(): Promise<void> {
        try {
            await this.ready()
            for (const link of this.store.getAll()) {
                if (!this.sessions.has(link.linkId))
                    this.markUnreachable(link.linkId)
            }
            this.emitState()
            this.syncWatch()
        }
        catch (err) {
            this.logError(err as Error, 'init')
        }
    }

    /** Snapshot of everything the settings and pairing screens render. */
    getDisplayProps(): LocalLinkClientDisplayProps {
        try {
            const available = this.isSupported()
            return {
                available,
                links: available ? this.store.getAll().map(r => this.toLink(r)) : [],
                checking: this.checkRun !== undefined,
                searchBlocked: this.searchBlocked ? { ...this.searchBlocked } : undefined,
                recovery: this.gate.info(Date.now()),
                discovery: this.getDiscovery(),
                pairing: this.pairingFlow.getState(),
            }
        }
        catch (err) {
            this.logError(err as Error, 'getDisplayProps')
            // fallback: the feature renders as not available
            return {
                available: false, links: [], checking: false,
                recovery: { autoBrowsesUsed: 0, autoBrowsesMax: RECOVERY_MAX_PER_SESSION },
                discovery: { phase: 'idle' }, pairing: { step: 'idle' },
            }
        }
    }

    /** The open session of a computer, if any. */
    getSession(linkId: string): LinkClientSession | undefined {
        try {
            const session = this.sessions.get(linkId)
            return session ? { ...session.info, capabilities: [...session.info.capabilities] } : undefined
        }
        catch (err) {
            this.logError(err as Error, 'getSession')
            return undefined
        }
    }

    /**
     * Searches the network for computers (10 s). Not allowed while a ride, a device scan or a
     * device pairing is running: the state is then `blocked`, never "none found". Resolves with
     * the final state when the search has ended.
     */
    async startSearch(): Promise<DiscoveryState> {
        try {
            if (!this.isSupported()) {
                this.searchPhase = { phase: 'blocked', reason: 'unsupported' }
                this.emitState()
                return this.getDiscovery()
            }
            this.searching ??= this.doSearch().finally(() => { this.searching = undefined })
            return await this.searching
        }
        catch (err) {
            this.logError(err as Error, 'startSearch')
            // fallback: the search ended without a result
            this.searchPhase = { phase: 'idle' }
            this.emitState()
            return { phase: 'idle' }
        }
    }

    /** Ends a running search early; what was found stays listed. */
    cancelSearch(): void {
        try {
            this.browse?.cancel()
        }
        catch (err) {
            this.logError(err as Error, 'cancelSearch')
        }
    }

    /**
     * Starts pairing with a computer from the search results, on the address the search found.
     * A computer that the search recognised as already paired ends in `connected` with `already`.
     */
    async selectComputer(computerId: string): Promise<void> {
        try {
            const computer = this.discovered.get(computerId)
            if (!computer)
                return
            await this.recognitions.get(computerId)
            if (computer.linkId) {
                this.pairingFlow.cancel()
                this.setPairingConnected(computer.linkId)
                return
            }
            await this.pairingFlow.start(this.toTarget(computer))
        }
        catch (err) {
            this.logError(err as Error, 'selectComputer')
        }
    }

    /** Submits the 6-digit code shown on the computer. */
    submitCode(pin: string): void {
        try {
            this.pairingFlow.submit(pin)
        }
        catch (err) {
            this.logError(err as Error, 'submitCode')
        }
    }

    /** "Get a new code" / "Try again": a new pairing request on the same address, never a new search. */
    async retryPairing(): Promise<void> {
        try {
            await this.pairingFlow.retry()
        }
        catch (err) {
            this.logError(err as Error, 'retryPairing')
        }
    }

    /** Leaves the pairing steps (cancel, back, done). */
    cancelPairing(): void {
        try {
            this.pairingFlow.cancel()
        }
        catch (err) {
            this.logError(err as Error, 'cancelPairing')
        }
    }

    /**
     * Checks the saved address of every paired computer and opens a session where it answers.
     * For computers that do not answer, one idle-only browse follows when allowed: an automatic
     * check is limited to once per 10 minutes and 3 times per app session, `manual` ("check
     * again") is not, but both need the app to be idle.
     */
    check(opts: { manual?: boolean } = {}): Promise<void> {
        try {
            if (!this.isSupported())
                return Promise.resolve()
            // concurrent callers share one run; the run never rejects
            this.checkRun ??= this.doCheck(opts?.manual === true)
                .catch(err => this.logError(err as Error, 'check'))
                .finally(() => {
                    this.checkRun = undefined
                    this.emitState()
                    this.syncWatch()
                })
            return this.checkRun
        }
        catch (err) {
            this.logError(err as Error, 'check')
            return Promise.resolve()
        }
    }

    /**
     * The app returns to the foreground: tries the saved address of every computer without a
     * session right away and starts the passive watch.
     */
    onForeground(): void {
        try {
            this.foreground = true
            this.retryNow()
            this.syncWatch()
        }
        catch (err) {
            this.logError(err as Error, 'onForeground')
        }
    }

    /** The app is not in the foreground: no network access and no watch until {@link onForeground}. */
    onBackground(): void {
        try {
            this.foreground = false
            this.syncWatch()
        }
        catch (err) {
            this.logError(err as Error, 'onBackground')
        }
    }

    /** The phone's network changed (another WiFi, WiFi back): tries the saved addresses now and re-arms the watch. */
    onNetworkChange(): void {
        try {
            this.retryNow()
            this.syncWatch()
        }
        catch (err) {
            this.logError(err as Error, 'onNetworkChange')
        }
    }

    /**
     * Tries the saved address of every computer without a session now (Routes page and sharing
     * settings call this when they open). Does nothing while the app is in the background, busy,
     * when nothing is paired or while an attempt is running.
     */
    retryNow(): void {
        try {
            if (this.retrying || !this.canRetry() || this.isNetworkBusy())
                return
            this.retrying = true
            this.runRetry().catch(err => this.logError(err as Error, 'retryNow'))
        }
        catch (err) {
            this.retrying = false
            this.logError(err as Error, 'retryNow')
        }
    }

    /** Sets the name shown on this device; an empty name resets it to the computer's own name. */
    async rename(linkId: string, name: string): Promise<void> {
        try {
            await this.ready()
            if (await this.store.update(linkId, { localName: cleanLocalName(name) }))
                this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'rename')
        }
    }

    /** Records the catalog version a sync of this computer ended with, so that an unchanged version can skip the next sync. */
    async setCatalogVersion(linkId: string, catalogVersion: string): Promise<void> {
        try {
            await this.ready()
            if (await this.store.update(linkId, { catalogVersion }))
                this.emitState()
        }
        catch (err) {
            this.logError(err as Error, 'setCatalogVersion')
        }
    }

    /** Forgets a computer: closes its session and deletes its record and secret. The computer is not told. */
    async forget(linkId: string): Promise<void> {
        try {
            await this.ready()
            this.cancelReconnect(linkId)
            this.closeSession(linkId)
            await this.media.release(linkId)
            await this.store.remove(linkId)
            this.mismatched.delete(linkId)
            this.unreachableSince.delete(linkId)
            this.syncWatch()
            for (const computer of this.discovered.values()) {
                if (computer.linkId === linkId)
                    delete computer.linkId
            }
            this.logEvent({ message: 'local-link computer forgotten' })
            this.emitState()
            this.emit('link-forgotten', linkId)
        }
        catch (err) {
            this.logError(err as Error, 'forget')
        }
    }

    /**
     * An authenticated session with a computer: the open one, or a new one on its saved address.
     * Never browses the network. `undefined` if the computer does not answer.
     */
    async ensureSession(linkId: string, source: LinkReconnectSource = 'on-demand'): Promise<LinkClientSession | undefined> {
        try {
            await this.ready()
            const link = this.store.get(linkId)
            if (!link || !this.isSupported())
                return undefined
            if (!this.sessions.has(linkId))
                await this.connectKnown(link, source)
            return this.getSession(linkId)
        }
        catch (err) {
            this.logError(err as Error, 'ensureSession')
            return undefined
        }
    }

    /**
     * What a media request to a computer needs. The session is re-established first when the
     * media token expires soon. `undefined` if the computer is unreachable or media is not
     * available on this platform.
     */
    async getMedia(linkId: string): Promise<LinkMediaAccess | undefined> {
        try {
            let session = this.getSession(linkId)
            if (session && session.mediaTokenExpiresAt - Date.now() < MEDIA_TOKEN_MARGIN_MS) {
                this.closeSession(linkId)
                session = undefined
            }
            session ??= await this.ensureSession(linkId)
            if (!session)
                return undefined

            const baseUrl = await this.media.getBaseUrl(linkId, session.host, session.mediaPort)
            if (!baseUrl)
                return undefined
            return { baseUrl, token: session.mediaToken, expiresAt: session.mediaTokenExpiresAt, catalogVersion: session.catalogVersion }
        }
        catch (err) {
            this.logError(err as Error, 'getMedia')
            return undefined
        }
    }

    /**
     * Sends a signed request on the open session of a computer and waits for its reply. Never
     * connects and never browses.
     *
     * @returns the reply, or `undefined` if there is no open session, the computer did not answer in
     * time or the session ended
     */
    async request<K extends keyof LinkClientMessageBodies & string>(
        linkId: string, t: K, b: LinkClientMessageBodies[K], timeoutMs: number,
    ): Promise<Extract<LinkServerMessage, { t: K }> | undefined> {
        try {
            const active = this.sessions.get(linkId)
            if (!active)
                return undefined
            return await active.conn.request(t, b, timeoutMs)
        }
        catch (err) {
            // timeout and closed session are expected: the caller treats both as "no reply"
            this.logEvent({ message: 'local-link request failed', t, code: err instanceof LinkConnectionError ? err.code : 'protocol' })
            return undefined
        }
    }

    /**
     * `http://<host>:<mediaPort>` on iOS, `http://127.0.0.1:<pipePort>` through the loopback pipe on
     * Android. `undefined` if media is unavailable (no session, or Android without the pipe binding).
     */
    async getMediaBaseUrl(linkId: string): Promise<string | undefined> {
        try {
            return (await this.getMedia(linkId))?.baseUrl
        }
        catch (err) {
            this.logError(err as Error, 'getMediaBaseUrl')
            return undefined
        }
    }

    /** true if media can be played on this platform with the bindings that are present */
    isMediaAvailable(): boolean {
        try {
            return this.media.isAvailable()
        }
        catch (err) {
            this.logError(err as Error, 'isMediaAvailable')
            return false
        }
    }

    /** iOS: route media through the loopback pipe as well (default: direct HTTP). */
    setMediaPipeEnabled(enabled: boolean): void {
        try {
            this.media.setPipeEnabled(enabled)
        }
        catch (err) {
            this.logError(err as Error, 'setMediaPipeEnabled')
        }
    }

    /** Stops the loopback pipe of one computer, or all: call when no media is needed any more. */
    async releaseMedia(linkId?: string): Promise<void> {
        try {
            await this.media.release(linkId)
        }
        catch (err) {
            this.logError(err as Error, 'releaseMedia')
        }
    }

    reset() {
        try {
            this.browse?.cancel()
            this.pairingFlow.cancel()
            this.watch.halt()
            this.watchNegative.clear()
            this.watchProbes.clear()
            this.watchInFlight.clear()
            this.unreachableSince.clear()
            this.flushWatchStats()
            for (const linkId of [...this.reconnects.keys()])
                this.cancelReconnect(linkId)
            for (const linkId of [...this.sessions.keys()])
                this.closeSession(linkId)
            this.media.release().catch(() => undefined)
            this.gate.reset()
            super.reset()
        }
        catch (err) {
            this.logError(err as Error, 'reset')
        }
    }

    // --- gating ---

    protected hasBindings(): boolean {
        const bindings = getBindings()
        const wifi = bindings?.wifi as LinkWifiBinding | undefined
        return typeof wifi?.net?.createSocket === 'function' && typeof wifi?.mdns?.find === 'function'
            && bindings.crypto !== undefined && bindings.db !== undefined && bindings.secureStorage !== undefined
    }

    /**
     * The native app must signal that it carries the native side of the link, the same way the
     * desktop shell announces its capabilities. A binary that does not signal (an old one) has
     * no capability: fails closed by absence, also if the query throws.
     */
    protected meetsNativeRequirements(): boolean {
        try {
            return getBindings()?.appInfo?.hasNativeFeature?.(NATIVE_FEATURE_LOCAL_LINK) === true
        }
        catch (err) {
            this.logError(err as Error, 'meetsNativeRequirements')
            return false
        }
    }

    protected getPlatform(): LinkClientPlatform {
        try {
            const platform = getBindings()?.appInfo?.getOS()?.platform
            if (platform === 'ios' || platform === 'android')
                return platform
            return 'other'
        }
        catch (err) {
            this.logError(err as Error, 'getPlatform')
            return 'other'
        }
    }

    /** Why the network must not be browsed right now, or `undefined` if the app is idle. */
    protected getBusyReason(): SearchBlockedReason | undefined {
        if (this.browse)
            return 'search-running'
        if (BUSY_RIDE_STATES.includes(this.getRideDisplay().getState()))
            return 'ride'
        if (this.getDeviceAccess().isScanning())
            return 'device-scan'
        const pairing = this.getDevicePairing()
        if (pairing.isScanning() || pairing.isPairing())
            return 'device-pairing'
        return undefined
    }

    protected async ready(): Promise<void> {
        try {
            if (!this.isSupported())
                return
            this.loading ??= this.store.load().catch(err => {
                this.loading = undefined
                this.logError(err, 'load')
            })
            await this.loading
        }
        catch (err) {
            this.loading = undefined
            this.logError(err as Error, 'ready')
        }
    }

    // --- search ---

    protected async doSearch(): Promise<DiscoveryState> {
        await this.ready()
        const hasLinks = this.store.getAll().length > 0
        this.searchResults = []
        const outcome = await this.runBrowse(false, () => {
            this.searchPhase = { phase: 'searching', expiresAt: Date.now() + BROWSE_TIMEOUT_MS }
            this.emitState()
        }, found => this.onFound(found, hasLinks))

        if (outcome.ok === false)
            this.searchPhase = { phase: 'blocked', reason: outcome.reason }
        else if (outcome.interrupted && this.searchResults.length === 0)
            this.searchPhase = { phase: 'blocked', reason: 'device-scan' }
        else {
            const noneFound = this.searchResults.length === 0
            this.searchPhase = { phase: 'done', noneFound, showLocalNetworkHint: noneFound && this.getPlatform() === 'ios' }
        }
        this.emitState()
        return this.getDiscovery()
    }

    protected onFound(found: BrowseResult, hasLinks: boolean): void {
        try {
            const id = `${found.host}:${found.port}`
            const { displayName, suffix } = parseInstanceName(found.name)
            let computer = this.discovered.get(id)
            if (computer) {
                computer.name = found.name
                computer.displayName = displayName
                computer.suffix = suffix
                // what an earlier search found out about this address may no longer hold
                delete computer.linkId
            }
            else {
                computer = { id, name: found.name, displayName, suffix, ambiguous: false, host: found.host, port: found.port, recognizing: false }
                this.discovered.set(id, computer)
            }
            this.searchResults.push(computer)
            this.markAmbiguous()
            this.emitState()
            if (hasLinks)
                this.recognitions.set(id, this.recognize(computer))
        }
        catch (err) {
            this.logError(err as Error, 'onFound')
        }
    }

    protected markAmbiguous(): void {
        for (const c of this.searchResults)
            c.ambiguous = this.searchResults.some(other => other !== c && other.displayName === c.displayName)
    }

    /** The same exchange as the recovery: is this one of the computers the phone is paired with? */
    protected async recognize(computer: DiscoveredComputer): Promise<void> {
        computer.recognizing = true
        this.emitState()
        try {
            const live = [...this.sessions.values()].find(s => s.info.host === computer.host && s.info.controlPort === computer.port)
            if (live) {
                computer.linkId = live.info.linkId
                return
            }
            const candidates = await this.loadCandidates(this.store.getAll())
            if (candidates.length === 0)
                return
            const result = await this.probe(computer.host, computer.port, candidates)
            if (result.kind === 'session') {
                this.adoptSession(result)
                computer.linkId = result.link.linkId
            }
        }
        catch (err) {
            this.logError(err as Error, 'recognize')
        }
        finally {
            computer.recognizing = false
            this.emitState()
        }
    }

    protected getDiscovery(): DiscoveryState {
        const phase = this.searchPhase
        const computers = this.searchResults.map(c => ({ ...c }))
        switch (phase.phase) {
            case 'searching':
                return { phase: 'searching', computers, expiresAt: phase.expiresAt }
            case 'done':
                return { phase: 'done', computers, noneFound: phase.noneFound, showLocalNetworkHint: phase.showLocalNetworkHint }
            default:
                return phase
        }
    }

    /**
     * One scoped browse with the exclusive use of network discovery. Records the browse for the
     * recovery limits, and ends early (`interrupted`) when a device scan starts meanwhile.
     */
    protected async runBrowse(automatic: boolean, onStart?: () => void, onFound?: (found: BrowseResult) => void): Promise<BrowseOutcome> {
        const reason = this.getBusyReason()
        if (reason)
            return { ok: false, reason }

        const browse = new LinkBrowse(getBindings().wifi as LinkWifiBinding)
        this.browse = browse
        this.gate.recordBrowse(automatic, Date.now())
        // exclusive use of the discovery: the watch steps aside (the browse is itself an announcement listener)
        this.syncWatch()
        onStart?.()

        const access = this.getDeviceAccess()
        let interrupted = false
        const onScan = (state: string) => {
            try {
                if (state === 'start-requested' || state === 'started') {
                    interrupted = true
                    browse.cancel()
                }
            }
            catch (err) {
                this.logError(err as Error, 'onScanStateChanged')
            }
        }
        try {
            access.on('scanstate-changed', onScan)
            await access.pauseBackgroundActivity(EXCLUSIVE_OWNER)
            const results = await browse.run(BROWSE_TIMEOUT_MS, onFound)
            return { ok: true, results, interrupted }
        }
        finally {
            access.off('scanstate-changed', onScan)
            this.browse = undefined
            await access.resumeBackgroundActivity(EXCLUSIVE_OWNER).catch(() => undefined)
            // the pause released every browser of the binding, the watch's too
            this.syncWatch()
        }
    }

    // --- check and recovery ---

    protected async doCheck(manual: boolean): Promise<void> {
        await this.ready()
        const links = this.store.getAll()
        this.searchBlocked = undefined
        if (links.length === 0)
            return
        this.emitState()

        const failed = await this.checkSavedAddresses(links)
        if (failed.length > 0)
            await this.recover(failed, manual)
    }

    /** @returns the computers that did not answer on their saved address */
    protected async checkSavedAddresses(links: LinkRecord[]): Promise<LinkRecord[]> {
        const failed: LinkRecord[] = []
        await Promise.all(links.filter(l => !this.sessions.has(l.linkId)).map(async link => {
            this.checkingLinks.add(link.linkId)
            this.emitState()
            try {
                if (!await this.connectKnown(link))
                    failed.push(link)
            }
            finally {
                this.checkingLinks.delete(link.linkId)
            }
        }))
        return failed
    }

    protected async recover(failed: LinkRecord[], manual: boolean): Promise<void> {
        const automatic = !manual
        if (automatic && !this.gate.canAutoBrowse(Date.now())) {
            this.searchBlocked = { reason: 'rate-limited', automatic }
            return
        }
        const outcome = await this.runBrowse(automatic)
        if (outcome.ok === false) {
            this.searchBlocked = { reason: outcome.reason, automatic }
            return
        }
        await this.probeFound(outcome.results, failed)
    }

    protected async probeFound(results: BrowseResult[], failed: LinkRecord[]): Promise<void> {
        let remaining = failed
        for (const found of results) {
            if (remaining.length === 0)
                return
            const candidates = await this.loadCandidates(remaining)
            const result = candidates.length > 0 ? await this.probe(found.host, found.port, candidates) : undefined
            if (result?.kind === 'session') {
                this.adoptSession(result)
                remaining = remaining.filter(l => l.linkId !== result.link.linkId)
            }
        }
    }

    /**
     * Connects to the saved address of a computer; concurrent calls for one computer share the attempt.
     *
     * @returns false if recovery (a browse) could help: the address did not answer or did not prove to be that computer
     */
    protected connectKnown(link: LinkRecord, source: LinkReconnectSource = 'on-demand'): Promise<boolean> {
        let attempt = this.connecting.get(link.linkId)
        if (!attempt) {
            attempt = this.connectAt(link, source).finally(() => this.connecting.delete(link.linkId))
            this.connecting.set(link.linkId, attempt)
        }
        return attempt
    }

    protected async connectAt(link: LinkRecord, source: LinkReconnectSource): Promise<boolean> {
        const address = link.lastAddress
        const candidates = await this.loadCandidates([link])
        if (!address || candidates.length === 0)
            return false
        const result = await this.probe(address.host, address.controlPort, candidates)
        if (result.kind === 'session') {
            this.adoptSession(result, source)
            return true
        }
        if (result.kind === 'version') {
            this.mismatched.add(link.linkId)
            this.emitState()
            this.syncWatch()
            return true
        }
        this.markUnreachable(link.linkId)
        return false
    }

    // --- connections and sessions ---

    // throws if the platform cannot create a socket: every caller (probe, pairing flow) handles that
    protected createConnection(): LinkClientConnection {
        return new LinkClientConnection((getBindings().wifi as LinkWifiBinding).net.createSocket())
    }

    protected async loadCandidates(links: LinkRecord[]): Promise<LinkAuthCandidate[]> {
        const candidates: LinkAuthCandidate[] = []
        for (const link of links) {
            const secret = await this.store.getSecret(link.linkId)
            if (secret && fromBase64Url(secret)?.length)
                candidates.push({ linkId: link.linkId, secret })
        }
        return candidates.slice(0, LINK_MAX_AUTH_KIDS)
    }

    /**
     * Connects to an address and runs `hello` and the challenge-response for the candidates.
     * Only key identifiers and MACs over fresh nonces leave the phone, so an address that does
     * not hold one of the secrets learns nothing that identifies a computer.
     */
    protected async probe(host: string, port: number, candidates: LinkAuthCandidate[]): Promise<ProbeResult> {
        const conn = this.createConnection()
        try {
            await conn.connect(host, port)
            const { version } = await conn.hello()
            const auth = await conn.authenticate(candidates)
            const link = auth.ok ? this.store.get(auth.candidate.linkId) : undefined
            if (auth.ok && link)
                return { kind: 'session', link, conn, session: auth.session, version, host, port }
            conn.close()
            return { kind: 'no-match' }
        }
        catch (err) {
            conn.close()
            const code = err instanceof LinkConnectionError ? err.code : 'protocol'
            this.logEvent({ message: 'local-link probe failed', code })
            if (code === 'version')
                return { kind: 'version' }
            return { kind: code === 'protocol' || code === 'not-a-link' ? 'no-match' : 'unreachable' }
        }
    }

    protected adoptSession(result: Extract<ProbeResult, { kind: 'session' }>, source: LinkReconnectSource = 'on-demand'): void {
        const { link, conn, session, host, port } = result
        this.closeSession(link.linkId)
        this.cancelReconnect(link.linkId)
        this.mismatched.delete(link.linkId)

        const info: LinkClientSession = {
            linkId: link.linkId, host, controlPort: port, mediaPort: session.mediaPort, mediaToken: session.mediaToken,
            mediaTokenExpiresAt: session.mediaTokenExpiresAt, catalogVersion: session.catalogVersion,
            capabilities: Array.isArray(session.capabilities) ? [...session.capabilities] : [],
        }
        const active: ActiveSession = { conn, info, intentional: false }
        this.sessions.set(link.linkId, active)
        conn.on('message', msg => this.onPush(link.linkId, msg))
        conn.on('close', () => this.onSessionClosed(link.linkId, active))
        conn.listen()
        conn.startKeepalive()

        this.store.update(link.linkId, {
            lastAddress: { host, controlPort: port }, lastSeenAt: Date.now(), protocolVersion: result.version,
        }).catch(err => this.logError(err, 'adoptSession'))
        this.logEvent({ message: 'local-link session established' })
        this.logReconnect(link.linkId, source)
        this.syncWatch()
        try {
            this.emit('session-changed', { linkId: link.linkId, session: this.getSession(link.linkId) })
        }
        catch (err) {
            this.logError(err as Error, 'adoptSession')
        }
        this.emitState()
    }

    protected closeSession(linkId: string): void {
        const active = this.sessions.get(linkId)
        if (!active)
            return
        active.intentional = true
        active.conn.close()
    }

    protected onPush(linkId: string, message: LinkServerMessage): void {
        try {
            this.emit('push', { linkId, message })
        }
        catch (err) {
            this.logError(err as Error, 'onPush')
        }
    }

    protected onSessionClosed(linkId: string, active: ActiveSession): void {
        try {
            if (this.sessions.get(linkId) !== active)
                return
            this.sessions.delete(linkId)
            this.emit('session-changed', { linkId, session: undefined })
            this.emitState()
            if (!active.intentional) {
                this.markUnreachable(linkId)
                this.scheduleReconnect(linkId)
                this.syncWatch()
            }
        }
        catch (err) {
            this.logError(err as Error, 'onSessionClosed')
        }
    }

    /** After a lost session the saved address is tried again a few times; the network is not browsed. */
    protected scheduleReconnect(linkId: string): void {
        try {
            const state = this.reconnects.get(linkId) ?? { attempt: 0 }
            const delay = RECONNECT_DELAYS_MS[state.attempt]
            if (delay === undefined || !this.store.get(linkId)) {
                this.reconnects.delete(linkId)
                return
            }
            state.attempt++
            state.timer = setTimeout(() => this.onReconnectTimer(linkId), delay)
            this.reconnects.set(linkId, state)
        }
        catch (err) {
            this.logError(err as Error, 'scheduleReconnect')
        }
    }

    protected onReconnectTimer(linkId: string): void {
        try {
            this.ensureSession(linkId, 'reconnect')
                .then(session => { if (!session) this.scheduleReconnect(linkId) })
                .catch(err => this.logError(err, 'reconnect'))
        }
        catch (err) {
            this.logError(err as Error, 'reconnect')
        }
    }

    protected cancelReconnect(linkId: string): void {
        clearTimeout(this.reconnects.get(linkId)?.timer)
        this.reconnects.delete(linkId)
    }

    // --- retry of the saved address (on demand) ---

    /** Computers that have a record, no session and are not known to speak another protocol version. */
    protected getRetryTargets(): LinkRecord[] {
        return this.store.getAll().filter(l => !this.sessions.has(l.linkId) && !this.mismatched.has(l.linkId))
    }

    protected canRetry(): boolean {
        return this.foreground && this.isSupported() && this.getRetryTargets().length > 0
    }

    /** true while a ride, a device scan, a device pairing, a search or a computer pairing is running */
    protected isNetworkBusy(): boolean {
        return this.getBusyReason() !== undefined || this.pairingFlow.getState().step !== 'idle'
    }

    /** One attempt on the saved addresses; never browses. Never rejects. */
    protected async runRetry(): Promise<void> {
        try {
            await this.ready()
            for (const link of this.getRetryTargets())
                await this.connectKnown(link)
        }
        catch (err) {
            this.logError(err as Error, 'runRetry')
        }
        finally {
            this.retrying = false
        }
    }

    // --- passive reconnect watch ---

    /** Starts, re-arms or stops the watch, depending on what holds now. Call whenever a condition may have changed. */
    protected syncWatch(): void {
        try {
            this.watch.sync()
            if (!this.watch.isRunning())
                this.flushWatchStats()
        }
        catch (err) {
            this.logError(err as Error, 'syncWatch')
        }
    }

    /**
     * The watch runs while the app is in the foreground, nothing exclusive uses the discovery (a
     * ride, an Add Computer browse) and a paired computer has no session. `isSupported` includes
     * the native requirements (iOS: the app declares the Bonjour service), so an app without them
     * never listens.
     */
    protected shouldWatch(): boolean {
        try {
            return this.foreground && this.isSupported() && !this.browse
                && !BUSY_RIDE_STATES.includes(this.getRideDisplay().getState())
                && this.getRetryTargets().length > 0
        }
        catch (err) {
            this.logError(err as Error, 'shouldWatch')
            return false
        }
    }

    /** true if the trainer discovery (WiFi interface) runs a rotation the watch can join */
    protected isTrainerRotationRunning(): boolean {
        try {
            return this.getDeviceAccess().getInterface?.('wifi')?.isConnected?.() === true
        }
        catch (err) {
            this.logError(err as Error, 'isTrainerRotationRunning')
            return false
        }
    }

    /**
     * An announcement of a computer. Announcements carry no link id: the probe (challenge-response)
     * finds out whether it is one of the paired computers. Every scan round announces again, so
     * addresses with a session, announcements already probed and addresses probed too often are skipped.
     */
    protected onWatchAnnouncement(service: LinkMdnsAnnouncement): void {
        try {
            if (!this.shouldWatch())
                return
            const { address, port } = service
            const now = Date.now()
            const key = `${address}:${port}:${service.name ?? ''}`
            const hasSession = [...this.sessions.values()].some(s => s.info.host === address)
            // a connection attempt or a pairing is talking to computers right now: the next scan round announces again
            const busy = this.connecting.size > 0 || this.pairingFlow.getState().step !== 'idle'
            if (hasSession || busy || this.watchInFlight.has(key) || this.isWatchNegative(key, now) || !this.canProbeAddress(address, now)) {
                this.watchStats.suppressed++
                return
            }
            this.watchInFlight.add(key)
            this.recordWatchProbe(address, now)
            this.watchProbe(service, key)
                .catch(err => this.logError(err as Error, 'watchProbe'))
                .finally(() => this.watchInFlight.delete(key))
        }
        catch (err) {
            this.logError(err as Error, 'onWatchAnnouncement')
        }
    }

    protected async watchProbe(service: LinkMdnsAnnouncement, key: string): Promise<void> {
        const candidates = await this.loadCandidates(this.getRetryTargets())
        if (candidates.length === 0)
            return
        const result = await this.probe(service.address, service.port, candidates)
        this.watchStats.probes++
        if (result.kind === 'session') {
            this.watchNegative.delete(key)
            if (this.sessions.has(result.link.linkId))
                result.conn.close()
            else
                this.adoptSession(result, 'watch')
        }
        else {
            this.addWatchNegative(key, result.kind === 'unreachable' ? WATCH_UNREACHABLE_TTL_MS : WATCH_NEGATIVE_TTL_MS)
        }
        this.logEvent({ message: 'local-link watch probe', outcome: result.kind, probes: this.watchStats.probes, suppressed: this.watchStats.suppressed })
    }

    protected isWatchNegative(key: string, now: number): boolean {
        const until = this.watchNegative.get(key)
        if (until === undefined)
            return false
        if (until <= now) {
            this.watchNegative.delete(key)
            return false
        }
        return true
    }

    protected addWatchNegative(key: string, ttl: number): void {
        this.watchNegative.set(key, Date.now() + ttl)
        // bounded: the oldest entries go first
        while (this.watchNegative.size > WATCH_CACHE_MAX_ENTRIES) {
            const oldest = this.watchNegative.keys().next().value
            if (oldest === undefined)
                break
            this.watchNegative.delete(oldest)
        }
    }

    protected canProbeAddress(address: string, now: number): boolean {
        const recent = (this.watchProbes.get(address) ?? []).filter(t => t > now - WATCH_ADDRESS_WINDOW_MS)
        return recent.length < WATCH_MAX_PROBES_PER_ADDRESS
    }

    protected recordWatchProbe(address: string, now: number): void {
        const recent = (this.watchProbes.get(address) ?? []).filter(t => t > now - WATCH_ADDRESS_WINDOW_MS)
        recent.push(now)
        this.watchProbes.delete(address)
        this.watchProbes.set(address, recent)
        while (this.watchProbes.size > WATCH_CACHE_MAX_ENTRIES) {
            const oldest = this.watchProbes.keys().next().value
            if (oldest === undefined)
                break
            this.watchProbes.delete(oldest)
        }
    }

    /** Logs and resets the counter of probes and suppressed duplicates when the watch ends. */
    protected flushWatchStats(): void {
        try {
            const { probes, suppressed } = this.watchStats
            if (probes === 0 && suppressed === 0)
                return
            this.watchStats = { probes: 0, suppressed: 0 }
            this.logEvent({ message: 'local-link watch ended', probes, suppressed })
        }
        catch (err) {
            this.logError(err as Error, 'flushWatchStats')
        }
    }

    protected markUnreachable(linkId: string): void {
        if (!this.unreachableSince.has(linkId))
            this.unreachableSince.set(linkId, Date.now())
    }

    /** A computer that was unreachable has a session again. */
    protected logReconnect(linkId: string, source: LinkReconnectSource): void {
        try {
            const since = this.unreachableSince.get(linkId)
            if (since === undefined)
                return
            this.unreachableSince.delete(linkId)
            this.logEvent({ message: 'local-link reconnected', source, msSinceUnreachable: Math.max(0, Date.now() - since) })
        }
        catch (err) {
            this.logError(err as Error, 'logReconnect')
        }
    }

    // --- pairing ---

    /** `paired` arrived: the secret goes to secure storage, the record to the repository. */
    protected async savePaired(target: PairTarget, body: PairedBody): Promise<LinkPairingFailure | undefined> {
        try {
            return await this.doSavePaired(target, body)
        }
        catch (err) {
            this.logError(err as Error, 'savePaired')
            return 'storage-unavailable'
        }
    }

    protected async doSavePaired(target: PairTarget, body: PairedBody): Promise<LinkPairingFailure | undefined> {
        const record = this.toRecord(target, body)
        if (!record || !fromBase64Url(body.secret)?.length)
            return 'connection-lost'
        // A stored computer is never overwritten while its secret still authenticates: a computer
        // that answers with a linkId we already hold must not replace that record or its secret.
        // Only when the stored secret is dead (e.g. the phone was removed on the computer) is
        // re-pairing allowed. The refusal reuses `connection-lost`, so the reason enum is unchanged.
        if (this.store.get(record.linkId) && await this.ensureSession(record.linkId)) {
            this.logEvent({ message: 'local-link pairing refused', reason: 'already-paired' })
            return 'connection-lost'
        }
        if (!await this.store.saveSecret(record.linkId, body.secret))
            return 'storage-unavailable'
        if (!await this.store.save(record)) {
            await this.store.deleteSecret(record.linkId)
            return 'storage-unavailable'
        }

        const computer = this.discovered.get(target.id)
        if (computer)
            computer.linkId = record.linkId
        this.mismatched.delete(record.linkId)
        this.logEvent({ message: 'local-link computer paired' })
        this.emitState()
        // the pairing connection is unsigned: the session needs its own authenticated connection
        this.ensureSession(record.linkId)
            .catch(err => this.logError(err, 'savePaired'))
            .finally(() => this.syncWatch())
        return undefined
    }

    protected toRecord(target: PairTarget, body: PairedBody): LinkRecord | undefined {
        if (typeof body?.linkId !== 'string' || !UUID_PATTERN.test(body.linkId) || typeof body.secret !== 'string')
            return undefined
        const version = body.protocolVersion
        if (!Number.isInteger(version?.major) || !Number.isInteger(version?.minor))
            return undefined
        const existing = this.store.get(body.linkId)
        const record: LinkRecord = {
            linkId: body.linkId,
            name: cleanLocalName(body.name) ?? target.name,
            protocolVersion: { major: version.major, minor: version.minor },
            lastAddress: { host: target.host, controlPort: target.port },
            pairedAt: Date.now(),
        }
        if (existing?.localName)
            record.localName = existing.localName
        return record
    }

    protected setPairingConnected(linkId: string): void {
        const link = this.store.get(linkId)
        this.pairingFlow.markConnected(linkId, link?.localName ?? link?.name ?? '', true)
    }

    protected toTarget(computer: DiscoveredComputer): PairTarget {
        return { id: computer.id, name: computer.displayName, host: computer.host, port: computer.port }
    }

    protected getClientName(): string {
        try {
            const platform = this.getPlatform()
            if (platform === 'ios')
                return 'iOS device'
            return platform === 'android' ? 'Android device' : DEFAULT_PHONE_NAME
        }
        catch (err) {
            this.logError(err as Error, 'getClientName')
            return DEFAULT_PHONE_NAME
        }
    }

    protected logPairing(message: string, data?: Record<string, unknown>): void {
        try {
            this.logEvent({ message: `local-link ${message}`, ...data })
        }
        catch (err) {
            this.logError(err as Error, 'logPairing')
        }
    }

    // --- display ---

    protected toLink(record: LinkRecord): LinkClientLink {
        return {
            linkId: record.linkId,
            displayName: record.localName ?? record.name,
            name: record.name,
            localName: record.localName,
            reachability: this.getReachability(record),
            pairedAt: record.pairedAt,
            lastSeenAt: record.lastSeenAt,
            catalogVersion: record.catalogVersion,
            connected: this.sessions.has(record.linkId),
            mediaAvailable: this.media.isAvailable(),
        }
    }

    protected getReachability(record: LinkRecord): LinkReachability {
        if (this.checkingLinks.has(record.linkId))
            return 'checking'
        if (this.mismatched.has(record.linkId))
            return 'version-mismatch'
        if (this.sessions.has(record.linkId))
            return 'reachable'
        return record.lastSeenAt === undefined ? 'never-reached' : 'not-reachable'
    }

    protected emitState(): void {
        try {
            this.emit('state-changed', this.getDisplayProps())
        }
        catch (err) {
            this.logError(err as Error, 'emit')
        }
    }

    @Injectable
    protected getAppState() {
        return useAppState()
    }

    @Injectable
    protected getDeviceAccess() {
        return useDeviceAccess()
    }

    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }

    @Injectable
    protected getRideDisplay() {
        return useRideDisplay()
    }
}

/** Returns the phone-side service of the `local-link`. */
export const useLocalLinkClient = () => new LocalLinkClientService()

/** App start: loads the paired computers (no network access). Call after the settings are loaded. */
export const initLocalLinkClient = () => useLocalLinkClient().init()

