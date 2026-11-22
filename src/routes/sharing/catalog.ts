import type { MediaState } from '../../api/localLink/types'
import { canonicalJson } from '../../link/utils'
import { fileUrlToPath } from '../base/parsers/utils'
import type { RouteInfo } from '../base/types'
import type { CatalogDocument, CatalogEntry, SharedRouteSummary } from './types'

const STAT_CONCURRENCY = 8

const VIDEO_TYPES: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo',
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
}

const extensionOf = (path: string): string => {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    const dot = name.lastIndexOf('.')
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

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

const buildEntry = async (descr: RouteInfo, path: string, opts: CatalogBuildOptions): Promise<{ entry: CatalogEntry, handles: MediaState['handles'] }> => {
    const handles: MediaState['handles'] = []
    const videoHandle = opts.makeHandle('v', path)
    handles.push({ handle: videoHandle, path, contentType: VIDEO_TYPES[extensionOf(path)] })

    let thumbHandle: string | undefined
    const thumbPath = fileUrlToPath(descr.previewUrl)
    if (thumbPath) {
        thumbHandle = opts.makeHandle('t', thumbPath)
        handles.push({ handle: thumbHandle, path: thumbPath, contentType: IMAGE_TYPES[extensionOf(thumbPath)] })
    }

    const entry: CatalogEntry = {
        routeKey: getRouteKey(descr, opts.linkId),
        routeIdOnComputer: descr.id!,
        title: descr.title ?? '',
        videoHandle,
        videoFormat: descr.videoFormat ?? extensionOf(path),
        size: (await opts.stat(path)) ?? 0,
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
    return { entry, handles }
}

/**
 * Builds the catalog document and the handle table from the route descriptions.
 * Routes whose key already occurred are skipped; entries are sorted by key so that the
 * catalog version only changes when the content does.
 */
export const buildCatalog = async (descriptions: RouteInfo[], opts: CatalogBuildOptions): Promise<CatalogBuild> => {
    const seen = new Set<string>()
    const candidates: Array<{ descr: RouteInfo, path: string }> = []
    for (const descr of descriptions) {
        if (!isShareable(descr) || !descr.id)
            continue
        const key = getRouteKey(descr, opts.linkId)
        if (seen.has(key))
            continue
        seen.add(key)
        candidates.push({ descr, path: getLocalVideoPath(descr)! })
    }

    const built: Array<{ entry: CatalogEntry, handles: MediaState['handles'] }> = []
    for (let i = 0; i < candidates.length; i += STAT_CONCURRENCY) {
        const chunk = candidates.slice(i, i + STAT_CONCURRENCY)
        built.push(...await Promise.all(chunk.map(c => buildEntry(c.descr, c.path, opts))))
    }
    built.sort((a, b) => (a.entry.routeKey < b.entry.routeKey ? -1 : Number(a.entry.routeKey > b.entry.routeKey)))

    const routes = built.map(b => b.entry)
    const catalogVersion = opts.hash(canonicalJson(routes))
    return { document: { catalogVersion, routes }, handles: built.flatMap(b => b.handles) }
}
