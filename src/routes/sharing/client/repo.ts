import { JsonRepository } from '../../../api/repository'
import type { JSONObject } from '../../../utils/xml'
import type { CatalogEntry, SharedRouteEntry } from '../types'
import { MAX_MISS_COUNT, SHARED_ROUTES_REPOSITORY } from './consts'
import type { ReplaceResult } from './types'

/** The part of the JSON repository the store needs. */
export type SharedRouteJsonRepo = Pick<JsonRepository, 'read' | 'write' | 'delete' | 'list'>

const WRITE_BATCH = 25

/** Row key, safe as a file name: characters other than letters, digits and `._:-` are escaped. */
export const toRowKey = (linkId: string, routeKey: string): string =>
    `${linkId}:${routeKey}`.replaceAll(/[^A-Za-z0-9._:-]/g, c => `%${c.codePointAt(0)!.toString(16).padStart(2, '0')}`)

/** Returns the row if the stored object has the shape of a {@link SharedRouteEntry}, otherwise `undefined`. */
export const toSharedRouteEntry = (data: unknown): SharedRouteEntry | undefined => {
    const d = data as Partial<SharedRouteEntry>
    if (typeof d?.linkId !== 'string' || !d.linkId || typeof d.routeKey !== 'string' || !d.routeKey)
        return undefined
    if (typeof d.routeIdOnComputer !== 'string' || typeof d.videoHandle !== 'string' || typeof d.videoFormat !== 'string')
        return undefined
    const row: SharedRouteEntry = {
        linkId: d.linkId, routeKey: d.routeKey, routeIdOnComputer: d.routeIdOnComputer, videoHandle: d.videoHandle,
        videoFormat: d.videoFormat, size: Number(d.size) || 0, mtime: Number(d.mtime) || 0,
        lastConfirmedAt: Number(d.lastConfirmedAt) || 0, missCount: Number(d.missCount) || 0,
    }
    if (typeof d.thumbHandle === 'string')
        row.thumbHandle = d.thumbHandle
    return row
}

const fromCatalog = (linkId: string, entry: CatalogEntry, now: number): SharedRouteEntry => {
    const row: SharedRouteEntry = {
        linkId, routeKey: entry.routeKey, routeIdOnComputer: entry.routeIdOnComputer, videoHandle: entry.videoHandle,
        videoFormat: entry.videoFormat, size: entry.size, mtime: entry.mtime, lastConfirmedAt: now, missCount: 0,
    }
    if (entry.thumbHandle)
        row.thumbHandle = entry.thumbHandle
    return row
}

/**
 * Persistence of the routes of the paired computers: one row per computer and route in the
 * `sharedRoutes` repository, kept in memory after {@link load}.
 *
 * Only the answer of a computer may change that computer's rows, and the shape of this API
 * enforces it: the one write path of a sync is {@link replaceForLink}, which takes a `linkId` and
 * touches exactly the rows of that computer; {@link forgetLink} is the only other way to delete.
 * There is deliberately no method that writes or reconciles entries without a `linkId`.
 */
export class SharedRouteRepo {
    protected rows = new Map<string, Map<string, SharedRouteEntry>>()
    protected loading?: Promise<void>

    constructor(protected repo: SharedRouteJsonRepo = JsonRepository.create(SHARED_ROUTES_REPOSITORY)) {}

    /** Reads every row once. Unreadable or malformed objects are skipped. Safe to call repeatedly. */
    load(): Promise<void> {
        this.loading ??= this.readAll().catch(() => { this.loading = undefined })
        return this.loading
    }

    getForLink(linkId: string): SharedRouteEntry[] {
        return [...(this.rows.get(linkId)?.values() ?? [])].map(r => ({ ...r }))
    }

    getAll(): SharedRouteEntry[] {
        return [...this.rows.keys()].flatMap(linkId => this.getForLink(linkId))
    }

    /** The rows of every computer that has the route. */
    getByRouteKey(routeKey: string): SharedRouteEntry[] {
        const found: SharedRouteEntry[] = []
        for (const rows of this.rows.values()) {
            const row = rows.get(routeKey)
            if (row)
                found.push({ ...row })
        }
        return found
    }

    getRow(linkId: string, routeKey: string): SharedRouteEntry | undefined {
        const row = this.rows.get(linkId)?.get(routeKey)
        return row ? { ...row } : undefined
    }

    /**
     * Replaces the rows of one computer with the catalog it just answered with.
     * - a route in the catalog is written with `missCount` 0;
     * - a route that is not in the catalog counts a miss and is deleted when the misses exceed
     *   the limit;
     * - rows of other computers are never touched.
     *
     * Must only be called with the catalog of a computer that answered.
     */
    async replaceForLink(linkId: string, entries: CatalogEntry[], now: number = Date.now()): Promise<ReplaceResult> {
        await this.load()
        const current = this.rows.get(linkId) ?? new Map<string, SharedRouteEntry>()
        const next = new Map<string, SharedRouteEntry>()
        const writes: SharedRouteEntry[] = []
        const deletes: SharedRouteEntry[] = []
        let added = 0

        for (const entry of entries) {
            const row = fromCatalog(linkId, entry, now)
            if (!current.has(row.routeKey))
                added++
            next.set(row.routeKey, row)
            writes.push(row)
        }
        for (const [routeKey, row] of current) {
            if (next.has(routeKey))
                continue
            if (row.missCount + 1 > MAX_MISS_COUNT) {
                deletes.push(row)
                continue
            }
            const missed = { ...row, missCount: row.missCount + 1 }
            next.set(routeKey, missed)
            writes.push(missed)
        }

        if (next.size > 0)
            this.rows.set(linkId, next)
        else
            this.rows.delete(linkId)
        await this.persist(writes, deletes)
        return { added, removed: deletes.length, kept: next.size - added }
    }

    /**
     * A computer that answered said that the file of a route is gone (`410`). Counts a miss for
     * that row; the row stays, only {@link replaceForLink} prunes.
     */
    async recordGone(linkId: string, routeKey: string): Promise<void> {
        await this.load()
        const row = this.rows.get(linkId)?.get(routeKey)
        if (!row)
            return
        row.missCount++
        await this.persist([row], [])
    }

    /** Deletes the rows of one computer (the computer was forgotten). */
    async forgetLink(linkId: string): Promise<void> {
        await this.load()
        const rows = this.rows.get(linkId)
        this.rows.delete(linkId)
        if (rows)
            await this.persist([], [...rows.values()])
    }

    protected async readAll(): Promise<void> {
        this.rows.clear()
        for (const name of await this.repo.list() ?? []) {
            const row = toSharedRouteEntry(await this.repo.read(name).catch(() => undefined)) // NOSONAR sequential: reads of the saved rows one at a time
            if (!row)
                continue
            const rows = this.rows.get(row.linkId) ?? new Map<string, SharedRouteEntry>()
            rows.set(row.routeKey, row)
            this.rows.set(row.linkId, rows)
        }
    }

    protected async persist(writes: SharedRouteEntry[], deletes: SharedRouteEntry[]): Promise<void> {
        for (let i = 0; i < deletes.length; i += WRITE_BATCH)
            await Promise.all(deletes.slice(i, i + WRITE_BATCH).map(r => this.repo.delete(toRowKey(r.linkId, r.routeKey)).catch(() => false))) // NOSONAR bounded concurrency: one batch of DB writes at a time
        for (let i = 0; i < writes.length; i += WRITE_BATCH)
            await Promise.all(writes.slice(i, i + WRITE_BATCH).map(r => this.repo.write(toRowKey(r.linkId, r.routeKey), { ...r } as unknown as JSONObject).catch(() => false))) // NOSONAR bounded concurrency: one batch of DB writes at a time
    }
}
