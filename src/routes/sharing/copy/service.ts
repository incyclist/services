import { getBindings } from '../../../api/bindings'
import { Injectable, Singleton } from '../../../base/decorators'
import { IncyclistService } from '../../../base/service'
import { useLocalLinkClient } from '../../../link/client/service'
import { MEDIA_TOKEN_MARGIN_MS } from '../../../link/client/consts'
import { buildVideoUrl } from '../../base/parsers/utils'
import { useRouteList } from '../../list/service'
import { COPY_STORAGE_MARGIN_BYTES } from '../client/consts'
import { useRouteVideoResolver } from '../client/resolver'
import { useRouteSharingClient } from '../client/service'
import type { OpenRowResult } from '../client/types'
import type { SharedRouteEntry } from '../types'
import type { RouteCopyFailure, RouteCopyState, RouteCopyStateEvent } from './types'
import { scrubError, scrubTokens } from '../../../utils/scrub'

/** A token that expired mid-copy is renewed at most this many times per copy. */
const MAX_REESTABLISH = 2

type Outcome = 'done' | 'cancelled' | RouteCopyFailure

type SessionResult = { kind: 'done' } | { kind: 'cancelled' } | { kind: 'error', error: Error }

type OpenedRow = Extract<OpenRowResult, { url: string }>

const isOpened = (r: OpenRowResult): r is OpenedRow => r.url !== undefined

interface ActiveCopy {
    promise: Promise<RouteCopyState>
    cancelled: boolean
    /** the file the video is copied to */
    file?: string
    stop?: () => void
}

const OUT_OF_SPACE = /ENOSPC|no space|not enough (space|storage)|out of space|NSFileWriteOutOfSpace/i

const isOutOfSpace = (err: Error | undefined): boolean => OUT_OF_SPACE.test(err?.message ?? '')

const safeName = (text: string): string => text.replace(/[^A-Za-z0-9_-]/g, '_')

const safeExtension = (format: string | undefined): string => format && /^[a-z0-9]{1,5}$/i.test(format) ? format.toLowerCase() : 'mp4'

/**
 * Copies the video of a route from a paired computer to this device ("Copy to device").
 *
 * - Pulls `GET /v/<handle>` from the first computer that has the route and answers, through the
 *   download manager (progress, cancel, restart as for every other download). The URL, with a fresh
 *   media token per attempt, is never persisted or logged.
 * - A `404` (stale handle) is refreshed once and retried, a `410` (file gone) moves on to the next
 *   computer. A media token that expires mid-copy re-establishes the session and restarts the transfer.
 * - Free space is checked against the size announced by the computer before any byte is pulled.
 * - For a route created from a computer's catalog the details are loaded first: a copy without them
 *   could not be ridden offline.
 * - On success the route plays from the local file exactly as after a download. Nothing is told to
 *   the computer and nothing is reconciled.
 * - A partial file is removed when the copy fails or is cancelled.
 *
 * Inert unless route sharing is supported (feature toggle, bindings, native requirements).
 *
 * Emits `state-changed` ({@link RouteCopyStateEvent}).
 */
@Singleton
export class RouteCopyService extends IncyclistService {
    protected states = new Map<string, RouteCopyState>()
    protected copies = new Map<string, ActiveCopy>()

    constructor() {
        super('RouteCopy')
    }

    /** true if copying to this device is available */
    isActive(): boolean {
        try {
            return this.getSharingClient().isActive()
        }
        catch {
            return false
        }
    }

    /** The state of the copy of a route: `idle` unless a copy is running or the last one failed. */
    getState(routeKey: string): RouteCopyState {
        return this.states.get(routeKey) ?? { status: 'idle' }
    }

    /**
     * Copies the video of a route to this device. A call while the copy of the route runs returns that copy.
     *
     * @returns the final state: `idle` if the route now has a local copy, otherwise `failed`
     */
    copyToDevice(routeKey: string): Promise<RouteCopyState> {
        const running = this.copies.get(routeKey)
        if (running)
            return running.promise

        const copy: ActiveCopy = { cancelled: false, promise: Promise.resolve({ status: 'idle' }) }
        copy.promise = this.run(routeKey, copy)
            .catch((err): RouteCopyState => { this.logError(scrubError(err as Error), 'copyToDevice'); return this.setFailed(routeKey, 'unknown') })
            .finally(() => { this.copies.delete(routeKey) })
        this.copies.set(routeKey, copy)
        return copy.promise
    }

    /** Stops a running copy and removes the partial file. The state becomes `failed` with reason `cancelled`. */
    cancel(routeKey: string): void {
        const copy = this.copies.get(routeKey)
        if (!copy || copy.cancelled)
            return
        copy.cancelled = true
        copy.stop?.()
    }

    /** Forgets a failure (the UI dismissed it). A running copy is not affected. */
    clear(routeKey: string): void {
        if (this.copies.has(routeKey))
            return
        this.setState(routeKey, { status: 'idle' })
    }

    reset() {
        for (const copy of this.copies.values()) {
            copy.cancelled = true
            copy.stop?.()
        }
        this.copies.clear()
        this.states.clear()
        super.reset()
    }

    protected async run(routeKey: string, copy: ActiveCopy): Promise<RouteCopyState> {
        if (!this.isActive())
            return this.setFailed(routeKey, 'not-supported')

        const route = this.getRouteList().getRoute(routeKey)
        if (!route)
            return this.setFailed(routeKey, 'unknown-route')
        const card = this.getRouteList().getCard(routeKey)
        if (card?.hasLocalCopy())
            return this.setState(routeKey, { status: 'idle' })

        const rows = this.getOrderedRows(routeKey)
        if (rows.length === 0)
            return this.setFailed(routeKey, 'unreachable')

        const dir = this.getBindings()?.downloadManager?.getVideoDir?.()
        if (!dir || !this.getBindings()?.downloadManager)
            return this.setFailed(routeKey, 'not-supported')

        const space = await this.checkSpace(dir, Math.max(...rows.map(r => r.size)))
        if (space)
            return this.setState(routeKey, { status: 'failed', reason: 'no-space', ...space })

        this.setState(routeKey, { status: 'copying', progress: 0 })

        if (route.description.linkShared && !route.details) {
            try {
                await this.getSharingClient().loadDescriptor(route, 'copy')
            }
            catch (err) {
                this.logEvent({ message: 'route copy failed', reason: 'details', detail: (err as { reason?: string })?.reason })
                return this.setFailed(routeKey, 'details')
            }
        }
        if (copy.cancelled)
            return this.setFailed(routeKey, 'cancelled')

        const outcome = await this.copyFromAny(routeKey, rows, dir, copy)
        if (outcome !== 'done')
            return this.setFailed(routeKey, outcome)

        await card?.onCopiedToDevice(buildVideoUrl(copy.file!))
        this.logEvent({ message: 'route copied to device' })
        return this.setState(routeKey, { status: 'idle' })
    }

    /** The first computer that opens wins; a transfer that fails after it started is not moved to another computer. */
    protected async copyFromAny(routeKey: string, rows: SharedRouteEntry[], dir: string, copy: ActiveCopy): Promise<Outcome> {
        let failure: RouteCopyFailure = 'unreachable'
        for (const row of rows) {
            if (copy.cancelled)
                return 'cancelled'
            const opened = await this.getResolver().openRow(row)
            if (!isOpened(opened)) {
                if (opened.failure === 'gone')
                    failure = 'gone'
                continue
            }
            const file = this.getFile(dir, routeKey, row)
            copy.file = file
            const outcome = await this.transfer(routeKey, row, opened, file, copy)
            if (outcome !== 'done')
                await this.removePartial(file)
            return outcome
        }
        return failure
    }

    /** Runs the download; a token that expired meanwhile is renewed and the transfer started again. */
    protected async transfer(routeKey: string, row: SharedRouteEntry, first: OpenedRow, file: string, copy: ActiveCopy): Promise<Outcome> {
        let opened = first
        for (let renewals = 0; ; renewals++) {
            const result = await this.runSession(routeKey, opened.url, file, copy)
            if (result.kind === 'done')
                return 'done'
            if (result.kind === 'cancelled' || copy.cancelled)
                return 'cancelled'
            if (isOutOfSpace(result.error))
                return 'no-space'

            const expired = opened.expiresAt - Date.now() < MEDIA_TOKEN_MARGIN_MS
            this.logEvent({ message: 'route copy transfer failed', reason: scrubTokens(result.error?.message), expired })
            const reopened = await this.getResolver().openRow(row)
            if (!isOpened(reopened))
                return reopened.failure
            if (!expired || renewals >= MAX_REESTABLISH)
                return 'unknown'
            opened = reopened
        }
    }

    protected runSession(routeKey: string, url: string, file: string, copy: ActiveCopy): Promise<SessionResult> {
        return new Promise<SessionResult>(resolve => {
            let settled = false
            const settle = (result: SessionResult) => {
                if (settled)
                    return
                settled = true
                copy.stop = undefined
                resolve(result)
            }
            try {
                const session = this.getBindings()!.downloadManager!.createSession(url, file)
                if (!session)
                    throw new Error('download not supported')
                copy.stop = () => { settle({ kind: 'cancelled' }); session.stop() }
                session.on('progress', (pct: number | string) => this.onProgress(routeKey, Number(pct)))
                session.once('error', (error: Error) => settle({ kind: 'error', error }))
                session.once('done', () => settle({ kind: 'done' }))
                if (copy.cancelled)
                    copy.stop()
                else
                    session.start()
            }
            catch (error) {
                settle({ kind: 'error', error: error as Error })
            }
        })
    }

    protected onProgress(routeKey: string, progress: number): void {
        if (Number.isNaN(progress) || this.getState(routeKey).status !== 'copying')
            return
        this.setState(routeKey, { status: 'copying', progress })
    }

    /** @returns the numbers for the refusal if the video does not fit, otherwise `undefined` */
    protected async checkSpace(dir: string, sizeBytes: number): Promise<{ sizeBytes: number, freeBytes: number } | undefined> {
        if (!(sizeBytes > 0))
            return undefined
        const freeBytes = await this.getFreeBytes(dir)
        if (freeBytes === undefined || freeBytes >= sizeBytes + COPY_STORAGE_MARGIN_BYTES)
            return undefined
        this.logEvent({ message: 'route copy refused', reason: 'no-space', sizeBytes, freeBytes })
        return { sizeBytes, freeBytes }
    }

    /** `undefined` if this device can not tell: the copy is then not refused up front. */
    protected async getFreeBytes(dir: string): Promise<number | undefined> {
        try {
            const bindings = this.getBindings()
            const free = await bindings?.downloadManager?.getFreeSpace?.(dir)
            if (free !== undefined)
                return free
            const access = bindings?.fileAccess
            if (access?.isSupported())
                return (await access.getAvailability(dir)).volumeFreeBytes
        }
        catch (err) {
            this.logError(err as Error, 'getFreeBytes')
        }
        return undefined
    }

    /** Rows of the computers that have the route: connected first, then the most recently seen. */
    protected getOrderedRows(routeKey: string): SharedRouteEntry[] {
        const client = this.getLocalLinkClient()
        const lastSeen = new Map(client.getDisplayProps().links.map(l => [l.linkId, l.lastSeenAt ?? 0]))
        const connected = (r: SharedRouteEntry) => Number(client.getSession(r.linkId) !== undefined)
        return this.getSharingClient().getRowsForRoute(routeKey).filter(r => lastSeen.has(r.linkId))
            .sort((a, b) => connected(b) - connected(a) || (lastSeen.get(b.linkId) ?? 0) - (lastSeen.get(a.linkId) ?? 0))
    }

    protected getFile(dir: string, routeKey: string, row: SharedRouteEntry): string {
        const name = `${safeName(routeKey)}.${safeExtension(row.videoFormat)}`
        const path = this.getBindings()?.path
        return path ? path.join(dir, name) : `${dir}/${name}`
    }

    protected async removePartial(file: string): Promise<void> {
        try {
            const fs = this.getBindings()?.fs
            if (fs && await fs.existsFile(file))
                await fs.unlink(file)
        }
        catch (err) {
            this.logError(err as Error, 'removePartial')
        }
    }

    protected setFailed(routeKey: string, reason: RouteCopyFailure): RouteCopyState {
        this.logEvent({ message: 'route copy failed', reason })
        return this.setState(routeKey, { status: 'failed', reason })
    }

    protected setState(routeKey: string, state: RouteCopyState): RouteCopyState {
        if (state.status === 'idle')
            this.states.delete(routeKey)
        else
            this.states.set(routeKey, state)
        this.emit('state-changed', { routeKey, state } satisfies RouteCopyStateEvent)
        return state
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getLocalLinkClient() {
        return useLocalLinkClient()
    }

    @Injectable
    protected getSharingClient() {
        return useRouteSharingClient()
    }

    @Injectable
    protected getResolver() {
        return useRouteVideoResolver()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }
}

/** Returns the service that copies route videos from a computer to this device. */
export const useRouteCopy = () => new RouteCopyService()
