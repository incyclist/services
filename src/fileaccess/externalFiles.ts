import { getBindings } from '../api'
import { Injectable, Singleton } from '../base/decorators'
import { IncyclistService } from '../base/service'
import { sleep } from '../utils/sleep'
import { useOnlineStatusMonitoring } from '../monitoring'
import { EnsureLocalOptions, EnsureLocalResult } from './types'
import type { RouteImportErrorCode } from '../routes/library/types'

/**
 * Companion files (XML/EPM/EPP/GPX/preview) are at most ~50-100kB, so once iCloud starts the
 * transfer it finishes in well under a second - this budget mainly covers iCloud's start-up
 * latency, not the transfer itself.
 */
const DEFAULT_TIMEOUT_MS = 10_000
const INITIAL_POLL_INTERVAL_MS = 300
const BACKOFF_POLL_INTERVAL_MS = 1_000

/**
 * Stable, translatable reason a route import file could not be read. Thrown by
 * `openRouteFile()` (see `routes/base/parsers/utils.ts`) so the route parsers - and ultimately
 * the import dialog - can map a stable key to copy instead of matching on message text.
 */
export class RouteImportError extends Error {
    code: RouteImportErrorCode

    constructor(code: RouteImportErrorCode, message: string) {
        super(message)
        this.name = 'RouteImportError'
        this.code = code
        // Restore the prototype chain so `instanceof RouteImportError` keeps working after
        // compilation down-levels the `extends Error` (a well-known TS/ES5 pitfall).
        Object.setPrototypeOf(this, RouteImportError.prototype)
    }
}

/**
 * Makes sure a file that lives outside the app sandbox is present locally before it is read -
 * currently only relevant for iCloud-backed companion files at folder-scan import time.
 *
 * Completely inert when the `fileAccess` binding is absent/unsupported, or when the path isn't
 * an iCloud path: NAS, On My iPad, local, http(s)/content:// and Android are all unaffected and
 * resolve immediately without touching the network.
 */
@Singleton
export class ExternalFileService extends IncyclistService {

    constructor() {
        super('ExternalFileService')
    }

    async ensureLocal(path: string, opts?: EnsureLocalOptions): Promise<EnsureLocalResult> {
        const start = Date.now()
        const binding = this.getBindings()?.fileAccess

        if (!path || !binding || !binding.isSupported())
            return { ok: true, downloaded: false, waitedMs: 0 }

        if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('content://'))
            return { ok: true, downloaded: false, waitedMs: 0 }

        let location
        try {
            location = binding.classifyLocation(path)
        }
        catch (err) {
            // classifyLocation is documented sync/path-only; treat a throw as "can't tell",
            // never as a reason to block the read.
            this.logError(err, 'ensureLocal:classifyLocation')
            return { ok: true, downloaded: false, waitedMs: 0 }
        }

        if (location !== 'icloud')
            return { ok: true, downloaded: false, waitedMs: 0 }

        const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const isCancelled = opts?.isCancelled ?? (() => false)

        try {
            const probe = await binding.checkAccess(path)
            if (probe.state === 'denied')
                return { ok: false, reason: 'access-lost' }
            if (probe.state === 'not-found')
                return { ok: false, reason: 'not-found' }

            let availability = await binding.getAvailability(path)

            if (this.isLocallyAvailable(availability))
                return { ok: true, downloaded: false, waitedMs: Date.now() - start }

            if (availability.downloadError)
                return this.downloadFailedResult(availability.downloadError)

            // not-downloaded from here on
            if (this.isOffline())
                return { ok: false, reason: 'offline' }

            if (isCancelled())
                return { ok: false, reason: 'cancelled' }

            await binding.startDownload(path)

            let interval = INITIAL_POLL_INTERVAL_MS

            for (;;) {
                const elapsed = Date.now() - start
                if (elapsed >= timeoutMs)
                    return { ok: false, reason: 'timeout' }

                if (isCancelled())
                    return { ok: false, reason: 'cancelled' }

                if (this.isOffline())
                    return { ok: false, reason: 'offline' }

                await sleep(Math.max(0, Math.min(interval, timeoutMs - elapsed)))
                interval = BACKOFF_POLL_INTERVAL_MS

                availability = await binding.getAvailability(path)

                if (this.isLocallyAvailable(availability))
                    return { ok: true, downloaded: true, waitedMs: Date.now() - start }

                if (availability.downloadError)
                    return this.downloadFailedResult(availability.downloadError)
            }
        }
        catch (err) {
            this.logError(err, 'ensureLocal')
            return { ok: false, reason: 'download-failed' }
        }
    }

    private isLocallyAvailable(availability: { isUbiquitous: boolean, downloadStatus?: string }): boolean {
        return !availability.isUbiquitous || availability.downloadStatus === 'current' || availability.downloadStatus === 'downloaded'
    }

    private downloadFailedResult(downloadError: { domain: string, code: number }): EnsureLocalResult {
        return { ok: false, reason: 'download-failed', code: downloadError.code, domain: downloadError.domain }
    }

    private isOffline(): boolean {
        return this.getOnlineStatus().onlineStatus === false
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getOnlineStatus() {
        return useOnlineStatusMonitoring()
    }

}

export const useExternalFileService = (): ExternalFileService => new ExternalFileService()

type ImportCancelledCheck = () => boolean

let importCancelledCheck: ImportCancelledCheck = () => false

/**
 * Registered by the route library scanner (the only caller of `openRouteFile()`, see
 * `routes/base/parsers/utils.ts`) so a companion-file wait can be cancelled the same way the
 * rest of an in-progress import is.
 *
 * This indirection - rather than `openRouteFile`/`ensureLocal` importing the scanner directly -
 * exists because `routes/library/service.ts` imports `routes/base/parsers/index.ts` (to parse
 * routes), which eagerly loads every parser class at module scope (each extends `XMLParser`);
 * importing the scanner back from a parser-side module would form a require cycle and leave
 * those classes `undefined` at the point they're extended.
 */
export const setImportCancelledCheck = (check: ImportCancelledCheck): void => {
    importCancelledCheck = check
}

export const isImportCancelled = (): boolean => importCancelledCheck()
