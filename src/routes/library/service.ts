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
import { FailedRoute, FolderInfo, ImportDisplayProps, ImportedLibrary, ParsedRoute, RouteDisplayItem, RouteImportErrorCode, ScanContext, ScanEntry, ScannedRoute  } from './types'
import { useRoutesDbLoader } from '../list/loaders/db'
import { Route } from '../base/model/route'
import { sleep } from '../../utils/sleep'
import { useUnitConverter } from '../../i18n'
import { fixIncorrectFileInfo } from '../base/parsers/utils'
import { useExternalFileService } from '../../fileaccess/externalFiles'
import type { ExternalFileScope } from '../../fileaccess/types'
import { usePreviewStore } from '../previews/store'
import { useRouteShapeStore } from '../shapes/store'

/** A wait for the current route's companion files is considered "waiting for iCloud" once it
 *  has been running this long, per `ImportDisplayProps.parseProgress.waitingForICloud`. */
const WAITING_FOR_ICLOUD_THRESHOLD_MS = 2_000

/** Video files sit next to route control files; recognising them spares a directory probe. */
const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'm4v', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv']

/** Either separator: a recursive listing uses the platform's, which is `\` on Windows. */
const PATH_SEPARATOR = /[/\\]/

/** Error codes of a listing that failed on a folder, as opposed to "not a directory" (ENOTDIR). */
const UNREADABLE_FOLDER_ERRORS = /\b(EACCES|EPERM|EIO|EBUSY|EAGAIN|ETIMEDOUT|ESTALE|EMFILE|ENFILE|EHOSTDOWN|EHOSTUNREACH|ENETDOWN|ENETUNREACH|ECONNRESET|ECONNABORTED)\b/


/**
 * Core service for scanning folder trees to discover importable routes and ingesting
 * them into the route library.
 */
@Singleton
export class RouteLibraryScannerService extends IncyclistService {

    private isCancelled: boolean = false
    private scanResult: ScannedRoute[] = []
    private importProps: ImportDisplayProps|undefined
    /** The external-file scope of the route currently being parsed - the basis for
     *  `parseProgress.waitingForICloud` and for classifying a failed read. */
    private currentScope: ExternalFileScope|undefined

    constructor() {
        super('RouteLibraryScanner')
    }

    prepare() {
        this.importProps= {
            phase:'landing',
            routes:[],
            hasICloudDownloadFailures: false
        }
    }

    done() {
        this.importProps = undefined
        this.scanResult = []
    }

    getDisplayProps():ImportDisplayProps {
        const importProps:ImportDisplayProps = this.importProps ?? { phase:'landing', routes:[], hasICloudDownloadFailures:false }

        const hasICloudDownloadFailures = importProps.routes.some(
            r => r.errorCode==='ICLOUD_OFFLINE' || r.errorCode==='ICLOUD_DOWNLOAD_FAILED'
        )

        const parseProgress = importProps.parseProgress
            ? { ...importProps.parseProgress, waitingForICloud: this.isWaitingForICloud() }
            : importProps.parseProgress

        return { ...importProps, hasICloudDownloadFailures, parseProgress }
    }

    /** Whether the current route's parse is actually waiting for a file to arrive from iCloud,
     *  and has been waiting long enough to be worth showing - the import dialog's
     *  `parseProgress` hint. A slow parse of a large local file never sets this. */
    private isWaitingForICloud():boolean {
        return this.currentScope?.isWaiting(WAITING_FOR_ICLOUD_THRESHOLD_MS) ?? false
    }


    importSingle(fileInfo: FileInfo):IObserver {

        const observer = new Observer()
        this.isCancelled = false
       
        this.importRoute(fileInfo, observer).catch(err => {
            this.logError(err, 'importSingle', { file: fileInfo?.filename })
            observer.emit('error', err.message)
        })

        observer.on('success',(route:Route)=> {
            // The scanner may already have been torn down (done()) if the dialog/page
            // unmounted before this async result arrived - nothing left to update in
            // that case (FIXES_BACKLOG.md item #40).
            if (!this.importProps)
                return

            this.importProps.phase = 'result'
            this.importProps.resultSuccess= { routeName: route.title}

        })
        observer.on('error',(error:string)=> {
            if (!this.importProps)
                return

            this.importProps.phase = 'result'
            this.importProps.error = error

        })

        return observer
    }

    /**
     * Scans a folder tree for importable routes, streaming results as they are discovered.
     *
     * @param folderInfo Folder to scan (uri + displayName).
     * @returns Observer that emits `'discovered'`, `'scan-progress'`, and `'scan-complete'` events.
     */
    scan(folderInfo: FolderInfo): IObserver {
        
        if (!this.importProps)
            this.prepare()

        
        this.logEvent({message:'import route library',folder:folderInfo.displayName})

        // reset cancel flag
        this.isCancelled = false
        this.scanResult = []

        this.importProps.phase = 'scanning'
        this.importProps.scanProgress = {scannedFolders:0, failedFolders:0}

        const observer = new Observer()
        this._scan(folderInfo, observer).catch(err => {
            this.logError(err, 'scan', { folder: folderInfo.displayName })
            observer.emit('error', err.message)
        })

        observer
            .on('scan-progress',(progress:{scannedFolders:number, failedFolders:number})=>{
                this.importProps.scanProgress = progress
            })
            .on('scan-complete',()=>{
                const {scannedFolders: cntScanned, failedFolders: cntFailed} = this.importProps.scanProgress
                this.logEvent({message:'import route library: scan success',folder:folderInfo.displayName, cntScanned, cntFailed})
                this.importProps.phase= 'parsing'
            })

        return observer
    }

    /**
     * Parses a list of discovered routes sequentially, streaming results as they are parsed.
     *
     * @param folderInfo Folder to scan (uri + displayName).
     * @returns Observer that emits `'parse-result'`, `'parse-progress'`, `'parse-error'`, and `'parse-complete'` events.
     */
    parse(scannedRoutes: ScannedRoute[]): IObserver {
        const observer = new Observer()

        if (!this.importProps)
            this.prepare()

        this.logEvent({message:'import route library: parse start',folder:scannedRoutes?.[0].folderName})

        this._parse(scannedRoutes, observer).catch(err => {
            this.logError(err, 'parse')
            observer.emit('error', err.message)
        })

        observer.on('parse-progress',(progress:{ parsed: number, total:number})=>{
            const {parsed, total} = progress
            this.importProps.parseProgress = {parsed, total}
        })

        observer.on('parse-result',(route:ParsedRoute)=>{
            const idx = this.importProps.routes.findIndex( r=> r.id===route.controlFileUri)
            if (idx!==-1) {
                const observer = this.importProps.routes[idx].observer
                const displayProps = this.buildRouteDisplayItem(route,observer)                 
                this.importProps.routes[idx]= displayProps
                if (observer) {
                    observer.emit('updated',displayProps)
                }
            }
            
        })

        observer.on('parse-complete',()=>{
            const parseSumamry = {
                cntTotal: this.importProps.routes.length,
                cntSuccess: this.importProps.routes.filter( r=> !r.errorReason).length,
                cntError: this.importProps.routes.filter( r=> r.errorReason!=null).length,
                cntExisting: this.importProps.routes.filter( r=> r.alreadyImported).length,
            }
            this.logEvent({message:'import route library: parse completed',folder:scannedRoutes?.[0].folderName, parseSumamry})
            this.importProps.phase= 'selecting'
        })

        return observer
    }


    /**
     * Ingests a list of discovered routes into the route library sequentially.
     *
     * @param routes List of discovered routes to ingest.
     * @returns Observer that emits `'ingest-progress'`, `'ingest-error'`, and `'ingest-complete'` events.
     */
    ingest(routes: ParsedRoute[]): IObserver {
        const observer = new Observer()

        if (!this.importProps)
            this.prepare()


        // don't emit route list update after every individual route import (which would trigger page re-render)
        const list = this.getRouteList()
        list.pauseListUpdates()

        this.importProps.phase = 'ingesting'
        
        this._ingest(routes,  observer)
            .catch(err => {
                this.logError(err, 'ingest')
                observer.emit('error', err.message)
            })
            .finally( ()=> {
                list.resumeListUpdates()
                // emit one final route list update 
                list.emitLists('updated',{source:'system'})
            })

            observer.on('ingest-progress',( progress:{ current:number, total:number, currentName: string})=> {
                const {current,total,currentName} = progress
                this.importProps.ingestProgress = {current,total,currentName}
            })

            observer.on( 'ingest-complete',(status:{ imported:number, skipped:number, errors:number, failedRoutes:FailedRoute[],importedRoutes:Route[] })=>{
                this.importProps.phase = 'complete'
                const {imported,skipped,errors,failedRoutes} = status
                this.importProps.completionSummary = {imported,skipped,errors,failedRoutes}
            })

        return observer
    }

    

    cancel() {
        this.isCancelled = true
        this.done()
        this.prepare()
    }

    private async importRoute  (fileInfo: FileInfo, observer:IObserver) {
        
        await sleep(0)

        observer.emit('parsing')

        // The scanner may already have been torn down (done()) if the dialog/page
        // unmounted while this promise chain was suspended - bail out, there's nothing
        // left to update (FIXES_BACKLOG.md item #40).
        if (!this.importProps)
            return

        this.importProps.phase = 'parsing'

        if (fileInfo?.ext==='gpx' ) {
            return this.importSingleGpxRoute(fileInfo,observer)
        }
        else {
            return this.importSingleVideoRoute(fileInfo,observer)
        }
    }


    // simple single GPX file import
    private async importSingleGpxRoute  (fileInfo: FileInfo, observer:IObserver) {

        const name = fileInfo.url??fileInfo.filename??fileInfo.name
        this.logEvent({message:'import single route file',file:name, type:fileInfo.ext})

        const service = this.getRouteList()
        const db = this.getRoutesDBLoader()
        
        try {
            const {data,details} = await RouteParser.parse(fileInfo)
            const route = new Route(data,details)

            this.logEvent({message:'import single route file success',file:name})
            
            const existing = service.findCard(route)
            if (existing ) {   
                this.logEvent({message:'route updated (import)',route:route.title})
            }

            route.description.tsImported = Date.now()
            await this.getRouteShapeStore().saveOnImport(route)
            await db.save(route,true)
            service.addRoute(route,existing? 'import': 'user')

            const cardInfo =  service.findCard(route)
            cardInfo?.card?.verify()


            if (existing ) {   
                // route item was replaced in-place, force UI to refresh
                existing.card.emitUpdate()
            }

            observer.emit('success',route)
        }
        catch(err:any) {
            this.logEvent({message:'import single route file failed', file:name, reason:err.message, stack:err.stack})

            observer.emit('error', err.message)
        }

    }


    private async importSingleVideoRoute  (fileInfo: FileInfo, observer:IObserver) {

        const name = fileInfo.url??fileInfo.filename??fileInfo.name
        this.logEvent({message:'import single route file',file:name, type:fileInfo.ext})
        const parsers = this.getParsers()
        const {dir,delimiter} = fileInfo
        let {ext}= fileInfo

        if (ext.startsWith('.')) ext = ext.slice(1)

        const folderUri = dir.endsWith(delimiter??'/') ? dir.slice(0, -delimiter.length) : dir     
        
        try {

            if (!parsers.isPrimaryExtension(ext)) {
                this.logEvent({message:'import single route file failed', file:name, reason:'not a route control file'})
                observer.emit('error','not a route control file',ext)
                return
            }

            const scanObserver = new Observer()
            await this.scanFolder( folderUri, folderUri, this.createScanContext(scanObserver, parsers, false) )
            const files = this.scanResult

            this.scanResult = []
            scanObserver.stop()

            if (!files.length) {
                this.logEvent({message:'import single route file failed', file:name, reason:'no file found'})
                observer.emit('error','no file found')
            }

            if (files[0].scanError) {
                this.logEvent({message:'import single route file failed', file:name, reason:files[0].scanError})
                
                observer.emit('error',files[0].scanError)
                return                    
            }
            else {
                
                // filter out the selected file                    
                const file = files.find( file => file.controlFileUri.includes( fileInfo.base))
                const parseObserver = this.parse([file])

                parseObserver.on('parse-result',(result:ParsedRoute)=>{                    

                    parseObserver.stop()
                    if (result.parseError) {
                        this.logEvent({message:'import single route file failed', file:name, reason:result.parseError})                        
                        observer.emit('error',result.parseError)
                        return                    
                    }

                    const ingest = this.ingest([result])

                    let ingestError:string
                    ingest.once('ingest-error',(_:string,reason:string
                    )=>{
                        ingest.stop()
                    this.logEvent({message:'import single route file failed', file:name, reason})

                        observer.emit('error',reason)
                        ingestError = reason
                    })
                    ingest.once('ingest-complete',(summary:any)=>{
                        ingest.stop()
                        if (!ingestError && summary.imported>0)  {
                            this.logEvent({message:'import single route file success',file:name})

                            observer.emit('success',summary.importedRoutes?.[0]?.title)
                        }
                        else if (!ingestError && summary.imported===0)  { 

                            this.logEvent({message:'import single route file failed', file:name, reason:'not imported'})                        
                            observer.emit('error','not imported')
                        }
                    })

                })
            }
        }
        catch(err) {
            this.logEvent({message:'import single route file failed', file:name, reason:err.message, stack:err.stack})
            observer.emit('error', err.message)
        }
    }



    private async _scan(folderInfo: FolderInfo, observer: Observer): Promise<void> {
        await waitNextTick()
        const ctx = this.createScanContext(observer, this.getParsers(), true)

        await this.scanFolder(folderInfo.uri, folderInfo.displayName, ctx)
        await this.upsertImportHistory(folderInfo, ctx.discoveredCount.value)

        const { scannedFolders, failedFolders } = ctx.progress
        this.logEvent({message:'video scan result', scannedFolders, failedFolders, files:this.scanResult.length})
        observer.emit('scan-complete',this.scanResult)
    }

    private createScanContext(observer: IObserver, parsers: ParserFactory, recursive: boolean): ScanContext {
        return {
            observer,
            parsers,
            recursive,
            progress: { scannedFolders: 0, failedFolders: 0 },
            discoveredCount: { value: 0 }
        }
    }

    /**
     * Reads one folder and (when `recursive`) descends into its sub-folders, streaming
     * discovered routes via `scan-result` events.
     *
     * A folder that cannot be listed (permission error, a NAS gone offline mid-scan, …) is
     * counted rather than crashing the scan - `progress.failedFolders` is surfaced through
     * `ImportDisplayProps.scanProgress` so the UI can report an incomplete scan instead of
     * showing a silently short result.
     *
     * A names-only listing (desktop) is first offered to the one-call recursive listing; when
     * that is unavailable, sub-folders are found by probing each entry (see `resolveNamesOnly`).
     */
    private async scanFolder(uri: string, folderName: string, ctx: ScanContext): Promise<void> {
        const listing = await this.readFolder(uri, folderName, ctx)
        if (!listing)
            return

        let entries = listing
        if (ctx.recursive && this.isNamesOnly(listing))
            entries = await this.listRecursively(uri) ?? listing

        await this.scanListing(uri, folderName, entries, ctx)
    }

    /** Announces the routes of one already-listed folder, then descends into its sub-folders. */
    private async scanListing(uri: string, folderName: string, entries: ScanEntry[], ctx: ScanContext): Promise<void> {
        this.logICloudPlaceholders(uri, entries)

        ctx.progress.scannedFolders++
        this.emitScanProgress(ctx)

        const { files, dirs } = await this.splitEntries(entries, ctx)

        await this.announceRoutes(files, uri, folderName, ctx)

        for (const dir of dirs) {
            if (this.isCancelled || !ctx.recursive)
                continue

            if (dir.listing)
                await this.scanListing(dir.uri, dir.name, dir.listing, ctx)
            else
                await this.scanFolder(dir.uri, dir.name, ctx)
        }
    }

    private async announceRoutes(files: ReadDirResult[], uri: string, folderName: string, ctx: ScanContext): Promise<void> {
        const primaryFiles = files.filter(f => {
            const ext = this.getExtension(f.name)
            return ext && ext!=='gpx' && ctx.parsers.isPrimaryExtension(ext)
        })

        for (const file of primaryFiles) {
            if (!this.isCancelled) {
                const routeAnnouncement = await this.buildDiscoveredRoute(file, files, uri, folderName, ctx.parsers)
                ctx.discoveredCount.value++
                ctx.observer.emit('scan-result', routeAnnouncement)
                this.scanResult.push(routeAnnouncement)
            }
        }
    }

    /**
     * Diagnostic: detect iCloud placeholder files (e.g., ".photo.icloud", ".gpx.icloud").
     * These indicate files that are stored in iCloud but not yet downloaded locally.
     * The scanner processes them normally — bindings are responsible for resolving them.
     */
    private logICloudPlaceholders(uri: string, entries: ScanEntry[]): void {
        const iCloudPlaceholders = entries.filter(e => /^\.(.+)\.icloud$/.test(e.name))
        if (iCloudPlaceholders.length > 0) {
            this.logEvent({
                message: 'iCloud placeholder files detected in folder',
                uri,
                count: iCloudPlaceholders.length,
                firstPlaceholder: iCloudPlaceholders[0].name
            })
        }
    }

    /**
     * Lists one folder. A folder that cannot be listed - the listing rejects, or the platform
     * returns no listing at all - is counted as failed and yields `undefined`.
     */
    private async readFolder(uri: string, folderName: string, ctx: ScanContext): Promise<ScanEntry[]|undefined> {
        try {
            const entries = await this.listEntries(uri)
            if (entries)
                return entries
            this.countFailedFolder(ctx, new Error('folder listing not available'), folderName)
        } catch (err) {
            this.countFailedFolder(ctx, err, folderName)
        }
        return undefined
    }

    private countFailedFolder(ctx: ScanContext, err: unknown, folderName: string): void {
        ctx.progress.failedFolders++
        this.logError(err as Error, 'scanFolder', { folderName })
        this.emitScanProgress(ctx)
    }

    private emitScanProgress(ctx: ScanContext): void {
        const { scannedFolders, failedFolders } = ctx.progress
        ctx.observer.emit('scan-progress', { scannedFolders, failedFolders })
    }

    /**
     * Lists one folder, normalised to entry objects.
     *
     * The branch is on the runtime shape of the listing, not on a platform or capability:
     * an object listing (mobile) is returned as-is; a names-only listing (desktop) is mapped to
     * `{name, uri}` entries whose directory-ness is still unknown.
     *
     * @returns the entries, or `null` when the platform returned no listing at all
     * @throws when the listing itself fails (e.g. the uri is not a directory)
     */
    private async listEntries(uri: string): Promise<ScanEntry[]|null> {
        const result: unknown = await this.getBindings().fs.readdir?.(uri, { recursive:false, extended:true })
        if (!Array.isArray(result))
            return null

        if (result.length===0 || typeof result[0]!=='string')
            return result as ScanEntry[]

        const path = this.getBindings().path
        return (result as string[]).map(name => ({ name, uri: path.join(uri, name), unknownType: true }))
    }

    private isNamesOnly(entries: ScanEntry[]): boolean {
        return entries.some(e => e.unknownType)
    }

    /**
     * Splits a listing into files and sub-folders. An object listing is split on the
     * `isDirectory` it reports, exactly as before; a names-only listing is resolved by probing.
     */
    private async splitEntries(entries: ScanEntry[], ctx: ScanContext): Promise<{ files: ReadDirResult[], dirs: ScanEntry[] }> {
        if (!this.isNamesOnly(entries)) {
            return {
                files: entries.filter(e => !e.isDirectory) as ReadDirResult[],
                dirs: entries.filter(e => e.isDirectory)
            }
        }
        return this.resolveNamesOnly(entries, ctx)
    }

    /**
     * Resolves a names-only listing by attempting to list each entry: the attempt is both the
     * directory test and, for a directory, its listing - so nothing is read twice.
     *
     * Entries already recognisable as a route, companion or video file are not probed, and
     * nothing is probed when the scan is not recursive (only the file names are needed then).
     */
    private async resolveNamesOnly(entries: ScanEntry[], ctx: ScanContext): Promise<{ files: ReadDirResult[], dirs: ScanEntry[] }> {
        const files: ReadDirResult[] = []
        const dirs: ScanEntry[] = []
        const knownFileExts = this.getKnownFileExtensions(entries, ctx.parsers)

        for (const entry of entries) {
            const needsProbe = ctx.recursive && !this.isCancelled && !knownFileExts.has(this.getExtension(entry.name))
            const listing = needsProbe ? await this.probeEntry(entry, ctx) : undefined

            if (listing)
                dirs.push({ name: entry.name, uri: entry.uri, isDirectory: true, listing })
            else if (listing===undefined)
                files.push({ name: entry.name, uri: entry.uri, isDirectory: false })
            // null: a folder that could not be read - already counted, neither file nor folder
        }

        return { files, dirs }
    }

    /**
     * Probes one names-only entry by listing it.
     *
     * @returns the entry's listing when it is a directory (an empty folder lists as `[]`);
     *  `undefined` when it is not a directory (the listing rejected as such, or the platform
     *  returned no listing); `null` when it is a directory that could not be read, which is
     *  counted towards the failed folders rather than being mistaken for a file
     */
    private async probeEntry(entry: ScanEntry, ctx: ScanContext): Promise<ScanEntry[]|null|undefined> {
        try {
            return (await this.listEntries(entry.uri)) ?? undefined
        }
        catch (err) {
            if (!this.isUnreadableFolderError(err))
                return undefined

            this.countFailedFolder(ctx, err, entry.name)
            return null
        }
    }

    /**
     * Whether a failed listing says the entry is a folder that could not be read (permissions,
     * a NAS gone away, ...) rather than "not a directory". The error code may not survive the
     * IPC boundary, so the message - which Node prefixes with the code - is checked as well.
     */
    private isUnreadableFolderError(err: unknown): boolean {
        const { code, message } = (err ?? {}) as { code?: unknown, message?: unknown }
        const text = [code, message].filter(v => typeof v==='string').join(' ')
        return UNREADABLE_FOLDER_ERRORS.test(text)
    }

    /** Extensions that identify an entry as a file without probing it: routes, their companions, videos. */
    private getKnownFileExtensions(entries: ScanEntry[], parsers: ParserFactory): Set<string> {
        const known = new Set<string>(VIDEO_EXTENSIONS)
        for (const entry of entries) {
            const ext = this.getExtension(entry.name)
            if (!ext || !parsers.isPrimaryExtension(ext))
                continue

            known.add(ext)
            for (const companion of this.getCompanionExts(parsers, ext))
                known.add(companion.toLowerCase())
        }
        return known
    }

    /**
     * Fast path: lists the whole tree in one call. Only trusted when the result demonstrably
     * recursed - at least one entry is a nested path, and every nested path's parent folder is
     * itself part of the listing. Platforms that ignore `recursive` return a flat listing, which
     * is indistinguishable from a folder without sub-folders, so `undefined` is returned and the
     * caller falls back to probing.
     *
     * @returns the folder's listing with every sub-folder's listing attached, or `undefined`
     */
    private async listRecursively(uri: string): Promise<ScanEntry[]|undefined> {
        let result: unknown
        try {
            result = await this.getBindings().fs.readdir?.(uri, { recursive:true })
        }
        catch {
            return undefined
        }

        if (!Array.isArray(result) || !result.every(p => typeof p==='string'))
            return undefined

        const paths = result as string[]
        if (!paths.some(p => PATH_SEPARATOR.test(p)))
            return undefined

        return this.buildListingTree(uri, paths)
    }

    /** Groups the relative paths of a recursive listing by parent folder into nested listings. */
    private buildListingTree(rootUri: string, paths: string[]): ScanEntry[]|undefined {
        const normalised = paths.map(p => p.split(PATH_SEPARATOR).join('/'))
        const listed = new Set(normalised)
        const children = new Map<string, string[]>()

        for (const relPath of normalised) {
            const cut = relPath.lastIndexOf('/')
            const parent = cut<0 ? '' : relPath.slice(0, cut)
            if (parent && !listed.has(parent))
                return undefined

            const siblings = children.get(parent) ?? []
            siblings.push(relPath.slice(cut+1))
            children.set(parent, siblings)
        }

        const path = this.getBindings().path
        const toListing = (relDir: string, dirUri: string): ScanEntry[] => (children.get(relDir) ?? []).map(name => {
            const relPath = relDir ? `${relDir}/${name}` : name
            const entryUri = path.join(dirUri, name)
            return children.has(relPath)
                ? { name, uri: entryUri, isDirectory: true, listing: toListing(relPath, entryUri) }
                : { name, uri: entryUri, isDirectory: false }
        })

        return toListing('', rootUri)
    }

    private async buildDiscoveredRoute(
        controlFile: ReadDirResult,
        folderFiles: ReadDirResult[],
        folderUri: string,
        folderName: string,
        parsers: ParserFactory
    ): Promise<ScannedRoute> {
        const ext = this.getExtension(controlFile.name)
        const baseName = controlFile.name.slice(0, controlFile.name.length - ext.length - 1)

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
                skipReason = `Missing companion file (.${compExt})`
                break
            }
        }

        return {
            folderUri,
            folderName,
            files:folderFiles,
            controlFileUri: controlFile.uri,
            format: ext,
            scanError: skipReason
        }
    }


    private async _parse(scannedRoutes: ScannedRoute[], observer: IObserver):Promise<void> {
        const service = this.getRouteList()
        const targets = scannedRoutes.filter( r=>!r.scanError )
        const total = targets.length


        targets.forEach( target=> {
            const file = this.buildFileInfo(target.controlFileUri, target.format)            
            this.importProps.routes.push( {
                format: target.format,
                parseState: 'waiting',
                importable: false,
                label: file.base,
                folder: target.folderName,
                id: target.controlFileUri,
                alreadyImported:false,
                observer:new Observer()
            })
        })

        observer.emit('parse-start')

        for (let i = 0; i < targets.length; i++) {
            if (this.isCancelled)
                continue;

            const parsed = i+1;
            const target = targets[i]
            observer.emit('parse-progress', { current: parsed, parsed, total, currentFolder: target.folderName})
            let fileName = target.controlFileUri
            try {
                const info = this.getBindings().path.parse(fileName)
                fixIncorrectFileInfo(info)
                fileName = info.base
            } catch { /*ignore*/ }
            await this._parseTarget(target, service, observer )
            this.logEvent({message:'parsing route done', fileName})

        }

        observer.emit('parse-complete')
    }


    private async _parseTarget(target: ScannedRoute, service: ReturnType<typeof this.getRouteList>, observer: IObserver):Promise<void> {

        let result: Awaited<ReturnType<typeof RouteParser.parse>> | undefined
        const file = this.buildFileInfo(target.controlFileUri, target.format)
        const importProps = this.importProps.routes.find( r => r.id===target.controlFileUri)??({} as RouteDisplayItem)

        // Brackets everything this route's parse reads, so a file that could not be made
        // available locally can be reported even though the parsers report read failures the
        // ordinary way (and some of them recover from one and return a route anyway).
        const scope = useExternalFileService().beginScope({ isCancelled: () => this.isCancelled })
        this.currentScope = scope

        try {


            importProps.parseState = 'parsing'
            observer.emit('updated',importProps)

            try {
                result = await RouteParser.parse(file)
            }
            finally {
                scope.end()
                this.currentScope = undefined
            }

            if (scope.lastFailure) {
                result = undefined
                throw new Error(this.getReadFailureMessage(scope))
            }

            importProps.parseState = 'parsed'

            const route= new Route(result.data, result.details)
            
            // is the same route already in the list (duplicate file in different folder, or two files pointing to the same route)
            const existing = this.importProps.routes.find( ri=> ri.id===route.description.id)
            if (existing) {                
                result  = undefined
                throw new Error(`Duplicate of ${existing.label}`)
            }

            if (result.data.hasVideo) {
                this.validateVideoUrl(route, target.folderUri, target.files)
            }

            const parsed:ParsedRoute = {
                alreadyImported: false,
                route,
                folderUri: target.folderUri,
                folderName: target.folderName,
                controlFileUri: target.controlFileUri,
                format: target.format
            }

            if (service.getRoute(route.description.id)) {
                parsed.alreadyImported = true;
            }
            
            observer.emit('parse-result', parsed)
        }
        catch(err) {
            importProps.parseState = 'parsed'

            const parsed:ParsedRoute = {
                alreadyImported: false,
                route: result ? new Route(result.data, result.details) : undefined,
                folderUri: target.folderUri,
                folderName: target.folderName,
                controlFileUri: target.controlFileUri,
                format: target.format,
                parseError: scope.lastFailure ? this.getReadFailureMessage(scope) : (err?.message ?? String(err)),
                parseErrorCode: this.mapErrorToImportCode(err, scope)
            }
            this.logEvent({message:'could not parse route file',file:file.base, reason:err.message, stack:err.stack})
            observer.emit('parse-result', parsed)
        }
    }

    /**
     * Classifies a parse/read failure into a stable `RouteImportErrorCode`, so the import
     * dialog can map it to copy instead of matching on message text.
     *
     * A file that could not be made available locally is recorded in the parse scope, which
     * says exactly why - that takes precedence. Every other failure is classified from its
     * message, matching today's text exactly so nothing about the existing failures changes.
     */
    private mapErrorToImportCode(err:any, scope?:ExternalFileScope): RouteImportErrorCode {
        switch (scope?.lastFailure?.reason) {
            case 'offline':
                return 'ICLOUD_OFFLINE'
            case 'timeout':
            case 'download-failed':
                return 'ICLOUD_DOWNLOAD_FAILED'
            case 'access-lost':
                return 'READ_FAILED'
        }

        const message = err?.message ?? String(err)

        if (/AVI/i.test(message))
            return 'AVI_NOT_SUPPORTED'
        if (/no video/i.test(message))
            return 'NO_VIDEO'
        if (/^Could not (open|read)/i.test(message))
            return 'READ_FAILED'
        if (/pars(e|ing)/i.test(message))
            return 'PARSE_FAILED'

        return 'UNSUPPORTED'
    }

    /**
     * The text shown (and logged) for a route whose file could not be made available locally.
     * Built here from what the scope recorded, so the reason survives even when the parser
     * absorbed the read failure and reported its own generic message.
     */
    private getReadFailureMessage(scope:ExternalFileScope):string {
        const name = this.getFileName(scope.failedFile)

        switch (scope.lastFailure?.reason) {
            case 'offline':
                return `Could not download '${name}' from iCloud: no internet connection`
            case 'timeout':
            case 'download-failed':
                return `Could not download '${name}' from iCloud`
            case 'cancelled':
                return `Could not open file: ${name} (import cancelled)`
            default:
                return `Could not open file: ${name}`
        }
    }

    private getFileName(path?:string):string {
        if (!path)
            return ''

        try {
            return this.getBindings().path.parse(path).base ?? path
        }
        catch {
            return path
        }
    }

    private validateVideoUrl(route:Route,folderUri:string, folderFiles:ReadDirResult[]) {

        const {video}= route?.details??{}
        const {file,url,format} = video??{}

        // Basenames and a count only - never the folder listing or an absolute path (a desktop
        // NAS scan can carry thousands of entries with paths that embed usernames/share names).
        this.logEvent({message:'validateVideoUrl', file:this.getFileName(file), url:this.getFileName(url), format, folderFileCount:folderFiles.length})

        let videoFormat = format 
        try {
            if (videoFormat===undefined) {
                const info = this.getBindings().path.parse(url??file)
                videoFormat = info.ext.toLowerCase()
            }
        }
        catch { /* ignore */}

        const routeDetail = route.details
        const routeDescr = route.description
        if (this.isMobile()) {
            if (format==='avi') {

                const hasUrl = routeDetail.video.url!=null
                const url = routeDetail.video.url ?? routeDetail.video.file

                try {
                    if (url) {
                        const mp4Url = this.findMatchingMp4(url, folderFiles)
                        if (mp4Url) {
                            routeDetail.video.format = 'mp4'
                            if (hasUrl)
                                routeDetail.video.url = mp4Url
                            else 
                                routeDetail.video.file = mp4Url
                            routeDescr.videoFormat = 'mp4'
                            routeDescr.videoUrl = mp4Url
                        }
                        else {
                            if ( format===undefined) {
                                this.logEvent({message:'video file not found',url})
                                throw new Error('no video found')
                            }
                            throw new Error('AVI video not supported')
                        }
                    }
                    else {
                        this.logEvent({message:'video file not found',url})
                        throw new Error('no video found')
                    }
                }
                catch(err) {
                    this.logEvent({message:'video check failed',url})
                    throw err
                }
                return;
            }
            
        }
        if (routeDetail.video.file) {
            routeDetail.video.file = this.resolveVideoUri(routeDetail.video.file,folderUri,folderFiles)
            
        }
    }

    private findMatchingMp4( videoUrl:string, folderFiles:ReadDirResult[]):string|undefined {
        const path = this.getBindings().path
        const fileName = path.parse(videoUrl)?.base
        const target = fileName.replace('.avi', '.mp4')
        const folderFile = folderFiles.find( file => file.name===target)
        if (!folderFile)
            return;

        const info = path.parse(videoUrl)
        return videoUrl.replace( info.base,folderFile.name )        
    }

    private async _ingest(routes:ParsedRoute[], observer: Observer): Promise<void> {

        await waitNextTick()

        const service = this.getRouteList()
        const db = this.getRoutesDBLoader()

        const target = routes.filter( r=> !r.parseError)

        const total = target.length
        let errors = 0
        const failedRoutes: FailedRoute[] = []
        const importedRoutes: Route[] = []

        for (let i = 0; i < target.length; i++) {
            if (this.isCancelled)
                continue

            const {route} = target[i]??{};
            const existing = target[i].alreadyImported ? service.findCard(route) : null

            try {
                observer.emit('ingest-progress', { current: i + 1, total, currentName: route.title})
                await this.ingestOne(route, existing, service, db)
                importedRoutes.push(route)
            }
            catch(err:any) {
                const reason = err?.message ?? String(err)
                errors++
                failedRoutes.push({ name: route.title, reason, code: this.mapErrorToImportCode(err) })
                observer.emit('ingest-error', { name: route.title, reason })

            }
        }
        const skipped = routes.length - target.length
        observer.emit('ingest-complete', { imported:importedRoutes.length, skipped, errors, failedRoutes,importedRoutes })
    }

    /** Saves one parsed route to the library and refreshes its card in place if it already existed. */
    private async ingestOne(
        route: Route,
        existing: ReturnType<ReturnType<typeof this.getRouteList>['findCard']> | null,
        service: ReturnType<typeof this.getRouteList>,
        db: ReturnType<typeof this.getRoutesDBLoader>
    ): Promise<void> {
        if (existing) {
            this.logEvent({message:'route updated (library import)',route:route.title})
        }

        route.description.tsImported = Date.now()

        try {
            await this.getPreviewStore().adoptOnImport(route)
        }
        catch (err) {
            // a preview is optional - a route is never rejected over one, and the
            // copy is retried later
            this.logError(err as Error, 'adoptPreview', { title: route?.title })
        }

        // never rejects - a missing shape is backfilled on the first details load
        await this.getRouteShapeStore().saveOnImport(route)

        await db.save(route,true)
        service.addRoute(route,existing? 'import': 'user')

        try{
            const cardInfo =  service.findCard(route)
            cardInfo?.card?.verify()
        } catch {
            // ignore
        }
        if (existing ) {
            // route item was replaced in-place, force UI to refresh
            existing.card.emitUpdate()
        }
    }



    private resolveVideoUri(videoRef: string, folderUri: string, folderFiles: ReadDirResult[]): string {
        if (videoRef.startsWith('http://') || videoRef.startsWith('https://')) {
            return videoRef
        }
        if (videoRef.startsWith('content://')) {
            return videoRef
        }
        if (videoRef.startsWith('/') || /^[A-Za-z]:[/\\]/.test(videoRef)) {
            if (this.isMobile())
                throw new Error('Absolute video path references are not supported')
            return videoRef
        }
        // Relative reference — look up the file URI from the folder listing
        const match = folderFiles.find(f => f.name.toLowerCase() === videoRef.toLowerCase())
        if (!match)
            throw new Error(`Video file not found in folder: ${videoRef}`)
        return match.uri
    }    



    private async upsertImportHistory(folderInfo: FolderInfo, routeCount: number): Promise<void> {
        try {
            const treeUri = this.normaliseTreeUri(folderInfo.uri)
            const repo = JsonRepository.create('importedLibraries')
            const names = (await repo.list()) ?? []
            const all = await Promise.all(names.map(n => repo.read(n)))

            // records written before normalisation may spell the same folder differently -
            // the first one is kept, any further ones are removed
            const matching = names.filter((_, i) => {
                const lib = all[i] as unknown as ImportedLibrary | undefined
                return typeof lib?.treeUri==='string' && this.normaliseTreeUri(lib.treeUri)===treeUri
            })
            const [kept, ...duplicates] = matching
            const existing = (kept===undefined ? undefined : all[names.indexOf(kept)]) as unknown as ImportedLibrary | undefined
            for (const duplicate of duplicates)
                await repo.delete(duplicate)

            const id = existing?.id ?? uuidv4()
            await repo.write(id, {
                id,
                treeUri,
                displayName: folderInfo.displayName,
                lastScanned: new Date().toISOString(),
                routeCount
            })
        } catch (err) {
            this.logError(err, 'upsertImportHistory', { folder: folderInfo.displayName })
        }
    }

    /**
     * One spelling per folder for the import history: a plain filesystem path loses trailing
     * separators (never reducing a root to nothing) and gets an upper-case Windows drive letter.
     * A uri with a scheme (`content://`, `file://`, ...) is platform-issued and kept verbatim.
     */
    private normaliseTreeUri(uri: string): string {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri))
            return uri

        const trimmed = uri.replace(/[/\\]+$/, '')
        const withDrive = trimmed.replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`)

        if (withDrive==='')
            return uri.slice(0, 1)          // the filesystem root, '/' or '\'
        if (/^[A-Z]:$/.test(withDrive))
            return withDrive + uri.charAt(2)  // a drive root keeps its separator: 'C:\'
        return withDrive
    }

    private buildFileInfo(uri: string, ext: string): FileInfo {
        const { dir, base, name } = this.getBindings().path.parse(uri)
        
        return {
            type: 'file',
            url: uri,
            filename: uri,
            base,
            name,
            dir,
            ext,
            delimiter: uri?.startsWith('content://') ? '%2F' : '/'
        }
    }

    private getImportProps(parsed:ParsedRoute) {        
        return this.importProps.routes.find( r=> r.id === parsed.controlFileUri)
    }


    private buildRouteDisplayItem(parsed:ParsedRoute, observer?:IObserver):RouteDisplayItem {
        const {route,alreadyImported,parseError,format,controlFileUri,folderName} = parsed
        const descr = route?.description??{}

        const [C,U] = this.getUnitConversionShortcuts()
        const distance = descr.distance===undefined ? undefined : {
                value: C( descr.distance,'distance',{digits:1}),
                unit: U('distance')
            }


        const path = this.getBindings().path
        const info = path.parse(controlFileUri)
        const importProps = this.getImportProps(parsed)

        return {
            id:route?.description?.id??info?.base,
            distance,
            label: route?.title??info?.base,
            folder: folderName,
            alreadyImported,
            parseState: importProps?.parseState??'waiting',
            importable: parseError==null,
            format,
            errorReason:parseError,
            errorCode: parsed.parseErrorCode,
            observer: observer??new Observer()
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

    private isMobile():boolean {
        return this.getBindings()?.appInfo?.getChannel()==='mobile'
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable 
    protected getRoutesDBLoader() {
        return useRoutesDbLoader() 
    }

    @Injectable
    protected getPreviewStore() {
        return usePreviewStore()
    }

    @Injectable
    protected getRouteShapeStore() {
        return useRouteShapeStore()
    }

    @Injectable
    protected getParsers() {
        return useParsers()
    }

    protected getUnitConversionShortcuts() {
        return this.getUnitConverter().getUnitConversionShortcuts()
    }

    @Injectable
    protected getUnitConverter() {
        return useUnitConverter()
    }

}

/** Returns the singleton RouteLibraryScannerService instance. */
export const useRouteLibraryScanner = (): RouteLibraryScannerService => new RouteLibraryScannerService()
