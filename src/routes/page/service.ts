import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { FileInfo, FolderInfo, ImportDisplayProps, IObserver, ParsedRoute, ScannedRoute } from "../../types";
import { useRouteList } from "../list";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { SearchFilter, SearchState } from "../list/types";
import {
    AttachedWorkoutProps, DownloadRowDisplayProps, DownloadStatus, IRoutePageService, RouteDetailsProps,
    RouteItemProps, RoutePageDisplayProps, RouteVideoDisplayProps
} from "./types";
import { useUserSettings } from "../../settings";
import { Observer } from "../../base/types";
import { sleep } from "../../utils/sleep";
import { useDevicePairing } from "../../devices";
import { Route } from "../base/model/route";
import { DownloadObserver } from "../download/types";
import { useRouteDownload } from "../download/service";
import { useRouteLibraryScanner } from "../library/service";
import { useWorkoutList } from "../../workouts";
import { FolderAccessService, useFolderAccess } from "../../fileaccess/service";
import { PreviewStore, usePreviewStore } from "../previews";
import { RouteVideoAvailabilityService, useRouteVideoAvailability } from "../video-availability/service";
import { RouteVideoPageActions, useRouteVideoPageActions } from "../video-availability/pageActions";
import { RouteVideoState, VideoDownloadRow, VideoKeepChoice } from "../video-availability/types";

/** How long video-pill-driven page updates are coalesced before another render is requested. A
 *  route list can queue many availability queries at once (§3.4); without this, each one landing
 *  would trigger its own 'page-update'. */
const VIDEO_PILL_UPDATE_THROTTLE_MS = 300

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

    // video (§3.7): routeId the details dialog has already had a refresh() paid for, cleared
    // whenever the dialog closes so the next open pays for a fresh one; and the timer that
    // coalesces videoPill-driven page updates.
    protected videoRefreshedForRouteId: string|undefined
    protected videoPillUpdateTimer?: ReturnType<typeof setTimeout>
    // first-seen timestamp per server download, used only to order the merged Downloads list -
    // never exposed on the row itself (server rows keep their existing shape, §7.2 golden test).
    protected downloadFirstSeen: Map<string, number> = new Map()

    protected routeVideoUpdateHandler   = this.onRouteVideoUpdate.bind(this)
    protected downloadRowsUpdateHandler = this.emitDownloadUpdate.bind(this)
    protected accessChangedHandler      = this.updatePageDisplay.bind(this)

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

                    this.onRouteListLoaded()
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

    /**
     * iCloud activation sequence (design §3.7): grants first (so a query for coverage answers
     * correctly), then legacy preview adoption (which itself listens for further `access-changed`
     * events), then the orphan sweep. Fire-and-forget - the route list is already showing, and
     * every step here is a no-op without the fileAccess binding.
     */
    protected onRouteListLoaded(): void {
        this.getFolderAccess().activateAll()
            .then(() => this.getPreviewStore().adoptPending())
            .then(() => this.getPreviewStore().sweepOrphans())
            .then(() => this.updatePageDisplay())
            .catch(err => this.logError(err, 'onRouteListLoaded'))
    }

    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page',null)
            this.logEvent({message:'page closed', page:'Routes'})

            this.stopEventListener()
            this.downloadCache.clear()
            this.downloadFirstSeen.clear()
            this.downloadObserver.stop()
            this.clearVideoPillThrottle()
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
            this.getVideoAvailability().onForeground()
                .catch(err => this.logError(err, 'resumePage'))
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
        // dialog is already open, avoid duplicate initialization
        if (this.showImportDialog)
            return;

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
            const observer = this.getRouteLibraryScanner().importSingle(fileInfo)
            this.updatePageDisplay()
            return observer
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
            // fire-and-forget (§3.7): the grant is stored best-effort, the scan never waits on it
            this.getFolderAccess().registerGrant(folderInfo.uri, folderInfo.grant, folderInfo.grantError, folderInfo.displayName)
                .catch(err => this.logError(err, 'startLibraryScan'))

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
    onImportCancelled(): void  { 
        this.getRouteLibraryScanner().done()
    }

    onImportClosed(): void  {
        try {
            this.showImportDialog = false

            if (this.importObserver)
                this.importObserver.stop()

            this.getRouteLibraryScanner().done()

            this.importObserver = undefined
            this.getPageObserver()?.emit('import-closed')
            
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
            if (card) {
                card.delete()
            }
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



    /**
     * The workout currently paired with `routeId`, for the "Workout: <name>" row on the route
     * details dialog (HLD §4.2). Additive companion to `RouteCard.openSettings()` - see
     * mobile/internal/designs/workout-combo-service-design.md §3.5. Takes `routeId` (rather than
     * reading `this.detailRouteId`) so it stays a pure read for the route the dialog is actually
     * showing.
     */
    getRouteDetailsProps(routeId: string): RouteDetailsProps {
        try {
            return { routeId, attachedWorkout: this.getAttachedWorkoutProps(), video: this.getVideoDetailsProps(routeId) }
        }
        catch (err) {
            this.logError(err, 'getRouteDetailsProps')
            return { routeId, attachedWorkout: null }
        }
    }

    /**
     * The route details dialog's video state (§3.7). Absent whenever the platform has no
     * `fileAccess` binding, in which case the dialog renders exactly as before.
     *
     * The first call for a newly opened dialog pays for a `refresh()` (the C9 reconcile); every
     * further call for the same open dialog just reads what is already cached, and re-renders are
     * driven by the `route-details-update` event once the refresh resolves.
     */
    protected getVideoDetailsProps(routeId: string): RouteVideoDisplayProps | undefined {
        const actions = this.getVideoPageActions()
        if (!routeId || !actions.isSupported())
            return undefined

        if (this.videoRefreshedForRouteId !== routeId) {
            this.videoRefreshedForRouteId = routeId
            this.getVideoAvailability().refresh(routeId)
                .catch(err => this.logError(err, 'getVideoDetailsProps'))
        }

        return actions.getDisplayProps(routeId)
    }

    protected getAttachedWorkoutProps(): AttachedWorkoutProps | null {
        const workout = this.getWorkoutList().getSelected()
        if (!workout)
            return null
        return { id: workout.id, title: workout.name }
    }

    /**
     * '[x]' on the "Workout: <name>" row (HLD §4.2). Clears only the workout side of the
     * attachment. Deliberately does NOT clear the route selection - RoutesPageService subscribes
     * 'selected' on the route list observer and closes the details dialog on it (onDialogClosed);
     * clearing the route from inside the route dialog would close the dialog out from under the
     * user (design §3.5).
     */
    onClearWorkoutSelection(): void {
        try {
            this.getWorkoutList().unselect()
            this.updatePageDisplay()
        }
        catch (err) {
            this.logError(err, 'onClearWorkoutSelection')
        }
    }

    // ---- route video actions (§3.7) -------------------------------------------------
    //
    // Every handler just forwards to RouteVideoPageActions - the shared UI-state layer used by
    // every page service that shows a route's video (RoutesPageService route details,
    // ActivitiesPageService Ride Again) - and then lets the open details dialog re-read its props.
    // Harmless on platforms without the fileAccess binding: RouteVideoPageActions itself no-ops.

    onVideoDownloadPressed(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoDownloadPressed(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoDownloadPressed') }
    }

    onVideoDownloadConfirmed(routeId: string, choice: VideoKeepChoice): void {
        try {
            this.getVideoPageActions().onVideoDownloadConfirmed(routeId, choice)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoDownloadConfirmed') }
    }

    onVideoDownloadDismissed(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoDownloadDismissed(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoDownloadDismissed') }
    }

    onVideoStop(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoStop(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoStop') }
    }

    onVideoRetry(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoRetry(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoRetry') }
    }

    onVideoKeepInstead(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoKeepInstead(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoKeepInstead') }
    }

    onVideoRemovePressed(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoRemovePressed(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoRemovePressed') }
    }

    onVideoRemoveConfirmed(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoRemoveConfirmed(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoRemoveConfirmed') }
    }

    onVideoRemoveDismissed(routeId: string): void {
        try {
            this.getVideoPageActions().onVideoRemoveDismissed(routeId)
            this.emitRouteDetailsUpdate(routeId)
        }
        catch (err) { this.logError(err, 'onVideoRemoveDismissed') }
    }

    /** Confirm Access (§3.7): `access-changed` (emitted once the grant is stored) then drives
     *  preview adoption and state refresh on its own - this just relays the outcome back to the
     *  dialog that asked for it. */
    async onConfirmAccess(routeId: string): Promise<void> {
        try {
            await this.getVideoPageActions().onConfirmAccess(routeId)
            this.emitRouteDetailsUpdate(routeId)
            this.updatePageDisplay()
        }
        catch (err) {
            this.logError(err, 'onConfirmAccess')
        }
    }

    // ---- Downloads list rows (§3.7) -------------------------------------------------
    //
    // A server row (this.downloadCache) delegates to exactly the RouteCard calls mobile makes
    // today; an iCloud row (no matching server entry) delegates to RouteVideoAvailabilityService.

    onDownloadStop(routeId: string): void {
        try {
            if (this.isServerDownloadRow(routeId)) {
                this.getRouteList().getCard(routeId)?.stopDownload()
                return
            }
            this.getVideoAvailability().stop(routeId).catch(err => this.logError(err, 'onDownloadStop'))
        }
        catch (err) {
            this.logError(err, 'onDownloadStop')
        }
    }

    onDownloadRetry(routeId: string): void {
        try {
            if (this.isServerDownloadRow(routeId)) {
                this.getRouteList().getCard(routeId)?.download()
                return
            }
            this.getVideoAvailability().retry(routeId).catch(err => this.logError(err, 'onDownloadRetry'))
        }
        catch (err) {
            this.logError(err, 'onDownloadRetry')
        }
    }

    onDownloadDelete(routeId: string): void {
        try {
            if (this.isServerDownloadRow(routeId))
                this.getRouteList().getCard(routeId)?.deleteDownload()
            // iCloud rows have no delete action here - removal is only ever explicit, via the
            // route details "Remove" flow (RouteVideoAvailabilityService.remove).
        }
        catch (err) {
            this.logError(err, 'onDownloadDelete')
        }
    }

    onDownloadKeepInstead(routeId: string): void {
        try {
            if (this.isServerDownloadRow(routeId))
                return
            this.getVideoAvailability().setChoice(routeId, 'keep').catch(err => this.logError(err, 'onDownloadKeepInstead'))
        }
        catch (err) {
            this.logError(err, 'onDownloadKeepInstead')
        }
    }

    protected isServerDownloadRow(routeId: string): boolean {
        return this.downloadCache.has(routeId)
    }

    protected emitRouteDetailsUpdate(routeId: string): void {
        this.getPageObserver()?.emit('route-details-update', routeId)
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
            // videoPill (§3.4/§3.7): absent whenever there is nothing to show, which is always
            // the case without the fileAccess binding - getListPill() is inert by itself.
            const videoPill = routeProps.id ? this.getVideoAvailability().getListPill(routeProps.id) : undefined

            return {
                ...routeProps,
                videoPill,
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
        // §3.7: video pills, the Downloads list, and access recovery all drive a re-render - none
        // of this depends on the route list's own search observer, so it is wired independently
        // of the early return below (and is a no-op by itself without the fileAccess binding).
        this.getVideoAvailability().on('route-video-update', this.routeVideoUpdateHandler)
        this.getVideoAvailability().on('download-rows-update', this.downloadRowsUpdateHandler)
        this.getFolderAccess().on('access-changed', this.accessChangedHandler)

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

        this.getVideoAvailability().off('route-video-update', this.routeVideoUpdateHandler)
        this.getVideoAvailability().off('download-rows-update', this.downloadRowsUpdateHandler)
        this.getFolderAccess().off('access-changed', this.accessChangedHandler)

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

        this.markDownloadFirstSeen(routeId)

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
            this.downloadFirstSeen.delete(routeId)
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

    /**
     * The Downloads list (§3.7): server rows exactly as before, plus the additive `source`/
     * `actions`, merged with the iCloud rows this session's app-started downloads produced.
     *
     * Server rows are golden-compared (§7.2 test) - only `source` and `actions` may ever be added
     * to one, nothing existing may change. iCloud rows come from
     * `RouteVideoAvailabilityService.getDownloadRows()`, which is itself empty without the
     * fileAccess binding, so this whole merge is a plain pass-through of the server rows then.
     */
    protected emitDownloadUpdate() {
        const serverRows = this.buildServerDownloadRows()
        const icloudRows = this.buildICloudDownloadRows()

        const orderKey = (row: DownloadRowDisplayProps): number =>
            row.source === 'icloud' ? (row.startedAt ?? 0) : (this.downloadFirstSeen.get(row.routeId) ?? 0)

        const rows = [...serverRows, ...icloudRows].sort((a, b) => orderKey(a) - orderKey(b))

        const count =
            serverRows.filter(r => r.status === 'downloading').length +
            icloudRows.filter(r => r.status === 'downloading' || r.status === 'waiting').length

        this.downloadObserver.emit('download-update', { rows, count })
    }

    protected markDownloadFirstSeen(routeId: string): void {
        if (!this.downloadFirstSeen.has(routeId))
            this.downloadFirstSeen.set(routeId, Date.now())
    }

    /** Today's rows, unchanged, plus the additive `source`/`actions` (§7.2 golden test). */
    protected buildServerDownloadRows(): DownloadRowDisplayProps[] {
        return this.getDownloadDisplayProps().map(row => ({
            ...row,
            source: 'server' as const,
            actions: this.buildServerRowActions(row.status)
        }))
    }

    protected buildServerRowActions(status: DownloadStatus): NonNullable<DownloadRowDisplayProps['actions']> {
        // exactly the buttons DownloadModalView renders today, by status
        return {
            stop: status === 'downloading',
            retry: status === 'failed',
            delete: status === 'done',
            download: status === 'required',
            keepInstead: false
        }
    }

    /**
     * Rows for the iCloud downloads this app started this session. `getDownloadRows()` is already
     * empty without the binding, but `isSupported()` is also checked here so the mapping below is
     * never asked to run against an empty array for the wrong reason.
     */
    protected buildICloudDownloadRows(): DownloadRowDisplayProps[] {
        if (!this.getVideoAvailability().isSupported())
            return []

        return this.getVideoAvailability().getDownloadRows()
            .map(row => this.toICloudRowProps(row))
            .filter((row): row is DownloadRowDisplayProps => !!row)
    }

    protected toICloudRowProps(row: VideoDownloadRow): DownloadRowDisplayProps | undefined {
        const status = this.mapICloudDownloadStatus(row.state)
        // downloading-external isn't listed (§3.7): watched only, this app never started it
        if (!status)
            return undefined

        return {
            routeId: row.routeId,
            title: row.title,
            status,
            source: 'icloud',
            sizeBytes: row.sizeBytes,
            startedAt: row.startedAt,
            choice: row.choice,
            requiredBytes: row.requiredBytes,
            freeBytes: row.freeBytes,
            actions: this.buildICloudRowActions(status, row.choice)
        }
    }

    protected mapICloudDownloadStatus(state: RouteVideoState): DownloadStatus | undefined {
        switch (state) {
            case 'downloading': return 'downloading'
            case 'waiting-for-network': return 'waiting'
            case 'ready': return 'done'
            case 'cancelled': return 'required'
            case 'download-failed': return 'failed'
            case 'not-enough-storage': return 'not-enough-storage'
            default: return undefined
        }
    }

    protected buildICloudRowActions(
        status: DownloadStatus, choice?: VideoKeepChoice
    ): NonNullable<DownloadRowDisplayProps['actions']> {
        return {
            stop: status === 'downloading' || status === 'waiting',
            retry: status === 'failed',
            delete: false,
            download: status === 'required',
            keepInstead: status === 'done' && choice === 'this-ride'
        }
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
        // the next dialog open - even for the same route - pays for a fresh refresh() (§3.7)
        this.videoRefreshedForRouteId = undefined
        this.updatePageDisplay()
    }

    /**
     * `route-video-update` (§3.7): re-render for the video pill it may have changed, and - if the
     * update is for the route whose details dialog is currently open - let that dialog re-read its
     * props via `route-details-update` too. Page-display re-renders are throttled: a route list can
     * have many pills resolve in a burst, and each one landing must not cause its own render.
     */
    protected onRouteVideoUpdate(routeId?: string): void {
        this.scheduleThrottledPageUpdate()

        if (routeId && routeId === this.detailRouteId)
            this.emitRouteDetailsUpdate(routeId)
    }

    protected scheduleThrottledPageUpdate(): void {
        if (this.videoPillUpdateTimer)
            return

        this.videoPillUpdateTimer = setTimeout(() => {
            this.videoPillUpdateTimer = undefined
            this.updatePageDisplay()
        }, VIDEO_PILL_UPDATE_THROTTLE_MS)

        // a pending throttle must never be a reason for the process to stay alive
        ;(this.videoPillUpdateTimer as unknown as { unref?: () => void })?.unref?.()
    }

    protected clearVideoPillThrottle(): void {
        if (!this.videoPillUpdateTimer)
            return
        clearTimeout(this.videoPillUpdateTimer)
        this.videoPillUpdateTimer = undefined
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

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }

    @Injectable
    protected getFolderAccess(): FolderAccessService {
        return useFolderAccess()
    }

    @Injectable
    protected getPreviewStore(): PreviewStore {
        return usePreviewStore()
    }

    @Injectable
    protected getVideoAvailability(): RouteVideoAvailabilityService {
        return useRouteVideoAvailability()
    }

    @Injectable
    protected getVideoPageActions(): RouteVideoPageActions {
        return useRouteVideoPageActions()
    }

}


export const getRoutesPageService = ()=> new RoutesPageService()