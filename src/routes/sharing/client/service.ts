import { Injectable, Singleton } from '../../../base/decorators'
import { IncyclistService } from '../../../base/service'
import { useLocalLinkClient } from '../../../link/client/service'
import type { LinkServerMessage } from '../../../link/types'
import type { LinkClientSession, LinkMediaAccess } from '../../../link/client/types'
import { sleep } from '../../../utils/sleep'
import { Route } from '../../base/model/route'
import { addDetails } from '../../base/utils/route'
import { RouteApiDetail } from '../../base/api/types'
import { useRouteList } from '../../list/service'
import type { CatalogDocument, CatalogEntry, SharedRouteEntry, SharedRouteSummary } from '../types'
import {
    CATALOG_CHANGED_MESSAGE, CATALOG_TIMEOUT_MS, DESCRIPTOR_BUSY_RETRY_MS, DESCRIPTOR_DOWNLOAD_TIMEOUT_MS, DESCRIPTOR_REQUEST_TIMEOUT_MS,
    HANDLE_PATTERN, ROUTE_HASH_PATTERN, SYNC_TIMEOUT_MS, UNREACHABLE_TTL_MS,
} from './consts'
import { DescriptorLoadError, getDescriptorDocument, parseDescriptor } from './descriptor'
import { SharedRouteRepo } from './repo'
import { SharedRouteMaterializer } from './routes'
import type { DescriptorFailure, DescriptorTrigger, SyncOptions, SyncResult } from './types'

type Unsubscribe = () => void

const TIMED_OUT = Symbol('timed-out')

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([promise, new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms) })])
    }
    finally {
        clearTimeout(timer)
    }
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The text of a localized title: a string, or a map of language to string. */
const toLocalizedTitle = (v: unknown): SharedRouteSummary['localizedTitle'] => {
    if (typeof v === 'string')
        return v as never
    if (v === null || typeof v !== 'object' || Array.isArray(v))
        return undefined
    const entries = Object.entries(v).filter(([, text]) => typeof text === 'string')
    return entries.length > 0 ? Object.fromEntries(entries) as never : undefined
}

const SUMMARY_FIELDS: Array<[keyof SharedRouteSummary, (v: unknown) => boolean]> = [
    ['country', v => typeof v === 'string'], ['distance', isNumber], ['elevation', isNumber], ['isLoop', v => typeof v === 'boolean'],
    ['hasGpx', v => typeof v === 'boolean'], ['pointsSource', v => v === 'gpx' || v === 'strava' || v === 'embedded'],
    ['videoFormat', v => typeof v === 'string'],
]

/** The summary of a catalog entry; each field is kept only if it has the expected type. Without a string title there is none. */
const toSummary = (raw: unknown): SharedRouteSummary | undefined => {
    const s = raw as Record<string, unknown> | undefined
    if (typeof s?.title !== 'string')
        return undefined
    const summary: Record<string, unknown> = { title: s.title }
    for (const [key, valid] of SUMMARY_FIELDS) {
        if (valid(s[key]))
            summary[key] = s[key]
    }
    const localizedTitle = toLocalizedTitle(s.localizedTitle)
    if (localizedTitle !== undefined)
        summary.localizedTitle = localizedTitle
    return summary as unknown as SharedRouteSummary
}

const toCatalogEntry = (raw: unknown): CatalogEntry | undefined => {
    const e = raw as Partial<CatalogEntry>
    if (!isText(e?.routeKey) || !isText(e.routeIdOnComputer) || !isText(e.videoHandle) || !HANDLE_PATTERN.test(e.videoHandle))
        return undefined
    const entry: CatalogEntry = {
        routeKey: e.routeKey, routeIdOnComputer: e.routeIdOnComputer, title: typeof e.title === 'string' ? e.title : '',
        videoHandle: e.videoHandle, videoFormat: typeof e.videoFormat === 'string' ? e.videoFormat : '',
        size: Number(e.size) || 0, mtime: Number(e.mtime) || 0,
    }
    if (isText(e.thumbHandle) && HANDLE_PATTERN.test(e.thumbHandle))
        entry.thumbHandle = e.thumbHandle
    if (e.origin === 'official' || e.origin === 'local')
        entry.origin = e.origin
    if (typeof e.routeHash === 'string' && ROUTE_HASH_PATTERN.test(e.routeHash))
        entry.routeHash = e.routeHash
    const summary = toSummary(e.summary)
    if (summary)
        entry.summary = summary
    return entry
}

/** The catalog document if it has the expected shape, otherwise `undefined` (never an empty catalog). */
export const parseCatalog = (body: unknown): CatalogDocument | undefined => {
    const doc = body as Partial<CatalogDocument>
    if (!isText(doc?.catalogVersion) || !Array.isArray(doc.routes))
        return undefined
    const routes = doc.routes.map(toCatalogEntry).filter((e): e is CatalogEntry => e !== undefined)
    return { catalogVersion: doc.catalogVersion, routes }
}

/**
 * Phone side of route sharing: keeps the persisted routes of every paired computer up to date.
 *
 * - Every computer is synced on its own and fails on its own: a computer that does not answer
 *   causes no write at all (not even for its own rows), and never affects another computer.
 * - Triggers: the route list preload, a new session of a computer (when its `catalogVersion`
 *   differs from the stored one), {@link checkAgain}, and a `catalog-changed` push.
 * - The catalog is fetched from the computer's media server with its media token. A `404` on a
 *   handle means the handle is stale (one resync, one retry); a `410` means the file is gone (a
 *   miss is counted, the row stays).
 *
 * Inert unless the link client is supported (feature toggle, bindings, native requirements).
 *
 * Emits `synced` (`SyncResult`) after every sync that ran.
 */
@Singleton
export class RouteSharingClientService extends IncyclistService {
    protected repo = new SharedRouteRepo()
    protected running = new Map<string, Promise<SyncResult>>()
    protected unreachableAt = new Map<string, number>()
    protected staleResynced = new Set<string>()
    protected unsubscribers: Unsubscribe[] = []
    protected started = false
    protected catalogs = new Map<string, CatalogEntry[]>()
    protected descriptorLoads = new Map<string, Promise<Route>>()
    protected materializer = new SharedRouteMaterializer({
        getList: () => this.getRouteList(),
        getRowsForRoute: routeKey => this.getRowsForRoute(routeKey),
        log: event => this.logEvent(event),
        logError: (err, fn) => this.logError(err, fn),
    })

    constructor() {
        super('RouteSharingClient')
    }

    /** Loads the persisted rows and subscribes to the triggers. Does no network access. */
    async start(): Promise<void> {
        try {
            if (this.started || !this.isActive())
                return
            this.started = true
            await this.repo.load()
            this.subscribe()
        }
        catch (err) {
            this.logError(err as Error, 'start')
        }
    }

    /** true if route sharing is available on this device */
    isActive(): boolean {
        try {
            return this.getLocalLinkClient().isSupported()
        }
        catch (err) {
            this.logError(err as Error, 'isActive')
            return false
        }
    }

    getRepo(): SharedRouteRepo {
        return this.repo
    }

    /** The persisted rows of every computer that has the route. */
    getRowsForRoute(routeKey: string): SharedRouteEntry[] {
        try {
            return this.repo.getByRouteKey(routeKey)
        }
        catch (err) {
            this.logError(err as Error, 'getRowsForRoute')
            return []
        }
    }

    /** Syncs every paired computer, each independently. */
    async syncAll(opts: SyncOptions = {}): Promise<SyncResult[]> {
        try {
            if (!this.isActive())
                return []
            await this.repo.load()
            const links = this.getLocalLinkClient().getDisplayProps().links
            const results = await Promise.allSettled(links.map(l => this.syncLink(l.linkId, opts)))
            return results.map((r, i) => r.status === 'fulfilled' ? r.value : { linkId: links[i].linkId, status: 'failed' as const })
        }
        catch (err) {
            this.logError(err as Error, 'syncAll')
            return []
        }
    }

    /** "Check again": re-checks the saved address of every computer and syncs those that answer. */
    async checkAgain(): Promise<SyncResult[]> {
        try {
            if (!this.isActive())
                return []
            this.unreachableAt.clear()
            await this.getLocalLinkClient().check({ manual: true })
            return await this.syncAll({ force: true })
        }
        catch (err) {
            this.logError(err as Error, 'checkAgain')
            return []
        }
    }

    /**
     * Syncs one computer. Concurrent calls share the run, except that a forced call after a
     * running one runs again (the running one may have started before the reason for it).
     */
    syncLink(linkId: string, opts: SyncOptions = {}): Promise<SyncResult> {
        try {
            const running = this.running.get(linkId)
            if (running && !opts.force)
                return running
            // runSync never rejects
            const run = (running ? running.catch(() => undefined) : Promise.resolve())
                .then(() => this.runSync(linkId, opts))
                .finally(() => { if (this.running.get(linkId) === run) this.running.delete(linkId) })
            this.running.set(linkId, run)
            return run
        }
        catch (err) {
            this.logError(err as Error, 'syncLink')
            return Promise.resolve({ linkId, status: 'failed' })
        }
    }

    /**
     * A handle answered `404`: it is stale (the computer restarted or its library changed). Resyncs
     * the computer once per route and session.
     *
     * @returns the row with the new handle, or `undefined` if the route is no longer in the catalog,
     * the computer does not answer or this was already tried
     */
    async onStaleHandle(linkId: string, routeKey: string): Promise<SharedRouteEntry | undefined> {
        try {
            const key = `${linkId}:${routeKey}`
            if (this.staleResynced.has(key) || !this.getLocalLinkClient().getSession(linkId))
                return undefined
            this.staleResynced.add(key)
            const result = await this.syncLink(linkId, { force: true })
            return result.status === 'synced' ? this.repo.getRow(linkId, routeKey) : undefined
        }
        catch (err) {
            this.logError(err as Error, 'onStaleHandle')
            return undefined
        }
    }

    /** A handle answered `410`: the file is gone on that computer. Counts a miss; the row stays. */
    async onGone(linkId: string, routeKey: string): Promise<void> {
        try {
            await this.repo.recordGone(linkId, routeKey)
        }
        catch (err) {
            this.logError(err as Error, 'onGone')
        }
    }

    /**
     * Loads the details of a `linkShared` route from a paired computer that has the route and offers
     * `route-descriptor`, verifies them (digest and `routeHash`) and persists them. A route that already
     * has details is returned as it is. Uses open sessions only: never connects and never browses.
     *
     * @param route the route as it is in the route list; its details are set
     * @param trigger what needs the details
     * @returns the route; if no computer could provide verified details, `details` is still absent and
     * nothing was persisted (the reason is logged)
     */
    loadDescriptor(route: Route, trigger: DescriptorTrigger): Promise<Route> {
        try {
            if (route.details)
                return Promise.resolve(route)
            const routeKey = route.description.id!
            let load = this.descriptorLoads.get(routeKey)
            if (!load) {
                load = this.doLoadDescriptor(route, trigger)
                    .catch(() => route)
                    .finally(() => { this.descriptorLoads.delete(routeKey) })
                this.descriptorLoads.set(routeKey, load)
            }
            return load
        }
        catch (err) {
            this.logError(err as Error, 'loadDescriptor')
            return Promise.resolve(route)
        }
    }

    reset() {
        try {
            this.catalogs.clear()
            this.descriptorLoads.clear()
            const unsubscribers = this.unsubscribers
            this.unsubscribers = []
            unsubscribers.forEach(u => this.unsubscribeSafely(u))
            this.started = false
            this.running.clear()
            this.unreachableAt.clear()
            this.staleResynced.clear()
            super.reset()
        }
        catch (err) {
            this.logError(err as Error, 'reset')
        }
    }

    protected unsubscribeSafely(unsubscribe: Unsubscribe): void {
        try {
            unsubscribe()
        }
        catch (err) {
            this.logError(err as Error, 'unsubscribe')
        }
    }

    protected subscribe(): void {
        const client = this.getLocalLinkClient()
        const onSession = (e: { linkId: string, session?: LinkClientSession }) => this.onSessionChanged(e)
        const onForgotten = (linkId: string) => this.onLinkForgotten(linkId)
        const onPush = (e: { linkId: string, message?: LinkServerMessage }) => this.onPush(e)
        client.on('session-changed', onSession)
        client.on('link-forgotten', onForgotten)
        client.on('push', onPush)
        this.unsubscribers.push(() => { client.off('session-changed', onSession); client.off('link-forgotten', onForgotten); client.off('push', onPush) })

        const list = this.getRouteList()
        const onLoaded = () => {
            try {
                this.materializeCached().catch(err => this.logError(err, 'materialize'))
                this.syncAll().catch(err => this.logError(err, 'preload'))
            }
            catch (err) {
                this.logError(err as Error, 'preload')
            }
        }
        list.on('load-done', onLoaded)
        this.unsubscribers.push(() => list.off('load-done', onLoaded))
    }

    protected onSessionChanged(e: { linkId: string, session?: LinkClientSession }): void {
        try {
            if (!e.session)
                return
            this.unreachableAt.delete(e.linkId)
            for (const key of [...this.staleResynced].filter(k => k.startsWith(`${e.linkId}:`)))
                this.staleResynced.delete(key)
            this.syncLink(e.linkId).catch(err => this.logError(err, 'session'))
        }
        catch (err) {
            this.logError(err as Error, 'onSessionChanged')
        }
    }

    protected onLinkForgotten(linkId: string): void {
        try {
            this.catalogs.delete(linkId)
            this.unreachableAt.delete(linkId)
            this.repo.forgetLink(linkId)
                .then(() => this.materializer.removeOrphans())
                .catch(err => this.logError(err, 'forget'))
        }
        catch (err) {
            this.logError(err as Error, 'onLinkForgotten')
        }
    }

    /** Materialises the catalogs that arrived before the route list was loaded. */
    protected async materializeCached(): Promise<void> {
        for (const entries of [...this.catalogs.values()])
            await this.materializer.materialize(entries)
    }

    /**
     * `catalog-changed` is pushed by a computer whose library changed; the body may carry the new
     * version. A push for the version we already hold causes no sync.
     */
    protected onPush(e: { linkId: string, message?: LinkServerMessage }): void {
        try {
            const message = e?.message
            if (message?.t !== CATALOG_CHANGED_MESSAGE)
                return
            const known = this.getStoredVersion(e.linkId)
            const announced = message.b?.catalogVersion
            if (announced !== undefined && announced === known)
                return
            this.syncLink(e.linkId, { force: true }).catch(err => this.logError(err, 'push'))
        }
        catch (err) {
            this.logError(err as Error, 'onPush')
        }
    }

    protected getStoredVersion(linkId: string): string | undefined {
        return this.getLocalLinkClient().getDisplayProps().links.find(l => l.linkId === linkId)?.catalogVersion
    }

    protected async runSync(linkId: string, opts: SyncOptions): Promise<SyncResult> {
        try {
            if (!opts.force && this.isRecentlyUnreachable(linkId))
                return { linkId, status: 'unreachable' }
            const result = await this.doSync(linkId, opts)
            if (result.status === 'unreachable')
                this.unreachableAt.set(linkId, Date.now())
            else
                this.unreachableAt.delete(linkId)
            this.emitSynced(result)
            return result
        }
        catch (err) {
            this.logError(err as Error, 'sync')
            return { linkId, status: 'failed' }
        }
    }

    protected emitSynced(result: SyncResult): void {
        try {
            this.emit('synced', result)
        }
        catch (err) {
            this.logError(err as Error, 'emitSynced')
        }
    }

    protected isRecentlyUnreachable(linkId: string): boolean {
        const at = this.unreachableAt.get(linkId)
        return at !== undefined && Date.now() - at < UNREACHABLE_TTL_MS
    }

    /** Nothing is written unless the computer answered with a usable catalog. */
    protected async doSync(linkId: string, opts: SyncOptions): Promise<SyncResult> {
        const media = await withTimeout(this.getLocalLinkClient().getMedia(linkId), SYNC_TIMEOUT_MS)
        if (media === TIMED_OUT || !media)
            return { linkId, status: 'unreachable' }
        if (!opts.force && media.catalogVersion && media.catalogVersion === this.getStoredVersion(linkId))
            return { linkId, status: 'unchanged' }

        const doc = await this.fetchCatalog(media)
        if (doc === undefined)
            return { linkId, status: 'unreachable' }
        if (doc === null)
            return { linkId, status: 'failed' }

        // the computer may have been forgotten while the catalog was on its way
        if (!this.getLocalLinkClient().getDisplayProps().links.some(l => l.linkId === linkId))
            return { linkId, status: 'failed' }

        const { added, removed } = await this.repo.replaceForLink(linkId, doc.routes)
        await this.getLocalLinkClient().setCatalogVersion(linkId, doc.catalogVersion)
        this.logEvent({ message: 'route sharing catalog synced', routes: doc.routes.length, added, removed })
        this.catalogs.set(linkId, doc.routes)
        await this.materialize(doc.routes)
        return { linkId, status: 'synced', added, removed }
    }

    /** Creates the routes of a catalog on this device; a failure here never fails the sync. */
    protected async materialize(entries: CatalogEntry[]): Promise<void> {
        try {
            await this.materializer.materialize(entries)
        }
        catch (err) {
            this.logError(err as Error, 'materialize')
        }
    }

    protected async doLoadDescriptor(route: Route, trigger: DescriptorTrigger): Promise<Route> {
        const routeKey = route.description.id!
        const startedAt = Date.now()
        try {
            const doc = await this.fetchDescriptor(routeKey)
            const descriptor = parseDescriptor(doc.body, doc.sha256, routeKey)
            const details = { ...descriptor.details, id: routeKey, routeHash: routeKey } as unknown as RouteApiDetail
            if (descriptor.description.segments)
                route.description.segments = descriptor.description.segments
            addDetails(route, details)
            await this.getRouteList().saveRoute(route, true)
            this.getRouteList().findCard(route)?.card?.emitUpdate()
            this.logEvent({ message: 'route descriptor loaded', bytes: Buffer.byteLength(doc.body), durationMs: Date.now() - startedAt, trigger })
            return route
        }
        catch (err) {
            const failure = err instanceof DescriptorLoadError ? err : new DescriptorLoadError('unreachable')
            if (!(err instanceof DescriptorLoadError))
                this.logError(err as Error, 'loadDescriptor')
            this.logEvent({ message: 'route descriptor failed', reason: failure.reason, httpStatus: failure.httpStatus })
            throw failure
        }
    }

    /** The computers that can hand out the descriptor of a route now, most recently seen first. */
    protected getDescriptorCandidates(routeKey: string): string[] {
        const client = this.getLocalLinkClient()
        const lastSeen = new Map(client.getDisplayProps().links.map(l => [l.linkId, l.lastSeenAt ?? 0]))
        const rows = this.getRowsForRoute(routeKey).filter(r => client.getSession(r.linkId) !== undefined)
        const capable = rows.filter(r => client.getSession(r.linkId)?.capabilities.includes('route-descriptor'))
        if (capable.length === 0)
            throw new DescriptorLoadError(rows.length > 0 ? 'unsupported' : 'unreachable')
        return capable.sort((a, b) => (lastSeen.get(b.linkId) ?? 0) - (lastSeen.get(a.linkId) ?? 0)).map(r => r.linkId)
    }

    /** Asks the candidates one after the other; the first computer that hands out a document wins. */
    protected async fetchDescriptor(routeKey: string): Promise<{ body: string, sha256: string }> {
        let failure = new DescriptorLoadError('unreachable')
        for (const linkId of this.getDescriptorCandidates(routeKey)) {
            try {
                return await this.fetchFrom(linkId, routeKey)
            }
            catch (err) {
                if (!(err instanceof DescriptorLoadError))
                    throw err
                failure = err
                if (err.reason === 'unknown-route')
                    await this.onStaleHandle(linkId, routeKey)
            }
        }
        throw failure
    }

    protected async fetchFrom(linkId: string, routeKey: string): Promise<{ body: string, sha256: string }> {
        const res = await this.requestDescriptor(linkId, routeKey)
        const { name, sha256 } = getDescriptorDocument(res)
        const media = await this.getLocalLinkClient().getMedia(linkId)
        if (!media)
            throw new DescriptorLoadError('unreachable')
        return { body: await this.downloadDocument(media, name), sha256 }
    }

    protected async requestDescriptor(linkId: string, routeKey: string) {
        let res = await this.sendDescriptorRequest(linkId, routeKey)
        if (res.error === 'busy') {
            await sleep(DESCRIPTOR_BUSY_RETRY_MS)
            res = await this.sendDescriptorRequest(linkId, routeKey)
        }
        if (res.error)
            throw new DescriptorLoadError(this.toFailure(res.error))
        return res
    }

    protected async sendDescriptorRequest(linkId: string, routeKey: string) {
        try {
            // `request` resolves with `undefined` if there is no session, no answer in time or the session ended
            const reply = await this.getLocalLinkClient().request(linkId, 'route-descriptor', { routeKey }, DESCRIPTOR_REQUEST_TIMEOUT_MS)
            if (!reply)
                throw new DescriptorLoadError('unreachable')
            return reply.b ?? { routeKey }
        }
        catch (err) {
            if (err instanceof DescriptorLoadError)
                throw err
            throw new DescriptorLoadError('unreachable')
        }
    }

    protected toFailure(error: string): DescriptorFailure {
        if (error === 'unknown-route' || error === 'busy' || error === 'too-large')
            return error
        return 'unreachable'
    }

    protected async downloadDocument(media: LinkMediaAccess, name: string): Promise<string> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), DESCRIPTOR_DOWNLOAD_TIMEOUT_MS)
        try {
            const response = await fetch(`${media.baseUrl}/${name}`, { headers: { Authorization: `Bearer ${media.token}` }, signal: controller.signal })
            if (!response.ok)
                throw new DescriptorLoadError('http', response.status)
            return await response.text()
        }
        catch (err) {
            if (err instanceof DescriptorLoadError)
                throw err
            throw new DescriptorLoadError(controller.signal.aborted ? 'timeout' : 'unreachable')
        }
        finally {
            clearTimeout(timer)
        }
    }

    /**
     * @returns the catalog; `undefined` if the computer did not answer; `null` if it answered with
     * something that is not a catalog
     */
    protected async fetchCatalog(media: LinkMediaAccess): Promise<CatalogDocument | null | undefined> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS)
        let response: Response
        try {
            response = await fetch(`${media.baseUrl}/catalog`, { headers: { Authorization: `Bearer ${media.token}` }, signal: controller.signal })
        }
        catch {
            clearTimeout(timer)
            return undefined
        }
        try {
            if (!response.ok)
                return null
            return parseCatalog(await response.json()) ?? null
        }
        catch {
            return null
        }
        finally {
            clearTimeout(timer)
        }
    }

    @Injectable
    protected getLocalLinkClient() {
        return useLocalLinkClient()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }
}

/** Returns the phone-side route sharing service. */
export const useRouteSharingClient = () => new RouteSharingClientService()

/** App start: loads the persisted rows of the paired computers and starts listening for sync triggers. */
export const initRouteSharingClient = () => useRouteSharingClient().start()
