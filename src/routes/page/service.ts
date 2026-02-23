import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { IObserver } from "../../types";
import { useRouteList } from "../list";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { SearchFilter, SearchState } from "../list/types";
import { IRoutePageService, RouteItemProps, RoutePageDisplayProps  } from "./types";
import { useUserSettings } from "../../settings";

@Singleton
export class RoutesPageService extends IncyclistPageService implements IRoutePageService {

    protected serviceState: SearchState
    protected detailRouteId: string|undefined
    

    protected updateStateHandler    =  this.onStateUpdate.bind(this)
    protected syncStartHandler      = this.onSycncStart.bind(this)
    protected syncStopHandler       = this.onSyncStop.bind(this)
    protected updateSelectStateHandler  = this.onSelecetStateUpdate.bind(this)

    constructor()  {
        super('RoutesPage')
    }

    openPage(): IObserver {

        this.logEvent({message:'page shown', page:'Routes'})
        console.log( new Date().toISOString(), '# route page opened' )
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
        const loading = this.serviceState===undefined
        const routes = this.getRoutesDisplayProps()

        const onImportClicked = this.onImportClicked.bind(this)
        const onFilterChanged = this.onFilterChanged.bind(this)
        const onFilterVisibleChange = this.onFilterVisibleChange.bind(this)

        const filterOptions = service.getFilterOptions()
        
        const detailRouteId = this.detailRouteId
        const filterVisible = this.getUserSettings().getValue('preferences.search.filterVisible',false);
        const filters = service.getFilters()
        
        return {loading,synchronizing, routes,displayType,
                filters,filterVisible, filterOptions,detailRouteId,
                onFilterChanged, onImportClicked, onFilterVisibleChange}
        
    }


    onFilterChanged( filters:SearchFilter ) {
        this.serviceState = this.getRouteList().search(filters)

        this.updatePageDisplay()
    }

    onFilterVisibleChange(visible:boolean) {

        console.log('# onFilterVisibleChange',visible)
        this.getUserSettings().set('preferences.search.filterVisible',visible);
    }

    onImportClicked():void {
        // TODO
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

    protected updatePageDisplay() {
        this.getPageObserver().emit('page-update')
    }

    protected getRoutesDisplayProps():Array<RouteItemProps> {
        const {routes} = this.serviceState

        const getRouteProps = (routeProps:SummaryCardDisplayProps) => {
            return {
                ...routeProps,
                onSelect: this.onSelect.bind(this),
                onDelete: this.onDelete.bind(this)
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
        observer.on('sync-start', this.syncStartHandler)
        observer.on('sync-done', this.syncStopHandler)
        observer.on('select-state-update', this.updateSelectStateHandler)

       
    }

    protected stopEventListener(final?:boolean) {
        const {observer} = this.serviceState
        if (!observer)
            return

        if (final)
            observer.stop()
        observer.off('updated', this.updateStateHandler)
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

    protected onSelecetStateUpdate() {
        
        const route = this.getRouteList().getSelected()

        console.log()
        this.detailRouteId = route?.description?.id
        this.updatePageDisplay()
    }



    @Injectable
    protected getRouteList() {
        return useRouteList()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

}


export const getRoutesPageService = ()=> new RoutesPageService()