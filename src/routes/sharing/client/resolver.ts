import { getBindings } from '../../../api/bindings'
import { Injectable, Singleton } from '../../../base/decorators'
import { IncyclistService } from '../../../base/service'
import { useLocalLinkClient } from '../../../link/client/service'
import type { LinkMediaAccess, LinkReachability } from '../../../link/client/types'
import { fileUrlToPath } from '../../base/parsers/utils'
import type { SharedRouteEntry } from '../types'
import { PROBE_TIMEOUT_MS, UNREACHABLE_TTL_MS } from './consts'
import { useRouteSharingClient } from './service'
import type {
    AvailabilityOptions, LinkSnapshot, OpenRowResult, ResolvedVideo, ResolveOptions, RouteAvailability, UnavailableReason, VideoAvailability, VideoSourceInput,
} from './types'

const isRemote = (url: string | undefined): url is string => typeof url === 'string' && url.startsWith('http')

const decode = (path: string): string => {
    try {
        return decodeURIComponent(path)
    }
    catch {
        return path
    }
}

/**
 * Decides where the video of a route is played from. For routes that have a remote original
 * (official and downloadable routes) the order is:
 *
 * 1. a copy on this device;
 * 2. a paired computer that has the route and answers (already connected first, then the most
 *    recently seen; the first that answers wins). A stale handle (`404`) is refreshed once, a gone
 *    file (`410`) counts a miss and the next computer is tried;
 * 3. the route's own remote URL;
 * 4. unavailable.
 *
 * The result is ephemeral: a link URL carries the media token and is handed to the player, never
 * stored. If the media token is about to expire the session is re-established first. The player
 * must not tie the ride to the health of the video: this service never touches ride state.
 *
 * Without route sharing (toggle off, unsupported platform) the computer step is skipped.
 */
@Singleton
export class RouteVideoResolver extends IncyclistService {
    protected unreachableAt = new Map<string, number>()

    constructor() {
        super('RouteVideoResolver')
    }

    /** true if route sharing is available on this device (toggle on, bindings and native requirements present) */
    isAvailable(): boolean {
        try {
            return this.getLocalLinkClient().isSupported()
        }
        catch (err) {
            this.logError(err as Error, 'isAvailable')
            return false
        }
    }

    /**
     * true if the video can come from a computer: the route has a remote original (it can not be
     * bricked by a missing computer: its description says so, or it has a remote url) or it was created
     * from a computer's catalog (it can only come from a computer)
     */
    isEligible(route: VideoSourceInput): boolean {
        try {
            return !!route?.linkShared || (!route?.isLocal && (!!route?.requiresDownload || this.getRemoteUrl(route) !== undefined))
        }
        catch (err) {
            this.logError(err as Error, 'isEligible')
            return false
        }
    }

    /**
     * Resolves the video source of an eligible route. A route that is not eligible is
     * reported `unavailable` (it is not handled here).
     *
     * @param opts.skipLinks computers whose video failed to load; asking again with them skipped
     * is the one fallthrough to the next source
     */
    async resolve(route: VideoSourceInput, opts: ResolveOptions = {}): Promise<ResolvedVideo> {
        try {
            if (!this.isEligible(route))
                return { source: 'unavailable' }

            const local = await this.getLocalCopy(route)
            if (local)
                return { source: 'local', url: local }

            const linked = await this.resolveFromLinks(route.id!, opts.skipLinks ?? [])
            if (linked)
                return { source: 'link', ...linked }

            const remote = this.getRemoteUrl(route)
            return remote ? { source: 'remote', url: remote } : { source: 'unavailable' }
        }
        catch (err) {
            this.logError(err as Error, 'resolve')
            return this.resolveFallback(route)
        }
    }

    /**
     * Where the route could be played from, from cached state only: no request is made and
     * no file is checked. A connected computer that has the route counts as available.
     */
    getAvailability(route: VideoSourceInput): VideoAvailability {
        try {
            if (route?.linkShared) {
                const { canStart, availability, linkId } = this.getRouteAvailability(route, { hasDetails: true })
                return { canStart, availability, linkId }
            }
            if (!this.isEligible(route))
                return { canStart: false, availability: 'unavailable' }
            if ((route.isDownloaded) && route.videoUrl && !isRemote(route.videoUrl))
                return { canStart: true, availability: 'local' }
            const linkId = this.getConnectedLinks(route.id!, [])[0]?.linkId
            if (linkId)
                return { canStart: true, availability: 'fromLink', linkId }
            return { canStart: true, availability: 'remote' }
        }
        catch (err) {
            this.logError(err as Error, 'getAvailability')
            return { canStart: false, availability: 'unavailable' }
        }
    }

    /**
     * What the list and Route Details show about a route's source (`availability`, `sourceLabel`,
     * `unavailableReason`) and whether it can be started. From cached state only: the connected
     * sessions, the saved rows and the last known reachability. Never a request.
     *
     * For a route that was created from a computer's catalog, a start needs its details (persisted
     * or loadable now from a connected computer that offers `route-descriptor`) and a connected
     * computer that has the route.
     */
    getRouteAvailability(route: VideoSourceInput, opts: AvailabilityOptions = {}): RouteAvailability {
        try {
            const links = opts.links ?? this.getLinkSnapshot()
            if (route.linkShared)
                return this.getLinkSharedAvailability(route, links, !!opts.hasDetails)
            return this.getOtherAvailability(route, links)
        }
        catch (err) {
            this.logError(err as Error, 'getRouteAvailability')
            return { canStart: false, availability: 'unavailable', unavailableReason: 'noSource' }
        }
    }

    /** The state of the computers that availability needs; read it once for a whole list. */
    getLinkSnapshot(): LinkSnapshot {
        const snapshot: LinkSnapshot = new Map()
        try {
            const client = this.getLocalLinkClient()
            if (!client.isSupported())
                return snapshot
            for (const link of client.getDisplayProps().links) {
                const session = client.getSession(link.linkId)
                snapshot.set(link.linkId, {
                    displayName: link.displayName, connected: session !== undefined, descriptor: !!session?.capabilities?.includes('route-descriptor'),
                    mediaAvailable: link.mediaAvailable, lastSeenAt: link.lastSeenAt ?? 0, reachability: link.reachability,
                })
            }
        }
        catch (err) {
            this.logError(err as Error, 'getLinkSnapshot')
            // fallback: no computer is known
            snapshot.clear()
        }
        return snapshot
    }

    /**
     * The computer and handle the thumbnail of a route can be fetched from: the preferred computer if
     * it has a thumbnail for the route, otherwise the most recently confirmed row that has one.
     * Cached state only.
     */
    getThumbnailLink(routeKey: string, preferLinkId?: string): { linkId: string, thumbHandle: string } | undefined {
        try {
            const rows = this.getSharingClient().getRowsForRoute(routeKey).filter(r => !!r.thumbHandle)
            const row = rows.find(r => r.linkId === preferLinkId) ?? rows.sort((a, b) => b.lastConfirmedAt - a.lastConfirmedAt)[0]
            return row ? { linkId: row.linkId, thumbHandle: row.thumbHandle! } : undefined
        }
        catch (err) {
            this.logError(err as Error, 'getThumbnailLink')
            return undefined
        }
    }

    /** true if a connected computer is known to have the route (cached state only) */
    hasLinkSource(route: VideoSourceInput): boolean {
        try {
            return this.getAvailability(route).availability === 'fromLink'
        }
        catch (err) {
            this.logError(err as Error, 'hasLinkSource')
            return false
        }
    }

    protected resolveFallback(route: VideoSourceInput): ResolvedVideo {
        try {
            const remote = this.getRemoteUrl(route)
            return remote ? { source: 'remote', url: remote } : { source: 'unavailable' }
        }
        catch {
            return { source: 'unavailable' }
        }
    }

    /**
     * Availability of a route that exists on this device, from the markers of its description only
     * (no urls, no details):
     *
     * - the video is on this device (`isLocal`, `isDownloaded`), or the route has none: `local`;
     * - a connected computer that offers the video (`linkSources`): `fromLink` with its name;
     * - the video is remote (`requiresDownload`), or nothing is known about the video yet: `remote`
     *   (nothing is shown);
     * - `unavailable` only if the markers prove that there is no source: not downloadable, no remote url,
     *   no computer.
     */
    protected getOtherAvailability(route: VideoSourceInput, links: LinkSnapshot): RouteAvailability {
        if (route.isLocal || route.isDownloaded)
            return { canStart: true, availability: 'local' }

        const linkId = this.getConnectedSource(route.linkSources, links)
        if (linkId)
            return { canStart: true, availability: 'fromLink', sourceLabel: links.get(linkId)?.displayName, linkId }

        if (route.hasVideo === false)
            return { canStart: true, availability: 'local' }
        if (route.requiresDownload === false && this.getRemoteUrl(route) === undefined)
            return { canStart: false, availability: 'unavailable', unavailableReason: 'noSource' }
        return { canStart: true, availability: 'remote' }
    }

    /** the computer of the markers that is connected and serves media now (the most recently seen one) */
    protected getConnectedSource(linkSources: string[] | undefined, links: LinkSnapshot): string | undefined {
        let found: string | undefined
        for (const linkId of linkSources ?? []) {
            const link = links.get(linkId)
            if (!link?.connected || !link.mediaAvailable)
                continue
            if (found === undefined || link.lastSeenAt > links.get(found)!.lastSeenAt)
                found = linkId
        }
        return found
    }

    protected getLinkSharedAvailability(route: VideoSourceInput, links: LinkSnapshot, hasDetails: boolean): RouteAvailability {
        if (route.isDownloaded && route.videoUrl && !isRemote(route.videoUrl))
            return { canStart: true, availability: 'local' }

        const rows = this.getSharingClient().getRowsForRoute(route.id!).filter(r => links.has(r.linkId))
        const byRecency = (a: SharedRouteEntry, b: SharedRouteEntry) => links.get(b.linkId)!.lastSeenAt - links.get(a.linkId)!.lastSeenAt
        const usable = rows.filter(r => links.get(r.linkId)!.connected && links.get(r.linkId)!.mediaAvailable).sort(byRecency)
        if (usable.length > 0) {
            const capable = usable.find(r => links.get(r.linkId)!.descriptor)
            const chosen = capable ?? usable[0]
            const sourceLabel = links.get(chosen.linkId)!.displayName
            if (hasDetails || capable)
                return { canStart: true, availability: 'fromLink', sourceLabel, linkId: chosen.linkId }
            return { canStart: false, availability: 'unavailable', unavailableReason: 'versionMismatch', sourceLabel }
        }

        const last = rows.sort(byRecency)[0]
        if (!last)
            return { canStart: false, availability: 'unavailable', unavailableReason: 'noSource' }
        const link = links.get(last.linkId)!
        return { canStart: false, availability: 'unavailable', unavailableReason: this.toReason(link.reachability), sourceLabel: link.displayName }
    }

    protected toReason(reachability: LinkReachability): UnavailableReason {
        if (reachability === 'never-reached')
            return 'linkNeverReached'
        return reachability === 'version-mismatch' ? 'versionMismatch' : 'linkUnreachable'
    }

    protected getRemoteUrl(route: VideoSourceInput): string | undefined {
        return [route?.originalVideoUrl, route?.downloadUrl, route?.videoUrl].find(isRemote)
    }

    protected async getLocalCopy(route: VideoSourceInput): Promise<string | undefined> {
        const url = route.videoUrl
        if (!(route.isDownloaded) || !url || isRemote(url))
            return undefined
        const path = fileUrlToPath(url)
        if (!path)
            return url
        const fs = getBindings()?.fs
        if (!fs)
            return url
        const decoded = decode(path)
        if (await fs.existsFile(decoded) || (decoded !== path && await fs.existsFile(path)))
            return url
        return undefined
    }

    /** Candidate rows of the computers that are usable now, in the order they are tried. */
    protected getCandidates(routeKey: string, skip: string[], links: LinkSnapshot = this.getLinkSnapshot()): SharedRouteEntry[] {
        const connected = (r: SharedRouteEntry) => links.get(r.linkId)?.connected === true
        return this.getSharingClient().getRowsForRoute(routeKey)
            .filter(r => links.has(r.linkId) && !skip.includes(r.linkId) && (connected(r) || !this.isRecentlyUnreachable(r.linkId)))
            .sort((a, b) => Number(connected(b)) - Number(connected(a)) || links.get(b.linkId)!.lastSeenAt - links.get(a.linkId)!.lastSeenAt)
    }

    protected getConnectedLinks(routeKey: string, skip: string[], links: LinkSnapshot = this.getLinkSnapshot()): SharedRouteEntry[] {
        return this.getCandidates(routeKey, skip, links).filter(r => links.get(r.linkId)?.connected)
    }

    protected isRecentlyUnreachable(linkId: string): boolean {
        const at = this.unreachableAt.get(linkId)
        return at !== undefined && Date.now() - at < UNREACHABLE_TTL_MS
    }

    protected async resolveFromLinks(routeKey: string, skip: string[]): Promise<{ url: string, linkId: string } | undefined> {
        for (const row of this.getCandidates(routeKey, skip)) {
            const url = await this.probe(row)
            if (url)
                return { url, linkId: row.linkId }
        }
        return undefined
    }

    /** @returns the player URL of the row's video if its computer serves it now */
    protected async probe(row: SharedRouteEntry): Promise<string | undefined> {
        return (await this.openRow(row)).url
    }

    /**
     * Checks that the computer of a row serves the row's video now and builds the (ephemeral) URL
     * with a fresh media token. A stale handle (`404`) is refreshed once; a gone file (`410`) counts a miss.
     *
     * @returns the URL, or the reason there is none: `unreachable` (no session, no answer or any other
     * status) or `gone` (`410`)
     */
    async openRow(row: SharedRouteEntry): Promise<OpenRowResult> {
        try {
            return await this.doOpenRow(row)
        }
        catch (err) {
            this.logError(err as Error, 'openRow')
            return { failure: 'unreachable' }
        }
    }

    protected async doOpenRow(row: SharedRouteEntry): Promise<OpenRowResult> {
        const media = await this.getLocalLinkClient().getMedia(row.linkId)
        if (!media) {
            this.unreachableAt.set(row.linkId, Date.now())
            return { failure: 'unreachable' }
        }
        this.unreachableAt.delete(row.linkId)

        let handle = row.videoHandle
        let status = await this.head(media, handle)
        if (status === 404) {
            const fresh = await this.getSharingClient().onStaleHandle(row.linkId, row.routeKey)
            if (fresh) {
                handle = fresh.videoHandle
                status = await this.head(media, handle)
            }
        }
        if (status === 410) {
            await this.getSharingClient().onGone(row.linkId, row.routeKey)
            return { failure: 'gone' }
        }
        if (status < 200 || status >= 300)
            return { failure: 'unreachable' }
        return { url: `${media.baseUrl}/v/${handle}?t=${encodeURIComponent(media.token)}`, expiresAt: media.expiresAt }
    }

    /** @returns the HTTP status of a `HEAD` request to the handle, `0` if it did not answer */
    protected async head(media: LinkMediaAccess, handle: string): Promise<number> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
        try {
            const response = await fetch(`${media.baseUrl}/v/${handle}`, {
                method: 'HEAD', headers: { Authorization: `Bearer ${media.token}` }, signal: controller.signal,
            })
            return response.status
        }
        catch {
            return 0
        }
        finally {
            clearTimeout(timer)
        }
    }

    @Injectable
    protected getLocalLinkClient() {
        return useLocalLinkClient()
    }

    @Injectable
    protected getSharingClient() {
        return useRouteSharingClient()
    }
}

/** Returns the resolver of video sources. */
export const useRouteVideoResolver = () => new RouteVideoResolver()
