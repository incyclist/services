import type { FileInfo, FileLoaderResult, IFileLoader } from '../api'
import { useExternalFileService } from './externalFiles'
import type { EnsureLocalFailure } from './types'

/**
 * Wraps a platform file loader so that a file living outside the app sandbox is present
 * locally before it is read. The only case this actually does anything for today is a
 * not-yet-downloaded file in an iCloud folder; every other location (app storage, on-device,
 * NAS, http(s), Android content://) and every platform without a `fileAccess` binding resolve
 * immediately, in which case this is a pure pass-through to `inner.open(file)`.
 *
 * Composed by the app that needs it (iOS) when it registers its loader binding, so no code
 * calling `getBindings().loader.open()` needs to know this exists.
 *
 * A file that cannot be made available is reported the same way the inner loader reports a
 * failed read - `{ error: { key, message } }`. This never throws, and never changes the
 * result of a successful read.
 */
export const withExternalFileAccess = (inner: IFileLoader): IFileLoader => ({

    async open(file: FileInfo): Promise<FileLoaderResult> {
        const service = useExternalFileService()
        const scope = service.getActiveScope()
        const path = file?.filename ?? file?.url

        let result
        try {
            scope?.beginWait()
            result = await service.ensureLocal(path, { isCancelled: () => scope?.isCancelled() ?? false })
        }
        finally {
            scope?.endWait()
        }

        if (result.ok)
            return inner.open(file)

        // The project's tsconfig doesn't enable strictNullChecks, so `if (result.ok)` above
        // doesn't narrow the union for the compiler - cast explicitly instead.
        const failure = result as EnsureLocalFailure

        scope?.recordFailure(path, failure)

        return { error: { key: failure.reason, message: describe(failure, path) } }
    }

})

const describe = (failure: EnsureLocalFailure, path: string): string => {
    switch (failure.reason) {
        case 'offline':
            return `Could not download '${path}': no internet connection`
        case 'timeout':
        case 'download-failed':
            return `Could not download '${path}'`
        case 'cancelled':
            return `Could not open file: ${path} (cancelled)`
        default:
            return `Could not open file: ${path}`
    }
}
