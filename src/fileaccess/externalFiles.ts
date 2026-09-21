import { getBindings } from '../api'
import { Injectable, Singleton } from '../base/decorators'
import { IncyclistService } from '../base/service'
import { sleep } from '../utils/sleep'
import { useOnlineStatusMonitoring } from '../monitoring'
import { EnsureLocalFailure, EnsureLocalOptions, EnsureLocalResult, ExternalFileScope, ExternalFileScopeRecorder } from './types'
import type { IFileAccessBinding } from '../api/fileAccess/types'

/**
 * Companion files (XML/EPM/EPP/GPX/preview) are at most ~50-100kB, so once iCloud starts the
 * transfer it finishes in well under a second - this budget mainly covers iCloud's start-up
 * latency, not the transfer itself.
 */
const DEFAULT_TIMEOUT_MS = 10_000
const INITIAL_POLL_INTERVAL_MS = 300
const BACKOFF_POLL_INTERVAL_MS = 1_000

/**
 * A scope's recording state. Created by `beginScope()`, handed to the loader decorator through
 * `getActiveScope()` and read back by the caller that opened it.
 */
class ParseScope implements ExternalFileScopeRecorder {

    private failure: EnsureLocalFailure|undefined
    private failedPath: string|undefined
    private waitStartedAt: number|undefined

    constructor(
        private readonly cancelledCheck: () => boolean,
        private readonly onEnd: (scope: ParseScope) => void
    ) {}

    get lastFailure(): EnsureLocalFailure|undefined {
        return this.failure
    }

    get failedFile(): string|undefined {
        return this.failedPath
    }

    isCancelled(): boolean {
        return this.cancelledCheck()
    }

    isWaiting(thresholdMs: number): boolean {
        return this.waitStartedAt !== undefined && (Date.now() - this.waitStartedAt) > thresholdMs
    }

    beginWait(): void {
        this.waitStartedAt = Date.now()
    }

    endWait(): void {
        this.waitStartedAt = undefined
    }

    recordFailure(file: string, failure: EnsureLocalFailure): void {
        this.failedPath = file
        this.failure = failure
    }

    end(): void {
        this.waitStartedAt = undefined
        this.onEnd(this)
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

    /** The scopes currently open - see `beginScope()`. The innermost one records the reads. */
    private scopes: ParseScope[] = []

    constructor() {
        super('ExternalFileService')
    }

    /**
     * Brackets a unit of work that reads external files (one route's parse). The reads
     * themselves keep reporting failures the ordinary way; the scope is how the caller learns
     * that an external-file wait failed, or is still running, without any of the code in
     * between having to know about it.
     */
    beginScope(opts?: { isCancelled?: () => boolean }): ExternalFileScope {
        const scope = new ParseScope(
            opts?.isCancelled ?? (() => false),
            (ended) => { this.scopes = this.scopes.filter( s => s!==ended ) }
        )

        this.scopes.push(scope)
        return scope
    }

    /** The scope a read happening right now should record into, if any. */
    getActiveScope(): ExternalFileScopeRecorder|undefined {
        return this.scopes.at(-1)
    }

    async ensureLocal(path: string, opts?: EnsureLocalOptions): Promise<EnsureLocalResult> {
        const start = Date.now()
        const binding = this.getBindings()?.fileAccess

        const skip = this.resolveSkip(path, binding)
        if (skip)
            return skip

        const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const isCancelled = opts?.isCancelled ?? (() => false)

        try {
            const probe = await binding!.checkAccess(path)
            if (probe.state === 'denied')
                return { ok: false, reason: 'access-lost' }
            if (probe.state === 'not-found')
                return { ok: false, reason: 'not-found' }

            const availability = await binding!.getAvailability(path)

            if (this.isLocallyAvailable(availability))
                return { ok: true, downloaded: false, waitedMs: Date.now() - start }

            if (availability.downloadError)
                return this.downloadFailedResult(availability.downloadError)

            // not-downloaded from here on
            if (this.isOffline())
                return { ok: false, reason: 'offline' }

            if (isCancelled())
                return { ok: false, reason: 'cancelled' }

            await binding!.startDownload(path)

            return await this.pollUntilAvailable(binding!, path, start, timeoutMs, isCancelled)
        }
        catch (err) {
            this.logError(err, 'ensureLocal')
            return { ok: false, reason: 'download-failed' }
        }
    }

    /**
     * Every reason `ensureLocal` can resolve immediately without touching the network: no path,
     * no/unsupported binding, a scheme that was never a local path, or a path that isn't iCloud.
     * Returns undefined when the caller must actually probe the file.
     */
    private resolveSkip(path: string, binding: IFileAccessBinding | undefined): EnsureLocalResult | undefined {
        if (!path || !binding?.isSupported())
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

        return location !== 'icloud' ? { ok: true, downloaded: false, waitedMs: 0 } : undefined
    }

    /** Polls availability with backoff until the file is local, fails, times out, or is cancelled. */
    private async pollUntilAvailable(
        binding: IFileAccessBinding,
        path: string,
        start: number,
        timeoutMs: number,
        isCancelled: () => boolean
    ): Promise<EnsureLocalResult> {
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

            const availability = await binding.getAvailability(path)

            if (this.isLocallyAvailable(availability))
                return { ok: true, downloaded: true, waitedMs: Date.now() - start }

            if (availability.downloadError)
                return this.downloadFailedResult(availability.downloadError)
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
