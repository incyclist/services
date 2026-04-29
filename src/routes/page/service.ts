import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { FileInfo, FolderInfo, ImportDisplayProps, IObserver, ParsedRoute, ScannedRoute } from "../../types";
import { useRouteList } from "../list";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { SearchFilter, SearchState } from "../list/types";
import { DownloadRowDisplayProps, IRoutePageService, RouteItemProps, RoutePageDisplayProps  } from "./types";
import { useUserSettings } from "../../settings";
import { Observer } from "../../base/types";
import { sleep } from "../../utils/sleep";
import { useDevicePairing } from "../../devices";
import { Route } from "../base/model/route";
import { DownloadObserver } from "../download/types";
import { useRouteDownload } from "../download/service";
import { useRouteLibraryScanner } from "../library/service";

@Singleton
export class RoutesPageService extends IncyclistPageService implements IRoutePageService {

    protected serviceState: SearchState|undefined
    protected detailRouteId: string|undefined
    

    protected updateStateHandler    =  this.onStateUpdate.bind(this)
    protected syncStartHandler      = this.onSycncStart.bind(this)
    protected syncStopHandler       = this.onSyncStop.bind(this)
    protected updateSelectStateHandler  = this.onDialogClosed.bind(this)

    // Import Handlers
    protected showImportDialog: boolean = false
    protected importObserver: Observer|undefined

    // downloads
    protected downloadCache: Map<string, DownloadRowDisplayProps> 
    protected downloadHandlers: Map<string, {
        onProgress: (pct: number) => void
        onDone: () => void
        onError: () => void
        onStopped: () => void
    }>
    protected downloadObserver: Observer = new Observer()
    

    constructor()  {
        super('RoutesPage')

        this.downloadCache = new Map()
        this.downloadHandlers = new Map()
    }

    openPage(): IObserver {
        try {
            this.logEvent({message:'page shown', page:'Routes'})
            EventLogger.setGlobalConfig('page','Routes')

            super.openPage()

            try {
                const service = useRouteList()
                const filters = this.getSearchFilters()

                const start = ()=> {
                    this.serviceState = service.search(filters)
                    if (this.serviceState.observer) {
                        this.startEventListener()
                    }
                    sleep(5).then( ()=>{
                            this.updatePageDisplay()
                    })

                }

                if (service.isStillLoading()) {                    
                    service.once('load-done',()=> {
                        start()
                      
                    })
                }
                else {
                    start()
                }
                

            }
            catch(err:any) {
                this.logError(err,'openPage')
            }
        }   
        catch(err:any) {
            this.logError(err,'openPage')

        }
        return this.getPageObserver()        
    }

    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page',null)
            this.logEvent({message:'page closed', page:'Routes'})        

            this.stopEventListener()
            this.downloadCache.clear()
            this.downloadObserver.stop()
            super.closePage()
        }
        catch(err:any) {
            this.logError(err,'closePage')
        }
    }
    async pausePage(): Promise<void> {
        try {
            this.stopEventListener()
            return super.pausePage()
        }
        catch(err:any) {
            this.logError(err,'pausePage')
        }
    }

    async resumePage(): Promise<void>  {
        try {
            this.startEventListener()
            return super.resumePage()
        }
        catch(err:any) {
            this.logError(err,'resumePage')
        }
    }

    getPageDisplayProps():RoutePageDisplayProps {
        try {
            const service = this.getRouteList()

            const loading = this.serviceState===undefined || service.isStillLoading()
            const displayType = service.getDisplayType()
            const filterVisible = this.getUserSettings().getValue('preferences.search.filterVisible',false);
            const filters = service.getFilters()

            if (loading) {
                return {loading,synchronizing:false, routes:[],displayType,
                        filters,filterVisible, 
                        downloadObserver:this.downloadObserver,
                        showImportDialog:false}
            }
            else {
                const synchronizing = false // TODO
                
                const routes = this.getRoutesDisplayProps()

                const filterOptions = service.getFilterOptions()
                
                const detailRouteId = this.detailRouteId
                
                return {loading,synchronizing, routes,displayType,
                        filters,filterVisible, filterOptions,
                        detailRouteId, 
                        downloadObserver:this.downloadObserver,
                        showImportDialog:this.showImportDialog}

            }
        }        
        catch(err:any) {
            this.logError(err,'getPageDisplayProps')
            return {} as RoutePageDisplayProps
        }
    }


    onFilterChanged( filters:SearchFilter ) {
        try {
            this.serviceState = this.getRouteList().search(filters)

            this.updatePageDisplay()
        }
        catch(err:any) {
            this.logError(err,'onFilterChanged')
        }
    }

    onFilterVisibleChange(visible:boolean) {
        try {
            this.getUserSettings().set('preferences.search.filterVisible',visible);
        }
        catch(err:any) {
            this.logError(err,'onFilterVisibleChange')
        }
    }

    onImportClicked():void {
        try {
            this.showImportDialog = true;
            this.getRouteLibraryScanner().prepare()
            this.updatePageDisplay()
        }
        catch(err:any) {
            this.logError(err,'onImportClicked')
        }
    }


    /**
     * 
     * Imports a single GPX or video route control file. 
     * 
     * Observer events:
     * 'parsing'
     * 'success' (routeName: string)
     * 'error' (reason: string)     * 
     * 
     * @param fileInfo file to import
     * @returns Observer that emits the events listed above
     */


    importSingleRoute(fileInfo: FileInfo): IObserver {
        try {
            return this.getRouteLibraryScanner().importSingle(fileInfo)
        }
        catch(err) {
            this.logError(err, 'importSingleRoute')
        }

    }

    /**
     * Scans a folder tree for importable routes, streaming results as they are discovered.
     *
     * @param folderInfo Folder to scan (uri + displayName).
     * @returns Observer that emits `'discovered'`, `'scan-progress'`, and `'scan-complete'` events.
     */

    startLibraryScan(folderInfo: FolderInfo): IObserver {
        try {
            return this.getRouteLibraryScanner().scan(folderInfo)
        }
        catch(err) {
            this.logError(err, 'startLibraryScan')
        }
    }

    /**
     * Parses a list of discovered routes sequentially, streaming results as they are parsed.
     *
     * @param folderInfo Folder to scan (uri + displayName).
     * @returns Observer that emits `'parse-result'`, `'parse-complete'` events.
     */

    startLibraryParse(scannedRoutes: ScannedRoute[]): IObserver {
        try {
            
            return this.getRouteLibraryScanner().parse(scannedRoutes)
        }
        catch(err) {
            this.logError(err, 'startLibraryParse')
        }

    }

    importSelected(routes: ParsedRoute[]): IObserver {
        
        try {
            return this.getRouteLibraryScanner().ingest(routes)            
        }
        catch(err) {
            this.logError(err, 'startLibraryParse')
        }
    }

    cancelLibraryImport(): void {
        try {
            return this.getRouteLibraryScanner().cancel()
        }
        catch(err) {
            this.logError(err, 'cancelLibraryImport')
        }

    }

    getImportDisplayProps(): ImportDisplayProps {
        return this.getRouteLibraryScanner().getDisplayProps()
    }

    onImportClosed(): void  {
        try {
            if (this.importObserver)
                this.importObserver.stop()

            this.getRouteLibraryScanner().done()

            this.importObserver = undefined
            this.showImportDialog = false
            this.getPageObserver().emit('import-closed')
            
            this.serviceState = this.getRouteList().search()
            this.updatePageDisplay()
            
        }
        catch(err:any) {
            this.logError(err,'onImportClosed')
        }
    }



    onSelect(id:string):void {
        try {
            this.detailRouteId = id;
            this.updatePageDisplay()
        }
        catch(err:any) {
            this.logError(err,'onSelect')
        }
    }

    onDelete(id:string):void {
        try {
            const service = this.getRouteList()
            const card = service.getCard(id)
            if (card)
                card.delete()
        }
        catch(err:any) {
            this.logError(err,'onDelete')
        }
    }

    start() {
        try {
            const service = this.getRouteList()
            const pairing = this.getDevicePairing()
            
            const setttings:any = service.getStartSettings()??{} as any
            const {id,title,videoUrl} = setttings
            this.logEvent( {message:'Attempting to start a ride',id,title,videoUrl,readyToStart:pairing.isReadyToStart(), } )
            
            service.close()       
            const next =  pairing.isReadyToStart() ? '/rideDeviceOK'  : '/pairingStart' 
            this.moveTo(next)
        }
        catch(err:any) {
            this.logError(err,'start')
        }

    }



    protected getDownloadDisplayProps(): DownloadRowDisplayProps[] {        
        return Array.from(this.downloadCache.values())
    }



    protected updatePageDisplay() {
        this.getPageObserver()?.emit('page-update')
    }

    protected getRoutesDisplayProps():Array<RouteItemProps> {
        const {routes=[]} = this.serviceState??{}

        const getRouteProps = (routeProps:SummaryCardDisplayProps) => {
            return {
                ...routeProps,
                // onSelect: this.onSelect.bind(this),
                // onDelete: this.onDelete.bind(this)
            }
        }
        
        return routes.map( getRouteProps)
    }

    protected getSearchFilters():SearchFilter {
        return this.getRouteList().getFilters()

    }

    protected startEventListener() {
        const {observer} = this.serviceState??{}
        if (!observer)
            return
        observer.on('updated', this.updateStateHandler)
        observer.on('loaded', this.updateStateHandler)
        observer.on('sync-start', this.syncStartHandler)
        observer.on('sync-done', this.syncStopHandler)
        observer.on('selected', this.updateSelectStateHandler)

        this.subscribeAllActiveDownloads()

        // subscribe to future downloads started while the page is open
        this.getRouteDownload().on('download-started', this.downloadStartedHandler)        
        
    }

    protected stopEventListener(final?:boolean) {
        const {observer} = this.serviceState??{}
        if (!observer)
            return

        if (final)
            observer.stop()
        observer.off('updated', this.updateStateHandler)
        observer.off('loaded', this.updateStateHandler)
        observer.off('sync-start', this.syncStartHandler)
        observer.off('sync-done', this.syncStopHandler)
        observer.off('selected', this.updateSelectStateHandler)

        this.unsubscribeAllActiveDownloads()

        this.getRouteDownload().off('download-started', this.downloadStartedHandler)
    }


    protected subscribeToActiveDownload(route: Route, observer: DownloadObserver) {
        const routeId = route?.description?.id
        const title = route?.description?.title??''

        if (!routeId)
            return

        // avoid double-registration
        if (this.downloadHandlers.has(routeId)) return

        const onProgress = (pct: number) => {
            this.downloadCache.set(routeId, { routeId, title, status: 'downloading', pct })
            this.emitDownloadUpdate()
        }
        const onDone = () => {
            this.downloadCache.set(routeId, { routeId, title, status: 'done' })
            this.downloadHandlers.delete(routeId)
            this.emitDownloadUpdate()
        }
        const onError = () => {
            this.downloadCache.set(routeId, { routeId, title, status: 'failed' })
            this.downloadHandlers.delete(routeId)
            this.emitDownloadUpdate()
        }

        const onStopped = () => {
            this.downloadCache.delete(routeId)
            this.downloadHandlers.delete(routeId)
            this.emitDownloadUpdate()
        }        

        this.downloadHandlers.set(routeId, { onProgress, onDone, onError,onStopped })
        this.downloadCache.set(routeId, { routeId, title, status: 'downloading' })

        observer.on('progress', onProgress)
        observer.on('done', onDone)
        observer.on('error', onError)
        observer.on('stopped', onStopped)

        this.updatePageDisplay()
    }    

    protected subscribeAllActiveDownloads() {
        // pick up any downloads already in progress when the page opens
        this.getRouteDownload().getActiveDownloads().forEach(({route, observer}) => {
            this.subscribeToActiveDownload(route, observer)
        })
    }

    protected unsubscribeAllActiveDownloads() {
        // unregister all download observer listeners
        const active = this.getRouteDownload().getActiveDownloads()
        for (const {route, observer} of active) {
            const routeId = route?.description?.id
            if (routeId) {
                const handlers = this.downloadHandlers.get(routeId)
                if (handlers) {
                    observer.off('progress', handlers.onProgress)
                    observer.off('done', handlers.onDone)
                    observer.off('error', handlers.onError)
                    observer.off('stopped', handlers.onStopped)
                }

            }
        }
        this.downloadHandlers.clear()        
    }

    protected downloadStartedHandler = (route: Route, observer: DownloadObserver) => {
        this.subscribeToActiveDownload(route, observer)
    }

    protected emitDownloadUpdate() {
        this.downloadObserver.emit('download-update', {
            rows: this.getDownloadDisplayProps(),
            count: Array.from(this.downloadCache.values())
                .filter(r => r.status === 'downloading').length
        })
    }    

    protected onSycncStart() {
        this.updatePageDisplay()
    }

    protected onSyncStop() {
        this.updatePageDisplay()
    }

    protected onStateUpdate() {
        this.updatePageDisplay()
    }

    protected onDialogClosed() {
        this.detailRouteId = undefined
        this.updatePageDisplay()
    }

    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getRouteDownload() {
        return useRouteDownload()
    }

    @Injectable
    protected getRouteLibraryScanner() {
        return useRouteLibraryScanner()
    }

}


export const getRoutesPageService = ()=> new RoutesPageService()