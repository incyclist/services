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
import { FailedRoute, FolderInfo, ImportDisplayProps, ImportedLibrary, ParsedRoute, RouteDisplayItem, RouteImportErrorCode, ScannedRoute  } from './types'
import { useRoutesDbLoader } from '../list/loaders/db'
import { Route } from '../base/model/route'
import { sleep } from '../../utils/sleep'
import { useUnitConverter } from '../../i18n'
import { fixIncorrectFileInfo } from '../base/parsers/utils'
import { useExternalFileService } from '../../fileaccess/externalFiles'
import type { ExternalFileScope } from '../../fileaccess/types'
import { usePreviewStore } from '../previews/store'

/** A wait for the current route's companion files is considered "waiting for iCloud" once it
 *  has been running this long, per `ImportDisplayProps.parseProgress.waitingForICloud`. */
const WAITING_FOR_ICLOUD_THRESHOLD_MS = 2_000


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

        
        this.logEvent({message:'import route library',folder:folderInfo.displayName, uri:folderInfo.uri})

        // reset cancel flag
        this.isCancelled = false
        this.scanResult = []

        this.importProps.phase = 'scanning'
        this.importProps.scanProgress = {scannedFolders:0}
        
        const observer = new Observer()
        this._scan(folderInfo, observer).catch(err => {
            this.logError(err, 'scan', { uri: folderInfo.uri })
            observer.emit('error', err.message)
        })

        observer
            .on('scan-progress',(progress:{scannedFolders:number})=>{
                this.importProps.scanProgress = progress
            })
            .on('scan-complete',()=>{
                const cntScanned = this.importProps.scanProgress.scannedFolders
                this.logEvent({message:'import route library: scan success',folder:folderInfo.displayName, cntScanned})
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
            await this.scanFolder( folderUri, folderUri,scanObserver,parsers,{ scannedFolders: 0}, { value: 0 },false )
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
        const parsers = this.getParsers()
        const progress = { scannedFolders: 0 }
        const discoveredCount = { value: 0 }

        await this.scanFolder(folderInfo.uri, folderInfo.displayName, observer, parsers, progress, discoveredCount)
        await this.upsertImportHistory(folderInfo, discoveredCount.value)

        this.logEvent({message:'video scan result', scannedFolders: this.importProps.scanProgress.scannedFolders, files:this.scanResult.length})
        observer.emit('scan-complete',this.scanResult)
    }

    private async scanFolder(
        uri: string,
        folderName: string,
        observer: Observer,
        parsers: ParserFactory,
        progress: { scannedFolders: number },
        discoveredCount: { value: number },
        recursive:boolean = true
    ): Promise<void> {
        const fs = this.getBindings().fs

        let entries: ReadDirResult[]
        try {
            entries = await fs.readdir(uri, { recursive:false,extended: true })
        } catch (err) {
            this.logError(err, 'scanFolder', { uri })
            return
        }

        // Diagnostic: detect iCloud placeholder files (e.g., ".photo.icloud", ".gpx.icloud").
        // These indicate files that are stored in iCloud but not yet downloaded locally.
        // The scanner processes them normally — bindings are responsible for resolving them.
        const iCloudPlaceholders = entries.filter(e => /^\.(.+)\.icloud$/.test(e.name))
        if (iCloudPlaceholders.length > 0) {
            const firstName = iCloudPlaceholders[0].name
            this.logEvent({
                message: 'iCloud placeholder files detected in folder',
                uri,
                count: iCloudPlaceholders.length,
                firstPlaceholder: firstName
            })
        }

        progress.scannedFolders++
        observer.emit('scan-progress', { scannedFolders: progress.scannedFolders })

        const files = entries.filter(e => !e.isDirectory)
        const dirs = entries.filter(e => e.isDirectory)

        const primaryFiles = files.filter( (f:string|ReadDirResult) => {
            const name = typeof(f)==='string' ? f : f.name
            const ext = this.getExtension(name)
            return ext && ext!=='gpx' && parsers.isPrimaryExtension(ext)
        }).map( (f:string|ReadDirResult) => {
            if (typeof f==='string') {
                return {
                    name:f,
                    isDirectory:false,
                    uri: this.getBindings().path.join( uri, f)
                }
            }
            else return f
        })

        for (const file of primaryFiles) {
            if (!this.isCancelled) {
                const routeAnnouncement = await this.buildDiscoveredRoute(file, files, uri, folderName, parsers)
                discoveredCount.value++
                observer.emit('scan-result', routeAnnouncement)
                this.scanResult.push(routeAnnouncement)
            }
        }

        for (const dir of dirs) {
            if (!this.isCancelled && recursive) {
                await this.scanFolder(dir.uri, dir.name, observer, parsers, progress, discoveredCount)
            }
        }

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


        //this.logEvent( {message:'validateVideoUrl',route:{file,url,format}, folderUri, folderFiles})

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
        const {route,alreadyImported,parseError,format,controlFileUri} = parsed
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
