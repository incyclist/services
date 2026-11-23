import type { MediaState } from '../../api/localLink/types'
import { canonicalJson } from '../../link/utils'
import { fileUrlToPath } from '../base/parsers/utils'
import type { RouteInfo } from '../base/types'
import type { CatalogDocument, CatalogEntry, SharedRouteSummary } from './types'

const STAT_CONCURRENCY = 8

const VIDEO_TYPES: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mkv: 'video/x-matroska',
}
const IMAGE_TYPES: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

export interface CatalogBuildOptions {
    linkId: string
    /** opaque handle for a file; stable for the same input within one process */
    makeHandle(kind: 'v' | 't', path: string): string
    /** file size in bytes, `undefined` when unknown (e.g. the NAS is not mounted) */
    stat(path: string): Promise<number | undefined>
    /** content hash of a text, used for the catalog version */
    hash(text: string): string
}

export interface CatalogBuild {
    document: CatalogDocument
    handles: MediaState['handles']
    /** counts of what was left out because of its file type or because the file is missing; never paths */
    skipped: { video: number, thumbnail: number, missingVideo: number }
    /** number of entries with and without a thumbnail handle */
    thumbnails: { with: number, without: number }
}

const extensionOf = (path: string): string => {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    const dot = name.lastIndexOf('.')
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

const isVideoType = (path: string): boolean => Object.hasOwn(VIDEO_TYPES, extensionOf(path))
const isImageType = (path: string): boolean => Object.hasOwn(IMAGE_TYPES, extensionOf(path))

/** The absolute path of the route's video if it is a local file, else `undefined`. */
export const getLocalVideoPath = (descr: RouteInfo): string | undefined => fileUrlToPath(descr.videoUrl)

/** A route is shared if it is not deleted and its video is a local file on this computer. */
export const isShareable = (descr: RouteInfo | undefined): descr is RouteInfo =>
    !!descr && !descr.isDeleted && !!(descr.isLocal || descr.isDownloaded) && getLocalVideoPath(descr) !== undefined

/**
 * Cross-computer identity: the route-server id for official routes, `routeHash` for local
 * routes, and `${linkId}:${routeIdOnComputer}` for local routes without a hash.
 */
export const getRouteKey = (descr: RouteInfo, linkId: string): string => {
    if (!descr.isLocal)
        return descr.id!
    return descr.routeHash ?? `${linkId}:${descr.id}`
}

const SUMMARY_KEYS = ['localizedTitle', 'country', 'distance', 'elevation', 'isLoop', 'hasGpx', 'pointsSource', 'videoFormat'] as const

/**
 * The list-level fields of a route, from a whitelist. Undefined values are omitted, so the
 * catalog version only changes when a value does. Never paths, urls or timestamps.
 */
export const buildSummary = (descr: RouteInfo): SharedRouteSummary => {
    const summary: Record<string, unknown> = { title: descr.title ?? '' }
    for (const key of SUMMARY_KEYS) {
        if (descr[key] !== undefined && descr[key] !== null)
            summary[key] = descr[key]
    }
    return summary as unknown as SharedRouteSummary
}

type BuiltEntry = { entry: CatalogEntry, handles: MediaState['handles'], thumbnailSkipped: boolean }

/** `undefined` if the video file is missing or empty: such a route can not be played by a tablet, so it is not published */
const buildEntry = async (descr: RouteInfo, path: string, opts: CatalogBuildOptions): Promise<BuiltEntry | undefined> => {
    const videoSize = await opts.stat(path)
    if (!videoSize)
        return undefined

    const handles: MediaState['handles'] = []
    const videoHandle = opts.makeHandle('v', path)
    handles.push({ handle: videoHandle, path, contentType: VIDEO_TYPES[extensionOf(path)] })

    let thumbHandle: string | undefined
    const thumbPath = fileUrlToPath(descr.previewUrl)
    let thumbnailSkipped = !!thumbPath && !isImageType(thumbPath)
    if (thumbPath && !thumbnailSkipped) {
        // the path is the one the media server opens; a preview that is not there would only ever be answered with 410
        const thumbSize = await opts.stat(thumbPath)
        thumbnailSkipped = !thumbSize
    }
    if (thumbPath && !thumbnailSkipped) {
        thumbHandle = opts.makeHandle('t', thumbPath)
        handles.push({ handle: thumbHandle, path: thumbPath, contentType: IMAGE_TYPES[extensionOf(thumbPath)] })
    }

    const entry: CatalogEntry = {
        routeKey: getRouteKey(descr, opts.linkId),
        routeIdOnComputer: descr.id!,
        title: descr.title ?? '',
        videoHandle,
        videoFormat: descr.videoFormat ?? extensionOf(path),
        size: videoSize,
        // the transport reports no modification time; the route's own change time is the best available signal
        mtime: descr.tsLastChange ?? descr.tsImported ?? 0,
        origin: descr.isLocal ? 'local' : 'official',
    }
    if (thumbHandle)
        entry.thumbHandle = thumbHandle
    if (descr.routeHash)
        entry.routeHash = descr.routeHash
    if (descr.isLocal && descr.routeHash)
        entry.summary = buildSummary(descr)
    return { entry, handles, thumbnailSkipped }
}

/**
 * Builds the catalog document and the handle table from the route descriptions.
 * Only files of a known video type (and, for thumbnails, a known image type) are shared: a route
 * with another video type is left out, another thumbnail type only drops the thumbnail.
 * A route whose video file is missing (e.g. an unmounted NAS) is left out and counted in `skipped.missingVideo`.
 * Routes whose key already occurred are skipped; entries are sorted by key so that the
 * catalog version only changes when the content does.
 */
export const buildCatalog = async (descriptions: RouteInfo[], opts: CatalogBuildOptions): Promise<CatalogBuild> => {
    const seen = new Set<string>()
    const candidates: Array<{ descr: RouteInfo, path: string }> = []
    const skipped = { video: 0, thumbnail: 0, missingVideo: 0 }
    for (const descr of descriptions) {
        if (!isShareable(descr) || !descr.id)
            continue
        if (!isVideoType(getLocalVideoPath(descr)!)) {
            skipped.video++
            continue
        }
        const key = getRouteKey(descr, opts.linkId)
        if (seen.has(key))
            continue
        seen.add(key)
        candidates.push({ descr, path: getLocalVideoPath(descr)! })
    }

    const built: BuiltEntry[] = []
    for (let i = 0; i < candidates.length; i += STAT_CONCURRENCY) {
        const chunk = candidates.slice(i, i + STAT_CONCURRENCY)
        const entries = await Promise.all(chunk.map(c => buildEntry(c.descr, c.path, opts))) // NOSONAR bounded concurrency: one chunk of file stats at a time
        for (const b of entries) {
            if (b)
                built.push(b)
            else
                skipped.missingVideo++
        }
    }
    built.sort((a, b) => (a.entry.routeKey < b.entry.routeKey ? -1 : Number(a.entry.routeKey > b.entry.routeKey)))

    const routes = built.map(b => b.entry)
    const catalogVersion = opts.hash(canonicalJson(routes))
    skipped.thumbnail = built.filter(b => b.thumbnailSkipped).length
    const withThumbnail = routes.filter(r => r.thumbHandle).length
    const thumbnails = { with: withThumbnail, without: routes.length - withThumbnail }
    return { document: { catalogVersion, routes }, handles: built.flatMap(b => b.handles), skipped, thumbnails }
}
