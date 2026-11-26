import { isWindows } from '../utils/fileurl'

/**
 * Rewrites a route's stored video URL into the scheme actually used for playback.
 *
 * Non-avi local mp4 playback always uses `file:`, never the desktop-only `video:` custom
 * protocol - that protocol is registered via Electron's legacy `protocol.registerFileProtocol`,
 * which can't serve HTTP range/seek requests, so it fails to open large and/or non-"faststart"
 * files (FIXES_BACKLOG #83/#85). Chromium's own `file:` loader has real range/seek support and
 * also tolerates malformed paths (e.g. an extra leading slash) that the custom scheme does not,
 * so any route-stored `video:` mp4 URL is rewritten back to `file:` too. `video:` is kept only
 * for `.avi`, which feeds the ffmpeg conversion pipeline rather than direct playback.
 *
 * Extracted out of RLVDisplayService.cleanupUrl() so any other code that needs to know what
 * URL a real ride would actually use - such as VideoProbe's pre-flight decode check - stays
 * in sync with it rather than duplicating (and inevitably drifting from) this logic.
 */
export const resolvePlaybackUrl = (url?: string): string | undefined => {
    if (!url)
        return undefined

    let fileName = url
    const lc = url.toLowerCase()

    if (fileName.startsWith('incyclist:'))
        fileName = fileName.replace('incyclist:', 'file:')

    if (fileName.startsWith('video:') && !lc.endsWith('.avi'))
        return restoreWindowsSeparators(fileName.replace('video:', 'file:'))

    if (fileName.startsWith('video:') && lc.endsWith('.avi'))
        return fileName

    if (fileName.startsWith('file:'))
        return restoreWindowsSeparators(fileName)

    if (fileName.startsWith('http:') || fileName.startsWith('https:') || fileName.startsWith('/'))
        return fileName

    if (fileName.startsWith('content:'))
        return fileName

    return `./${fileName}`
}

/**
 * Chromium's file: loader refuses percent-encoded path separators on Windows, so a stored
 * `file:///C:%5CVideos%5Ca.mp4` (encodeURI of a backslash path) fails with "Format error" /
 * "URL safety check", while `file:///C:\Videos\a.mp4` plays. Restores the separators of a
 * drive-letter path. Windows only; every other URL is returned as it is.
 */
const restoreWindowsSeparators = (url: string): string => {
    if (!isWindows() || !/^file:\/\/\/[A-Za-z]:/.test(url))
        return url
    return url.replace(/%5C/gi, '\\')
}
