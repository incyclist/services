import { Inject } from '../base/decorators'
import { useExternalFileService } from './externalFiles'
import { withExternalFileAccess } from './loader'
import { createFileAccessBindingMock, FileAccessBindingMock } from '../../__tests__/utils/fileAccessMock'
import type { FileInfo, IFileLoader } from '../api'
import type { ExternalFileScope } from './types'

describe('withExternalFileAccess', () => {

    const file: FileInfo = {
        type: 'file', filename: '/icloud/routes/route.xml', name: 'route', base: 'route.xml',
        ext: 'xml', dir: '/icloud/routes', url: undefined, delimiter: '/'
    }

    const notDownloaded = { isUbiquitous: true, downloadStatus: 'not-downloaded' as const, isDownloading: false, downloadRequested: false }
    const downloaded = { isUbiquitous: true, downloadStatus: 'downloaded' as const, isDownloading: false, downloadRequested: false }

    let binding: FileAccessBindingMock
    let inner: IFileLoader & { open: jest.Mock }
    let loader: IFileLoader
    let onlineStatus: { onlineStatus: boolean|undefined }
    let scope: ExternalFileScope|undefined

    beforeEach(() => {
        binding = createFileAccessBindingMock({ classifyLocation: jest.fn().mockReturnValue('icloud') })
        onlineStatus = { onlineStatus: true }

        Inject('Bindings', { fileAccess: binding })
        Inject('OnlineStatus', onlineStatus)

        inner = { open: jest.fn().mockResolvedValue({ data: '<xml/>' }) }
        loader = withExternalFileAccess(inner)
    })

    afterEach(() => {
        scope?.end()
        scope = undefined
        useExternalFileService()['reset']?.()
        Inject('Bindings', null)
        Inject('OnlineStatus', null)
        jest.clearAllMocks()
        jest.useRealTimers()
    })

    const openScope = (isCancelled?: () => boolean) => {
        scope = useExternalFileService().beginScope({ isCancelled })
        return scope
    }

    describe('pass-through', () => {

        test('no fileAccess binding -> delegates to the inner loader untouched', async () => {
            Inject('Bindings', {})

            const res = await loader.open(file)

            expect(inner.open).toHaveBeenCalledTimes(1)
            expect(inner.open).toHaveBeenCalledWith(file)
            expect(res).toEqual({ data: '<xml/>' })
        })

        test('binding unsupported -> delegates to the inner loader untouched', async () => {
            binding.isSupported.mockReturnValue(false)

            const res = await loader.open(file)

            expect(inner.open).toHaveBeenCalledWith(file)
            expect(res).toEqual({ data: '<xml/>' })
        })

        test('non-icloud file -> delegates to the inner loader untouched', async () => {
            binding.classifyLocation.mockReturnValue('on-device')

            const res = await loader.open(file)

            expect(inner.open).toHaveBeenCalledWith(file)
            expect(binding.getAvailability).not.toHaveBeenCalled()
            expect(res).toEqual({ data: '<xml/>' })
        })

        test('iCloud file already local -> delegates, and the inner result is returned unchanged', async () => {
            binding.getAvailability.mockResolvedValue(downloaded)
            inner.open.mockResolvedValue({ data: Buffer.from('binary') })

            const res = await loader.open(file)

            expect(binding.startDownload).not.toHaveBeenCalled()
            expect(inner.open).toHaveBeenCalledWith(file)
            expect(res).toEqual({ data: Buffer.from('binary') })
        })

        test('an inner read failure is passed through as-is', async () => {
            binding.getAvailability.mockResolvedValue(downloaded)
            inner.open.mockResolvedValue({ error: { key: 'ENOENT', message: 'no such file' } })

            const res = await loader.open(file)

            expect(res).toEqual({ error: { key: 'ENOENT', message: 'no such file' } })
        })

        test('a file that had to be downloaded first is then read by the inner loader', async () => {
            binding.getAvailability
                .mockResolvedValueOnce(notDownloaded)
                .mockResolvedValue(downloaded)

            const res = await loader.open(file)

            expect(binding.startDownload).toHaveBeenCalledWith(file.filename)
            expect(inner.open).toHaveBeenCalledWith(file)
            expect(res).toEqual({ data: '<xml/>' })
        })
    })

    describe('failures', () => {

        test('offline -> {error} with the reason as key, inner loader never called', async () => {
            binding.getAvailability.mockResolvedValue(notDownloaded)
            onlineStatus.onlineStatus = false

            const res = await loader.open(file)

            expect(res.error?.key).toBe('offline')
            expect(res.error?.message).toContain('no internet connection')
            expect(res.data).toBeUndefined()
            expect(inner.open).not.toHaveBeenCalled()
        })

        test('the download itself fails -> {error} with key download-failed', async () => {
            binding.getAvailability.mockResolvedValue({
                ...notDownloaded,
                downloadError: { domain: 'NSURLErrorDomain', code: -1009 }
            })

            const res = await loader.open(file)

            expect(res.error?.key).toBe('download-failed')
            expect(inner.open).not.toHaveBeenCalled()
        })

        test('the download times out -> {error} with key timeout', async () => {
            jest.useFakeTimers()
            binding.getAvailability.mockResolvedValue(notDownloaded)

            const promise = loader.open(file)
            await jest.advanceTimersByTimeAsync(10_000)
            const res = await promise

            expect(res.error?.key).toBe('timeout')
            expect(inner.open).not.toHaveBeenCalled()
        })

        test('access lost -> {error} with key access-lost', async () => {
            binding.checkAccess.mockResolvedValue({ state: 'denied' })

            const res = await loader.open(file)

            expect(res.error?.key).toBe('access-lost')
            expect(inner.open).not.toHaveBeenCalled()
        })

        test('file gone -> {error} with key not-found', async () => {
            binding.checkAccess.mockResolvedValue({ state: 'not-found' })

            const res = await loader.open(file)

            expect(res.error?.key).toBe('not-found')
            expect(inner.open).not.toHaveBeenCalled()
        })

        test('the scope is cancelled -> {error} with key cancelled', async () => {
            binding.getAvailability.mockResolvedValue(notDownloaded)
            openScope(() => true)

            const res = await loader.open(file)

            expect(res.error?.key).toBe('cancelled')
            expect(inner.open).not.toHaveBeenCalled()
        })

        test('never throws - a binding that blows up still yields a FileLoaderResult', async () => {
            binding.getAvailability.mockRejectedValue(new Error('native crash'))

            const res = await loader.open(file)

            expect(res.error).toBeDefined()
            expect(inner.open).not.toHaveBeenCalled()
        })
    })

    describe('scope recording', () => {

        test('records the failure and the file it happened on', async () => {
            binding.getAvailability.mockResolvedValue(notDownloaded)
            onlineStatus.onlineStatus = false
            const active = openScope()

            await loader.open(file)

            expect(active.lastFailure).toEqual({ ok: false, reason: 'offline' })
            expect(active.failedFile).toBe(file.filename)
        })

        test('records nothing when the read succeeds', async () => {
            binding.getAvailability.mockResolvedValue(downloaded)
            const active = openScope()

            await loader.open(file)

            expect(active.lastFailure).toBeUndefined()
        })

        test('works without a scope - a read outside any scope is unaffected', async () => {
            binding.getAvailability.mockResolvedValue(notDownloaded)
            onlineStatus.onlineStatus = false

            const res = await loader.open(file)

            expect(res.error?.key).toBe('offline')
        })

        test('isWaiting is true only while a wait is running past the threshold', async () => {
            jest.useFakeTimers()
            binding.getAvailability.mockResolvedValue(notDownloaded)
            const active = openScope()

            expect(active.isWaiting(2000)).toBe(false)

            const promise = loader.open(file)
            await jest.advanceTimersByTimeAsync(1_000)
            expect(active.isWaiting(2000)).toBe(false)

            await jest.advanceTimersByTimeAsync(1_500)
            expect(active.isWaiting(2000)).toBe(true)

            await jest.advanceTimersByTimeAsync(10_000)
            await promise

            // the wait is over - even a failed one doesn't leave the scope 'waiting'
            expect(active.isWaiting(2000)).toBe(false)
        })

        test('isWaiting stays false for a read that never waits', async () => {
            jest.useFakeTimers()
            binding.classifyLocation.mockReturnValue('on-device')
            const active = openScope()

            // a slow read of a local file: the wait bracket is only around the availability
            // check, which returns immediately for a non-icloud path
            inner.open.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: 'x' }), 30_000)))

            const promise = loader.open(file)
            await jest.advanceTimersByTimeAsync(10_000)

            expect(active.isWaiting(2000)).toBe(false)

            await jest.advanceTimersByTimeAsync(30_000)
            await promise
        })

        test('an ended scope stops receiving records', async () => {
            binding.getAvailability.mockResolvedValue(notDownloaded)
            onlineStatus.onlineStatus = false
            const active = openScope()
            active.end()
            scope = undefined

            await loader.open(file)

            expect(active.lastFailure).toBeUndefined()
        })
    })
})
