import { v4 as uuidv4 } from 'uuid'

import { getBindings } from "../api/bindings"
import { JsonRepository } from "../api/repository"
import { IncyclistService } from "../base/service"
import { Injectable, Singleton } from "../base/decorators"
import { useRouteList } from "../routes/list/service"
import type { RouteInfo } from "../routes/base/types"
import type { FileLocation, IFileAccessBinding } from "../api/fileAccess/types"
import type { AccessState, AccessTarget, ConfirmAccessResult, FolderAccessGrant } from "./types"
import {
    buildDisplayPath, canonicalPath, isSamePathOrBelow, lowestCommonAncestor, parentFolder
} from "./utils"

/** Repository record: a grant plus the id it is stored under. */
type StoredGrant = FolderAccessGrant & { id: string }

/** What happened to a grant when it was activated at launch. */
type ActivationState = 'active' | 'failed' | 'no-grant'

const REPO_NAME = 'folderAccessGrants'

/**
 * Owns the folders outside the app sandbox that the app is still allowed to read.
 *
 * On iOS a folder the user picked is only readable while a security scope is held, and that
 * scope does not survive a restart - it has to be re-established from a stored grant. This
 * service stores those grants, re-activates them once per launch, answers "can this path be
 * read right now", and drives the per-route re-selection when the answer is no.
 *
 * Without the `fileAccess` binding (Android, web-ui, desktop) external paths are readable
 * anyway, so every method here is a no-op: nothing is stored, nothing is probed, nothing is
 * reported as lost.
 *
 * Emits `access-changed` (with the folder that changed) whenever coverage changes, so that
 * cached availability and preview state can be invalidated.
 *
 * @noInheritDoc
 * @extends IncyclistService
 */
@Singleton
export class FolderAccessService extends IncyclistService {

    protected grants: Array<StoredGrant> = []
    protected activation: Record<string, ActivationState> = {}
    /** Path the platform resolved a grant to, per grant id. Scopes are held for the process lifetime. */
    protected resolvedPaths: Record<string, string> = {}
    /** Folders currently backed by a held scope - what `isCovered` matches against. */
    protected coveredFolders: Array<string> = []
    protected activationPromise?: Promise<void>
    protected summaryLogged = false

    constructor() {
        super('FolderAccess')
    }

    /** True only when the platform can actually hand out and re-activate folder grants. */
    isSupported(): boolean {
        try {
            const binding = this.getFileAccess()
            return !!binding?.isSupported()
        }
        catch {
            return false
        }
    }

    /**
     * Re-establishes every stored grant. Idempotent per launch: repeated calls (each page
     * service calls it when it opens) await the first run instead of activating again.
     *
     * Stale grants are renewed, moved folders are logged, failures are recorded on the record.
     * A grant is never deleted automatically - the user may plug the drive back in, sign back
     * into the cloud account, or restore the folder, and a deleted grant could not recover.
     */
    async activateAll(): Promise<void> {
        if (!this.isSupported())
            return

        this.activationPromise ??= this.doActivateAll()
        return this.activationPromise
    }

    /**
     * Stores the grant the picker returned for `folder` and verifies it right away, so a
     * grant that cannot be re-activated is noticed while the user is still in the flow.
     *
     * Never throws and never rejects: a missing or broken grant must not fail the pick or the
     * import scan that follows it. When no usable grant arrives, one is captured from the path
     * as a best effort.
     */
    async registerGrant(folder: string, grant?: string, grantError?: string, displayName?: string): Promise<void> {
        if (!this.isSupported())
            return

        try {
            const canonical = canonicalPath(folder)
            if (!canonical)
                return

            await this.activateAll()

            const existing = this.grants.find(g => g.folder === canonical)
            const id = existing?.id ?? uuidv4()

            // a folder can only be held by one scope at a time
            await this.releaseScope(id)

            const location = this.classify(canonical)

            let activation = await this.tryActivate(id, grant)
            let source: FolderAccessGrant['source'] = 'pick'
            let token = grant

            if (!activation.ok) {
                const captured = await this.tryCapture(canonical)
                if (captured) {
                    const capturedActivation = await this.tryActivate(id, captured)
                    if (capturedActivation.ok) {
                        activation = capturedActivation
                        source = 'captured'
                        token = captured
                    }
                }
            }

            const record: StoredGrant = {
                id,
                folder: canonical,
                grant: activation.ok ? (activation.renewedGrant ?? token) : token,
                displayName: displayName ?? existing?.displayName,
                location,
                source,
                createdAt: existing?.createdAt ?? Date.now(),
                renewedAt: activation.renewedGrant ? Date.now() : existing?.renewedAt,
                lastError: activation.ok ? undefined : (activation.error ?? grantError ?? 'no grant')
            }

            this.upsert(record)
            this.activation[id] = activation.ok ? 'active' : (token ? 'failed' : 'no-grant')

            if (activation.ok) {
                this.resolvedPaths[id] = activation.resolvedPath ?? canonical
                this.logEvent({
                    message: source === 'captured' ? 'folder grant captured' : 'folder grant stored',
                    location, name: this.folderName(canonical)
                })
            }
            else {
                this.logEvent({
                    message: 'folder grant unverified',
                    location, name: this.folderName(canonical), error: record.lastError
                })
            }

            await this.save(record)
            this.rebuildCoverage()
            this.emitAccessChanged(canonical)
        }
        catch (err) {
            // registering a grant is best effort - the pick and the scan continue either way
            this.logError(err as Error, 'registerGrant')
        }
    }

    /**
     * Whether a held grant covers `path`. Synchronous and path-only: no probing, no native
     * calls, safe to call for every row of a list.
     */
    isCovered(path: string): boolean {
        if (!this.isSupported())
            return false

        const canonical = canonicalPath(path)
        if (!canonical)
            return false

        return this.coveredFolders.some(folder => isSamePathOrBelow(folder, canonical))
    }

    /**
     * Whether `path` can be read right now.
     *
     * Paths inside app storage are always readable and are never probed. For anything else the
     * stored grants are activated first, then the platform is asked - metadata only, so a
     * cloud file is never downloaded just to answer this.
     */
    async getAccessState(path: string): Promise<AccessState> {
        const binding = this.getFileAccess()
        if (!this.isSupported() || !binding)
            return { state: 'readable' }

        const canonical = canonicalPath(path)
        if (!canonical)
            return { state: 'readable' }

        const location = this.classify(canonical)
        if (location === 'app')
            return { state: 'readable' }

        try {
            await this.activateAll()

            const probe = await binding.checkAccess(canonical)

            if (probe?.state === 'readable') {
                await this.captureIfUncovered(canonical)
                this.logAccessState(canonical, location, 'readable')
                return { state: 'readable' }
            }

            if (probe?.state === 'not-found') {
                this.logAccessState(canonical, location, 'not-found')
                return { state: 'not-found' }
            }

            if (probe?.state === 'denied') {
                const transient = await this.isLossTransient()
                this.logAccessState(canonical, location, 'access-lost', transient, probe.errno)
                return { state: 'access-lost', transient, location }
            }

            this.logAccessState(canonical, location, 'unknown')
            return { state: 'unknown' }
        }
        catch (err) {
            this.logError(err as Error, 'getAccessState', { location })
            return { state: 'unknown' }
        }
    }

    /**
     * The folder to offer the user for re-selection so that this route (and as many of its
     * neighbours as possible) becomes readable again.
     *
     * Computed on demand from paths alone - no probing and no background scan - so it is cheap
     * enough to call while rendering the route details of a route that lost access.
     */
    getTargetFor(routeId: string): AccessTarget | undefined {
        if (!this.isSupported())
            return undefined

        try {
            const routePath = this.getVideoPath(this.getDescription(routeId))
            if (!routePath)
                return undefined

            const location = this.classify(routePath)
            if (location === 'app')
                return undefined

            // every other route that would be fixed by the same re-selection
            const siblings = this.getUncoveredVideoPaths()
                .filter(p => p !== routePath && this.classify(p) === location)

            const candidates = [routePath, ...siblings]
            const ancestor = lowestCommonAncestor(candidates.map(p => parentFolder(p)))

            // unrelated trees share nothing but the root, which is useless to re-select -
            // fall back to the folder this route's own video is in
            const folder = (!ancestor || ancestor === '/') ? parentFolder(routePath) : ancestor
            if (!folder)
                return undefined

            const siblingCount = siblings.filter(p => isSamePathOrBelow(folder, p)).length

            return { folder, displayPath: buildDisplayPath(folder, location), location, siblingCount }
        }
        catch (err) {
            this.logError(err as Error, 'getTargetFor')
            return undefined
        }
    }

    /**
     * Asks the user to re-select the folder of this route's video, starting the picker at the
     * folder we believe it is in, and stores whatever grant comes back.
     *
     * Only re-establishes access: no folder scan and no import is triggered, so confirming
     * access never changes the route library.
     */
    async confirmAccess(routeId: string): Promise<ConfirmAccessResult> {
        const cancelled: ConfirmAccessResult = { outcome: 'cancelled', coversRoute: false, restoredCount: 0 }

        if (!this.isSupported())
            return cancelled

        try {
            const target = this.getTargetFor(routeId)
            const routePath = this.getVideoPath(this.getDescription(routeId))

            const uncoveredBefore = this.getUncoveredVideoPaths()

            const result = await this.getBindings().ui.selectDirectory(
                target?.folder ? { initialDirectory: target.folder } : undefined
            )

            if (!result || result.canceled || !result.selected) {
                this.logEvent({ message: 'access confirm', outcome: 'cancelled' })
                return cancelled
            }

            await this.registerGrant(result.selected, result.grant, result.grantError, result.displayName)

            const coversRoute = !!routePath && this.isCovered(routePath)
            const restoredCount = uncoveredBefore.filter(p => this.isCovered(p)).length
            const outcome: ConfirmAccessResult['outcome'] = coversRoute ? 'confirmed' : 'wrong-folder'

            this.logEvent({
                message: 'access confirm', outcome, restoredCount,
                location: target?.location ?? this.classify(routePath)
            })

            return { outcome, coversRoute, restoredCount }
        }
        catch (err) {
            this.logError(err as Error, 'confirmAccess')
            return cancelled
        }
    }

    reset() {
        super.reset()
        this.grants = []
        this.activation = {}
        this.resolvedPaths = {}
        this.coveredFolders = []
        this.activationPromise = undefined
        this.summaryLogged = false
    }

    // --- activation ------------------------------------------------------------------

    protected async doActivateAll(): Promise<void> {
        try {
            this.grants = await this.load()

            for (const record of this.grants) {
                await this.activateStored(record)
            }

            this.rebuildCoverage()
            this.logAccessSummary()
            this.emitAccessChanged()
        }
        catch (err) {
            this.logError(err as Error, 'activateAll')
        }
    }

    protected async activateStored(record: StoredGrant): Promise<void> {
        if (!record.grant) {
            this.activation[record.id] = 'no-grant'
            return
        }

        const activation = await this.tryActivate(record.id, record.grant)

        if (!activation.ok) {
            this.activation[record.id] = 'failed'
            record.lastError = activation.error
            this.logEvent({
                message: 'folder grant failed',
                location: record.location, name: this.folderName(record.folder), error: activation.error
            })
            // deliberately not deleted: the folder may come back (drive reconnected, signed in again)
            await this.save(record)
            return
        }

        this.activation[record.id] = 'active'
        this.resolvedPaths[record.id] = activation.resolvedPath ?? record.folder

        const moved = !!activation.resolvedPath && activation.resolvedPath !== record.folder
        let changed = false

        if (activation.renewedGrant) {
            record.grant = activation.renewedGrant
            record.renewedAt = Date.now()
            changed = true
        }
        if (record.lastError) {
            record.lastError = undefined
            changed = true
        }

        this.logEvent({
            message: 'folder grant activated',
            location: record.location, name: this.folderName(record.folder),
            renewed: !!activation.renewedGrant, moved
        })

        if (changed)
            await this.save(record)
    }

    protected async tryActivate(id: string, grant?: string):
        Promise<{ ok: boolean, resolvedPath?: string, renewedGrant?: string, error?: string }> {

        const binding = this.getFileAccess()
        if (!binding || !grant)
            return { ok: false, error: grant ? 'binding unavailable' : 'no grant' }

        try {
            const activation = await binding.activateGrant(grant)
            const resolvedPath = canonicalPath(activation?.resolvedPath)
            this.resolvedPaths[id] = resolvedPath ?? this.resolvedPaths[id]
            return { ok: true, resolvedPath, renewedGrant: activation?.renewedGrant }
        }
        catch (err) {
            return { ok: false, error: (err as Error)?.message }
        }
    }

    protected async tryCapture(folder: string): Promise<string | undefined> {
        const binding = this.getFileAccess()
        if (!binding)
            return undefined
        try {
            return await binding.captureGrant(folder)
        }
        catch (err) {
            this.logError(err as Error, 'captureGrant')
            return undefined
        }
    }

    protected async releaseScope(id: string): Promise<void> {
        const resolved = this.resolvedPaths[id]
        if (!resolved)
            return
        delete this.resolvedPaths[id]
        try {
            await this.getFileAccess()?.deactivateGrant(resolved)
        }
        catch (err) {
            this.logError(err as Error, 'deactivateGrant')
        }
    }

    /**
     * Picks up access to a folder that is readable but has no grant yet, so that it survives
     * the next restart without asking the user.
     */
    protected async captureIfUncovered(path: string): Promise<void> {
        if (this.isCovered(path))
            return

        const folder = parentFolder(path)
        if (!folder)
            return

        const captured = await this.tryCapture(folder)
        if (!captured)
            return

        await this.registerGrant(folder, captured)
    }

    // --- state ----------------------------------------------------------------------

    /**
     * Whether a lost access is expected to come back on its own.
     *
     * The platform answer is used when there is one. When it cannot tell, the pattern decides:
     * every cloud folder failing while a folder on the device still works is what being signed
     * out of the cloud account looks like, and that resolves as soon as the user signs back in.
     */
    protected async isLossTransient(): Promise<boolean> {
        const binding = this.getFileAccess()
        if (!binding)
            return false

        let identity: boolean | undefined
        try {
            identity = await binding.isCloudIdentityAvailable()
        }
        catch {
            identity = undefined
        }

        if (typeof identity === 'boolean')
            return identity === false

        const byLocation = (location: FileLocation) =>
            this.grants.filter(g => (g.location ?? this.classify(g.folder)) === location)

        const cloud = byLocation('icloud')
        const onDevice = byLocation('on-device')

        const allCloudFailed = cloud.length > 0 && cloud.every(g => this.activation[g.id] !== 'active')
        const anyOnDeviceWorks = onDevice.some(g => this.activation[g.id] === 'active')

        return allCloudFailed && anyOnDeviceWorks
    }

    protected rebuildCoverage(): void {
        const folders: Array<string> = []

        for (const record of this.grants) {
            if (this.activation[record.id] !== 'active')
                continue
            folders.push(record.folder)
            const resolved = this.resolvedPaths[record.id]
            // a moved folder is reachable under its new path, the routes still name the old one.
            // A resolved root would cover every path there is, so it is never treated as coverage.
            if (resolved && resolved !== record.folder && resolved !== '/')
                folders.push(resolved)
        }

        this.coveredFolders = folders
    }

    protected emitAccessChanged(folder?: string): void {
        this.emit('access-changed', folder)
    }

    // --- route paths ----------------------------------------------------------------

    protected getDescription(routeId: string): RouteInfo | undefined {
        if (!routeId)
            return undefined
        return this.getRouteDescriptions().find(d => d.id === routeId)
    }

    protected getRouteDescriptions(): Array<RouteInfo> {
        try {
            const routes = this.getRouteList()?.getAllRoutes() ?? []
            return routes
                .map(r => r?.description)
                .filter((d): d is RouteInfo => !!d && !d.isDeleted)
        }
        catch (err) {
            this.logError(err as Error, 'getRouteDescriptions')
            return []
        }
    }

    /** The local path of a route's video, or undefined when there is none or it is remote. */
    protected getVideoPath(description?: RouteInfo): string | undefined {
        if (!description)
            return undefined
        return canonicalPath(description.videoUrl ?? description.originalVideoUrl)
    }

    /** Video paths of imported routes that live outside app storage and have no grant. */
    protected getUncoveredVideoPaths(): Array<string> {
        return this.getRouteDescriptions()
            .map(d => this.getVideoPath(d))
            .filter((p): p is string => !!p)
            .filter(p => this.classify(p) !== 'app')
            .filter(p => !this.isCovered(p))
    }

    protected classify(path?: string): FileLocation {
        if (!path)
            return 'other'
        try {
            return this.getFileAccess()?.classifyLocation(path) ?? 'other'
        }
        catch {
            return 'other'
        }
    }

    // --- logging --------------------------------------------------------------------

    protected folderName(folder?: string): string | undefined {
        if (!folder)
            return undefined
        return folder.split('/').filter(s => s.length > 0).at(-1)
    }

    protected logAccessState(
        path: string, location: FileLocation, state: string, transient?: boolean, errno?: number
    ): void {
        this.logEvent({ message: 'access state', location, name: this.folderName(path), state, transient, errno })
    }

    /**
     * One line per launch sizing the population of routes whose folder we can no longer read.
     * Path-only: it makes no native calls and drives nothing in the UI.
     */
    protected logAccessSummary(): void {
        if (this.summaryLogged)
            return
        this.summaryLogged = true

        try {
            const external = this.getRouteDescriptions()
                .map(d => this.getVideoPath(d))
                .filter((p): p is string => !!p)
                .filter(p => this.classify(p) !== 'app')

            const byLocation: Record<string, { covered: number, notCovered: number }> = {}
            let covered = 0

            for (const path of external) {
                const location = this.classify(path)
                byLocation[location] ??= { covered: 0, notCovered: 0 }
                if (this.isCovered(path)) {
                    covered++
                    byLocation[location].covered++
                }
                else {
                    byLocation[location].notCovered++
                }
            }

            this.logEvent({
                message: 'access summary',
                routes: external.length,
                covered,
                notCovered: external.length - covered,
                grants: this.grants.length,
                activeGrants: Object.values(this.activation).filter(s => s === 'active').length,
                byLocation
            })
        }
        catch (err) {
            this.logError(err as Error, 'logAccessSummary')
        }
    }

    // --- repository -----------------------------------------------------------------

    protected upsert(record: StoredGrant): void {
        const idx = this.grants.findIndex(g => g.id === record.id)
        if (idx >= 0)
            this.grants[idx] = record
        else
            this.grants.push(record)
    }

    protected async load(): Promise<Array<StoredGrant>> {
        try {
            const repo = this.getGrantsRepo()
            const names = await repo.list()
            const records = await Promise.all((names ?? []).map(name => repo.read(name)))

            return records
                .map(r => r as unknown as StoredGrant | undefined)
                .filter((r): r is StoredGrant => !!r?.folder)
                .map(r => ({ ...r, id: r.id ?? uuidv4(), folder: canonicalPath(r.folder) ?? r.folder }))
        }
        catch (err) {
            this.logError(err as Error, 'loadGrants')
            return []
        }
    }

    protected async save(record: StoredGrant): Promise<void> {
        try {
            await this.getGrantsRepo().write(record.id, { ...record })
        }
        catch (err) {
            this.logError(err as Error, 'saveGrant')
        }
    }

    @Injectable
    protected getGrantsRepo(): JsonRepository {
        return JsonRepository.create(REPO_NAME)
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    protected getFileAccess(): IFileAccessBinding | undefined {
        return this.getBindings()?.fileAccess
    }
}

export const useFolderAccess = () => new FolderAccessService()
