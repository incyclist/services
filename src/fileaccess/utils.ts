import type { FileLocation } from "../api/fileAccess/types"

/**
 * Path helpers for the folder-grant layer.
 *
 * Everything here is pure and synchronous: no bindings, no file system, no native calls.
 * The platform hands us the same folder back in a number of spellings (percent-encoded,
 * `file://`-prefixed, with a `/private` prefix, with duplicate separators), and a grant for
 * a folder has to be recognised as covering a file below it regardless of the spelling used.
 */

/** Schemes that never denote a local file, so they can never be covered by a folder grant. */
const REMOTE_SCHEMES = ['http://', 'https://', 'content://', 'ftp://', 'ftps://']

/** Schemes that wrap a plain local path. */
const LOCAL_SCHEMES = ['file://', 'video://']

const SEPARATOR = '/'

export const isRemoteUrl = (url?: string): boolean => {
    if (!url)
        return false
    const lower = url.trim().toLowerCase()
    return REMOTE_SCHEMES.some(scheme => lower.startsWith(scheme))
}

const decodeOnce = (value: string): string => {
    try {
        return decodeURIComponent(value)
    }
    catch {
        // not a valid escape sequence - a literal '%' in a file name
        return value
    }
}

const stripLocalScheme = (value: string): string => {
    const lower = value.toLowerCase()
    const scheme = LOCAL_SCHEMES.find(s => lower.startsWith(s))
    if (!scheme)
        return value
    return value.substring(scheme.length)
}

/**
 * Brings a path or local file URL into the one spelling everything else compares against:
 * decoded, scheme-less, single separators, no trailing separator, `/private/var` folded onto
 * `/var`, NFC-normalised.
 *
 * Returns `undefined` for remote URLs (http/https/content/ftp) and for empty input - those are
 * never local paths and can never be covered by a grant.
 */
export const canonicalPath = (url?: string): string | undefined => {
    if (!url)
        return undefined

    let path = url.trim()
    if (!path || isRemoteUrl(path))
        return undefined

    path = decodeOnce(stripLocalScheme(path))

    // a Windows path from a three-slash file URL keeps its drive letter, not a leading separator
    if (/^\/[A-Za-z]:/.exec(path))
        path = path.substring(1)

    path = path.replace(/\/{2,}/g, SEPARATOR)

    if (path.length > 1) {
        let end = path.length
        while (end > 1 && path[end - 1] === SEPARATOR)
            end--
        path = path.slice(0, end)
    }

    if (!path)
        return undefined

    // on iOS the same volume is reachable as /var/... and as /private/var/...
    if (path === '/private/var')
        path = '/var'
    else if (path.startsWith('/private/var/'))
        path = path.substring('/private'.length)

    return path.normalize('NFC')
}

/**
 * Whether `child` is `parent` itself or lies below it. Matching is on segment boundaries, so
 * `/Videos2` is not below `/Videos`. Both arguments must already be canonical.
 */
export const isSamePathOrBelow = (parent?: string, child?: string): boolean => {
    if (!parent || !child)
        return false
    if (parent === child)
        return true
    const prefix = parent.endsWith(SEPARATOR) ? parent : `${parent}${SEPARATOR}`
    return child.startsWith(prefix)
}

/** The folder containing `path`, or undefined if there is none. `path` must be canonical. */
export const parentFolder = (path?: string): string | undefined => {
    if (!path)
        return undefined
    const idx = path.lastIndexOf(SEPARATOR)
    if (idx < 0)
        return undefined
    if (idx === 0)
        return path.length > 1 ? SEPARATOR : undefined
    return path.substring(0, idx)
}

/**
 * The deepest folder that contains all of `paths`. Used to pick the single folder whose
 * re-selection restores the largest number of routes at once.
 */
export const lowestCommonAncestor = (paths: Array<string | undefined>): string | undefined => {
    const valid = paths.filter((p): p is string => !!p)
    if (valid.length === 0)
        return undefined

    const split = valid.map(p => p.split(SEPARATOR))
    let common = split[0]

    for (const segments of split.slice(1)) {
        const max = Math.min(common.length, segments.length)
        let matched = 0
        while (matched < max && common[matched] === segments[matched])
            matched++
        common = common.slice(0, matched)
        if (common.length === 0)
            break
    }

    if (common.length === 0)
        return undefined

    const result = common.join(SEPARATOR)
    // an absolute path shares only its empty leading segment -> the root
    return result === '' ? SEPARATOR : result
}

/** How many trailing segments of a folder are worth showing to the user. */
const MAX_DISPLAY_SEGMENTS = 3

const ICLOUD_CONTAINER = 'com~apple~CloudDocs'
const ICLOUD_ROOT_MARKER = 'Mobile Documents'
const ICLOUD_ROOT_LABEL = 'iCloud Drive'

/**
 * A short, readable form of a folder for use in user-facing text ("iCloud Drive › Videos").
 * The container plumbing above the user's own folders carries no meaning for them, so it is
 * replaced by the name they see in the Files app.
 */
export const buildDisplayPath = (folder?: string, location?: FileLocation): string => {
    if (!folder)
        return ''

    const segments = folder.split(SEPARATOR).filter(s => s.length > 0)

    const containerIdx = segments.indexOf(ICLOUD_CONTAINER)
    const markerIdx = segments.indexOf(ICLOUD_ROOT_MARKER)
    const cloudRootIdx = containerIdx >= 0 ? containerIdx : markerIdx

    const isCloud = cloudRootIdx >= 0 || location === 'icloud'
    const rootLabel = isCloud ? ICLOUD_ROOT_LABEL : undefined

    let rest = cloudRootIdx >= 0
        ? segments.slice(cloudRootIdx + 1)
        : segments.slice(-MAX_DISPLAY_SEGMENTS)

    if (rest.length > MAX_DISPLAY_SEGMENTS)
        rest = rest.slice(-MAX_DISPLAY_SEGMENTS)

    const parts = rootLabel ? [rootLabel, ...rest] : rest
    return parts.join(' › ')
}
