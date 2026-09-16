import type { FileLocation } from "../api/fileAccess/types"

/**
 * Types for the folder-grant layer: which folders outside the app sandbox the app is still
 * allowed to read, and what to do when it isn't.
 *
 * All of this is inert when `getBindings().fileAccess` is absent or unsupported - on those
 * platforms external paths are simply readable and no grant is ever needed.
 */

/** Result of probing whether a path can currently be read. */
export type AccessState =
    | { state: 'readable' }
    /** `transient` means the loss is expected to resolve on its own (e.g. signed out of the cloud account). */
    | { state: 'access-lost', transient: boolean, location: FileLocation }
    | { state: 'not-found' }
    | { state: 'unknown' }

/** The folder the user should be asked to re-select, and how many routes that would fix. */
export interface AccessTarget {
    folder: string
    displayPath: string
    location: FileLocation
    /** Other affected routes below `folder`; an upper bound, computed from paths only. */
    siblingCount: number
}

export interface ConfirmAccessResult {
    outcome: 'confirmed' | 'cancelled' | 'wrong-folder'
    coversRoute: boolean
    restoredCount: number
}

/** A persisted grant record. Local only - never synced, never exported. */
export interface FolderAccessGrant {
    folder: string
    grant?: string
    displayName?: string
    location?: FileLocation
    source: 'pick' | 'captured'
    createdAt: number
    renewedAt?: number
    lastError?: string
}

/**
 * Outcome of making sure an external file's content is present locally (§ companion files at
 * import). `downloaded` says whether a transfer actually had to happen.
 */
export type EnsureLocalResult =
    | { ok: true, downloaded: boolean, waitedMs: number }
    | {
        ok: false,
        reason: 'offline' | 'timeout' | 'access-lost' | 'not-found' | 'download-failed' | 'cancelled',
        code?: number,
        domain?: string
      }

export interface EnsureLocalOptions {
    timeoutMs?: number
    isCancelled?: () => boolean
}
