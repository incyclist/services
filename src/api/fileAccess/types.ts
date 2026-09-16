/**
 * Platform binding for access to files that live outside the app sandbox.
 *
 * Implemented on iOS only (security-scoped bookmarks + iCloud/ubiquitous item metadata).
 * On every other platform the binding is simply absent, or `isSupported()` returns false;
 * all services built on top of it must then be completely inert.
 *
 * Grants are opaque, platform-defined tokens (base64 bookmark data on iOS). They are never
 * logged, never sent anywhere, and never interpreted outside the binding.
 */

/** Where a path physically lives - derived from the path alone, no I/O. */
export type FileLocation = 'app' | 'icloud' | 'on-device' | 'network' | 'other'

/** Result of a metadata-only access probe. Reading the file content is never attempted. */
export interface AccessProbeResult {
    state: 'readable' | 'denied' | 'not-found'
    errno?: number
}

/** Result of activating a stored grant. */
export interface GrantActivation {
    resolvedPath: string
    isStale: boolean
    /** Set when the platform handed back a refreshed grant that should replace the stored one. */
    renewedGrant?: string
}

/** Download state of a cloud-backed file. */
export type CloudDownloadStatus = 'current' | 'downloaded' | 'not-downloaded'

/** Metadata describing whether a file's content is locally present and how large it is. */
export interface FileAvailability {
    isUbiquitous: boolean
    downloadStatus?: CloudDownloadStatus
    isDownloading: boolean
    downloadRequested: boolean
    downloadError?: { domain: string, code: number }
    sizeBytes?: number
    allocatedBytes?: number
    volumeFreeBytes?: number
}

export interface IFileAccessBinding {
    isSupported(): boolean
    /** Sync, path-only classification - must not touch the file system. */
    classifyLocation(path: string): FileLocation

    // --- grants (opaque tokens; never logged) ---
    activateGrant(grant: string): Promise<GrantActivation>
    deactivateGrant(resolvedPath: string): Promise<void>
    captureGrant(folderPath: string): Promise<string | undefined>
    /** Metadata only - must never read file content and must never trigger a download. */
    checkAccess(path: string): Promise<AccessProbeResult>

    // --- cloud files ---
    /** Coordinated, metadata-only read with a timeout. */
    getAvailability(path: string): Promise<FileAvailability>
    startDownload(path: string): Promise<void>
    evict(path: string): Promise<void>
    /**
     * Whether a cloud identity is available. Resolves `undefined` when the platform cannot
     * tell, in which case callers fall back to a heuristic.
     */
    isCloudIdentityAvailable(): Promise<boolean | undefined>

    // --- private app storage ---
    /**
     * Returns (creating on demand) a private directory inside app storage that is not visible
     * to the user in a file browser.
     */
    getPrivateDir(name: 'previews'): Promise<string>
    /** Coordinated read of the source, write to a temp file, then atomic move onto the target. */
    copyFile(sourcePath: string, targetPath: string): Promise<void>
}
