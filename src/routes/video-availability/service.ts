import { getBindings } from "../../api/bindings"
import type { FileAvailability, IFileAccessBinding } from "../../api/fileAccess/types"
import { Injectable, Singleton } from "../../base/decorators"
import { IncyclistService } from "../../base/service"
import { canonicalPath, isRemoteUrl } from "../../fileaccess/utils"
import { useFolderAccess } from "../../fileaccess/service"
import { useOnlineStatusMonitoring } from "../../monitoring"
import { getNextVideoId } from "../base/utils/route"
import type { RouteInfo } from "../base/types"
import { useRouteList } from "../list/service"
import { VideoDownloadJournal } from "./journal"
import type {
    RouteVideoState, RouteVideoStatus, VideoDownloadJournalEntry, VideoDownloadRow, VideoKeepChoice,
    VideoListPill
} from "./types"

/** How long a metadata answer is reused before the file is queried again. */
const AVAILABILITY_TTL_MS = 60_000
/** Parallel metadata queries. Deliberately small: the list can ask for dozens at once. */
const QUEUE_CONCURRENCY = 2
/** A metadata query that takes longer than this is treated as "don't know" and simply has no pill. */
const QUERY_TIMEOUT_MS = 4_000
/** How often a running download is re-queried. */
const POLL_INTERVAL_MS = 3_000
/** How long after leaving a ride the visit's due-for-removal videos are given before eviction runs. */
const RIDE_LEFT_SETTLE_DELAY_MS = 2_000
/**
 * Free space asked for on top of the video itself before a download is offered. A multi-GB
 * transfer that fills the volume completely would take the rest of the app (activities, route
 * data, preview copies) down with it, so the check is deliberately not "does it just fit".
 */
const STORAGE_MARGIN_BYTES = 500 * 1024 * 1024

/** Longest video chain followed, as a guard against a cyclic `next`. */
const MAX_CHAIN_LENGTH = 20

/**
 * Worst state first. Every state a route can be in is ranked exactly once, so aggregating a
 * multi-video route is a matter of picking the highest-ranked file.
 */
const STATE_ORDER: Array<RouteVideoState> = [
    'not-found', 'access-lost', 'not-enough-storage', 'download-failed', 'waiting-for-network',
    'downloading', 'downloading-external', 'cancelled', 'not-downloaded', 'checking', 'ready', 'unknown'
]

/**
 * States that mean "the bytes are not here and no transfer is running" - the family whose counts
 * and sizes are added up for a multi-video route.
 */
const NOT_DOWNLOADED_STATES: Array<RouteVideoState> = [
    'not-downloaded', 'not-enough-storage', 'download-failed', 'cancelled'
]

/** Out-of-space errors, which get their own state rather than a generic failure. */
const OUT_OF_SPACE = [
    { domain: 'NSCocoaErrorDomain', code: 640 },   // NSFileWriteOutOfSpaceError
    { domain: 'NSPOSIXErrorDomain', code: 28 }     // ENOSPC
]

/**
 * Reason shown in the "Start failed" overlay, per state.
 *
 * `{device}` in the source copy is the user's device model, which services has no way of knowing;
 * the neutral word reads correctly in every one of these sentences.
 */
const DEVICE = 'device'

const START_REASONS: Partial<Record<RouteVideoState, string>> = {
    'not-downloaded': `This route's video isn't downloaded to this ${DEVICE} yet. Open the route under Routes to download it.`,
    'cancelled': `This route's video isn't downloaded to this ${DEVICE} yet. Open the route under Routes to download it.`,
    'download-failed': `This route's video isn't downloaded to this ${DEVICE} yet. Open the route under Routes to download it.`,
    'downloading': `This route's video is still downloading from iCloud. Try again once it has finished — you can check under Routes.`,
    'downloading-external': `This route's video is still downloading from iCloud. Try again once it has finished — you can check under Routes.`,
    'waiting-for-network': `This route's video is waiting for an internet connection to finish downloading.`,
    'not-enough-storage': `This route's video isn't downloaded, and there isn't enough free space on this ${DEVICE} for it.`,
    'access-lost': 'Incyclist needs your OK to use the folder with this video. Open the route under Routes and tap Confirm Access.',
    'not-found': `The video file can't be found. It may have been moved, renamed or deleted.`
}

const REASON_ICLOUD_UNAVAILABLE = `iCloud Drive isn't available. Check in the Settings app that you're signed in to iCloud.`
const REASON_FALLBACK = 'Could not load video.'

/** One file of a route, with everything known about it. */
interface VideoFile {
    path: string
    /** Which route in the chain contributes this file. */
    routeId: string
    /** 1-based position in the chain, as the UI numbers the parts. */
    segment: number
    isExternal: boolean
    isICloud: boolean
}

/** Last answer about one file. Kept per path, because a file can be shared between routes. */
interface FileCacheEntry {
    checkedAt: number
    availability?: FileAvailability
    accessState?: 'readable' | 'access-lost' | 'not-found' | 'unknown'
    transient?: boolean
    /** The query failed or timed out: nothing is known, and nothing is shown. */
    indeterminate?: boolean
    /** A local failure that the platform's own metadata cannot express (e.g. the start threw). */
    failed?: RouteVideoState
}

/** A file's state, plus the numbers the aggregate needs from it. */
interface FileState {
    file: VideoFile
    state: RouteVideoState
    transient?: boolean
    choice?: VideoKeepChoice
    sizeBytes?: number
    freeBytes?: number
    startedAt?: number
}

/**
 * Answers, per route, whether its video can be played right now - and drives everything needed
 * to get it there: downloading it out of iCloud, keeping or removing it again afterwards, and
 * asking the user to re-confirm access to the folder it lives in.
 *
 * Two rules shape the whole service:
 *
 * - **Cheap by default.** Route lists ask about every visible row, so the list path never probes
 *   access and only asks the platform for metadata when a grant already covers the file and the
 *   journal has nothing to say. Route details, the Ride Again check and the ride gate ask for a
 *   `refresh()` and pay for a real query.
 * - **Never remove a file the app did not download.** Automatic eviction requires a journal entry,
 *   which only exists for a transfer this app started on a file that was genuinely not there
 *   before. Everything else - a video the user downloaded in the Files app, one that was always
 *   local - is only ever removed when the user explicitly asks for it.
 *
 * Inert on every platform without the `fileAccess` binding (Android, web-ui, desktop): the state
 * is always `unknown`, no pill is produced, no journal is written and nothing is gated.
 *
 * Emits `route-video-update` (routeId) and `download-rows-update`.
 *
 * @noInheritDoc
 * @extends IncyclistService
 */
@Singleton
export class RouteVideoAvailabilityService extends IncyclistService {

    protected journal = new VideoDownloadJournal()
    protected files: Record<string, FileCacheEntry> = {}

    /** Keep choice the user confirmed this session, per route. Lost on restart, by design. */
    protected sessionChoices: Record<string, VideoKeepChoice> = {}

    /** Downloads this session started, for the Downloads screen. Terminal rows stay until restart. */
    protected rows: Record<string, VideoDownloadRow> = {}

    /** Paths mounted by a running ride. Never evicted. Populated by the ride integration. */
    protected activeRidePaths: Array<string> = []

    /** Routes latched by the current ride visit - what `onRideLeft` decides "for this ride" against. */
    protected rideRouteIds: Array<string> = []

    protected queue: Array<{ path: string, routeId: string }> = []
    protected queued = new Set<string>()
    protected inFlight = 0
    protected queryDurations: Array<number> = []

    protected pollTimer?: ReturnType<typeof setInterval>
    protected journalStarted = false
    /** Set by `reset()`, so work already in flight cannot restart a timer behind its back. */
    protected disposed = false

    constructor() {
        super('RouteVideoAvailability')
        this.journal.on('changed', () => this.onJournalChanged())
    }

    /** True only where the platform can actually answer any of this. */
    isSupported(): boolean {
        try {
            return !!this.getFileAccess()?.isSupported()
        }
        catch {
            return false
        }
    }

    /**
     * What is currently known about a route's video, without asking the platform anything.
     *
     * Safe to call while rendering: a file nothing is known about yet reports `checking`, and a
     * `refresh()` is what turns that into an answer.
     */
    getStatus(routeId: string): RouteVideoStatus {
        if (!this.isSupported())
            return this.emptyStatus(routeId)

        this.startJournal()

        const files = this.getVideoFiles(routeId)
        if (!files.length)
            return this.emptyStatus(routeId)

        return this.aggregate(routeId, files.map(file => this.getFileState(file)))
    }

    /**
     * Re-queries every file of a route and returns the result. Used where the user is looking at
     * one route and an accurate answer is worth a platform call: route details, the Ride Again
     * pre-check and the ride gate.
     */
    async refresh(routeId: string): Promise<RouteVideoStatus> {
        if (!this.isSupported())
            return this.emptyStatus(routeId)

        await this.journal.init()

        const files = this.getVideoFiles(routeId)
        if (!files.length)
            return this.emptyStatus(routeId)

        // forced: this is the path that pays for an accurate answer, and a cached one may have come
        // from the list, which never probes access
        for (const file of files) {
            if (file.isExternal)
                await this.query(file.path, { force: true, probeAccess: true })
        }

        // C9: iOS can free a downloaded file on its own between visits - drop those journal
        // entries silently now, before the state is read back out.
        await this.reconcile(files.map(file => file.path))

        const status = this.aggregate(routeId, files.map(file => this.getFileState(file)))
        this.emitRouteUpdate(routeId)
        return status
    }

    /**
     * The badge for a route list card, or nothing.
     *
     * The journal answers first and for free. Only a file that is external, already covered by a
     * grant and unknown to the journal costs a metadata query, and that query is queued rather
     * than made immediately. Access is never probed here: a file whose folder needs confirming has
     * no list label at all, so probing it would buy nothing.
     */
    getListPill(routeId: string): VideoListPill | undefined {
        if (!this.isSupported())
            return undefined

        this.startJournal()

        const path = this.getOwnVideoPath(routeId)
        if (!path)
            return undefined

        const entry = this.journal.getEntry(path)
        if (entry?.status === 'downloading' || entry?.status === 'stopping')
            return 'downloading'

        if (entry)
            return undefined

        const external = this.isExternal(path)
        const covered = this.getFolderAccess().isCovered(path)
        if (!external || !covered)
            return undefined

        const cached = this.getFresh(path)
        if (!cached) {
            this.enqueue(path, routeId)
            return undefined
        }

        if (cached.indeterminate || !cached.availability)
            return undefined

        // a transfer someone else started is still a transfer as far as the list is concerned
        if (cached.availability.isDownloading)
            return 'downloading'

        return this.isNotDownloaded(cached.availability) ? 'in-icloud' : undefined
    }

    /**
     * Whether tapping `Download` has to ask the keep-or-remove question first.
     *
     * It is asked once per route per app session: a retry, or a download restarted after a stop,
     * reuses the answer the user already gave. A file that finished and was removed again, or a
     * failure retried after a restart, has no answer on record and is asked afresh.
     */
    needsConfirmation(routeId: string): boolean {
        if (!this.isSupported())
            return false
        return !this.sessionChoices[routeId]
    }

    /**
     * Starts downloading every file of the route that is missing.
     *
     * A journal entry is written and awaited for each file that was genuinely not downloaded and
     * not already arriving, so that the app may remove it again later. A file that is already on
     * its way (started in the Files app, say) is left alone: watching it is all the app can do,
     * and it never earns the right to evict it.
     */
    async download(routeId: string, choice: VideoKeepChoice): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        this.sessionChoices[routeId] = choice

        for (const file of this.getVideoFiles(routeId)) {
            if (file.isExternal)
                await this.startFile(file, choice)
        }

        this.ensurePolling()
        this.emitRouteUpdate(routeId)
        this.emitRowsUpdate()
    }

    /**
     * Stops the downloads this app started for a route and gives the space back.
     *
     * The entry moves to `stopping` rather than being dropped: iOS may take a moment to react, and
     * an eviction that has not been confirmed yet still has to happen - at the next launch if need be.
     */
    async stop(routeId: string): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        for (const entry of this.journal.getForRoute(routeId)) {
            if (entry.status !== 'downloading')
                continue

            await this.journal.markStopping(entry.path)
            delete this.rows[entry.path]
            await this.tryEvict(entry.path)
        }

        // no invalidation needed: the eviction path re-queries every file it touched
        this.ensurePolling()
        this.emitRouteUpdate(routeId)
        this.emitRowsUpdate()
    }

    /** Starts a failed or stopped download again, with the choice the user already made. */
    async retry(routeId: string): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        const remembered = this.sessionChoices[routeId]
            ?? this.journal.getForRoute(routeId)[0]?.choice
            ?? 'keep'

        await this.download(routeId, remembered)
    }

    /**
     * Changes the keep-or-remove choice for a route's downloads. Switching to `keep` is an undo:
     * the pending removal is forgotten entirely.
     */
    async setChoice(routeId: string, choice: VideoKeepChoice): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        this.sessionChoices[routeId] = choice

        for (const entry of this.journal.getForRoute(routeId)) {
            await this.journal.setChoice(entry.path, choice)
            const row = this.rows[entry.path]
            if (row)
                row.choice = choice
        }

        this.emitRouteUpdate(routeId)
        this.emitRowsUpdate()
    }

    /**
     * Removes a route's downloaded video from the device at the user's request.
     *
     * Unlike automatic cleanup this does not need a journal entry - the user is asking for a file
     * they can see - but it still refuses while the file is mounted by a running ride.
     */
    async remove(routeId: string): Promise<'removed' | 'in-use' | 'failed'> {
        if (!this.isSupported())
            return 'failed'

        await this.journal.init()

        const files = this.getVideoFiles(routeId).filter(f => f.isExternal)
        if (!files.length)
            return 'failed'

        if (files.some(f => this.isActiveInRide(f.path)))
            return 'in-use'

        let removed = false

        for (const file of files) {
            const ok = await this.evict(file.path)
            if (!ok)
                return 'failed'

            removed = true
            await this.journal.discard(file.path)
            delete this.rows[file.path]
            await this.query(file.path, { force: true })
        }

        delete this.sessionChoices[routeId]

        this.logEvent({ message: 'icloud video removed', routeId, files: files.length })
        this.emitRouteUpdate(routeId)
        this.emitRowsUpdate()

        return removed ? 'removed' : 'failed'
    }

    /**
     * Rows for the Downloads screen: the downloads this app started this session, with their
     * outcome. A stopped download leaves no row, and a download the app is only watching was never
     * started here and is not listed.
     */
    getDownloadRows(): Array<VideoDownloadRow> {
        if (!this.isSupported())
            return []

        return Object.values(this.rows).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    }

    /**
     * The sentence shown under "Start failed" when a ride cannot start because of its video.
     *
     * `segment` is the 1-based part number for a route made of several videos; it re-words the
     * reason so it is clear which part is missing.
     */
    getStartOverlayReason(routeId: string, opts?: { segment?: number }): string | undefined {
        if (!this.isSupported())
            return undefined

        const status = this.getStatus(routeId)
        if (status.state === 'ready' || status.state === 'unknown')
            return undefined

        return this.buildReason(status.state, status.transient, opts?.segment ?? status.affectedSegment)
    }

    /** Re-queries everything on the next ask. */
    invalidate(): void {
        this.files = {}
    }

    /**
     * Finishes off whatever the journal still owes the device: an eviction after a stop, or after a
     * "for this ride" ride was left. Runs at launch and whenever a download is polled, so a stop or
     * a ride exit interrupted by the app being killed is completed later instead of being lost.
     */
    async settle(): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        for (const entry of this.journal.getCleanupDue()) {
            if (this.isActiveInRide(entry.path))
                continue

            if (entry.status === 'stopping') {
                const availability = await this.query(entry.path, { force: true })
                // still arriving: evicting now would be racing the transfer, so wait for the next pass
                if (availability?.isDownloading)
                    continue
            }

            await this.tryEvict(entry.path)
        }

        this.emitRowsUpdate()
    }

    reset() {
        super.reset()
        this.disposed = true
        this.stopPolling()
        this.journal.reset()
        this.journal = new VideoDownloadJournal()
        this.journal.on('changed', () => this.onJournalChanged())
        this.files = {}
        this.sessionChoices = {}
        this.rows = {}
        this.activeRidePaths = []
        this.rideRouteIds = []
        this.queue = []
        this.queued = new Set<string>()
        this.inFlight = 0
        this.queryDurations = []
        this.journalStarted = false
    }

    // --- ride integration ---------------------------------------------------------------

    /**
     * Whether a video file can be played right now, for the ride gate.
     *
     * Reads the same cache `refresh()` and the list queries already fill - it does not itself pay
     * for a platform query, so it is only as accurate as the last time this path was refreshed.
     * `unknown` (binding unsupported, or nothing known yet) counts as playable: this gate must
     * never block a ride start on a platform, or a file, it cannot actually reason about.
     */
    async getPlayability(path: string): Promise<{ playable: boolean, state: RouteVideoState }> {
        if (!this.isSupported())
            return { playable: true, state: 'unknown' }

        this.startJournal()

        const state = this.getFileState(this.describeFile({ path, routeId: '' })).state
        return { playable: state === 'ready' || state === 'unknown', state }
    }

    /**
     * A ride visit started. Latches the routes it covers - what `onRideLeft` later checks its
     * `awaiting-ride` entries against - and hands the actively mounted paths on to
     * `setActiveRidePaths`.
     */
    onRideStarted(routeIds: Array<string>, activePaths: Array<string>): void {
        if (!this.isSupported())
            return

        this.rideRouteIds = routeIds
        this.setActiveRidePaths(activePaths)
        this.logEvent({ message: 'ride visit started', routeIds })
    }

    /** Which files the running ride currently has mounted. Never evicted while listed here. */
    setActiveRidePaths(paths: Array<string>): void {
        if (!this.isSupported())
            return
        this.activeRidePaths = paths
    }

    /**
     * The ride visit ended. Every `awaiting-ride` entry for one of this visit's routes is owed
     * back to the device: its status moves to `removal-due` - persisted first, so a kill right
     * after this call still finishes the removal at the next launch - and cleanup runs a short
     * while later, once the ride's own teardown has had a chance to let go of the file.
     *
     * Does not touch `activeRidePaths` itself: clearing those is the caller's job, once it is safe
     * to do so.
     */
    async onRideLeft(): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        const dueAt = Date.now()
        const routeIds = this.rideRouteIds

        for (const entry of this.journal.getAll()) {
            if (entry.status !== 'awaiting-ride' || !routeIds.includes(entry.routeId))
                continue

            await this.journal.markRemovalDue(entry.path, dueAt)
        }

        this.logEvent({ message: 'ride visit left', routeIds })

        this.scheduleRideLeftSettle()
    }

    /** The ride summary's "removed when you leave" line, for one or more routes ridden this visit. */
    getRideRemovalNotice(routeIds: Array<string>): { pending: boolean, kept: boolean } | undefined {
        if (!this.isSupported())
            return undefined

        let pending = false
        let kept = false

        for (const routeId of routeIds) {
            for (const entry of this.journal.getForRoute(routeId)) {
                if (entry.choice === 'this-ride')
                    pending = true
                if (entry.choice === 'keep')
                    kept = true
            }
        }

        return pending || kept ? { pending, kept } : undefined
    }

    /**
     * The app came back to the foreground. Cached answers are dropped, because anything could have
     * happened while the app was away; journal entries are then reconciled against what iOS has
     * actually freed on its own (C9), and whatever cleanup is now due is settled.
     */
    async onForeground(): Promise<void> {
        if (!this.isSupported())
            return

        this.invalidate()
        await this.reconcile()
        await this.settle()
    }

    /** Runs `settle()` after the ride-left grace period, guarded against a reset in between. */
    protected scheduleRideLeftSettle(): void {
        if (this.disposed)
            return

        const timer = setTimeout(() => {
            if (this.disposed)
                return
            this.settle().catch(err => this.logError(err as Error, 'onRideLeftSettle'))
        }, RIDE_LEFT_SETTLE_DELAY_MS)

        // a pending grace-period timer must never be a reason for the process to stay alive
        ;(timer as unknown as { unref?: () => void })?.unref?.()
    }

    /**
     * C9 - iOS can evict a download this app started without telling it. Each affected journal
     * entry is re-queried; one found not local, not downloading, and without a download error is
     * dropped silently, whatever its status: there is nothing left to remove, restore, or wait
     * for, and the route simply goes back to showing what the platform now reports. Never a
     * failure or an abandon event - this is the expected shape of the platform behaviour, not a
     * problem with the download.
     *
     * Runs over every journal entry when called with no argument (`onForeground` - the app has no
     * idea what changed while it was away), or just the given paths when the caller already knows
     * which files it cares about (`refresh(routeId)`).
     */
    protected async reconcile(paths?: Array<string>): Promise<void> {
        await this.journal.init()

        const entries = this.journal.getAll().filter(entry => !paths || paths.includes(entry.path))

        for (const entry of entries)
            await this.reconcileEntry(entry)
    }

    protected async reconcileEntry(entry: VideoDownloadJournalEntry): Promise<void> {
        const availability = await this.query(entry.path, { force: true })
        if (!availability)
            return

        if (!this.isNotDownloaded(availability) || availability.isDownloading || availability.downloadError)
            return

        await this.journal.discard(entry.path)
        delete this.rows[entry.path]
        delete this.sessionChoices[entry.routeId]

        this.logEvent({ message: 'icloud download reconciled', routeId: entry.routeId, reason: 'no-longer-local' })
        this.emitRouteUpdate(entry.routeId)
    }

    // --- per-file state ---------------------------------------------------------------

    /**
     * Turns what is known about one file into a state.
     *
     * Order matters: a file that cannot be read at all is that, whatever its download status says,
     * and a download this app started outranks what the metadata shows, because the journal knows
     * about an intention the platform cannot see.
     */
    protected getFileState(file: VideoFile): FileState {
        const base: FileState = { file, state: 'unknown' }

        if (!file.isExternal)
            return { ...base, state: 'ready' }

        const cached = this.files[file.path]
        const entry = this.journal.getEntry(file.path)

        if (cached?.accessState === 'not-found')
            return { ...base, state: 'not-found' }

        if (cached?.accessState === 'access-lost')
            return { ...base, state: 'access-lost', transient: cached.transient }

        if (cached?.failed)
            return { ...base, state: cached.failed, choice: entry?.choice }

        const availability = cached?.availability
        const failure = availability?.downloadError ? this.mapDownloadError(availability.downloadError) : undefined
        const sizeBytes = this.getSize(availability)
        const freeBytes = availability?.volumeFreeBytes

        if (entry?.status === 'downloading') {
            if (failure)
                return { ...base, state: failure, choice: entry.choice, sizeBytes, freeBytes }

            const state: RouteVideoState = this.isOffline() ? 'waiting-for-network' : 'downloading'
            return { ...base, state, choice: entry.choice, sizeBytes, freeBytes, startedAt: entry.startedAt }
        }

        if (entry?.status === 'stopping')
            return { ...base, state: 'cancelled', choice: entry.choice, sizeBytes, freeBytes }

        if (!availability)
            return { ...base, state: cached?.indeterminate ? 'unknown' : 'checking' }

        if (!this.isNotDownloaded(availability)) {
            const thisRide = entry?.choice === 'this-ride'
                && (entry.status === 'awaiting-ride' || entry.status === 'removal-due')
            return { ...base, state: 'ready', choice: thisRide ? 'this-ride' : entry?.choice, sizeBytes, freeBytes }
        }

        if (failure)
            return { ...base, state: failure, sizeBytes, freeBytes }

        if (availability.isDownloading)
            return { ...base, state: 'downloading-external', sizeBytes, freeBytes }

        if (!this.hasRoomFor(sizeBytes, freeBytes))
            return { ...base, state: 'not-enough-storage', sizeBytes, freeBytes }

        return { ...base, state: 'not-downloaded', sizeBytes, freeBytes }
    }

    /**
     * Folds a route's files into one answer: the worst file decides the state, and the files that
     * still need downloading decide the counts and the size the user is asked to make room for.
     */
    protected aggregate(routeId: string, states: Array<FileState>): RouteVideoStatus {
        const worst = [...states].sort((a, b) => this.rank(a) - this.rank(b))[0]

        const pending = states.filter(s => NOT_DOWNLOADED_STATES.includes(s.state))
        const pendingSize = pending.reduce<number | undefined>(
            (sum, s) => (s.sizeBytes === undefined ? sum : (sum ?? 0) + s.sizeBytes), undefined
        )

        const sizeBytes = pending.length ? pendingSize : worst.sizeBytes
        const freeBytes = states.map(s => s.freeBytes).find(v => v !== undefined)
        const startedAt = states.map(s => s.startedAt).filter((v): v is number => v !== undefined).sort()[0]

        const status: RouteVideoStatus = {
            routeId,
            state: worst.state,
            isICloud: states.some(s => s.file.isICloud),
            fileCount: states.length,
            notDownloadedCount: pending.length,
            confirmedThisSession: !!this.sessionChoices[routeId],
            sizeBytes,
            freeBytes,
            requiredBytes: sizeBytes === undefined ? undefined : sizeBytes + STORAGE_MARGIN_BYTES,
            startedAt,
            transient: worst.transient,
            choice: worst.choice ?? this.sessionChoices[routeId],
            thisRide: worst.state === 'ready' && worst.choice === 'this-ride' ? true : undefined
        }

        if (states.length > 1)
            status.affectedSegment = worst.file.segment

        return status
    }

    /** Position in the precedence order, with the documented tie-breaks folded in. */
    protected rank(state: FileState): number {
        const base = STATE_ORDER.indexOf(state.state) * 2

        // a loss that resolves on its own is explained differently, so it wins its own slot
        if (state.state === 'access-lost')
            return base + (state.transient ? 0 : 1)

        // a "for this ride" video is ready, but with a notice - so it must not be hidden behind a
        // plain ready file of the same route
        if (state.state === 'ready')
            return base + (state.choice === 'this-ride' ? 0 : 1)

        return base
    }

    protected emptyStatus(routeId: string): RouteVideoStatus {
        return {
            routeId, state: 'unknown', isICloud: false,
            fileCount: 0, notDownloadedCount: 0, confirmedThisSession: false
        }
    }

    // --- downloading ------------------------------------------------------------------

    /**
     * Starts one file, if it needs starting.
     *
     * Eligibility for a journal entry is decided from a fresh query taken immediately before the
     * start: only a file that was genuinely not downloaded and not already arriving may later be
     * removed again. If the entry cannot be persisted the download still goes ahead, but as a
     * download the user keeps - the app will not remove a file it has no record of.
     */
    protected async startFile(file: VideoFile, choice: VideoKeepChoice): Promise<void> {
        const availability = await this.query(file.path, { force: true, probeAccess: true })

        if (!availability)
            return

        if (!this.isNotDownloaded(availability))
            return

        const sizeBytes = this.getSize(availability)
        if (!this.hasRoomFor(sizeBytes, availability.volumeFreeBytes)) {
            this.logEvent({
                message: 'icloud download refused', routeId: file.routeId, reason: 'not-enough-storage',
                sizeBytes, freeBytes: availability.volumeFreeBytes
            })
            return
        }

        if (availability.isDownloading) {
            // already on its way, started elsewhere: nothing to start and nothing to claim
            return
        }

        const eligible = !this.journal.getEntry(file.path)
            || this.journal.getEntry(file.path)?.status === 'stopping'

        let effectiveChoice = choice

        if (eligible) {
            const written = await this.journal.begin(file.path, file.routeId, choice)
            if (!written)
                effectiveChoice = 'keep'
        }

        try {
            await this.getFileAccess()?.startDownload(file.path)
        }
        catch (err) {
            // the entry only ever existed to authorise removing what this start would have fetched
            await this.journal.discard(file.path)
            this.files[file.path] = { checkedAt: Date.now(), failed: 'download-failed' }
            this.logError(err as Error, 'startDownload', { routeId: file.routeId })
            this.setRow(file, 'download-failed', effectiveChoice, availability)
            return
        }

        this.logEvent({
            message: 'icloud download started', routeId: file.routeId,
            choice: effectiveChoice, sizeBytes, journalled: eligible
        })

        this.setRow(file, this.isOffline() ? 'waiting-for-network' : 'downloading', effectiveChoice, availability)
    }

    /** One pass over the running downloads. Also the hook the poll timer and tests use. */
    async pollOnce(): Promise<void> {
        if (!this.isSupported())
            return

        await this.journal.init()

        const running = this.journal.getAll().filter(e => e.status === 'downloading')
        const touched = new Set<string>()

        for (const entry of running) {
            const availability = await this.query(entry.path, { force: true })
            if (!availability)
                continue

            touched.add(entry.routeId)
            await this.onDownloadProgress(entry, availability)
        }

        await this.settle()

        for (const routeId of touched)
            this.emitRouteUpdate(routeId)

        this.emitRowsUpdate()

        if (!this.hasActiveWork())
            this.stopPolling()
    }

    /** Applies one query result to a running download. */
    protected async onDownloadProgress(
        entry: VideoDownloadJournalEntry, availability: FileAvailability
    ): Promise<void> {

        const file = this.describeFile(entry)

        if (!this.isNotDownloaded(availability)) {
            if (entry.choice === 'this-ride')
                await this.journal.markAwaitingRide(entry.path)
            else
                await this.journal.discard(entry.path)

            this.logEvent({ message: 'icloud download finished', routeId: entry.routeId, choice: entry.choice })
            this.setRow(file, 'ready', entry.choice, availability)
            return
        }

        if (availability.downloadError) {
            const state = this.mapDownloadError(availability.downloadError)
            await this.journal.discard(entry.path)
            this.logEvent({
                message: 'icloud download failed', routeId: entry.routeId, state,
                domain: availability.downloadError.domain, code: availability.downloadError.code
            })
            this.setRow(file, state, entry.choice, availability)
            return
        }

        this.setRow(
            file, this.isOffline() ? 'waiting-for-network' : 'downloading', entry.choice, availability, entry.startedAt
        )
    }

    /** Whether anything still needs watching or cleaning up. */
    protected hasActiveWork(): boolean {
        return this.journal.getAll().some(e => e.status === 'downloading')
            || this.journal.getAll().some(e => e.status === 'stopping' || e.status === 'removal-due')
    }

    protected ensurePolling(): void {
        if (this.disposed || this.pollTimer || !this.hasActiveWork())
            return

        this.pollTimer = setInterval(() => {
            this.pollOnce().catch(err => this.logError(err as Error, 'pollOnce'))
        }, POLL_INTERVAL_MS)
    }

    protected stopPolling(): void {
        if (!this.pollTimer)
            return
        clearInterval(this.pollTimer)
        this.pollTimer = undefined
    }

    // --- eviction ---------------------------------------------------------------------

    /**
     * Tries to give a file's space back and drops the entry once it is gone. A failure is counted
     * and retried later, so a file that is briefly busy is not lost track of.
     */
    protected async tryEvict(path: string): Promise<void> {
        if (this.isActiveInRide(path))
            return

        const evicted = await this.evict(path)

        if (!evicted) {
            await this.journal.recordEvictAttempt(path)
            return
        }

        const availability = await this.query(path, { force: true })

        // verify: only an entry whose file is actually gone may be dropped
        if (availability && !this.isNotDownloaded(availability)) {
            await this.journal.recordEvictAttempt(path)
            return
        }

        const entry = this.journal.getEntry(path)
        await this.journal.discard(path)
        delete this.rows[path]

        if (entry) {
            this.logEvent({ message: 'icloud video evicted', routeId: entry.routeId, status: entry.status })
            delete this.sessionChoices[entry.routeId]
        }
    }

    protected async evict(path: string): Promise<boolean> {
        try {
            await this.getFileAccess()?.evict(path)
            return true
        }
        catch (err) {
            this.logError(err as Error, 'evict')
            return false
        }
    }

    protected isActiveInRide(path: string): boolean {
        return this.activeRidePaths.includes(path)
    }

    // --- queries ----------------------------------------------------------------------

    /**
     * Asks the platform about one file and caches the answer.
     *
     * `probeAccess` adds the access check, which only the paths a user is actually looking at pay
     * for - a list never probes access.
     */
    protected async query(
        path: string, opts: { force?: boolean, probeAccess?: boolean } = {}
    ): Promise<FileAvailability | undefined> {

        if (!opts.force) {
            const fresh = this.getFresh(path)
            if (fresh)
                return fresh.availability
        }

        const binding = this.getFileAccess()
        if (!binding)
            return undefined

        if (opts.probeAccess) {
            const access = await this.getFolderAccess().getAccessState(path)

            if (access.state === 'not-found' || access.state === 'access-lost') {
                this.files[path] = {
                    checkedAt: Date.now(),
                    accessState: access.state,
                    transient: access.state === 'access-lost' ? access.transient : undefined
                }
                return undefined
            }
        }

        const started = Date.now()

        try {
            const availability = await this.withTimeout(binding.getAvailability(path))
            this.files[path] = { checkedAt: Date.now(), accessState: 'readable', availability }
            return availability
        }
        catch (err) {
            // a query that fails or times out means "don't know": no state, no pill, nothing gated
            this.files[path] = { checkedAt: Date.now(), indeterminate: true }
            this.logError(err as Error, 'getAvailability')
            return undefined
        }
        finally {
            this.recordDuration(Date.now() - started)
        }
    }

    protected async withTimeout<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined

        try {
            return await Promise.race([
                promise,
                new Promise<T>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('availability query timed out')), QUERY_TIMEOUT_MS)
                    // a pending guard must never be a reason for the process to stay alive
                    ;(timer as unknown as { unref?: () => void })?.unref?.()
                })
            ])
        }
        finally {
            if (timer)
                clearTimeout(timer)
        }
    }

    protected getFresh(path: string): FileCacheEntry | undefined {
        const cached = this.files[path]
        if (!cached)
            return undefined
        return (Date.now() - cached.checkedAt) < AVAILABILITY_TTL_MS ? cached : undefined
    }

    /** Queues a list-driven query. The queue is what keeps a long list from flooding the platform. */
    protected enqueue(path: string, routeId: string): void {
        if (this.queued.has(path))
            return

        this.queued.add(path)
        this.queue.push({ path, routeId })
        this.pump()
    }

    protected pump(): void {
        while (this.inFlight < QUEUE_CONCURRENCY && this.queue.length > 0) {
            const next = this.queue.shift()
            if (!next)
                return

            this.inFlight++

            this.query(next.path)
                .then(() => this.emitRouteUpdate(next.routeId))
                .catch(err => this.logError(err as Error, 'queuedQuery'))
                .finally(() => {
                    this.inFlight--
                    this.queued.delete(next.path)
                    this.logQueueDebug()
                    this.pump()
                })
        }
    }

    protected recordDuration(ms: number): void {
        this.queryDurations.push(ms)
        if (this.queryDurations.length > 50)
            this.queryDurations.shift()
    }

    /**
     * TEMPORARY - remove once the list-pill cost has been measured on device.
     *
     * Deliberately a raw console line and not a logged event: it is throwaway instrumentation for
     * one measurement, and it must not end up in the event stream.
     */
    protected logQueueDebug(): void {
        const durations = this.queryDurations
        const avgMs = durations.length
            ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
            : 0

        console.log(`[DEBUG-ICLD] availability queue queued=${this.queue.length} inFlight=${this.inFlight} avgMs=${avgMs}`)
    }

    // --- invalidation -----------------------------------------------------------------

    /** Kicks off the journal read, so that the synchronous callers get an answer soon after. */
    protected startJournal(): void {
        if (this.journalStarted)
            return

        this.journalStarted = true
        this.subscribeToAccessChanges()

        this.journal.init()
            .then(() => this.settle())
            .then(() => {
                this.ensurePolling()
                this.emit('route-video-update')
                this.emitRowsUpdate()
            })
            .catch(err => this.logError(err as Error, 'startJournal'))
    }

    /**
     * Cached metadata is deliberately *not* dropped here: every journal mutation happens right
     * after a forced query on the same file, so the cache is the fresher of the two. The list
     * pill reads the journal live anyway, so it can never be stale.
     */
    protected onJournalChanged(): void {
        this.emitRowsUpdate()
    }

    /**
     * A folder gaining or losing a grant changes which files may be queried at all, so every
     * cached answer is dropped when coverage changes.
     */
    protected subscribeToAccessChanges(): void {
        try {
            this.getFolderAccess()?.on('access-changed', () => {
                this.invalidate()
                this.emit('route-video-update')
            })
        }
        catch (err) {
            this.logError(err as Error, 'subscribeToAccessChanges')
        }
    }

    // --- routes -----------------------------------------------------------------------

    /**
     * The video files a route needs, in order: its own, then the videos it chains to.
     *
     * A chained video belongs to another route, which carries its own state; the chain matters here
     * because a ride on this route plays all of them.
     */
    protected getVideoFiles(routeId: string): Array<VideoFile> {
        const files: Array<VideoFile> = []
        const seen = new Set<string>()

        let current: string | undefined = routeId

        while (current && !seen.has(current) && files.length < MAX_CHAIN_LENGTH) {
            seen.add(current)

            const path = this.getOwnVideoPath(current)
            if (path)
                files.push(this.describeFile({ path, routeId: current }, files.length + 1))

            current = this.getNext(current)
        }

        return files
    }

    protected describeFile(entry: { path: string, routeId: string }, segment = 1): VideoFile {
        const location = this.classify(entry.path)
        return {
            path: entry.path,
            routeId: entry.routeId,
            segment,
            isExternal: this.isExternal(entry.path),
            isICloud: location === 'icloud'
        }
    }

    /** The local path of a route's own video, or nothing when it has none or it is served remotely. */
    protected getOwnVideoPath(routeId: string): string | undefined {
        const description = this.getDescription(routeId)
        if (!description)
            return undefined

        const url = description.videoUrl ?? description.originalVideoUrl
        if (!url || isRemoteUrl(url))
            return undefined

        return canonicalPath(url)
    }

    protected getNext(routeId: string): string | undefined {
        try {
            const route = this.getRouteList()?.getCard(routeId)?.getData()
            const next = route ? getNextVideoId(route) : undefined
            return next ?? this.getDescription(routeId)?.next
        }
        catch {
            return this.getDescription(routeId)?.next
        }
    }

    protected getDescription(routeId: string): RouteInfo | undefined {
        if (!routeId)
            return undefined

        try {
            const routes = this.getRouteList()?.getAllRoutes() ?? []
            return routes.map(r => r?.description).find(d => d?.id === routeId)
        }
        catch (err) {
            this.logError(err as Error, 'getDescription')
            return undefined
        }
    }

    // --- rows -------------------------------------------------------------------------

    protected setRow(
        file: VideoFile, state: RouteVideoState, choice: VideoKeepChoice,
        availability?: FileAvailability, startedAt?: number
    ): void {

        const sizeBytes = this.getSize(availability)

        this.rows[file.path] = {
            routeId: file.routeId,
            title: this.getDescription(file.routeId)?.title ?? '',
            state, choice, sizeBytes,
            requiredBytes: sizeBytes === undefined ? undefined : sizeBytes + STORAGE_MARGIN_BYTES,
            freeBytes: availability?.volumeFreeBytes,
            startedAt: startedAt ?? this.rows[file.path]?.startedAt ?? Date.now()
        }
    }

    // --- helpers ----------------------------------------------------------------------

    /**
     * Whether the bytes are somewhere else - the one question every state hangs off.
     *
     * A file that is not cloud-backed at all is simply there. For a cloud-backed one only an
     * explicit "downloaded" or "current" counts as present: an unknown status is treated as absent,
     * because claiming a file is playable and being wrong breaks a ride.
     */
    protected isNotDownloaded(availability?: FileAvailability): boolean {
        if (!availability)
            return false
        if (!availability.isUbiquitous)
            return false
        return availability.downloadStatus !== 'current' && availability.downloadStatus !== 'downloaded'
    }

    protected getSize(availability?: FileAvailability): number | undefined {
        // a placeholder can report 0, which is not a size - the UI leaves the figure out instead
        return availability?.sizeBytes ? availability.sizeBytes : undefined
    }

    protected hasRoomFor(sizeBytes?: number, freeBytes?: number): boolean {
        if (sizeBytes === undefined || freeBytes === undefined)
            return true
        return freeBytes >= sizeBytes + STORAGE_MARGIN_BYTES
    }

    protected mapDownloadError(error: { domain: string, code: number }): RouteVideoState {
        const outOfSpace = OUT_OF_SPACE.some(e => e.domain === error.domain && e.code === error.code)
        return outOfSpace ? 'not-enough-storage' : 'download-failed'
    }

    protected buildReason(state: RouteVideoState, transient?: boolean, segment?: number): string {
        if (state === 'access-lost' && transient)
            return this.prefixSegment(REASON_ICLOUD_UNAVAILABLE, segment)

        return this.prefixSegment(START_REASONS[state] ?? REASON_FALLBACK, segment)
    }

    /** Re-words a reason for a route made of several videos, naming the part that is missing. */
    protected prefixSegment(reason: string, segment?: number): string {
        if (!segment || segment < 2)
            return reason
        return `Part ${segment} of this route: ${reason.replace(`This route's video`, 'the video')}`
    }

    protected isExternal(path: string): boolean {
        if (!path || isRemoteUrl(path))
            return false
        return this.classify(path) !== 'app'
    }

    protected classify(path: string) {
        try {
            return this.getFileAccess()?.classifyLocation(path) ?? 'other'
        }
        catch {
            return 'other'
        }
    }

    protected isOffline(): boolean {
        try {
            return this.getOnlineStatus()?.onlineStatus === false
        }
        catch {
            return false
        }
    }

    protected emitRouteUpdate(routeId: string): void {
        this.emit('route-video-update', routeId)
    }

    protected emitRowsUpdate(): void {
        this.emit('download-rows-update')
    }

    protected getFileAccess(): IFileAccessBinding | undefined {
        return this.getBindings()?.fileAccess
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getFolderAccess() {
        return useFolderAccess()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getOnlineStatus() {
        return useOnlineStatusMonitoring()
    }
}

export const useRouteVideoAvailability = () => new RouteVideoAvailabilityService()
