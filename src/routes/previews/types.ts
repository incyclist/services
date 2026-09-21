/** Why a preview could not be copied into the private store. */
export type PreviewCopyFailure =
    | 'offline'
    | 'timeout'
    | 'access-lost'
    | 'not-found'
    | 'download-failed'
    | 'cancelled'
    | 'too-large'
    | 'copy-failed'

export type PreviewCopyResult =
    | { ok: true, target: string }
    | { ok: false, reason: PreviewCopyFailure }

/**
 * What an adoption attempt did to a route description.
 *
 * - `skipped`  - nothing to do (no local source, store unavailable, already a store copy)
 * - `adopted`  - `previewUrl` now points at the private copy
 * - `hidden`   - `previewUrl` cleared and `previewSource` kept, so the route shows its fallback
 */
export type PreviewAdoptionOutcome = 'skipped' | 'adopted' | 'hidden'
