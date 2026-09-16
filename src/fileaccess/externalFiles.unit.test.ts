import { Inject } from '../base/decorators'
import { ExternalFileService, useExternalFileService } from './externalFiles'
import { createFileAccessBindingMock, FileAccessBindingMock } from '../../__tests__/utils/fileAccessMock'

describe('ExternalFileService', () => {
    let service: ExternalFileService
    let binding: FileAccessBindingMock
    let bindings: any
    let onlineStatus: { onlineStatus: boolean | undefined }

    beforeEach(() => {
        binding = createFileAccessBindingMock({
            classifyLocation: jest.fn().mockReturnValue('icloud')
        })
        bindings = { fileAccess: binding }
        onlineStatus = { onlineStatus: true }

        Inject('Bindings', bindings)
        Inject('OnlineStatus', onlineStatus)

        service = new ExternalFileService()
    })

    afterEach(() => {
        Inject('Bindings', null)
        Inject('OnlineStatus', null)
        jest.clearAllMocks()
        jest.useRealTimers()
    })

    const notDownloaded = { isUbiquitous: true, downloadStatus: 'not-downloaded' as const, isDownloading: false, downloadRequested: false }
    const downloaded = { isUbiquitous: true, downloadStatus: 'downloaded' as const, isDownloading: false, downloadRequested: false }

    test('binding absent -> ok, no native calls', async () => {
        Inject('Bindings', {})

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: true, downloaded: false, waitedMs: 0 })
    })

    test('binding unsupported -> ok, no native calls', async () => {
        binding.isSupported.mockReturnValue(false)

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: true, downloaded: false, waitedMs: 0 })
        expect(binding.checkAccess).not.toHaveBeenCalled()
    })

    test.each(['http://x/route.xml', 'https://x/route.xml', 'content://x/route.xml'])(
        'skips %s without calling the binding',
        async (path) => {
            const result = await service.ensureLocal(path)

            expect(result).toEqual({ ok: true, downloaded: false, waitedMs: 0 })
            expect(binding.classifyLocation).not.toHaveBeenCalled()
            expect(binding.checkAccess).not.toHaveBeenCalled()
        }
    )

    test('non-icloud location -> ok, no download/availability calls', async () => {
        binding.classifyLocation.mockReturnValue('on-device')

        const result = await service.ensureLocal('/on-device/route.xml')

        expect(result).toEqual({ ok: true, downloaded: false, waitedMs: 0 })
        expect(binding.checkAccess).not.toHaveBeenCalled()
        expect(binding.getAvailability).not.toHaveBeenCalled()
    })

    test('already downloaded -> ok without starting a download', async () => {
        binding.getAvailability.mockResolvedValue(downloaded)

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.downloaded).toBe(false)
        }
        expect(binding.startDownload).not.toHaveBeenCalled()
    })

    test('not-current but not ubiquitous -> ok without starting a download', async () => {
        binding.getAvailability.mockResolvedValue({ isUbiquitous: false, isDownloading: false, downloadRequested: false })

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual(expect.objectContaining({ ok: true, downloaded: false }))
        expect(binding.startDownload).not.toHaveBeenCalled()
    })

    test('not-downloaded, online -> starts the download, polls, resolves ok once local', async () => {
        binding.getAvailability
            .mockResolvedValueOnce(notDownloaded)
            .mockResolvedValueOnce(notDownloaded)
            .mockResolvedValueOnce(downloaded)

        jest.useFakeTimers()
        const promise = service.ensureLocal('/icloud/route.xml')

        await jest.advanceTimersByTimeAsync(300)
        await jest.advanceTimersByTimeAsync(1000)

        const result = await promise

        expect(binding.startDownload).toHaveBeenCalledWith('/icloud/route.xml')
        expect(result).toEqual(expect.objectContaining({ ok: true, downloaded: true }))
        expect(binding.getAvailability).toHaveBeenCalledTimes(3)
    })

    test('offline before starting -> fails fast, no download started', async () => {
        binding.getAvailability.mockResolvedValue(notDownloaded)
        onlineStatus.onlineStatus = false

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: false, reason: 'offline' })
        expect(binding.startDownload).not.toHaveBeenCalled()
    })

    test('goes offline mid-wait -> offline, after the download already started', async () => {
        binding.getAvailability.mockResolvedValue(notDownloaded)
        // flip offline only once the download is underway, so this genuinely exercises the
        // poll loop's offline check rather than the pre-download one
        binding.startDownload.mockImplementation(async () => { onlineStatus.onlineStatus = false })

        jest.useFakeTimers()
        const promise = service.ensureLocal('/icloud/route.xml')
        await jest.advanceTimersByTimeAsync(300)

        const result = await promise
        expect(result).toEqual({ ok: false, reason: 'offline' })
        expect(binding.startDownload).toHaveBeenCalled()
    })

    test('downloadError from the initial availability check -> download-failed', async () => {
        binding.getAvailability.mockResolvedValue({
            isUbiquitous: true, downloadStatus: 'not-downloaded', isDownloading: false, downloadRequested: false,
            downloadError: { domain: 'NSCocoaErrorDomain', code: 257 }
        })

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: false, reason: 'download-failed', code: 257, domain: 'NSCocoaErrorDomain' })
        expect(binding.startDownload).not.toHaveBeenCalled()
    })

    test('downloadError appearing while polling -> download-failed', async () => {
        binding.getAvailability
            .mockResolvedValueOnce(notDownloaded)
            .mockResolvedValueOnce({
                isUbiquitous: true, downloadStatus: 'not-downloaded', isDownloading: false, downloadRequested: false,
                downloadError: { domain: 'NSURLErrorDomain', code: -1009 }
            })

        jest.useFakeTimers()
        const promise = service.ensureLocal('/icloud/route.xml')
        await jest.advanceTimersByTimeAsync(300)

        const result = await promise
        expect(result).toEqual({ ok: false, reason: 'download-failed', code: -1009, domain: 'NSURLErrorDomain' })
    })

    test('times out after the configured budget', async () => {
        binding.getAvailability.mockResolvedValue(notDownloaded)

        jest.useFakeTimers()
        const promise = service.ensureLocal('/icloud/route.xml', { timeoutMs: 1000 })

        await jest.advanceTimersByTimeAsync(1000)

        const result = await promise
        expect(result).toEqual({ ok: false, reason: 'timeout' })
    })

    test('cancelled before starting the download', async () => {
        binding.getAvailability.mockResolvedValue(notDownloaded)

        const result = await service.ensureLocal('/icloud/route.xml', { isCancelled: () => true })

        expect(result).toEqual({ ok: false, reason: 'cancelled' })
        expect(binding.startDownload).not.toHaveBeenCalled()
    })

    test('cancelled while polling, after the download already started', async () => {
        binding.getAvailability.mockResolvedValue(notDownloaded)
        let cancelled = false
        binding.startDownload.mockImplementation(async () => { cancelled = true })

        jest.useFakeTimers()
        const promise = service.ensureLocal('/icloud/route.xml', { isCancelled: () => cancelled })
        await jest.advanceTimersByTimeAsync(300)

        const result = await promise
        expect(result).toEqual({ ok: false, reason: 'cancelled' })
        expect(binding.startDownload).toHaveBeenCalled()
    })

    test('access denied -> access-lost, no availability query', async () => {
        binding.checkAccess.mockResolvedValue({ state: 'denied' })

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: false, reason: 'access-lost' })
        expect(binding.getAvailability).not.toHaveBeenCalled()
    })

    test('file missing -> not-found, no availability query', async () => {
        binding.checkAccess.mockResolvedValue({ state: 'not-found' })

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: false, reason: 'not-found' })
        expect(binding.getAvailability).not.toHaveBeenCalled()
    })

    test('a thrown/rejected binding call is reported as download-failed, never crashes', async () => {
        binding.checkAccess.mockRejectedValue(new Error('native crash'))

        const result = await service.ensureLocal('/icloud/route.xml')

        expect(result).toEqual({ ok: false, reason: 'download-failed' })
    })

    test('useExternalFileService() returns the same singleton instance', () => {
        expect(useExternalFileService()).toBe(useExternalFileService())
    })
})
