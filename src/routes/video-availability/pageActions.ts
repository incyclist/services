import { FolderAccessService, useFolderAccess } from "../../fileaccess/service"
import type { AccessTarget, ConfirmAccessResult } from "../../fileaccess/types"
import { Injectable, Singleton } from "../../base/decorators"
import { IncyclistService } from "../../base/service"
import { useOnlineStatusMonitoring } from "../../monitoring"
import { useRouteList } from "../list/service"
import type { RouteVideoDisplayProps } from "../page/types"
import { RouteVideoAvailabilityService, useRouteVideoAvailability } from "./service"
import type { RouteVideoStatus, VideoKeepChoice } from "./types"

/**
 * The route-video actions and display props shared by every page service that shows a route's
 * video state (`RoutesPageService` route details, `ActivitiesPageService` Ride Again). It owns
 * nothing durable itself - the download, the journal, and the access grants all live in
 * `RouteVideoAvailabilityService` and `FolderAccessService` - only the transient, session-only UI
 * state a display prop needs and a domain service has no reason to know about: which route is
 * mid-confirmation, and the outcome of the last Confirm Access attempt.
 *
 * Maps `RouteVideoStatus` (what is true) to the action booleans a screen renders buttons from
 * (what can be tapped right now), per the state precedence in `RouteVideoAvailabilityService`.
 *
 * Inert on every platform without the `fileAccess` binding: `getDisplayProps` reports `unknown`,
 * every action is `false`, and every handler is a no-op - because the domain services it
 * delegates to are inert themselves on those platforms.
 *
 * Emits `route-video-actions-update` (routeId) whenever local UI state changes (a confirmation
 * opened or closed, a Confirm Access result came back). Callers additionally subscribe to
 * `RouteVideoAvailabilityService`'s own `route-video-update` for state changes driven by the
 * download itself.
 *
 * @noInheritDoc
 * @extends IncyclistService
 */
@Singleton
export class RouteVideoPageActions extends IncyclistService {

    /** Routes currently showing the keep-or-remove download confirmation. */
    protected pendingConfirmations: Record<string, boolean> = {}
    /** Routes currently showing the "remove this download" confirmation. */
    protected pendingRemoveConfirmations: Record<string, boolean> = {}
    /** Routes whose last remove attempt didn't end in `'removed'`, until the next attempt replaces it. */
    protected lastRemoveFailed: Record<string, boolean> = {}
    /** The outcome of the last Confirm Access attempt, per route, until the next one replaces it. */
    protected lastAccessResults: Record<string, ConfirmAccessResult> = {}

    constructor() {
        super('RouteVideoPageActions')
    }

    /** True only where the underlying availability service can actually answer anything. */
    isSupported(): boolean {
        try {
            return this.getAvailability().isSupported()
        }
        catch {
            return false
        }
    }

    /**
     * Everything one route's video display needs: its status, whether the ride/route can start,
     * which buttons apply, and any confirmation or access-recovery panel currently open for it.
     *
     * Safe to call on every render - it never queries the platform itself, only reads what
     * `RouteVideoAvailabilityService` already has cached (a `refresh()` is the caller's job, e.g.
     * when a route details dialog first opens).
     */
    getDisplayProps(routeId: string): RouteVideoDisplayProps {
        const status = this.getAvailability().getStatus(routeId)

        const props: RouteVideoDisplayProps = {
            status,
            canStart: this.canStart(status),
            actions: this.buildActions(status)
        }

        if (this.pendingConfirmations[routeId]) {
            props.confirmation = {
                routeTitle: this.getRouteTitle(routeId),
                sizeBytes: status.sizeBytes,
                freeBytes: status.freeBytes,
                fileCount: status.fileCount,
                offline: this.isOffline()
            }
        }

        if (this.pendingRemoveConfirmations[routeId])
            props.removeConfirmation = { sizeBytes: status.sizeBytes }

        if (this.lastRemoveFailed[routeId])
            props.removeFailed = true

        const lastResult = this.lastAccessResults[routeId]
        if (status.state === 'access-lost' || lastResult) {
            props.access = {
                target: status.state === 'access-lost' ? this.getAccessTarget(routeId) : undefined,
                lastResult
            }
        }

        return props
    }

    // --- download -----------------------------------------------------------------------

    /**
     * "Download" was tapped.
     *
     * The keep-or-remove question is only ever asked once per route per session
     * (`needsConfirmation`): once it has an answer on record, pressing Download again goes
     * straight to starting the transfer with that remembered choice - the same "session-direct"
     * path a retry after a stop or a failure already uses.
     */
    onVideoDownloadPressed(routeId: string): void {
        if (!this.isSupported())
            return

        if (this.getAvailability().needsConfirmation(routeId)) {
            this.pendingConfirmations[routeId] = true
            this.emitUpdate(routeId)
            return
        }

        this.getAvailability().retry(routeId).catch(err => this.logError(err as Error, 'onVideoDownloadPressed'))
    }

    /** The user answered the keep-or-remove question and the download may start. */
    onVideoDownloadConfirmed(routeId: string, choice: VideoKeepChoice): void {
        if (!this.isSupported())
            return

        delete this.pendingConfirmations[routeId]
        this.emitUpdate(routeId)

        this.getAvailability().download(routeId, choice)
            .catch(err => this.logError(err as Error, 'onVideoDownloadConfirmed'))
    }

    /** The confirmation was dismissed without an answer: nothing starts. */
    onVideoDownloadDismissed(routeId: string): void {
        if (!this.isSupported())
            return

        delete this.pendingConfirmations[routeId]
        this.emitUpdate(routeId)
    }

    onVideoStop(routeId: string): void {
        if (!this.isSupported())
            return

        this.getAvailability().stop(routeId).catch(err => this.logError(err as Error, 'onVideoStop'))
    }

    /** Starts a failed or stopped download again, with whatever choice was already made. */
    onVideoRetry(routeId: string): void {
        if (!this.isSupported())
            return

        this.getAvailability().retry(routeId).catch(err => this.logError(err as Error, 'onVideoRetry'))
    }

    /** Cancels a pending "for this ride" removal: the file is kept for good instead. */
    onVideoKeepInstead(routeId: string): void {
        if (!this.isSupported())
            return

        this.getAvailability().setChoice(routeId, 'keep')
            .catch(err => this.logError(err as Error, 'onVideoKeepInstead'))
    }

    // --- remove --------------------------------------------------------------------------

    onVideoRemovePressed(routeId: string): void {
        if (!this.isSupported())
            return

        this.pendingRemoveConfirmations[routeId] = true
        this.emitUpdate(routeId)
    }

    async onVideoRemoveConfirmed(routeId: string): Promise<void> {
        if (!this.isSupported())
            return

        delete this.pendingRemoveConfirmations[routeId]
        delete this.lastRemoveFailed[routeId]
        this.emitUpdate(routeId)

        try {
            const result = await this.getAvailability().remove(routeId)
            if (result !== 'removed')
                this.lastRemoveFailed[routeId] = true
        }
        catch (err) {
            this.lastRemoveFailed[routeId] = true
            this.logError(err as Error, 'onVideoRemoveConfirmed')
        }
        finally {
            this.emitUpdate(routeId)
        }
    }

    onVideoRemoveDismissed(routeId: string): void {
        if (!this.isSupported())
            return

        delete this.pendingRemoveConfirmations[routeId]
        this.emitUpdate(routeId)
    }

    // --- access --------------------------------------------------------------------------

    /** Opens the folder picker to re-confirm access, and remembers the outcome for the caller. */
    async onConfirmAccess(routeId: string): Promise<void> {
        if (!this.isSupported())
            return

        try {
            this.lastAccessResults[routeId] = await this.getFolderAccess().confirmAccess(routeId)
        }
        catch (err) {
            this.logError(err as Error, 'onConfirmAccess')
        }
        finally {
            this.emitUpdate(routeId)
        }
    }

    reset() {
        super.reset()
        this.pendingConfirmations = {}
        this.pendingRemoveConfirmations = {}
        this.lastRemoveFailed = {}
        this.lastAccessResults = {}
    }

    // --- mapping ---------------------------------------------------------------------------

    /** Whether the video is ready to play right now - mirrors the ride gate's own verdict. */
    protected canStart(status: RouteVideoStatus): boolean {
        return status.state === 'ready' || status.state === 'unknown'
    }

    /**
     * Which buttons apply for a given state.
     *
     * - **download**: a fresh, unconfirmed start - `not-downloaded`, or offered but disabled for
     *   `not-enough-storage`.
     * - **retry**: a start that already has an answer on record - `cancelled` (stopped) or
     *   `download-failed`.
     * - **stop**: an app-owned transfer actually in flight - `downloading` or, blocked on the
     *   network, `waiting-for-network`. Not `downloading-external`: a transfer this app did not
     *   start is only ever watched, never owned.
     * - **keepInstead**: only once the file is `ready` and this app's journal still has an opinion
     *   about it (`status.choice === 'this-ride'`).
     * - **remove**: any `ready` iCloud video, kept or not - a completed "keep" download has its
     *   journal entry cleared (architecture §3.4), so this can't gate on `status.choice`. Evicting a
     *   ubiquitous item is non-destructive (the file stays in iCloud Drive), so gating on `isICloud`
     *   alone is safe; in-ride protection is handled inside `remove()` itself.
     * - **confirmAccess**: `access-lost` and not `transient` - a transient loss (signed out of
     *   iCloud) is fixed in Settings, not by re-picking the folder.
     */
    protected buildActions(status: RouteVideoStatus): RouteVideoDisplayProps['actions'] {
        const state = status.state

        return {
            download: state === 'not-downloaded' || state === 'not-enough-storage',
            downloadEnabled: state === 'not-downloaded',
            retry: state === 'cancelled' || state === 'download-failed',
            stop: state === 'downloading' || state === 'waiting-for-network',
            keepInstead: state === 'ready' && status.choice === 'this-ride',
            remove: state === 'ready' && status.isICloud,
            confirmAccess: state === 'access-lost' && !status.transient
        }
    }

    // --- helpers ---------------------------------------------------------------------------

    protected emitUpdate(routeId: string): void {
        this.emit('route-video-actions-update', routeId)
    }

    protected getRouteTitle(routeId: string): string {
        try {
            const routes = this.getRouteList()?.getAllRoutes() ?? []
            return routes.map((r: { description?: { id?: string, title?: string } }) => r?.description)
                .find((d?: { id?: string }) => d?.id === routeId)?.title ?? ''
        }
        catch (err) {
            this.logError(err as Error, 'getRouteTitle')
            return ''
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

    protected getAccessTarget(routeId: string): AccessTarget | undefined {
        try {
            return this.getFolderAccess().getTargetFor(routeId)
        }
        catch (err) {
            this.logError(err as Error, 'getAccessTarget')
            return undefined
        }
    }

    @Injectable
    protected getAvailability(): RouteVideoAvailabilityService {
        return useRouteVideoAvailability()
    }

    @Injectable
    protected getFolderAccess(): FolderAccessService {
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

export const useRouteVideoPageActions = () => new RouteVideoPageActions()
