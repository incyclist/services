import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { FileInfo, IObserver, RouteImportDialogDisplayProps, RouteImportDisplayProps } from "../../types";
import { useRouteList } from "../list";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { SearchFilter, SearchState } from "../list/types";
import { IRoutePageService, RouteItemProps, RoutePageDisplayProps  } from "./types";
import { useUserSettings } from "../../settings";
import { Observer } from "../../base/types";
import { v4 } from "uuid";
import { sleep } from "../../utils/sleep";
import { useDevicePairing } from "../../devices";

@Singleton
export class RoutesPageService extends IncyclistPageService implements IRoutePageService {

    protected serviceState: SearchState
    protected detailRouteId: string|undefined
    

    protected updateStateHandler    =  this.onStateUpdate.bind(this)
    protected syncStartHandler      = this.onSycncStart.bind(this)
    protected syncStopHandler       = this.onSyncStop.bind(this)
    protected updateSelectStateHandler  = this.onDialogClosed.bind(this)

    // Import Handlers
    protected showImportDialog: boolean = false
    protected importObserver: Observer|undefined
    protected importProps: Array<RouteImportDisplayProps>
    

    constructor()  {
        super('RoutesPage')
    }

    openPage(): IObserver {

        this.logEvent({message:'page shown', page:'Routes'})
        EventLogger.setGlobalConfig('page','Routes')

        super.openPage()

        try {
            const service = useRouteList()
            const filters = this.getSearchFilters()

            this.serviceState = service.search(filters)
            if (this.serviceState.observer) {
                this.startEventListener()
            }
        }
        catch(err) {
            this.logError(err,'openPage')
        }
        return this.getPageObserver()

    }
    closePage(): void {
        EventLogger.setGlobalConfig('page',null)
        this.logEvent({message:'page closed', page:'Routes'})        

        super.closePage()
    }
    pausePage(): Promise<void> {
        this.stopEventListener()
        return super.pausePage()
    }

    resumePage(): Promise<void>  {
        this.startEventListener()
        return super.resumePage()
    }

    getPageDisplayProps():RoutePageDisplayProps {
        const service = this.getRouteList()

        const displayType = service.getDisplayType()
        const showImport = false // TODO
        const synchronizing = false // TODO
        const loading = this.serviceState===undefined || service.isStillLoading()
        const routes = this.getRoutesDisplayProps()

        const filterOptions = service.getFilterOptions()
        
        const detailRouteId = this.detailRouteId
        const filterVisible = this.getUserSettings().getValue('preferences.search.filterVisible',false);
        const filters = service.getFilters()
        
        return {loading,synchronizing, routes,displayType,
                filters,filterVisible, filterOptions,
                detailRouteId, showImportDialog:this.showImportDialog}
        
    }


    onFilterChanged( filters:SearchFilter ) {
        this.serviceState = this.getRouteList().search(filters)

        this.updatePageDisplay()
    }

    onFilterVisibleChange(visible:boolean) {
        this.getUserSettings().set('preferences.search.filterVisible',visible);
    }

    onImportClicked():void {
        this.showImportDialog = true;
        this.updatePageDisplay()
    }

    onSelect(id:string):void {
        this.detailRouteId = id;
        this.updatePageDisplay()
    }

    onDelete(id:string):void {
        const service = this.getRouteList()
        const card = service.getCard(id)
        if (card)
            card.delete()
    }

    start() {
        const service = this.getRouteList()
        const pairing = this.getDevicePairing()
        
        
        const {id,title,videoUrl} = service.getStartSettings()??{} as any
        this.logEvent( {message:'Attempting to start a ride',id,title,videoUrl,readyToStart:pairing.isReadyToStart(), } )
        
        service.close()       
        const next =  pairing.isReadyToStart() ? '/rideDeviceOK'  : '/pairingStart' 
        this.moveTo(next)

    }

    startImport(info:FileInfo|Array<FileInfo>): IObserver {
        if (this.importObserver)
            return this.importObserver;


        this.importObserver = new Observer()

        const imports: Array<FileInfo> = Array.isArray(info) ? info : [info]
        this.importProps  = this.importProps ?? []

        imports.forEach ( (i:FileInfo) => { 
            this.prepareSingleImport(i)
        })



        return this.importObserver

    }

    onImportClosed(): void  {
        if (this.importObserver)
            this.importObserver.stop()

        this.serviceState = this.getRouteList().search()
        this.importObserver = undefined
        this.importProps = undefined
        this.showImportDialog = false
        this.updatePageDisplay()
    }

    getImportDisplayProps(): RouteImportDialogDisplayProps {
        return this.importProps
    }




    protected updatePageDisplay() {
        this.getPageObserver().emit('page-update')
    }

    protected getRoutesDisplayProps():Array<RouteItemProps> {
        const {routes} = this.serviceState

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
        const {observer} = this.serviceState
        if (!observer)
            return
        observer.on('updated', this.updateStateHandler)
        observer.on('loaded', this.updateStateHandler)
        observer.on('sync-start', this.syncStartHandler)
        observer.on('sync-done', this.syncStopHandler)
        observer.on('selected', this.updateSelectStateHandler)

       
    }

    protected stopEventListener(final?:boolean) {
        const {observer} = this.serviceState
        if (!observer)
            return

        if (final)
            observer.stop()
        observer.off('updated', this.updateStateHandler)
        observer.off('loaded', this.updateStateHandler)
        observer.off('sync-start', this.syncStartHandler)
        observer.off('sync-done', this.syncStopHandler)
        observer.off('selected', this.updateSelectStateHandler)
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
        
        const route = this.getRouteList().getSelected()

        this.detailRouteId = null
        this.updatePageDisplay()
    }

    protected prepareSingleImport(file:FileInfo) {
        const observer = new Observer();
        const props:RouteImportDisplayProps = {
            id: v4(),
            status: 'idle',
            fileName: file.name
        }
        this.importProps.push(props)
      

        observer.once( 'success', ()=> { 
            props.status = 'success'
            this.updateImportDialogDisplay()
            observer.stop()
        })
        observer.once( 'error', (id:string, error:string)=> { 
            props.status = 'error'
            props.error = error;
            this.updateImportDialogDisplay()
            observer.stop()
        } )


        sleep(5).then( ()=> {
            this.getRouteList().import(file,{importId:props.id,observer})
            props.status = 'parsing'
            this.updateImportDialogDisplay()

        })
    }



    protected updateImportDialogDisplay() {
        this.importObserver?.emit('update')
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

}


export const getRoutesPageService = ()=> new RoutesPageService()