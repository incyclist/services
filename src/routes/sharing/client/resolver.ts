import { getBindings } from '../../../api/bindings'
import { Injectable, Singleton } from '../../../base/decorators'
import { IncyclistService } from '../../../base/service'
import { useLocalLinkClient } from '../../../link/client/service'
import type { LinkMediaAccess } from '../../../link/client/types'
import { fileUrlToPath } from '../../base/parsers/utils'
import type { SharedRouteEntry } from '../types'
import { PROBE_TIMEOUT_MS, UNREACHABLE_TTL_MS } from './consts'
import { useRouteSharingClient } from './service'
import type { ResolvedVideo, ResolveOptions, VideoAvailability, VideoSourceInput } from './types'

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
        catch {
            return false
        }
    }

    /** true if the route has a remote original, i.e. cannot be bricked by a missing computer */
    isEligible(route: VideoSourceInput): boolean {
        return !route?.isLocal && this.getRemoteUrl(route) !== undefined
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

            return { source: 'remote', url: this.getRemoteUrl(route)! }
        }
        catch (err) {
            this.logError(err as Error, 'resolve')
            const remote = this.getRemoteUrl(route)
            return remote ? { source: 'remote', url: remote } : { source: 'unavailable' }
        }
    }

    /**
     * Where the route could be played from, from cached state only: no request is made and
     * no file is checked. A connected computer that has the route counts as available.
     */
    getAvailability(route: VideoSourceInput): VideoAvailability {
        if (!this.isEligible(route))
            return { canStart: false, availability: 'unavailable' }
        if ((route.isDownloaded) && route.videoUrl && !isRemote(route.videoUrl))
            return { canStart: true, availability: 'local' }
        const linkId = this.getConnectedLinks(route.id!, [])[0]?.linkId
        if (linkId)
            return { canStart: true, availability: 'fromLink', linkId }
        return { canStart: true, availability: 'remote' }
    }

    /** true if a connected computer is known to have the route (cached state only) */
    hasLinkSource(route: VideoSourceInput): boolean {
        try {
            return this.getAvailability(route).availability === 'fromLink'
        }
        catch {
            return false
        }
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
    protected getCandidates(routeKey: string, skip: string[]): SharedRouteEntry[] {
        const client = this.getLocalLinkClient()
        if (!client.isSupported())
            return []
        const links = new Map(client.getDisplayProps().links.map(l => [l.linkId, l]))
        const connected = (r: SharedRouteEntry) => client.getSession(r.linkId) !== undefined
        return this.getSharingClient().getRowsForRoute(routeKey)
            .filter(r => links.has(r.linkId) && !skip.includes(r.linkId) && (connected(r) || !this.isRecentlyUnreachable(r.linkId)))
            .sort((a, b) => Number(connected(b)) - Number(connected(a)) || (links.get(b.linkId)!.lastSeenAt ?? 0) - (links.get(a.linkId)!.lastSeenAt ?? 0))
    }

    protected getConnectedLinks(routeKey: string, skip: string[]): SharedRouteEntry[] {
        const client = this.getLocalLinkClient()
        return this.getCandidates(routeKey, skip).filter(r => client.getSession(r.linkId) !== undefined)
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
        const media = await this.getLocalLinkClient().getMedia(row.linkId)
        if (!media) {
            this.unreachableAt.set(row.linkId, Date.now())
            return undefined
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
        if (status === 410)
            await this.getSharingClient().onGone(row.linkId, row.routeKey)
        if (status < 200 || status >= 300)
            return undefined
        return `${media.baseUrl}/v/${handle}?t=${encodeURIComponent(media.token)}`
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
