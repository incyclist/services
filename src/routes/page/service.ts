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
            catch(err) {
                this.logError(err,'openPage')
            }
            return this.getPageObserver()
        }   
        catch(err) {
            this.logError(err,'openPage')

        }
    }
    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page',null)
            this.logEvent({message:'page closed', page:'Routes'})        

            super.closePage()
        }
        catch(err) {
            this.logError(err,'closePage')
        }
    }
    pausePage(): Promise<void> {
        try {
            this.stopEventListener()
            return super.pausePage()
        }
        catch(err) {
            this.logError(err,'pausePage')
        }
    }

    resumePage(): Promise<void>  {
        try {
            this.startEventListener()
            return super.resumePage()
        }
        catch(err) {
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
                        filters,filterVisible, showImportDialog:false}
            }
            else {
                const showImport = false // TODO
                const synchronizing = false // TODO
                
                const routes = this.getRoutesDisplayProps()

                const filterOptions = service.getFilterOptions()
                
                const detailRouteId = this.detailRouteId
                
                return {loading,synchronizing, routes,displayType,
                        filters,filterVisible, filterOptions,
                        detailRouteId, showImportDialog:this.showImportDialog}

            }
        }        
        catch(err) {
            this.logError(err,'getPageDisplayProps')
            return {} as RoutePageDisplayProps
        }
    }


    onFilterChanged( filters:SearchFilter ) {
        try {
            this.serviceState = this.getRouteList().search(filters)

            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onFilterChanged')
        }
    }

    onFilterVisibleChange(visible:boolean) {
        try {
            this.getUserSettings().set('preferences.search.filterVisible',visible);
        }
        catch(err) {
            this.logError(err,'onFilterVisibleChange')
        }
    }

    onImportClicked():void {
        try {
            this.showImportDialog = true;
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onImportClicked')
        }
    }

    onSelect(id:string):void {
        try {
            this.detailRouteId = id;
            this.updatePageDisplay()
        }
        catch(err) {
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
        catch(err) {
            this.logError(err,'onDelete')
        }
    }

    start() {
        try {
            const service = this.getRouteList()
            const pairing = this.getDevicePairing()
            
            
            const {id,title,videoUrl} = service.getStartSettings()??{} as any
            this.logEvent( {message:'Attempting to start a ride',id,title,videoUrl,readyToStart:pairing.isReadyToStart(), } )
            
            service.close()       
            const next =  pairing.isReadyToStart() ? '/rideDeviceOK'  : '/pairingStart' 
            this.moveTo(next)
        }
        catch(err) {
            this.logError(err,'start')
        }

    }

    startImport(info:FileInfo|Array<FileInfo>): IObserver {
        try {
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
        catch(err) {
            this.logError(err,'start')
        }

    }

    onImportClosed(): void  {
        try {
            if (this.importObserver)
                this.importObserver.stop()

            this.serviceState = this.getRouteList().search()
            this.importObserver = undefined
            this.importProps = undefined
            this.showImportDialog = false
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onImportClosed')
        }
    }

    getImportDisplayProps(): RouteImportDialogDisplayProps {
        try {
            return this.importProps
        }
        catch(err) {
            this.logError(err,'getImportDisplayProps')
        }

    }




    protected updatePageDisplay() {
        this.getPageObserver()?.emit('page-update')
    }

    protected getRoutesDisplayProps():Array<RouteItemProps> {
        const {routes} = this.serviceState??{}

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