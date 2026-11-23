import type { MediaState } from '../../api/localLink/types'
import { getBindings } from '../../api/bindings'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { randomBytes, sha256Base64Url, toBase64Url } from '../../link/utils'
import { useUserSettings } from '../../settings/service'
import { useRouteList } from '../list/service'
import { buildCatalog } from './catalog'
import type { CatalogBuild } from './catalog'
import { DESCRIPTOR_DOCUMENT_PREFIX, DESCRIPTOR_MAX_DOCUMENTS, DESCRIPTOR_MAX_TOTAL_BYTES, DESCRIPTOR_TTL_MS } from './consts'
import { buildRouteDescriptor } from './descriptor'
import type { RouteDescriptorError, RouteDescriptorResponseBody } from './types'

const REFRESH_DEBOUNCE_MS = 1500
const STAT_TIMEOUT_MS = 3000
const VIDEO_DIR_KEY = 'videos.directory'
const SETTINGS_REQUESTER = 'RouteSharing'

type Unsubscribe = () => void

interface DescriptorDocument {
    routeKey: string
    body: string
    bytes: number
    servedAt: number
}

/**
 * Builds the catalog document and the handle table of the routes this computer shares and
 * publishes them, together with the digests of the media tokens it is told about, to the
 * `local-link` transport. Handles are opaque and stable within one process; the catalog
 * version is a hash of the catalog content.
 *
 * Emits `catalog-changed` with `{ catalogVersion, routeCount }`.
 */
@Singleton
export class RouteSharingService extends IncyclistService {
    protected linkId?: string
    protected started = false
    protected tokens: MediaState['tokens'] = []
    protected catalog?: CatalogBuild
    protected handleSalt?: Buffer
    protected publishChain: Promise<unknown> = Promise.resolve()
    protected refreshing?: Promise<void>
    protected refreshAgain = false
    protected refreshTimer?: ReturnType<typeof setTimeout>
    protected unsubscribers: Unsubscribe[] = []
    protected descriptorDocs = new Map<string, DescriptorDocument>()
    protected outstanding = new Set<string>()
    protected descriptorTimer?: ReturnType<typeof setTimeout>

    constructor() {
        super('RouteSharing')
    }

    /** Starts watching the route list and the video directory, builds and publishes the catalog. */
    async start(linkId: string): Promise<void> {
        try {
            this.linkId = linkId
            if (!this.started) {
                this.started = true
                this.subscribe()
            }
            this.ensureRoutesLoaded()
            await this.refresh()
        }
        catch (err) {
            this.logError(err as Error, 'start')
        }
    }

    /** Stops watching. The transport drops the published state itself when it stops. */
    stop(): void {
        try {
            this.started = false
            clearTimeout(this.refreshTimer)
            const unsubscribers = this.unsubscribers
            this.unsubscribers = []
            this.catalog = undefined
            clearTimeout(this.descriptorTimer)
            this.descriptorTimer = undefined
            this.descriptorDocs.clear()
            this.outstanding.clear()
            unsubscribers.forEach(u => this.unsubscribeSafely(u))
        }
        catch (err) {
            this.logError(err as Error, 'stop')
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

    /**
     * Sets the digests of the currently valid media tokens and republishes.
     *
     * @returns false if the transport rejected the publication
     */
    async setTokens(tokens: MediaState['tokens']): Promise<boolean> {
        try {
            this.tokens = tokens.map(t => ({ ...t }))
            return this.started ? await this.publish() : true
        }
        catch (err) {
            this.logError(err as Error, 'setTokens')
            return false
        }
    }

    /** Rebuilds the catalog from the route list and republishes it. */
    refresh(): Promise<void> {
        if (this.refreshing !== undefined) {
            this.refreshAgain = true
            return this.refreshing
        }
        // concurrent callers share one run; the run never rejects (runRefresh is async)
        this.refreshing = this.runRefresh()
            .catch(err => this.logError(err as Error, 'refresh'))
            .finally(() => { this.refreshing = undefined })
        return this.refreshing
    }

    /**
     * Hands out the details of one local route to a paired phone: builds the whitelisted descriptor,
     * publishes it as a short-lived document and returns its name, size and digest.
     *
     * Only routes of the current catalog that are local and have a `routeHash` are served. At most
     * {@link DESCRIPTOR_MAX_DOCUMENTS} documents and {@link DESCRIPTOR_MAX_TOTAL_BYTES} bytes are
     * held (oldest first out); a connection has one request at a time.
     *
     * @param routeKey the route's key in the catalog
     * @param connectionId the control connection that asks
     */
    async getDescriptor(routeKey: string, connectionId: string): Promise<RouteDescriptorResponseBody> {
        try {
            return await this.doGetDescriptor(routeKey, connectionId)
        }
        catch (err) {
            this.logError(err as Error, 'getDescriptor')
            // fallback: the phone is told that no details are available
            return { routeKey: typeof routeKey === 'string' ? routeKey : '', error: 'no-details' }
        }
    }

    protected async doGetDescriptor(routeKey: string, connectionId: string): Promise<RouteDescriptorResponseBody> {
        const startedAt = Date.now()
        if (this.outstanding.has(connectionId))
            return this.descriptorFailed(routeKey, 'busy')
        this.outstanding.add(connectionId)
        let name: string | undefined
        try {
            const entry = typeof routeKey === 'string' ? this.catalog?.document.routes.find(r => r.routeKey === routeKey) : undefined
            if (entry?.origin !== 'local' || !entry.routeHash)
                return this.descriptorFailed(routeKey, 'unknown-route')

            const route = await this.loadRouteWithDetails(entry.routeIdOnComputer)
            if (!route?.details)
                return this.descriptorFailed(routeKey, 'no-details')

            const body = JSON.stringify(buildRouteDescriptor(routeKey, route.description, route.details))
            const bytes = Buffer.byteLength(body)
            if (bytes > DESCRIPTOR_MAX_TOTAL_BYTES)
                return this.descriptorFailed(routeKey, 'too-large')

            name = this.descriptorName(routeKey)
            if (!this.reserveDescriptorSpace(name, bytes))
                return this.descriptorFailed(routeKey, 'busy')
            this.descriptorDocs.set(name, { routeKey, body, bytes, servedAt: Date.now() })

            if (!await this.publish()) {
                this.descriptorDocs.delete(name)
                return this.descriptorFailed(routeKey, 'publish-failed')
            }
            this.scheduleDescriptorExpiry()
            this.logEvent({
                message: 'route descriptor served', bytes, pointCount: route.details.points?.length ?? 0,
                mappingCount: route.details.video?.mappings?.length ?? 0, durationMs: Date.now() - startedAt,
            })
            return { routeKey, document: name, size: bytes, sha256: sha256Base64Url(body) }
        }
        catch (err) {
            this.logError(err as Error, 'getDescriptor')
            if (name)
                this.descriptorDocs.delete(name)
            return this.descriptorFailed(routeKey, 'no-details')
        }
        finally {
            this.outstanding.delete(connectionId)
        }
    }

    getCatalogVersion(): string {
        try {
            return this.catalog?.document.catalogVersion ?? ''
        }
        catch (err) {
            this.logError(err as Error, 'getCatalogVersion')
            return ''
        }
    }

    getRouteCount(): number {
        try {
            return this.catalog?.document.routes.length ?? 0
        }
        catch (err) {
            this.logError(err as Error, 'getRouteCount')
            return 0
        }
    }

    reset() {
        try {
            this.stop()
            super.reset()
        }
        catch (err) {
            this.logError(err as Error, 'reset')
        }
    }

    protected descriptorFailed(routeKey: string, error: RouteDescriptorError): RouteDescriptorResponseBody {
        this.logEvent({ message: 'route descriptor failed', reason: error })
        return { routeKey: typeof routeKey === 'string' ? routeKey : '', error }
    }

    protected async loadRouteWithDetails(id: string) {
        const list = this.getRouteList()
        let route = list.getRoute(id)
        if (route && !route.details) {
            await list.getRouteDetails(id)
            route = list.getRoute(id)
        }
        return route
    }

    /** Opaque and stable within the process: `rd-` and 16 hex characters. */
    protected descriptorName(routeKey: string): string {
        this.handleSalt ??= randomBytes(32)
        const hmac = this.getBindings().crypto.createHmac('sha256', this.handleSalt)
        hmac.update(`rd|${routeKey}`)
        return DESCRIPTOR_DOCUMENT_PREFIX + Buffer.from(hmac.digest()).toString('hex').slice(0, 16)
    }

    /**
     * Drops expired documents and the document of the same name, then the oldest ones until the new
     * one fits the count and byte budget.
     *
     * @returns false if it does not fit
     */
    protected reserveDescriptorSpace(name: string, bytes: number): boolean {
        this.dropExpiredDescriptors()
        this.descriptorDocs.delete(name)
        const total = () => [...this.descriptorDocs.values()].reduce((sum, d) => sum + d.bytes, 0)
        const fits = () => this.descriptorDocs.size < DESCRIPTOR_MAX_DOCUMENTS && bytes + total() <= DESCRIPTOR_MAX_TOTAL_BYTES
        while (!fits() && this.descriptorDocs.size > 0) {
            const oldest = [...this.descriptorDocs.entries()].sort((a, b) => a[1].servedAt - b[1].servedAt)[0]
            this.descriptorDocs.delete(oldest[0])
        }
        return fits()
    }

    /** @returns true if a document was dropped */
    protected dropExpiredDescriptors(): boolean {
        const now = Date.now()
        let dropped = false
        for (const [name, doc] of this.descriptorDocs) {
            if (now - doc.servedAt >= DESCRIPTOR_TTL_MS) {
                this.descriptorDocs.delete(name)
                dropped = true
            }
        }
        return dropped
    }

    protected scheduleDescriptorExpiry(): void {
        clearTimeout(this.descriptorTimer)
        if (this.descriptorDocs.size === 0)
            return
        const oldest = Math.min(...[...this.descriptorDocs.values()].map(d => d.servedAt))
        const delay = Math.max(0, oldest + DESCRIPTOR_TTL_MS - Date.now())
        this.descriptorTimer = setTimeout(() => this.onDescriptorExpiry(), delay)
        this.descriptorTimer.unref?.()
    }

    protected onDescriptorExpiry(): void {
        try {
            if (this.dropExpiredDescriptors() && this.started)
                this.publish().catch(err => this.logError(err, 'descriptorExpiry'))
            this.scheduleDescriptorExpiry()
        }
        catch (err) {
            this.logError(err as Error, 'descriptorExpiry')
        }
    }

    protected async runRefresh(): Promise<void> {
        do {
            this.refreshAgain = false
            await this.rebuild() // NOSONAR sequential: a rebuild runs after the previous one, repeated while changes arrive
        } while (this.refreshAgain && this.started)
    }

    protected async rebuild(): Promise<void> {
        const linkId = this.linkId
        if (!this.started || !linkId)
            return
        try {
            const previous = this.getCatalogVersion()
            const descriptions = (this.getRouteList().getAllRoutes() ?? []).map(r => r.description).filter(Boolean)
            this.catalog = await buildCatalog(descriptions, {
                linkId,
                makeHandle: (kind, path) => this.makeHandle(kind, path),
                stat: path => this.getFileSize(path),
                hash: text => sha256Base64Url(text).slice(0, 22),
            })
            if (this.catalog.skipped.video || this.catalog.skipped.thumbnail || this.catalog.skipped.missingVideo)
                this.logEvent({ message: 'routes or thumbnails left out of the shared catalog (unsupported file type or missing file)', ...this.catalog.skipped })
            this.logEvent({ message: 'published-media', routes: this.catalog.document.routes.length, withThumbnail: this.catalog.thumbnails.with, withoutThumbnail: this.catalog.thumbnails.without })
            await this.publish()
            if (previous !== this.getCatalogVersion())
                this.emit('catalog-changed', { catalogVersion: this.getCatalogVersion(), routeCount: this.getRouteCount() })
        }
        catch (err) {
            this.logError(err as Error, 'rebuild')
        }
    }

    /** Publications are serialised; each one sends the latest state at the time it runs. */
    protected publish(): Promise<boolean> {
        const run = async (): Promise<boolean> => {
            const link = this.getBindings().localLink
            if (!link || !this.catalog)
                return false
            this.dropExpiredDescriptors()
            const documents: MediaState['documents'] = { catalog: { body: this.catalog.document, contentType: 'application/json' } }
            for (const [name, doc] of this.descriptorDocs)
                documents[name] = { body: doc.body, contentType: 'application/json' }
            const res = await link.publishMedia({ documents, handles: this.catalog.handles, tokens: this.tokens })
            if (!res?.ok || res.rejectedHandles?.length || res.rejectedTokens)
                this.logEvent({ message: 'media publication incomplete', ok: !!res?.ok, rejectedHandles: res?.rejectedHandles?.length, rejectedTokens: res?.rejectedTokens })
            return !!res?.ok
        }
        const result = this.publishChain.then(run, run) as Promise<boolean>
        this.publishChain = result.catch(() => false)
        return result.catch(err => { this.logError(err, 'publish'); return false })
    }

    protected makeHandle(kind: 'v' | 't', path: string): string {
        this.handleSalt ??= randomBytes(32)
        const hmac = (this.getBindings().crypto).createHmac('sha256', this.handleSalt)
        hmac.update(`${kind}|${path}`)
        return toBase64Url(hmac.digest()).slice(0, 22)
    }

    protected async getFileSize(path: string): Promise<number | undefined> {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            // a stat on an unresponsive network mount can hang; treat it as missing for this publish
            const timeout = new Promise<'timeout'>(resolve => {
                timer = setTimeout(() => resolve('timeout'), STAT_TIMEOUT_MS)
                timer.unref?.()
            })
            const stat = await Promise.race([this.getBindings().fs?.stat?.(path), timeout])
            if (stat === 'timeout') {
                this.logEvent({ message: 'file stat timed out, treated as missing', timeoutMs: STAT_TIMEOUT_MS })
                return undefined
            }
            return typeof stat?.size === 'number' ? stat.size : undefined
        }
        catch {
            return undefined
        }
        finally {
            clearTimeout(timer)
        }
    }

    protected ensureRoutesLoaded(): void {
        const list = this.getRouteList()
        if (list.getAllRoutes() === undefined && !list.isStillLoading())
            list.preload()
    }

    protected subscribe(): void {
        const list = this.getRouteList()
        const onChange = () => this.scheduleRefresh()
        const onOpened = (observer) => {
            try {
                observer?.on('loaded', onChange)
                observer?.on('updated', onChange)
            }
            catch (err) {
                this.logError(err as Error, 'onOpened')
            }
        }
        list.on('load-done', onChange)
        list.on('opened', onOpened)
        this.unsubscribers.push(() => { list.off('load-done', onChange); list.off('opened', onOpened) })

        const settings = this.getUserSettings()
        const observer = settings.requestNotifyOnChange(SETTINGS_REQUESTER, VIDEO_DIR_KEY)
        observer.on('changed', onChange)
        this.unsubscribers.push(() => settings.stopNotifyOnChange(SETTINGS_REQUESTER))
    }

    protected scheduleRefresh(): void {
        try {
            clearTimeout(this.refreshTimer)
            this.refreshTimer = setTimeout(() => {
                this.refresh().catch(err => this.logError(err, 'refresh'))
            }, REFRESH_DEBOUNCE_MS)
        }
        catch (err) {
            this.logError(err as Error, 'scheduleRefresh')
        }
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }
}

export const useRouteSharing = () => new RouteSharingService()
