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

export type EnsureLocalFailure = Extract<EnsureLocalResult, { ok: false }>

export interface EnsureLocalOptions {
    timeoutMs?: number
    isCancelled?: () => boolean
}

/**
 * One bracket around a single unit of work that reads external files - currently one route's
 * parse. It carries the cancellation check into `ensureLocal` and collects what the reads did,
 * so the caller that opened the scope can tell why a file could not be read even though the
 * read itself reports failures the ordinary way (`FileLoaderResult.error`).
 *
 * The scope is owned by whoever calls `beginScope()` and must be ended (`end()`), typically in
 * a `finally`.
 */
export interface ExternalFileScope {
    end(): void
    /** The last failed `ensureLocal` in this scope, if any. */
    readonly lastFailure?: EnsureLocalFailure
    /** The path of the file `lastFailure` refers to. */
    readonly failedFile?: string
    /** True while an `ensureLocal` wait is running and has been running longer than `thresholdMs`. */
    isWaiting(thresholdMs: number): boolean
    /** Whether the work this scope brackets has been cancelled. */
    isCancelled(): boolean
}

/**
 * The recording side of a scope, used by the loader decorator. Separate from `ExternalFileScope`
 * so the owner of a scope only sees the read-only view.
 */
export interface ExternalFileScopeRecorder extends ExternalFileScope {
    /** A read is now waiting for a file to be made available locally. */
    beginWait(): void
    endWait(): void
    recordFailure(file: string, failure: EnsureLocalFailure): void
}
