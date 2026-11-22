import type { MediaState } from '../../api/localLink/types'
import { getBindings } from '../../api/bindings'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { randomBytes, sha256Base64Url, toBase64Url } from '../../link/utils'
import { useUserSettings } from '../../settings/service'
import { useRouteList } from '../list/service'
import { buildCatalog } from './catalog'
import type { CatalogBuild } from './catalog'

const REFRESH_DEBOUNCE_MS = 1500
const VIDEO_DIR_KEY = 'videos.directory'
const SETTINGS_REQUESTER = 'RouteSharing'

type Unsubscribe = () => void

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
        this.started = false
        clearTimeout(this.refreshTimer)
        this.unsubscribers.forEach(u => u())
        this.unsubscribers = []
        this.catalog = undefined
    }

    /**
     * Sets the digests of the currently valid media tokens and republishes.
     *
     * @returns false if the transport rejected the publication
     */
    async setTokens(tokens: MediaState['tokens']): Promise<boolean> {
        this.tokens = tokens.map(t => ({ ...t }))
        return this.started ? await this.publish() : true
    }

    /** Rebuilds the catalog from the route list and republishes it. */
    refresh(): Promise<void> {
        if (this.refreshing) {
            this.refreshAgain = true
            return this.refreshing
        }
        this.refreshing = this.runRefresh().finally(() => { this.refreshing = undefined })
        return this.refreshing
    }

    getCatalogVersion(): string {
        return this.catalog?.document.catalogVersion ?? ''
    }

    getRouteCount(): number {
        return this.catalog?.document.routes.length ?? 0
    }

    reset() {
        this.stop()
        super.reset()
    }

    protected async runRefresh(): Promise<void> {
        do {
            this.refreshAgain = false
            await this.rebuild()
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
            const documents = { catalog: { body: this.catalog.document, contentType: 'application/json' } }
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
        try {
            const stat = await this.getBindings().fs?.stat?.(path)
            return typeof stat?.size === 'number' ? stat.size : undefined
        }
        catch {
            return undefined
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
            observer?.on('loaded', onChange)
            observer?.on('updated', onChange)
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
        clearTimeout(this.refreshTimer)
        this.refreshTimer = setTimeout(() => {
            this.refresh().catch(err => this.logError(err, 'refresh'))
        }, REFRESH_DEBOUNCE_MS)
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
