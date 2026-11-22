import { Injectable, Singleton } from '../../../base/decorators'
import { IncyclistService } from '../../../base/service'
import { useLocalLinkClient } from '../../../link/client/service'
import type { LinkServerMessage } from '../../../link/types'
import type { LinkClientSession, LinkMediaAccess } from '../../../link/client/types'
import { useRouteList } from '../../list/service'
import type { CatalogDocument, CatalogEntry, SharedRouteEntry } from '../types'
import {
    CATALOG_CHANGED_MESSAGE, CATALOG_TIMEOUT_MS, HANDLE_PATTERN, SYNC_TIMEOUT_MS, UNREACHABLE_TTL_MS,
} from './consts'
import { SharedRouteRepo } from './repo'
import type { SyncOptions, SyncResult } from './types'

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

    constructor() {
        super('RouteSharingClient')
    }

    /** Loads the persisted rows and subscribes to the triggers. Does no network access. */
    async start(): Promise<void> {
        if (this.started || !this.isActive())
            return
        this.started = true
        try {
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
        catch {
            return false
        }
    }

    getRepo(): SharedRouteRepo {
        return this.repo
    }

    /** The persisted rows of every computer that has the route. */
    getRowsForRoute(routeKey: string): SharedRouteEntry[] {
        return this.repo.getByRouteKey(routeKey)
    }

    /** Syncs every paired computer, each independently. */
    async syncAll(opts: SyncOptions = {}): Promise<SyncResult[]> {
        if (!this.isActive())
            return []
        await this.repo.load()
        const links = this.getLocalLinkClient().getDisplayProps().links
        const results = await Promise.allSettled(links.map(l => this.syncLink(l.linkId, opts)))
        return results.map((r, i) => r.status === 'fulfilled' ? r.value : { linkId: links[i].linkId, status: 'failed' as const })
    }

    /** "Check again": re-checks the saved address of every computer and syncs those that answer. */
    async checkAgain(): Promise<SyncResult[]> {
        if (!this.isActive())
            return []
        this.unreachableAt.clear()
        await this.getLocalLinkClient().check({ manual: true })
        return await this.syncAll({ force: true })
    }

    /**
     * Syncs one computer. Concurrent calls share the run, except that a forced call after a
     * running one runs again (the running one may have started before the reason for it).
     */
    syncLink(linkId: string, opts: SyncOptions = {}): Promise<SyncResult> {
        const running = this.running.get(linkId)
        if (running && !opts.force)
            return running
        const run = (running ? running.catch(() => undefined) : Promise.resolve())
            .then(() => this.runSync(linkId, opts))
            .finally(() => { if (this.running.get(linkId) === run) this.running.delete(linkId) })
        this.running.set(linkId, run)
        return run
    }

    /**
     * A handle answered `404`: it is stale (the computer restarted or its library changed). Resyncs
     * the computer once per route and session.
     *
     * @returns the row with the new handle, or `undefined` if the route is no longer in the catalog,
     * the computer does not answer or this was already tried
     */
    async onStaleHandle(linkId: string, routeKey: string): Promise<SharedRouteEntry | undefined> {
        const key = `${linkId}:${routeKey}`
        if (this.staleResynced.has(key) || !this.getLocalLinkClient().getSession(linkId))
            return undefined
        this.staleResynced.add(key)
        const result = await this.syncLink(linkId, { force: true })
        return result.status === 'synced' ? this.repo.getRow(linkId, routeKey) : undefined
    }

    /** A handle answered `410`: the file is gone on that computer. Counts a miss; the row stays. */
    async onGone(linkId: string, routeKey: string): Promise<void> {
        await this.repo.recordGone(linkId, routeKey)
    }

    reset() {
        this.unsubscribers.forEach(u => u())
        this.unsubscribers = []
        this.started = false
        this.running.clear()
        this.unreachableAt.clear()
        this.staleResynced.clear()
        super.reset()
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
        const onLoaded = () => { this.syncAll().catch(err => this.logError(err, 'preload')) }
        list.on('load-done', onLoaded)
        this.unsubscribers.push(() => list.off('load-done', onLoaded))
    }

    protected onSessionChanged(e: { linkId: string, session?: LinkClientSession }): void {
        if (!e.session)
            return
        this.unreachableAt.delete(e.linkId)
        for (const key of [...this.staleResynced].filter(k => k.startsWith(`${e.linkId}:`)))
            this.staleResynced.delete(key)
        this.syncLink(e.linkId).catch(err => this.logError(err, 'session'))
    }

    protected onLinkForgotten(linkId: string): void {
        this.repo.forgetLink(linkId).catch(err => this.logError(err, 'forget'))
        this.unreachableAt.delete(linkId)
    }

    /**
     * `catalog-changed` is pushed by a computer whose library changed; the body may carry the new
     * version. A push for the version we already hold causes no sync.
     */
    protected onPush(e: { linkId: string, message?: LinkServerMessage }): void {
        const message = e?.message
        if (message?.t !== CATALOG_CHANGED_MESSAGE)
            return
        const known = this.getStoredVersion(e.linkId)
        const announced = message.b?.catalogVersion
        if (announced !== undefined && announced === known)
            return
        this.syncLink(e.linkId, { force: true }).catch(err => this.logError(err, 'push'))
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
            this.emit('synced', result)
            return result
        }
        catch (err) {
            this.logError(err as Error, 'sync')
            return { linkId, status: 'failed' }
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
        return { linkId, status: 'synced', added, removed }
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
