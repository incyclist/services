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
import { FailedRoute, FolderInfo, ImportDisplayProps, ImportedLibrary, ParsedRoute, RouteDisplayItem, ScannedRoute  } from './types'
import { useRoutesDbLoader } from '../list/loaders/db'
import { RouteApiDetail } from '../types'
import { Route } from '../base/model/route'
import { sleep } from '../../utils/sleep'
import { useUnitConverter } from '../../i18n'


/**
 * Core service for scanning folder trees to discover importable routes and ingesting
 * them into the route library.
 */
@Singleton
export class RouteLibraryScannerService extends IncyclistService {

    private isCancelled: boolean = false
    private scanResult: ScannedRoute[] = []
    private importProps: ImportDisplayProps|undefined

    constructor() {
        super('RouteLibraryScanner')
    }

    prepare() {
        this.importProps= {
            phase:'landing',
            routes:[]
        }
    }

    done() {
        this.importProps = undefined
    }

    getDisplayProps():ImportDisplayProps {
        return this.importProps
    }




    importSingle(fileInfo: FileInfo):IObserver {

        const observer = new Observer()
        this.isCancelled = false
       
        this.importRoute(fileInfo, observer).catch(err => {
            this.logError(err, 'importSingle', { file: fileInfo?.filename })
            observer.emit('error', err.message)
        })

        observer.on('success',(route:Route)=> {
            this.importProps.phase = 'result'
            this.importProps.resultSuccess= { routeName: route.title}

        })
        observer.on('error',(error:string)=> {
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

        // reset cancel flag
        this.isCancelled = false
        this.scanResult = []

        this.importProps.phase = 'scanning'

        const observer = new Observer()
        this._scan(folderInfo, observer).catch(err => {
            this.logError(err, 'scan', { uri: folderInfo.uri })
            observer.emit('error', err.message)
        })

        observer.on('scan-progress',(progress:{scannedFolders:number})=>{
            this.importProps.scanProgress = progress
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

        this._parse(scannedRoutes, observer).catch(err => {
            this.logError(err, 'parse')
            observer.emit('error', err.message)
        })

        observer.on('parse-progress',(progress:{ parsed: number, total:number})=>{
            const {parsed, total} = progress
            this.importProps.parseProgress = {parsed, total}
        })

        observer.on('parse-result',(route:ParsedRoute)=>{
            this.importProps.routes.push( this.buildRouteDisplayItem(route) )
        })

        observer.on('parse-complete',()=>{
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
        this.importProps.phase = 'landing'

    }

    private async importRoute  (fileInfo: FileInfo, observer:IObserver) {
        
        await sleep(0)
       
        observer.emit('parsing')
        this.importProps.phase = 'parsing'
        
        if (fileInfo?.ext==='gpx') {
            return this.importSingleGpxRoute(fileInfo,observer)
        }
        else {
            return this.importSingleVideoRoute(fileInfo,observer)
        }
    }


    // simple single GPX file import
    private async importSingleGpxRoute  (fileInfo: FileInfo, observer:IObserver) {
        const list = this.getRouteList()
        const db = this.getRoutesDBLoader()
        
        try {
            const {data,details} = await RouteParser.parse(fileInfo)
            const route = new Route(data,details)
            route.description.tsImported = Date.now()
            await db.save(route,true)
            list.addRoute(route,'user')


            observer.emit('success',route)
        }
        catch(err:any) {
            observer.emit('error', err.message)
        }

    }


    private async importSingleVideoRoute  (fileInfo: FileInfo, observer:IObserver) {
        const parsers = this.getParsers()
        const {dir,ext,delimiter} = fileInfo
        const folderUri = dir.endsWith(delimiter??'/') ? dir.slice(0, -delimiter.length) : dir     
        
        try {

            if (!parsers.isPrimaryExtension(ext)) {
                observer.emit('error','not a route control file')
                return
            }

            const scanObserver = new Observer()
            await this.scanFolder( folderUri, folderUri,scanObserver,parsers,{ scannedFolders: 0}, { value: 0 },false )
            const files = this.scanResult

            this.scanResult = []
            scanObserver.stop()

            if (files[0].scanError) {
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
                        observer.emit('error',result.parseError)
                        return                    
                    }

                    const ingest = this.ingest([result])

                    let ingestError:string
                    ingest.once('ingest-error',(_:string,reason:string
                    )=>{
                        ingest.stop()
                        observer.emit('error',reason)
                        ingestError = reason
                    })
                    ingest.once('ingest-complete',(summary:any)=>{
                        ingest.stop()
                        if (!ingestError && summary.imported>0)  {
                            observer.emit('success',summary.importedRoutes?.[0]?.title)
                        }
                        else if (!ingestError && summary.imported===0)  { 
                            observer.emit('error','not imported')
                        }
                    })

                })
            }
        }
        catch(err) {
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

        progress.scannedFolders++
        observer.emit('scan-progress', { scannedFolders: progress.scannedFolders })

        const files = entries.filter(e => !e.isDirectory)
        const dirs = entries.filter(e => e.isDirectory)

        const primaryFiles = files.filter( (f:string|ReadDirResult) => {
            const name = typeof(f)==='string' ? f : f.name
            const ext = this.getExtension(name)
            return ext && parsers.isPrimaryExtension(ext)
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

        for (let i = 0; i < targets.length; i++) {
            if (this.isCancelled)
                continue;

            const parsed = i+1;
            const target = targets[i]
            observer.emit('parse-progress', { current: parsed, parsed, total, currentFolder: target.folderName})
            await this._parseTarget(target, service, observer)
        }

        observer.emit('parse-complete')
    }

    private async _parseTarget(target: ScannedRoute, service: ReturnType<typeof this.getRouteList>, observer: IObserver):Promise<void> {
        if (service.existsBySourceUri(target.controlFileUri)) {
            observer.emit('parse-result', {
                alreadyImported: true,
                route: service.getBySourceUri(target.controlFileUri),
                folderUri: target.folderUri,
                controlFileUri: target.controlFileUri,
                format: target.format
            } as ParsedRoute)
            return
        }

        let result: Awaited<ReturnType<typeof RouteParser.parse>> | undefined
        const file = this.buildFileInfo(target.controlFileUri, target.format)
        try {
            try {
                result = await RouteParser.parse(file)
            }
            catch(err) {
                throw new Error(`Could not parse: [${err.message}]`)
            }

            if (result.data.hasVideo) {
                this.validateVideoUrl(result.details, target.folderUri, target.files)
            }

            observer.emit('parse-result', {
                alreadyImported: false,
                route: new Route(result.data, result.details),
                folderUri: target.folderUri,
                controlFileUri: target.controlFileUri,
                format: target.format
            } as ParsedRoute)
        }
        catch(err) {
            observer.emit('parse-result', {
                alreadyImported: false,
                route: result ? new Route(result.data, result.details) : undefined,
                folderUri: target.folderUri,
                controlFileUri: target.controlFileUri,
                format: target.format,
                parseError: err?.message ?? String(err)
            } as ParsedRoute)
        }
    }

    private validateVideoUrl(routeDetail:RouteApiDetail,folderUri:string, folderFiles:ReadDirResult[]) {
        if (this.isMobile()) {
            if (routeDetail.video.format==='avi') {
                throw new Error('AVI video not supported')
            }
        }
        if (routeDetail.video.file) {
            routeDetail.video.file = this.resolveVideoUri(routeDetail.video.file,folderUri,folderFiles)
        }
    }

    private async _ingest(routes:ParsedRoute[], observer: Observer): Promise<void> {

        await waitNextTick()

        const service = this.getRouteList()
        const db = this.getRoutesDBLoader()

        const target = routes.filter( r=>!r.alreadyImported && !r.parseError)

        const total = target.length
        let errors = 0
        const failedRoutes: FailedRoute[] = []
        const importedRoutes: Route[] = []

        for (let i = 0; i < target.length; i++) {
            if (this.isCancelled)
                continue

            const {route} = target[i]??{};

            try {

                observer.emit('ingest-progress', { current: i + 1, total, currentName: route.title})
                await db.save(route,true)
                service.addRoute(route,'user')
                importedRoutes.push(route)                
            }
            catch(err:any) {
                const reason = err?.message ?? String(err)
                errors++
                failedRoutes.push({ name: route.title, reason })
                observer.emit('ingest-error', { name: route.title, reason })

            }
        }
        const skipped = routes.length - target.length
        observer.emit('ingest-complete', { imported:importedRoutes.length, skipped, errors, failedRoutes,importedRoutes })
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

    private buildRouteDisplayItem(parsed:ParsedRoute):RouteDisplayItem {
        const {route,alreadyImported,parseError,format} = parsed
        const descr = route?.description??{}

        const [C,U] = this.getUnitConversionShortcuts()
        const distance = descr.distance===undefined ? undefined : {
                value: C( descr.distance,'distance',{digits:1}),
                unit: U('distance')
            }

        return {
            id:route.description.id,
            distance,
            label: route.title,
            alreadyImported,
            importable: parseError==null,
            format,
            errorReason:parseError
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
