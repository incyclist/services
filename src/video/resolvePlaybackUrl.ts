/**
 * Rewrites a route's stored video URL into the scheme actually used for playback.
 *
 * On desktop, native (non-avi) video playback uses a custom `video:` protocol instead of
 * `file:` for local files. This matters beyond just routing: Chromium treats `file:` as a
 * special scheme with lenient path normalization (e.g. collapses extra leading slashes),
 * while a custom, non-special scheme like `video:` does not get that normalization and is
 * passed through to the registered protocol handler literally. A malformed URL with an
 * extra slash can therefore fail to load via `video:` while playing back fine via `file:`.
 *
 * Extracted out of RLVDisplayService.cleanupUrl() so any other code that needs to know what
 * URL a real ride would actually use - such as VideoProbe's pre-flight decode check - stays
 * in sync with it rather than duplicating (and inevitably drifting from) this logic.
 */
export const resolvePlaybackUrl = (url?: string, isMobile = false): string | undefined => {
    if (!url)
        return undefined

    let fileName = url
    const lc = url.toLowerCase()

    if (fileName.startsWith('incyclist:'))
        fileName = fileName.replace('incyclist:', 'file:')

    if (fileName.startsWith('video:') && !lc.endsWith('.avi'))
        return fileName.replace('video:', 'file:')

    if (fileName.startsWith('file:') && !lc.endsWith('.avi') && !isMobile)
        return fileName.replace('file:', 'video:')

    if (fileName.startsWith('video:') && lc.endsWith('.avi'))
        return fileName

    if (fileName.startsWith('file:') || fileName.startsWith('http:') || fileName.startsWith('https:') || fileName.startsWith('/'))
        return fileName

    if (fileName.startsWith('content:'))
        return fileName

    return `./${fileName}`
}
