import { getBindings } from '../../api/bindings'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { useLocalLinkClient } from '../../link/client/service'
import { FAILURE_TTL_MS, FETCH_TIMEOUT_MS, MAX_COMPUTER_REQUESTS, MAX_THUMBNAIL_BYTES, THUMBNAIL_DIR, THUMBNAIL_EXT } from './consts'
import { getKeys, isCacheableUrl } from './keys'
import type { ThumbnailRequest } from './types'

type DownloadResult = { data?: Buffer, gone?: boolean }
type ThumbnailSource = { key: string, goneKey?: string, fetch: () => Promise<DownloadResult> }

/**
 * Keeps every route thumbnail on the device, permanently, after its first successful fetch.
 * There is no expiry and no eviction: thumbnails are small.
 *
 * - {@link getCached} is a cheap local lookup.
 * - {@link cache} fetches from the source and stores the file. Sources: the `http(s)` URL, or a
 *   paired computer (`/t/<handle>`), for which a fresh media token is requested for every fetch.
 *   The token URL is used for the one request and never stored; only the bytes are.
 * - {@link resolve} is both: cached file first, then fetch.
 *
 * Nothing here ever throws: every failure is reported as `undefined`, so the caller keeps using
 * the original source. A failed fetch is not retried for a short while.
 *
 * Needs the `fs`, `path` and `appInfo` bindings; without them it does nothing.
 */
@Singleton
export class RouteThumbnailCacheService extends IncyclistService {
    protected inflight = new Map<string, Promise<string | undefined>>()
    protected failedAt = new Map<string, number>()
    /** computer thumbnails (key and handle) the computer answered with 404/410: no thumbnail, not retried in this session */
    protected gone = new Set<string>()
    protected activeComputerRequests = 0
    protected waitingComputerRequests: Array<() => void> = []

    constructor() {
        super('RouteThumbnailCache')
    }

    /** @returns the `file://` URI of the cached thumbnail, `undefined` if it is not cached */
    async getCached(request: ThumbnailRequest): Promise<string | undefined> {
        try {
            for (const key of getKeys(request)) {
                const path = this.getPath(key)
                if (path && await getBindings().fs!.existsFile(path)) // NOSONAR sequential: file operations one at a time
                    return this.toUri(path)
            }
        }
        catch (err) {
            this.logError(err as Error, 'getCached')
        }
        return undefined
    }

    /** Fetches the thumbnail and stores it. @returns the `file://` URI of the stored file, `undefined` on any failure */
    async cache(request: ThumbnailRequest): Promise<string | undefined> {
        try {
            const keys = getKeys(request)
            if (keys.length === 0 || !this.isAvailable())
                return undefined

            const id = keys.join('+')
            let run = this.inflight.get(id)
            if (!run) {
                run = this.fetchAndStore(request, keys).finally(() => this.inflight.delete(id))
                this.inflight.set(id, run)
            }
            return await run
        }
        catch (err) {
            this.logError(err as Error, 'cache')
            return undefined
        }
    }

    /** Cached file if there is one, otherwise a fetch. */
    async resolve(request: ThumbnailRequest): Promise<string | undefined> {
        try {
            return await this.getCached(request) ?? await this.cache(request)
        }
        catch (err) {
            this.logError(err as Error, 'resolve')
            return undefined
        }
    }

    /** Removes a cached file that turned out to be unusable (e.g. a partial write), so it is fetched again. */
    async invalidate(request: ThumbnailRequest): Promise<void> {
        try {
            for (const key of getKeys(request)) {
                const path = this.getPath(key)
                if (path && await getBindings().fs!.existsFile(path))
                    await getBindings().fs!.unlink(path) // NOSONAR sequential: file operations one at a time
                this.failedAt.delete(key)
            }
        }
        catch (err) {
            this.logError(err as Error, 'invalidate')
        }
    }

    protected isAvailable(): boolean {
        const b = getBindings()
        return !!(b?.fs && b.path && b.appInfo)
    }

    protected getPath(key: string): string | undefined {
        if (!this.isAvailable())
            return undefined
        const b = getBindings()
        return b.path!.join(b.appInfo!.getAppDir(), THUMBNAIL_DIR, `${key}.${THUMBNAIL_EXT}`)
    }

    protected toUri(path: string): string {
        return path.includes('://') ? path : `file://${path}`
    }

    protected async fetchAndStore(request: ThumbnailRequest, keys: string[]): Promise<string | undefined> {
        try {
            const sources = this.getSources(request, keys)
            for (const source of sources) {
                if (this.isRecentlyFailed(source.key) || (source.goneKey && this.gone.has(source.goneKey)))
                    continue
                const { data, gone } = await source.fetch()
                if (!data) {
                    if (gone && source.goneKey)
                        this.gone.add(source.goneKey)
                    else
                        this.failedAt.set(source.key, Date.now())
                    continue
                }
                const path = await this.store(source.key, data)
                if (path)
                    return this.toUri(path)
            }
        }
        catch (err) {
            this.logError(err as Error, 'cache')
        }
        return undefined
    }

    /** `keys` follow the order of {@link getKeys}: url first (if cacheable), then the computer */
    protected getSources(request: ThumbnailRequest, keys: string[]): ThumbnailSource[] {
        const sources: ThumbnailSource[] = []
        let i = 0
        if (isCacheableUrl(request.url)) {
            const url = request.url
            sources.push({ key: keys[i++], fetch: () => this.download(url) })
        }
        if (request.link && keys[i]) {
            const link = request.link
            sources.push({ key: keys[i], goneKey: `${keys[i]}|${link.thumbHandle}`, fetch: () => this.downloadFromLink(link.linkId, link.thumbHandle) })
        }
        return sources
    }

    protected isRecentlyFailed(key: string): boolean {
        const at = this.failedAt.get(key)
        return at !== undefined && Date.now() - at < FAILURE_TTL_MS
    }

    protected async downloadFromLink(linkId: string, handle: string): Promise<DownloadResult> {
        await this.acquireComputerSlot()
        try {
            // the token is requested once the slot is free, so a queued request never holds a stale one
            const media = await this.getLocalLinkClient().getMedia(linkId)
            if (!media)
                return {}
            return await this.request(`${media.baseUrl}/t/${encodeURIComponent(handle)}`, 'computer', { Authorization: `Bearer ${media.token}` })
        }
        finally {
            this.releaseComputerSlot()
        }
    }

    protected async acquireComputerSlot(): Promise<void> {
        if (this.activeComputerRequests < MAX_COMPUTER_REQUESTS) {
            this.activeComputerRequests++
            return
        }
        // the slot is handed over directly, the count stays
        await new Promise<void>(resolve => this.waitingComputerRequests.push(resolve))
    }

    protected releaseComputerSlot(): void {
        const next = this.waitingComputerRequests.shift()
        if (next)
            next()
        else
            this.activeComputerRequests = Math.max(0, this.activeComputerRequests - 1)
    }

    protected async download(url: string, headers?: Record<string, string>): Promise<DownloadResult> {
        return await this.request(url, 'url', headers)
    }

    /**
     * @returns the body (only for a `2xx` with a non-empty, reasonably sized body); `gone` if the server
     * says the file does not exist (404/410). Failures are logged with status and duration, never the url.
     */
    protected async request(url: string, source: 'url' | 'computer', headers?: Record<string, string>): Promise<DownloadResult> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        const started = Date.now()
        try {
            const response = await fetch(url, { headers, signal: controller.signal })
            if (response.status < 200 || response.status >= 300) {
                this.logEvent({ message: 'thumbnail fetch failed', source, httpStatus: response.status, durationMs: Date.now() - started })
                return { gone: source === 'computer' && (response.status === 404 || response.status === 410) }
            }
            const data = Buffer.from(await response.arrayBuffer())
            return data.length > 0 && data.length <= MAX_THUMBNAIL_BYTES ? { data } : {}
        }
        catch (err) {
            this.logEvent({ message: 'thumbnail fetch error', source, error: (err as Error)?.name, durationMs: Date.now() - started })
            return {}
        }
        finally {
            clearTimeout(timer)
        }
    }

    protected async store(key: string, data: Buffer): Promise<string | undefined> {
        const fs = getBindings().fs!
        const path = this.getPath(key)!
        try {
            await fs.ensureDir(getBindings().path!.join(getBindings().appInfo!.getAppDir(), THUMBNAIL_DIR))
            await fs.writeFile(path, data)
            this.failedAt.delete(key)
            return path
        }
        catch (err) {
            this.logError(err as Error, 'store')
            await fs.unlink(path).catch(() => undefined)
            return undefined
        }
    }

    @Injectable
    protected getLocalLinkClient() {
        return useLocalLinkClient()
    }
}

/** Returns the persistent route thumbnail cache. */
export const useRouteThumbnailCache = () => new RouteThumbnailCacheService()
