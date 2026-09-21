import { getBindings } from "../../api"
import { Injectable, Singleton } from "../../base/decorators"
import { IncyclistService } from "../../base/service"
import type { IFileAccessBinding } from "../../api/fileAccess/types"
import { useExternalFileService } from "../../fileaccess/externalFiles"
import type { EnsureLocalFailure } from "../../fileaccess/types"
import { useFolderAccess } from "../../fileaccess/service"
import { canonicalPath, isRemoteUrl, isSamePathOrBelow } from "../../fileaccess/utils"
import { Route } from "../base/model/route"
import type { RouteInfo } from "../base/types"
import { useRouteList } from "../list/service"
import { useRoutesDbLoader } from "../list/loaders/db"
import type { PreviewAdoptionOutcome, PreviewCopyFailure, PreviewCopyResult } from "./types"

/** Sub-directory of the app's private storage the copies live in. */
const STORE_NAME = 'previews'

/** Prefix every file in the store carries, so nothing else in the directory is ever touched. */
const FILE_PREFIX = 'route-'

/** A preview is a still image - anything larger than this is not a preview and is not copied. */
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024

/** Copies run two at a time: enough to hide the per-file latency, few enough to stay unnoticed. */
const ADOPT_CONCURRENCY = 2

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png']
const DEFAULT_EXTENSION = 'png'

/** The union's discriminant does not narrow without `strictNullChecks`, so ask explicitly. */
const failureReason = (result: PreviewCopyResult): PreviewCopyFailure|undefined =>
    (result as { reason?: PreviewCopyFailure }).reason

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Keeps a private copy of every imported route's preview image inside app storage.
 *
 * On iOS a preview that sits next to the video in a folder the user picked is only readable
 * while a security scope is held, so a `previewUrl` pointing there breaks as soon as the app
 * restarts. The fix is in the data rather than in the UI: `description.previewUrl` is set
 * **only** to a copy inside app storage, or left undefined - and undefined is what the card and
 * the details view already handle by showing the map or the empty tile.
 *
 * The original location is remembered in `description.previewSource` while a copy is still
 * outstanding, which is what turns a failed copy into a retry rather than a lost preview.
 *
 * Every method is a no-op without the `fileAccess` binding (desktop, web-ui, Android): nothing
 * is copied, nothing is deleted, no description is touched, and `previewUrl` keeps whatever the
 * import produced.
 *
 * @noInheritDoc
 * @extends IncyclistService
 */
@Singleton
export class PreviewStore extends IncyclistService {

    protected storeDir?: string
    protected storeDirPromise?: Promise<string | undefined>
    protected pendingRun?: Promise<void>
    protected rerunRequested = false
    protected listening = false

    constructor() {
        super('PreviewStore')
    }

    /** True only where private copies are both necessary and possible. */
    isEnabled(): boolean {
        try {
            const binding = this.getFileAccess()
            return !!binding && binding.isSupported()
        }
        catch (err) {
            this.logError(err as Error, 'isEnabled')
            return false
        }
    }

    /**
     * Copies a freshly imported route's preview into the store, before the route is saved.
     *
     * Never throws and never rejects: a preview is optional, so an import must not fail because
     * of one. A failed copy leaves `previewSource` behind and `adoptPending` retries it later.
     */
    async adoptOnImport(target: Route | RouteInfo, sourcePath?: string): Promise<void> {
        if (!this.isEnabled())
            return

        const description = this.getDescription(target)
        if (!description)
            return

        try {
            await this.adopt(description, sourcePath ?? description.previewSource ?? description.previewUrl)
        }
        catch (err) {
            this.logError(err as Error, 'adoptOnImport', { id: description.id })
        }
    }

    /**
     * Copies the previews of all routes that still point outside app storage, or whose earlier
     * copy failed. Run once the route list is up, and again whenever folder access changes -
     * after the user has confirmed access to a folder this is what brings the pictures of every
     * route in it back at once.
     */
    async adoptPending(): Promise<void> {
        if (!this.isEnabled())
            return

        this.armAccessListener()

        if (this.pendingRun) {
            // a trigger that arrives mid-run gets its own pass, so newly granted routes are not missed
            this.rerunRequested = true
            return this.pendingRun
        }

        this.pendingRun = (async () => {
            try {
                do {
                    this.rerunRequested = false
                    await this.runPending()
                } while (this.rerunRequested)
            }
            catch (err) {
                this.logError(err as Error, 'adoptPending')
            }
            finally {
                this.pendingRun = undefined
            }
        })()

        return this.pendingRun
    }

    /**
     * Moves a generated thumbnail into the store. The screenshot itself already lands in app
     * storage, but in a cache directory the OS may purge, so the store is where it belongs.
     */
    async adoptGenerated(description: RouteInfo, generatedPath: string): Promise<void> {
        if (!this.isEnabled() || !description || !generatedPath)
            return

        try {
            const source = this.localPath(generatedPath)
            const dir = await this.getStoreDir()
            if (!source || !dir || isSamePathOrBelow(dir, source))
                return

            const result = await this.copyIntoStore(description.id, source, dir)
            if (!result.ok) {
                // the generated file is in app storage and readable, so it stays the preview
                this.logEvent({ message: 'preview not stored', id: description.id, reason: failureReason(result) })
                return
            }

            description.previewUrl = this.toUrl(result.target)
            delete description.previewSource
            await this.deleteFile(source)
        }
        catch (err) {
            this.logError(err as Error, 'adoptGenerated', { id: description?.id })
        }
    }

    /** Deletes a deleted route's copies - only `route-<id>.*`, and only inside the store. */
    async release(routeId: string): Promise<void> {
        if (!this.isEnabled() || !routeId)
            return

        try {
            const dir = await this.getStoreDir()
            if (!dir)
                return

            const matcher = new RegExp(`^${FILE_PREFIX}${escapeForRegex(routeId)}\\.[^.]+$`)
            const files = (await this.listStore(dir)).filter(name => matcher.test(name))

            for (const name of files)
                await this.deleteFile(`${dir}/${name}`)

            if (files.length > 0)
                this.logEvent({ message: 'preview released', id: routeId, files: files.length })
        }
        catch (err) {
            this.logError(err as Error, 'release', { id: routeId })
        }
    }

    /**
     * Removes copies left behind by a route that no longer exists (a crash between the copy and
     * the delete). Runs once per launch, after the route list has loaded - with no routes at all
     * it cannot tell an orphan from a route it simply has not seen yet, so it does nothing.
     */
    async sweepOrphans(): Promise<void> {
        if (!this.isEnabled())
            return

        try {
            const dir = await this.getStoreDir()
            if (!dir)
                return

            const files = await this.listStore(dir)
            if (files.length === 0)
                return

            const known = new Set(this.getAllDescriptions().map(d => d.id).filter(id => !!id))
            if (known.size === 0)
                return

            const orphans = files.filter(name => {
                const id = this.routeIdOf(name)
                return !!id && !known.has(id)
            })

            for (const name of orphans)
                await this.deleteFile(`${dir}/${name}`)

            if (orphans.length > 0)
                this.logEvent({ message: 'previews swept', files: orphans.length })
        }
        catch (err) {
            this.logError(err as Error, 'sweepOrphans')
        }
    }

    /**
     * Whether a screenshot may be taken from this route's video.
     *
     * False only for an external video whose content is not on the device: reading a cloud
     * placeholder either fails outright or silently pulls the whole multi-GB file, depending on
     * the OS version. The screenshot is taken later, once the video has been downloaded.
     */
    async isScreenshotAllowed(description: RouteInfo): Promise<boolean> {
        if (!this.isEnabled() || !description)
            return true

        const path = this.localPath(description.videoUrl ?? description.downloadUrl)
        if (!path)
            return true

        try {
            const binding = this.getFileAccess()
            if (binding.classifyLocation(path) === 'app')
                return true

            const availability = await binding.getAvailability(path)
            if (!availability?.isUbiquitous)
                return true

            const isLocal = availability.downloadStatus === 'current' || availability.downloadStatus === 'downloaded'
            if (!isLocal)
                this.logEvent({ message: 'preview skipped', id: description.id, title: description.title, reason: 'video not downloaded' })

            return isLocal
        }
        catch (err) {
            // a guess here can cost a multi-GB download, so an unanswerable probe means "not now"
            this.logError(err as Error, 'isScreenshotAllowed', { id: description.id })
            return false
        }
    }

    reset(): void {
        delete this.storeDir
        delete this.storeDirPromise
        this.listening = false
        this.rerunRequested = false
        super.reset()
    }

    // --- adoption ---------------------------------------------------------------------

    /**
     * Points a description's `previewUrl` at a store copy of `source`, or - when the copy is not
     * possible right now - clears it and remembers the source for the next retry.
     */
    protected async adopt(description: RouteInfo, source?: string): Promise<PreviewAdoptionOutcome> {
        const path = this.localPath(source)

        if (!path)
            // a preview served over http(s) needs no copy
            return 'skipped'

        const dir = await this.getStoreDir()
        if (!dir)
            return 'skipped'

        if (isSamePathOrBelow(dir, path)) {
            description.previewUrl = this.toUrl(path)
            delete description.previewSource
            return 'skipped'
        }

        const result = await this.copyIntoStore(description.id, path, dir)

        if (result.ok) {
            description.previewUrl = this.toUrl(result.target)
            delete description.previewSource
            this.logEvent({ message: 'preview copied', id: description.id, title: description.title })
            return 'adopted'
        }

        description.previewUrl = undefined
        description.previewSource = source
        this.logEvent({
            message: 'preview copy failed', id: description.id, title: description.title,
            reason: failureReason(result)
        })
        return 'hidden'
    }

    protected async copyIntoStore(routeId: string, source: string, dir: string): Promise<PreviewCopyResult> {
        const ensured = await this.getExternalFiles().ensureLocal(source)
        if (!ensured.ok)
            return { ok: false, reason: (ensured as EnsureLocalFailure).reason }

        const size = await this.getSize(source)
        if (size !== undefined && size > MAX_PREVIEW_BYTES)
            return { ok: false, reason: 'too-large' }

        const target = `${dir}/${FILE_PREFIX}${routeId}.${this.extensionOf(source)}`

        try {
            // the binding writes to a temp file and moves it onto the target, so a re-import
            // of the same route never leaves a half-written picture behind
            await this.getFileAccess().copyFile(source, target)
        }
        catch {
            return { ok: false, reason: 'copy-failed' }
        }

        await this.removeOtherVariants(routeId, target, dir)
        return { ok: true, target }
    }

    protected async runPending(): Promise<void> {
        const dir = await this.getStoreDir()
        if (!dir)
            return

        const candidates = this.getAllDescriptions().filter(d => this.isPending(d, dir))
        if (candidates.length === 0)
            return

        this.logEvent({ message: 'adopting previews', routes: candidates.length })

        let next = 0
        const worker = async () => {
            for (; ;) {
                const description = candidates[next++]
                if (!description)
                    return
                await this.adoptForRoute(description)
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(ADOPT_CONCURRENCY, candidates.length) }, worker)
        )
    }

    /** Path-only: a route is a candidate if its preview is external, or a copy is outstanding. */
    protected isPending(description: RouteInfo, dir: string): boolean {
        if (description.previewSource)
            return true

        const path = this.localPath(description.previewUrl)
        if (!path)
            return false

        return !isSamePathOrBelow(dir, path)
    }

    protected async adoptForRoute(description: RouteInfo): Promise<void> {
        try {
            const outcome = await this.adopt(description, description.previewSource ?? description.previewUrl)
            if (outcome === 'skipped')
                return
            await this.persist(description)
        }
        catch (err) {
            this.logError(err as Error, 'adoptForRoute', { id: description.id })
        }
    }

    /** Writes the changed description and lets the card and any open details view redraw. */
    protected async persist(description: RouteInfo): Promise<void> {
        try {
            const routeList = this.getRouteList()
            const route = routeList?.getAllRoutes?.()?.find(r => r?.description?.id === description.id)
            if (route)
                await this.getRepo().save(route)

            routeList?.getCard?.(description.id)?.emitUpdate?.()
        }
        catch (err) {
            this.logError(err as Error, 'persist', { id: description.id })
        }
    }

    protected armAccessListener(): void {
        if (this.listening)
            return

        try {
            const access = this.getFolderAccess()
            if (typeof access?.on !== 'function')
                return

            this.listening = true
            access.on('access-changed', () => {
                this.adoptPending().catch(err => this.logError(err as Error, 'onAccessChanged'))
            })
        }
        catch (err) {
            this.logError(err as Error, 'armAccessListener')
        }
    }

    // --- store ------------------------------------------------------------------------

    protected async getStoreDir(): Promise<string | undefined> {
        if (!this.isEnabled())
            return undefined
        if (this.storeDir)
            return this.storeDir

        this.storeDirPromise ??= (async () => {
            try {
                const dir = await this.getFileAccess().getPrivateDir(STORE_NAME)
                this.storeDir = canonicalPath(dir) ?? dir
                return this.storeDir
            }
            catch (err) {
                this.logError(err as Error, 'getStoreDir')
                delete this.storeDirPromise
                return undefined
            }
        })()

        return this.storeDirPromise
    }

    protected async listStore(dir: string): Promise<Array<string>> {
        try {
            const fs = this.getBindings()?.fs
            if (!fs?.readdir)
                return []

            const entries = await fs.readdir(dir)
            return (entries ?? [])
                .map((entry: any) => (typeof entry === 'string' ? entry : entry?.name))
                .filter((name: any): name is string => typeof name === 'string' && name.length > 0)
                .map(name => name.split('/').filter(s => s.length > 0).at(-1) as string)
        }
        catch (err) {
            this.logError(err as Error, 'listStore')
            return []
        }
    }

    /** Drops an earlier copy of the same route that was stored under a different extension. */
    protected async removeOtherVariants(routeId: string, target: string, dir: string): Promise<void> {
        const matcher = new RegExp(`^${FILE_PREFIX}${escapeForRegex(routeId)}\\.[^.]+$`)
        const targetName = target.split('/').at(-1)

        for (const name of await this.listStore(dir)) {
            if (name !== targetName && matcher.test(name))
                await this.deleteFile(`${dir}/${name}`)
        }
    }

    protected async deleteFile(path: string): Promise<void> {
        try {
            const fs = this.getBindings()?.fs
            if (fs?.deleteFile)
                await fs.deleteFile(path)
            else if (fs?.unlink)
                await fs.unlink(path)
        }
        catch (err) {
            this.logError(err as Error, 'deleteFile')
        }
    }

    protected async getSize(path: string): Promise<number | undefined> {
        try {
            const availability = await this.getFileAccess().getAvailability(path)
            return availability?.sizeBytes
        }
        catch (err) {
            this.logError(err as Error, 'getSize')
            return undefined
        }
    }

    // --- helpers ----------------------------------------------------------------------

    protected getDescription(target: Route | RouteInfo): RouteInfo | undefined {
        if (!target)
            return undefined
        const description = (target as Route).description ?? (target as RouteInfo)
        return description?.id ? description : undefined
    }

    protected getAllDescriptions(): Array<RouteInfo> {
        try {
            const routes = this.getRouteList()?.getAllRoutes?.() ?? []
            return routes
                .map(route => route?.description)
                .filter((description): description is RouteInfo => !!description?.id)
        }
        catch (err) {
            this.logError(err as Error, 'getAllDescriptions')
            return []
        }
    }

    /** The plain local path behind a preview reference, or undefined for a remote one. */
    protected localPath(url?: string): string | undefined {
        if (!url || isRemoteUrl(url))
            return undefined
        return canonicalPath(url)
    }

    /** How a store path is handed to the UI - an image needs a scheme to be rendered. */
    protected toUrl(path: string): string {
        return path.startsWith('/') ? `file://${path}` : path
    }

    protected extensionOf(path: string): string {
        const base = path.split('/').at(-1) ?? ''
        const idx = base.lastIndexOf('.')
        const ext = idx > 0 ? base.substring(idx + 1).toLowerCase() : ''
        return IMAGE_EXTENSIONS.includes(ext) ? ext : DEFAULT_EXTENSION
    }

    /** The route a store file belongs to, or undefined for anything not stored by us. */
    protected routeIdOf(name: string): string | undefined {
        const match = new RegExp(`^${FILE_PREFIX}(.+)\\.[^.]+$`).exec(name)
        return match?.[1]
    }

    protected getFileAccess(): IFileAccessBinding | undefined {
        return this.getBindings()?.fileAccess
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getFolderAccess() {
        return useFolderAccess()
    }

    @Injectable
    protected getExternalFiles() {
        return useExternalFileService()
    }

    @Injectable
    protected getRepo() {
        return useRoutesDbLoader()
    }
}

export const usePreviewStore = (): PreviewStore => new PreviewStore()
