import { EventEmitter } from 'node:events'

import { createFileAccessBindingMock, FileAccessBindingMock } from '../../../__tests__/utils/fileAccessMock'
import type { FileLocation } from '../../api/fileAccess/types'
import type { RouteInfo } from '../base/types'
import { PreviewStore } from './store'

const STORE_DIR = '/private/previews'

/** Path-only classification, mirroring what the real binding does from path markers alone. */
const classify = (path: string): FileLocation => {
    if (path.startsWith('/private')) return 'app'
    if (path.startsWith('/app')) return 'app'
    if (path.startsWith('/icloud')) return 'icloud'
    if (path.startsWith('/device')) return 'on-device'
    if (path.startsWith('/nas')) return 'network'
    return 'other'
}

const route = (id: string, extra: Partial<RouteInfo> = {}): RouteInfo =>
    ({ id, title: `route ${id}`, hasVideo: true, ...extra } as RouteInfo)

describe('PreviewStore', () => {

    let store: any
    let binding: FileAccessBindingMock
    let descriptions: Array<RouteInfo>
    let cards: Record<string, { emitUpdate: jest.Mock }>
    let repo: { save: jest.Mock }
    let externalFiles: { ensureLocal: jest.Mock }
    let folderAccess: EventEmitter
    let fs: { readdir: jest.Mock, deleteFile: jest.Mock }
    let storeFiles: Array<string>
    let logged: Array<any>

    const setup = (props: {
        routes?: Array<RouteInfo>,
        files?: Array<string>,
        bindingOverrides?: Partial<FileAccessBindingMock>,
        noBinding?: boolean,
        noFs?: boolean
    } = {}) => {

        binding = createFileAccessBindingMock(props.bindingOverrides)
        binding.classifyLocation.mockImplementation(classify)
        binding.getPrivateDir.mockResolvedValue(STORE_DIR)

        descriptions = props.routes ?? []
        storeFiles = props.files ?? []

        cards = {}
        descriptions.forEach(d => { cards[d.id] = { emitUpdate: jest.fn() } })

        repo = { save: jest.fn().mockResolvedValue(undefined) }
        externalFiles = { ensureLocal: jest.fn().mockResolvedValue({ ok: true, downloaded: false, waitedMs: 0 }) }
        folderAccess = new EventEmitter()
        fs = {
            readdir: jest.fn(async () => [...storeFiles]),
            deleteFile: jest.fn(async (path: string) => {
                storeFiles = storeFiles.filter(name => `${STORE_DIR}/${name}` !== path)
            })
        }
        logged = []

        store = new PreviewStore()
        store.inject('Bindings', {
            fileAccess: props.noBinding ? undefined : binding,
            fs: props.noFs ? undefined : fs
        })
        store.inject('RouteList', {
            getAllRoutes: jest.fn(() => descriptions.map(description => ({ description }))),
            getCard: jest.fn((id: string) => cards[id])
        })
        store.inject('Repo', repo)
        store.inject('ExternalFiles', externalFiles)
        store.inject('FolderAccess', folderAccess)
        store.logEvent = (event: any) => { logged.push(event) }

        return store
    }

    afterEach(() => {
        store?.reset()
        store = undefined
    })

    // ---------------------------------------------------------------- inertness

    describe('without the binding', () => {

        test('every method is a safe no-op and previewUrl is left exactly as imported', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ noBinding: true, routes: [descr], files: ['route-1.png', 'route-9.png'] })

            expect(store.isEnabled()).toBe(false)

            await store.adoptOnImport({ description: descr })
            await store.adoptPending()
            await store.adoptGenerated(descr, '/app/cache/thumb.png')
            await store.release('1')
            await store.sweepOrphans()

            expect(descr.previewUrl).toBe('/icloud/Videos/A/preview.png')
            expect(descr.previewSource).toBeUndefined()
            expect(fs.deleteFile).not.toHaveBeenCalled()
            expect(fs.readdir).not.toHaveBeenCalled()
            expect(repo.save).not.toHaveBeenCalled()
            expect(externalFiles.ensureLocal).not.toHaveBeenCalled()
        })

        test('a screenshot is never blocked', async () => {
            setup({ noBinding: true })
            expect(await store.isScreenshotAllowed(route('1', { videoUrl: '/icloud/Videos/A/a.mp4' }))).toBe(true)
        })

        test('an unsupported binding is treated the same way', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({
                bindingOverrides: { isSupported: jest.fn().mockReturnValue(false) },
                routes: [descr]
            })

            await store.adoptOnImport({ description: descr })
            await store.adoptPending()
            await store.release('1')
            await store.sweepOrphans()

            expect(store.isEnabled()).toBe(false)
            expect(descr.previewUrl).toBe('/icloud/Videos/A/preview.png')
            expect(binding.getPrivateDir).not.toHaveBeenCalled()
            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(await store.isScreenshotAllowed(route('1', { videoUrl: '/icloud/Videos/A/a.mp4' }))).toBe(true)
        })
    })

    // ---------------------------------------------------------------- adoptOnImport

    describe('adoptOnImport', () => {

        test('copies the preview into the store and points previewUrl at the copy', async () => {
            const descr = route('1', { previewUrl: 'file:///icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })

            await store.adoptOnImport({ description: descr })

            expect(externalFiles.ensureLocal).toHaveBeenCalledWith('/icloud/Videos/A/preview.png')
            expect(binding.copyFile).toHaveBeenCalledWith('/icloud/Videos/A/preview.png', `${STORE_DIR}/route-1.png`)
            expect(descr.previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
            expect(descr.previewSource).toBeUndefined()
        })

        test('accepts a description and an explicit source', async () => {
            const descr = route('1')
            setup({ routes: [descr] })

            await store.adoptOnImport(descr, '/icloud/Videos/A/route_preview.JPG')

            expect(binding.copyFile).toHaveBeenCalledWith('/icloud/Videos/A/route_preview.JPG', `${STORE_DIR}/route-1.jpg`)
            expect(descr.previewUrl).toBe(`file://${STORE_DIR}/route-1.jpg`)
        })

        test('a failed download hides the preview, keeps the source and does not throw', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })
            externalFiles.ensureLocal.mockResolvedValue({ ok: false, reason: 'offline' })

            await expect(store.adoptOnImport({ description: descr })).resolves.toBeUndefined()

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(descr.previewUrl).toBeUndefined()
            expect(descr.previewSource).toBe('/icloud/Videos/A/preview.png')
            expect(logged.find(e => e.message === 'preview copy failed')?.reason).toBe('offline')
        })

        test('a failing copy does not throw either', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })
            binding.copyFile.mockRejectedValue(new Error('EPERM'))

            await expect(store.adoptOnImport({ description: descr })).resolves.toBeUndefined()

            expect(descr.previewUrl).toBeUndefined()
            expect(descr.previewSource).toBe('/icloud/Videos/A/preview.png')
        })

        test('an unavailable store directory leaves the description untouched', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })
            binding.getPrivateDir.mockRejectedValue(new Error('no such directory'))

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(descr.previewUrl).toBe('/icloud/Videos/A/preview.png')
        })

        test('a source larger than 20MB is not copied', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })
            binding.getAvailability.mockResolvedValue({
                isUbiquitous: true, downloadStatus: 'current', isDownloading: false,
                downloadRequested: false, sizeBytes: 20 * 1024 * 1024 + 1
            })

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(descr.previewUrl).toBeUndefined()
            expect(descr.previewSource).toBe('/icloud/Videos/A/preview.png')
            expect(logged.find(e => e.message === 'preview copy failed')?.reason).toBe('too-large')
        })

        test('a source of exactly 20MB is still copied', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })
            binding.getAvailability.mockResolvedValue({
                isUbiquitous: true, downloadStatus: 'current', isDownloading: false,
                downloadRequested: false, sizeBytes: 20 * 1024 * 1024
            })

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).toHaveBeenCalled()
            expect(descr.previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
        })

        test('re-importing the same route overwrites its copy and drops another extension', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.jpg' })
            setup({ routes: [descr], files: ['route-1.png', 'route-2.png'] })

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).toHaveBeenCalledWith('/icloud/Videos/A/preview.jpg', `${STORE_DIR}/route-1.jpg`)
            expect(fs.deleteFile).toHaveBeenCalledTimes(1)
            expect(fs.deleteFile).toHaveBeenCalledWith(`${STORE_DIR}/route-1.png`)
        })

        test('an unknown source extension is stored as png', async () => {
            const descr = route('1')
            setup({ routes: [descr] })

            await store.adoptOnImport(descr, '/icloud/Videos/A/preview')

            expect(binding.copyFile).toHaveBeenCalledWith('/icloud/Videos/A/preview', `${STORE_DIR}/route-1.png`)
        })

        test('a preview served over https is left alone', async () => {
            const descr = route('1', { previewUrl: 'https://incyclist.com/preview.jpg' })
            setup({ routes: [descr] })

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(descr.previewUrl).toBe('https://incyclist.com/preview.jpg')
            expect(descr.previewSource).toBeUndefined()
        })

        test('a preview that is already a store copy is not copied again', async () => {
            const descr = route('1', { previewUrl: `${STORE_DIR}/route-1.png` })
            setup({ routes: [descr] })

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(descr.previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
        })

        test('a route without any preview is a no-op', async () => {
            const descr = route('1')
            setup({ routes: [descr] })

            await store.adoptOnImport({ description: descr })

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(descr.previewUrl).toBeUndefined()
        })
    })

    // ---------------------------------------------------------------- adoptPending

    describe('adoptPending', () => {

        test('copies the preview of a legacy route and saves the description', async () => {
            const legacy = route('1', { previewUrl: 'file:///icloud/Videos/A/preview.png' })
            setup({ routes: [legacy] })

            await store.adoptPending()

            expect(binding.copyFile).toHaveBeenCalledWith('/icloud/Videos/A/preview.png', `${STORE_DIR}/route-1.png`)
            expect(legacy.previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
            expect(repo.save).toHaveBeenCalledTimes(1)
            expect(cards['1'].emitUpdate).toHaveBeenCalled()
        })

        test('a route whose preview is no longer readable shows the fallback and keeps the source', async () => {
            const legacy = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [legacy] })
            externalFiles.ensureLocal.mockResolvedValue({ ok: false, reason: 'access-lost' })

            await store.adoptPending()

            expect(legacy.previewUrl).toBeUndefined()
            expect(legacy.previewSource).toBe('/icloud/Videos/A/preview.png')
            expect(repo.save).toHaveBeenCalledTimes(1)
            expect(cards['1'].emitUpdate).toHaveBeenCalled()
        })

        test('a route with a pending source is retried', async () => {
            const pending = route('1', { previewSource: '/icloud/Videos/A/preview.png' })
            setup({ routes: [pending] })

            await store.adoptPending()

            expect(binding.copyFile).toHaveBeenCalledWith('/icloud/Videos/A/preview.png', `${STORE_DIR}/route-1.png`)
            expect(pending.previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
            expect(pending.previewSource).toBeUndefined()
        })

        test('routes already stored, remote or without a preview are not candidates', async () => {
            setup({
                routes: [
                    route('1', { previewUrl: `file://${STORE_DIR}/route-1.png` }),
                    route('2', { previewUrl: 'https://incyclist.com/preview.jpg' }),
                    route('3')
                ]
            })

            await store.adoptPending()

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(repo.save).not.toHaveBeenCalled()
            expect(externalFiles.ensureLocal).not.toHaveBeenCalled()
        })

        test('one attempt per route per trigger', async () => {
            setup({ routes: [route('1', { previewUrl: '/icloud/Videos/A/preview.png' })] })
            externalFiles.ensureLocal.mockResolvedValue({ ok: false, reason: 'timeout' })

            await store.adoptPending()

            expect(externalFiles.ensureLocal).toHaveBeenCalledTimes(1)
        })

        test('at most two copies run at the same time', async () => {
            const routes = ['1', '2', '3', '4', '5']
                .map(id => route(id, { previewUrl: `/icloud/Videos/${id}/preview.png` }))
            setup({ routes })

            let inFlight = 0
            let maxInFlight = 0
            binding.copyFile.mockImplementation(async () => {
                inFlight++
                maxInFlight = Math.max(maxInFlight, inFlight)
                await new Promise(resolve => setTimeout(resolve, 1))
                inFlight--
            })

            await store.adoptPending()

            expect(binding.copyFile).toHaveBeenCalledTimes(5)
            expect(maxInFlight).toBe(2)
        })

        test('adopts the siblings that become readable on access-changed', async () => {
            const siblings = ['1', '2']
                .map(id => route(id, { previewSource: `/icloud/Videos/A/${id}.png` }))
            setup({ routes: siblings })
            externalFiles.ensureLocal.mockResolvedValue({ ok: false, reason: 'access-lost' })

            await store.adoptPending()
            expect(siblings.every(d => d.previewUrl === undefined)).toBe(true)

            externalFiles.ensureLocal.mockResolvedValue({ ok: true, downloaded: true, waitedMs: 10 })
            folderAccess.emit('access-changed', '/icloud/Videos')
            await new Promise(resolve => setImmediate(resolve))

            expect(siblings[0].previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
            expect(siblings[1].previewUrl).toBe(`file://${STORE_DIR}/route-2.png`)
        })

        test('a trigger arriving during a run gets its own pass', async () => {
            const descr = route('1', { previewUrl: '/icloud/Videos/A/preview.png' })
            setup({ routes: [descr] })

            let releaseFirstAttempt: (result: any) => void
            externalFiles.ensureLocal
                .mockImplementationOnce(() => new Promise(resolve => { releaseFirstAttempt = resolve }))
                .mockResolvedValue({ ok: true, downloaded: false, waitedMs: 0 })

            const first = store.adoptPending()
            await new Promise(resolve => setImmediate(resolve))
            const second = store.adoptPending()

            releaseFirstAttempt({ ok: false, reason: 'offline' })
            await Promise.all([first, second])

            expect(externalFiles.ensureLocal).toHaveBeenCalledTimes(2)
            expect(descr.previewUrl).toBe(`file://${STORE_DIR}/route-1.png`)
        })
    })

    // ---------------------------------------------------------------- screenshots

    describe('isScreenshotAllowed', () => {

        test('false for an external video whose content is not on the device', async () => {
            setup()
            binding.getAvailability.mockResolvedValue({
                isUbiquitous: true, downloadStatus: 'not-downloaded', isDownloading: false, downloadRequested: false
            })

            expect(await store.isScreenshotAllowed(route('1', { videoUrl: '/icloud/Videos/A/a.mp4' }))).toBe(false)
            expect(logged.find(e => e.message === 'preview skipped')).toBeDefined()
        })

        test('true once the video has been downloaded', async () => {
            setup()
            binding.getAvailability.mockResolvedValue({
                isUbiquitous: true, downloadStatus: 'current', isDownloading: false, downloadRequested: false
            })

            expect(await store.isScreenshotAllowed(route('1', { videoUrl: '/icloud/Videos/A/a.mp4' }))).toBe(true)
        })

        test('true for app storage, a NAS video and a remote video without asking the platform', async () => {
            setup()

            expect(await store.isScreenshotAllowed(route('1', { videoUrl: 'file:///app/videos/a.mp4' }))).toBe(true)
            expect(binding.getAvailability).not.toHaveBeenCalled()

            expect(await store.isScreenshotAllowed(route('2', { videoUrl: 'https://incyclist.com/a.mp4' }))).toBe(true)
            expect(binding.getAvailability).not.toHaveBeenCalled()

            expect(await store.isScreenshotAllowed(route('3', { videoUrl: '/nas/videos/a.mp4' }))).toBe(true)
            expect(binding.getAvailability).toHaveBeenCalledTimes(1)
        })

        test('false when the platform cannot answer', async () => {
            setup()
            binding.getAvailability.mockRejectedValue(new Error('timeout'))

            expect(await store.isScreenshotAllowed(route('1', { videoUrl: '/icloud/Videos/A/a.mp4' }))).toBe(false)
        })
    })

    // ---------------------------------------------------------------- adoptGenerated

    describe('adoptGenerated', () => {

        test('moves the generated thumbnail into the store', async () => {
            const descr = route('1', { previewUrl: '/app/previewImg/thumb.jpg' })
            setup({ routes: [descr] })

            await store.adoptGenerated(descr, '/app/previewImg/thumb.jpg')

            expect(binding.copyFile).toHaveBeenCalledWith('/app/previewImg/thumb.jpg', `${STORE_DIR}/route-1.jpg`)
            expect(fs.deleteFile).toHaveBeenCalledWith('/app/previewImg/thumb.jpg')
            expect(descr.previewUrl).toBe(`file://${STORE_DIR}/route-1.jpg`)
        })

        test('keeps the generated file as the preview when the copy fails', async () => {
            const descr = route('1', { previewUrl: '/app/previewImg/thumb.jpg' })
            setup({ routes: [descr] })
            binding.copyFile.mockRejectedValue(new Error('ENOSPC'))

            await store.adoptGenerated(descr, '/app/previewImg/thumb.jpg')

            expect(descr.previewUrl).toBe('/app/previewImg/thumb.jpg')
            expect(fs.deleteFile).not.toHaveBeenCalled()
        })

        test('a thumbnail already in the store is left where it is', async () => {
            const descr = route('1', { previewUrl: `${STORE_DIR}/route-1.png` })
            setup({ routes: [descr] })

            await store.adoptGenerated(descr, `${STORE_DIR}/route-1.png`)

            expect(binding.copyFile).not.toHaveBeenCalled()
            expect(fs.deleteFile).not.toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- release / sweep

    describe('release', () => {

        test('deletes only the route own copies inside the store', async () => {
            setup({
                routes: [route('1')],
                files: ['route-1.png', 'route-1.jpg', 'route-10.png', 'route-2.png', 'thumbnail.png']
            })

            await store.release('1')

            expect(fs.deleteFile.mock.calls.map(c => c[0]).sort()).toEqual([
                `${STORE_DIR}/route-1.jpg`, `${STORE_DIR}/route-1.png`
            ])
        })

        test('a route without a copy deletes nothing', async () => {
            setup({ routes: [route('1')], files: ['route-2.png'] })

            await store.release('1')

            expect(fs.deleteFile).not.toHaveBeenCalled()
        })

        test('an unlistable store is not an error', async () => {
            setup({ routes: [route('1')], files: ['route-1.png'] })
            fs.readdir.mockRejectedValue(new Error('ENOENT'))

            await expect(store.release('1')).resolves.toBeUndefined()
            expect(fs.deleteFile).not.toHaveBeenCalled()
        })
    })

    describe('sweepOrphans', () => {

        test('deletes store files without a matching route and nothing else', async () => {
            setup({
                routes: [route('1'), route('2')],
                files: ['route-1.png', 'route-2.jpg', 'route-99.png', 'preview.png', 'notes.txt']
            })

            await store.sweepOrphans()

            expect(fs.deleteFile).toHaveBeenCalledTimes(1)
            expect(fs.deleteFile).toHaveBeenCalledWith(`${STORE_DIR}/route-99.png`)
        })

        test('does nothing while no route is known', async () => {
            setup({ routes: [], files: ['route-99.png'] })

            await store.sweepOrphans()

            expect(fs.deleteFile).not.toHaveBeenCalled()
        })

        test('an empty store is a no-op', async () => {
            setup({ routes: [route('1')], files: [] })

            await store.sweepOrphans()

            expect(fs.deleteFile).not.toHaveBeenCalled()
        })

        test('without a file system binding nothing is deleted', async () => {
            setup({ routes: [route('1')], files: ['route-99.png'], noFs: true })

            await store.sweepOrphans()
            await store.release('1')

            expect(fs.readdir).not.toHaveBeenCalled()
        })
    })
})
