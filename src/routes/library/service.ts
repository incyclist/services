import { v4 as uuidv4 } from 'uuid'
import { getBindings } from '../../api'
import { ReadDirResult } from '../../api/fs'
import { JsonRepository } from '../../api/repository/json'
import { FileInfo } from '../../api/repository/types'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { Observer } from '../../base/types'
import { IObserver } from '../../base/typedefs'
import { ParserFactory } from '../base/parsers/factory'
import { RouteParser, useParsers } from '../base/parsers'
import { useRouteList } from '../list/service'
import { waitNextTick } from '../../utils'
import { DiscoveredRoute, FailedRoute, FolderInfo, ImportedLibrary, RouteRecord } from './types'

interface ILibraryRouteList {
    existsBySourceUri(uri: string): Promise<boolean>
    addRoute(record: RouteRecord): Promise<void>
}

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'm4v', 'mpg', 'mpeg', 'wmv', 'avi']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']

/**
 * Core service for scanning folder trees to discover importable routes and ingesting
 * them into the route library.
 */
@Singleton
export class RouteLibraryScannerService extends IncyclistService {

    constructor() {
        super('RouteLibraryScanner')
    }

    /**
     * Scans a folder tree for importable routes, streaming results as they are discovered.
     *
     * @param folderInfo Folder to scan (uri + displayName).
     * @returns Observer that emits `'discovered'`, `'scan-progress'`, and `'scan-complete'` events.
     */
    scan(folderInfo: FolderInfo): IObserver {
        const observer = new Observer()
        this._scan(folderInfo, observer).catch(err => {
            this.logError(err, 'scan', { uri: folderInfo.uri })
            observer.emit('error', err.message)
        })
        return observer
    }

    /**
     * Ingests a list of discovered routes into the route library sequentially.
     *
     * @param routes List of discovered routes to ingest.
     * @param treeUri URI of the root folder tree being imported.
     * @returns Observer that emits `'ingest-progress'`, `'ingest-error'`, and `'ingest-complete'` events.
     */
    ingest(routes: DiscoveredRoute[], treeUri: string): IObserver {
        const observer = new Observer()
        this._ingest(routes, treeUri, observer).catch(err => {
            this.logError(err, 'ingest', { treeUri })
            observer.emit('error', err.message)
        })
        return observer
    }

    private async _scan(folderInfo: FolderInfo, observer: Observer): Promise<void> {
        await waitNextTick()
        const parsers = useParsers()
        const progress = { scannedFolders: 0 }
        const discoveredCount = { value: 0 }

        await this.scanFolder(folderInfo.uri, folderInfo.displayName, observer, parsers, progress, discoveredCount)
        await this.upsertImportHistory(folderInfo, discoveredCount.value)

        observer.emit('scan-complete')
    }

    private async scanFolder(
        uri: string,
        folderName: string,
        observer: Observer,
        parsers: ParserFactory,
        progress: { scannedFolders: number },
        discoveredCount: { value: number }
    ): Promise<void> {
        const fs = this.getBindings().fs

        let entries: ReadDirResult[]
        try {
            entries = await fs.readdir(uri, { extended: true })
        } catch (err) {
            this.logError(err, 'scanFolder', { uri })
            return
        }

        progress.scannedFolders++
        observer.emit('scan-progress', { scannedFolders: progress.scannedFolders })

        const files = entries.filter(e => !e.isDirectory)
        const dirs = entries.filter(e => e.isDirectory)

        const primaryFiles = files.filter(f => {
            const ext = this.getExtension(f.name)
            return ext && parsers.isPrimaryExtension(ext)
        })

        for (const file of primaryFiles) {
            const route = await this.buildDiscoveredRoute(file, files, uri, folderName, parsers)
            discoveredCount.value++
            observer.emit('discovered', route)
        }

        for (const dir of dirs) {
            await this.scanFolder(dir.uri, dir.name, observer, parsers, progress, discoveredCount)
        }
    }

    private async buildDiscoveredRoute(
        controlFile: ReadDirResult,
        folderFiles: ReadDirResult[],
        folderUri: string,
        folderName: string,
        parsers: ParserFactory
    ): Promise<DiscoveredRoute> {
        const ext = this.getExtension(controlFile.name)
        const baseName = controlFile.name.slice(0, controlFile.name.length - ext.length - 1)

        let importable = true
        let skipReason: string | undefined

        // Check companion files are present
        const companionExts = this.getCompanionExts(parsers, ext)
        for (const compExt of companionExts) {
            const hasCompanion = folderFiles.some(
                f =>
                    this.getExtension(f.name).toLowerCase() === compExt.toLowerCase() &&
                    f.name.toLowerCase().startsWith(baseName.toLowerCase())
            )
            if (!hasCompanion) {
                importable = false
                skipReason = `Missing companion file (.${compExt})`
                break
            }
        }

        // Check video file is present and not AVI
        let hasVideo = false
        const hasThumbnail = folderFiles.some(f => IMAGE_EXTENSIONS.includes(this.getExtension(f.name).toLowerCase()))

        if (importable) {
            const videoFiles = folderFiles.filter(f =>
                VIDEO_EXTENSIONS.includes(this.getExtension(f.name).toLowerCase())
            )
            const nonAviVideo = videoFiles.find(f => this.getExtension(f.name).toLowerCase() !== 'avi')

            if (videoFiles.length === 0) {
                importable = false
                skipReason = 'No video file found in folder'
            } else if (!nonAviVideo) {
                importable = false
                skipReason = 'Only AVI video format found; AVI is not supported'
            } else {
                hasVideo = true
            }
        }

        // Quick-read control file header to detect absolute video path references
        if (importable) {
            try {
                const fs = this.getBindings().fs
                const content = await fs.readFile(controlFile.uri)
                const text = typeof content === 'string' ? content : content?.toString?.('utf8') ?? ''
                if (this.containsAbsolutePath(text.slice(0, 4096))) {
                    importable = false
                    skipReason = 'Route references an absolute video path'
                }
            } catch {
                // If the file cannot be read, do not block the import
            }
        }

        // Determine if already imported
        const alreadyImported = await this.getRouteList()
            .existsBySourceUri(controlFile.uri)
            .catch(() => false)

        return {
            id: uuidv4(),
            folderUri,
            folderName,
            controlFileUri: controlFile.uri,
            format: ext,
            hasVideo,
            hasThumbnail,
            alreadyImported,
            importable,
            skipReason
        }
    }

    private async _ingest(routes: DiscoveredRoute[], treeUri: string, observer: Observer): Promise<void> {
        await waitNextTick()
        const importable = routes.filter(r => r.importable && !r.alreadyImported)
        const total = importable.length
        let imported = 0
        let errors = 0
        const failedRoutes: FailedRoute[] = []

        for (let i = 0; i < importable.length; i++) {
            const route = importable[i]

            observer.emit('ingest-progress', { current: i + 1, total, currentName: route.folderName })

            try {
                await this.ingestRoute(route, treeUri)
                imported++
            } catch (err: any) {
                const reason = err?.message ?? String(err)
                errors++
                failedRoutes.push({ name: route.folderName, reason })
                observer.emit('ingest-error', { name: route.folderName, reason })
            }
        }

        const skipped = routes.length - importable.length
        observer.emit('ingest-complete', { imported, skipped, errors, failedRoutes })
    }

    private async ingestRoute(route: DiscoveredRoute, treeUri: string): Promise<void> {
        const { format, controlFileUri, folderUri } = route

        const fileInfo = this.buildFileInfo(controlFileUri, format)
        const { data } = await RouteParser.parse(fileInfo)

        let thumbnailPath: string | undefined
        if (route.hasThumbnail) {
            thumbnailPath = await this.copyThumbnail(route, folderUri).catch(() => undefined)
        }

        const videoUri = data.videoUrl ? this.resolveVideoUri(data.videoUrl, folderUri) : undefined

        const record: RouteRecord = {
            id: data.id ?? uuidv4(),
            name: data.title ?? route.folderName,
            format,
            thumbnailPath,
            videoUri,
            sourceTreeUri: treeUri
        }

        await this.getRouteList().addRoute(record)
    }

    private async copyThumbnail(route: DiscoveredRoute, folderUri: string): Promise<string | undefined> {
        const { fs, appInfo } = this.getBindings()

        if (!fs || !appInfo)
            return undefined

        const entries = await fs.readdir(folderUri, { extended: true })
        const thumbnailFile = entries.find(
            e => !e.isDirectory && IMAGE_EXTENSIONS.includes(this.getExtension(e.name).toLowerCase())
        )
        if (!thumbnailFile)
            return undefined

        const destDir = `${appInfo.getAppDir()}/thumbnails`
        await fs.ensureDir(destDir)

        const srcContent = await fs.readFile(thumbnailFile.uri)
        const destPath = `${destDir}/${route.id}.${this.getExtension(thumbnailFile.name)}`
        await fs.writeFile(destPath, srcContent)

        return destPath
    }

    private resolveVideoUri(videoRef: string, folderUri: string): string {
        if (videoRef.startsWith('http://') || videoRef.startsWith('https://')) {
            return videoRef
        }

        if (videoRef.startsWith('content://')) {
            return videoRef
        }

        if (videoRef.startsWith('/') || /^[A-Za-z]:[/\\]/.test(videoRef)) {
            throw new Error('Absolute video path references are not supported during ingest')
        }

        // Relative reference - resolve against folder content URI
        return `${folderUri}/${videoRef}`
    }

    private async upsertImportHistory(folderInfo: FolderInfo, routeCount: number): Promise<void> {
        try {
            const repo = JsonRepository.create('importedLibraries')
            const names = await repo.list()
            const all = await Promise.all((names ?? []).map(n => repo.read(n)))
            const existing = all
                .map(lib => lib as unknown as ImportedLibrary | undefined)
                .find(lib => lib?.treeUri === folderInfo.uri)

            const id = existing?.id ?? uuidv4()
            await repo.write(id, {
                id,
                treeUri: folderInfo.uri,
                displayName: folderInfo.displayName,
                lastScanned: new Date().toISOString(),
                routeCount
            })
        } catch (err) {
            this.logError(err, 'upsertImportHistory', { uri: folderInfo.uri })
        }
    }

    private buildFileInfo(uri: string, ext: string): FileInfo {
        const lastSlash = Math.max(uri.lastIndexOf('/'), uri.lastIndexOf('\\'))
        const dir = uri.slice(0, lastSlash)
        const base = uri.slice(lastSlash + 1)
        const name = base.slice(0, base.length - ext.length - 1)

        return {
            type: 'url',
            url: uri,
            filename: uri,
            base,
            name,
            dir,
            ext,
            delimiter: '/'
        }
    }

    private getCompanionExts(parsers: ParserFactory, primaryExt: string): string[] {
        try {
            const matching = parsers.suppertsExtension(primaryExt)
            const parser = matching.find(p => p.getPrimaryExtension() === primaryExt)
            return parser?.getCompanionExtensions() ?? []
        } catch {
            return []
        }
    }

    private getExtension(filename: string): string {
        const dot = filename.lastIndexOf('.')
        return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
    }

    private containsAbsolutePath(content: string): boolean {
        // Unix absolute paths embedded in XML attributes or element content
        if (/[>"']\//m.test(content)) return true
        // Windows absolute paths (e.g. C:\ or C:/)
        if (/[A-Za-z]:[/\\]/m.test(content)) return true
        return false
    }

    @Injectable
    protected getRouteList(): ILibraryRouteList {
        return useRouteList() as unknown as ILibraryRouteList
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }
}

/** Returns the singleton RouteLibraryScannerService instance. */
export const useRouteLibraryScanner = (): RouteLibraryScannerService => new RouteLibraryScannerService()
