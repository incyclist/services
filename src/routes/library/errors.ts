import type { ExternalFileScope } from '../../fileaccess/types'
import type { RouteImportErrorCode, RouteImportFailure } from './types'

/**
 * Why one route file could not be imported: the free-text reason (kept for logs and for
 * consumers that already show it) plus a stable `RouteImportErrorCode`, so a UI can map the
 * failure to its own copy instead of matching on the text.
 *
 * Thrown by the single-route import path (`RouteLibraryScannerService.importRouteFile()`),
 * which serves both the import dialog and files dropped onto the route list - so the same
 * failure carries the same code whichever way the file arrived.
 */
export class RouteImportError extends Error {
    readonly code: RouteImportErrorCode
    /** The extension of the file the route needs but that is missing (`MISSING_COMPANION` only) */
    readonly missingExt?: string

    constructor(message: string, code: RouteImportErrorCode, props?: { missingExt?: string }) {
        super(message)
        this.name = 'RouteImportError'
        this.code = code
        this.missingExt = props?.missingExt
    }

    /** The failure as plain data, e.g. for display props that must survive a copy. */
    toFailure(): RouteImportFailure {
        const failure: RouteImportFailure = { code: this.code, reason: this.message }
        if (this.missingExt)
            failure.missingExt = this.missingExt
        return failure
    }
}

/**
 * Classifies a parse/read failure into a stable `RouteImportErrorCode`.
 *
 * A file that could not be made available locally is recorded in the parse scope, which
 * says exactly why - that takes precedence. Every other failure is classified from its
 * message.
 *
 * @param err the failure
 * @param scope the external-file scope the failing parse ran in, if any
 * @returns the error code - `UNSUPPORTED` when nothing more specific applies
 */
export const mapErrorToImportCode = (err: unknown, scope?: ExternalFileScope): RouteImportErrorCode => {
    if (err instanceof RouteImportError)
        return err.code

    switch (scope?.lastFailure?.reason) {
        case 'offline':
            return 'ICLOUD_OFFLINE'
        case 'timeout':
        case 'download-failed':
            return 'ICLOUD_DOWNLOAD_FAILED'
        case 'access-lost':
            return 'READ_FAILED'
    }

    const message = errorText(err)

    if (/AVI/i.test(message))
        return 'AVI_NOT_SUPPORTED'
    if (/no video|video file not found/i.test(message))
        return 'NO_VIDEO'
    if (/^Could not (open|read)/i.test(message))
        return 'READ_FAILED'
    if (/pars(e|ing)/i.test(message))
        return 'PARSE_FAILED'

    return 'UNSUPPORTED'
}

/**
 * Normalises any failure of a single-route import to a `RouteImportError`.
 *
 * @param err the failure
 * @param scope the external-file scope the failing parse ran in, if any
 * @param message the text to report instead of the error's own message (e.g. a read failure
 *  that the scope explains better than the parser did)
 * @returns the error itself when it already is one, otherwise a new, classified one
 */
// what an error says - its message, or the error itself when it is a plain string
const errorText = (err: unknown): string => (err as Error)?.message ?? (typeof err === 'string' ? err : '')

export const toRouteImportError = (err: unknown, scope?: ExternalFileScope, message?: string): RouteImportError => {
    if (err instanceof RouteImportError)
        return err

    const text = message ?? errorText(err)
    return new RouteImportError(text, mapErrorToImportCode(err, scope))
}
