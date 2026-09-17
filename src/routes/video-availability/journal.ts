import { getBindings } from "../../api/bindings"
import { JsonRepository } from "../../api/repository"
import { Injectable } from "../../base/decorators"
import { IncyclistService } from "../../base/service"
import type { JSONObject } from "../../utils/xml"
import type { VideoDownloadJournalEntry, VideoKeepChoice } from "./types"

const REPO_NAME = 'videoDownloadJournal'

/**
 * All entries live in one repository object. The journal only ever holds a handful of records
 * (the downloads this app started and has not finished cleaning up), and one document keeps a
 * write atomic - which matters, because an entry has to be on disk *before* the download it
 * authorises is started.
 */
const DOC_NAME = 'entries'

/** Cleanup is given up after this many failed evictions, so it cannot retry forever. */
export const MAX_EVICT_ATTEMPTS = 20
/** ...or after this long, whichever comes first. */
export const MAX_EVICT_AGE_MS = 30 * 24 * 60 * 60 * 1000

const FIRST_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 30 * 60_000

/** Statuses that owe the device an eviction, and are therefore the only ones ever given up on. */
const CLEANUP_STATUS: Array<VideoDownloadJournalEntry['status']> = ['stopping', 'removal-due']

export const isCleanupStatus = (entry?: VideoDownloadJournalEntry): boolean =>
    !!entry && CLEANUP_STATUS.includes(entry.status)

/**
 * The record of which video files this app downloaded itself, and what it still owes the user
 * for each of them.
 *
 * It exists for one reason: **an entry is the only thing that authorises removing a file again.**
 * A video that was already on the device - downloaded in the Files app, or synced by iOS - has no
 * entry and is therefore never touched, however the user got there. That is also why the entry is
 * written and awaited *before* the download starts: a download whose entry never made it to disk
 * would be a file the app promised to remove and then couldn't.
 *
 * Because the app can be killed at any point, every step is a persisted status rather than an
 * in-memory intention: a stop or a post-ride removal that did not complete is finished off at the
 * next launch instead of being lost.
 *
 * Emits `changed` after every mutation.
 */
export class VideoDownloadJournal extends IncyclistService {

    protected entries: Record<string, VideoDownloadJournalEntry> = {}
    protected loadPromise?: Promise<void>

    constructor() {
        super('VideoDownloadJournal')
    }

    /** Reads the journal from disk. Idempotent: repeated calls await the first read. */
    async init(): Promise<void> {
        this.loadPromise ??= this.load()
        return this.loadPromise
    }

    getEntry(path: string): VideoDownloadJournalEntry | undefined {
        return path ? this.entries[path] : undefined
    }

    getAll(): Array<VideoDownloadJournalEntry> {
        return Object.values(this.entries)
    }

    getForRoute(routeId: string): Array<VideoDownloadJournalEntry> {
        return this.getAll().filter(e => e.routeId === routeId)
    }

    /** Whether a download this app started is currently in flight for `path`. */
    isDownloading(path: string): boolean {
        return this.getEntry(path)?.status === 'downloading'
    }

    /**
     * Records a download about to be started, and reports whether the record is safely on disk.
     *
     * A `false` means the caller must not rely on ever being allowed to remove the file again -
     * the download may still go ahead, but only as a download the user keeps.
     */
    async begin(path: string, routeId: string, choice: VideoKeepChoice): Promise<boolean> {
        if (!path)
            return false

        await this.init()

        const existing = this.entries[path]

        this.entries[path] = {
            path, routeId, choice,
            status: 'downloading',
            startedAt: existing?.startedAt ?? Date.now(),
            stoppedAt: undefined,
            dueAt: undefined,
            evictAttempts: 0,
            appVersion: this.getAppVersion()
        }

        const written = await this.save()

        if (!written) {
            // without a persisted entry the file must never be evicted automatically, so the
            // record is dropped again rather than left half-true in memory
            delete this.entries[path]
            this.logEvent({ message: 'video journal write failed', routeId })
            return false
        }

        this.changed()
        return true
    }

    /** Drops the record, giving up any claim to remove the file. */
    async discard(path: string): Promise<void> {
        await this.init()
        if (!this.entries[path])
            return
        delete this.entries[path]
        await this.save()
        this.changed()
    }

    /**
     * The user stopped the download. The file may still be arriving, so the entry survives until
     * an eviction has actually been confirmed.
     */
    async markStopping(path: string): Promise<void> {
        await this.patch(path, { status: 'stopping', stoppedAt: Date.now(), dueAt: Date.now(), evictAttempts: 0 })
    }

    /** A stopped download the user restarted. */
    async markDownloading(path: string): Promise<void> {
        await this.patch(path, { status: 'downloading', stoppedAt: undefined, dueAt: undefined, evictAttempts: 0 })
    }

    /**
     * A "for this ride" download that finished. There is no time limit on how long it waits: the
     * file is removed when the ride it was downloaded for has been ridden and left, and never
     * because enough time has passed.
     */
    async markAwaitingRide(path: string): Promise<void> {
        await this.patch(path, { status: 'awaiting-ride', evictAttempts: 0, dueAt: undefined })
    }

    /** The ride is over: the file is now owed back to the device. Persisted before any eviction. */
    async markRemovalDue(path: string, dueAt: number): Promise<void> {
        await this.patch(path, { status: 'removal-due', dueAt, evictAttempts: 0 })
    }

    async setChoice(path: string, choice: VideoKeepChoice): Promise<void> {
        const entry = this.getEntry(path)
        if (!entry)
            return

        // "keep it instead" on a finished or already-due download is an undo: there is nothing
        // left to remember once the file is simply kept
        if (choice === 'keep' && (entry.status === 'awaiting-ride' || entry.status === 'removal-due')) {
            await this.discard(path)
            return
        }

        await this.patch(path, { choice })
    }

    /** Entries whose eviction is due now. */
    getCleanupDue(now = Date.now()): Array<VideoDownloadJournalEntry> {
        return this.getAll().filter(e => isCleanupStatus(e) && (e.dueAt ?? 0) <= now)
    }

    /**
     * Notes a failed eviction and says whether to keep trying. Attempts are spread out with a
     * growing delay, and given up on entirely after `MAX_EVICT_ATTEMPTS` or `MAX_EVICT_AGE_MS`.
     *
     * Only cleanup statuses are ever abandoned - a `downloading` or `awaiting-ride` entry is
     * waiting for the user, not for a retry, and must not expire underneath them.
     */
    async recordEvictAttempt(path: string): Promise<'retry' | 'abandoned'> {
        const entry = this.getEntry(path)
        if (!entry)
            return 'abandoned'

        const attempts = (entry.evictAttempts ?? 0) + 1
        const age = Date.now() - (entry.stoppedAt ?? entry.startedAt ?? Date.now())
        const exhausted = attempts >= MAX_EVICT_ATTEMPTS || age > MAX_EVICT_AGE_MS

        if (isCleanupStatus(entry) && exhausted) {
            this.logEvent({
                message: 'restore abandoned', routeId: entry.routeId,
                status: entry.status, attempts, ageDays: Math.round(age / (24 * 60 * 60 * 1000))
            })
            await this.discard(path)
            return 'abandoned'
        }

        const backoff = Math.min(FIRST_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS)
        await this.patch(path, { evictAttempts: attempts, dueAt: Date.now() + backoff })
        return 'retry'
    }

    reset() {
        super.reset()
        this.entries = {}
        this.loadPromise = undefined
    }

    // --- persistence ------------------------------------------------------------------

    protected async patch(path: string, changes: Partial<VideoDownloadJournalEntry>): Promise<void> {
        await this.init()

        const entry = this.entries[path]
        if (!entry)
            return

        this.entries[path] = { ...entry, ...changes }
        await this.save()
        this.changed()
    }

    protected async load(): Promise<void> {
        try {
            const doc = await this.getJournalRepo().read(DOC_NAME) as
                { entries?: Record<string, VideoDownloadJournalEntry> } | undefined

            const stored = doc?.entries ?? {}
            const entries: Record<string, VideoDownloadJournalEntry> = {}

            for (const [path, entry] of Object.entries(stored)) {
                if (entry?.path && entry?.status)
                    entries[path] = { ...entry, evictAttempts: entry.evictAttempts ?? 0 }
            }

            this.entries = entries
        }
        catch (err) {
            this.logError(err as Error, 'loadJournal')
            this.entries = {}
        }
    }

    protected async save(): Promise<boolean> {
        try {
            const doc = { entries: this.entries } as unknown as JSONObject
            return await this.getJournalRepo().write(DOC_NAME, doc) !== false
        }
        catch (err) {
            this.logError(err as Error, 'saveJournal')
            return false
        }
    }

    protected changed(): void {
        this.emit('changed')
    }

    protected getAppVersion(): string | undefined {
        try {
            return getBindings()?.appInfo?.getAppVersion()
        }
        catch {
            return undefined
        }
    }

    @Injectable
    protected getJournalRepo(): JsonRepository {
        return JsonRepository.create(REPO_NAME)
    }
}
