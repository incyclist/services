import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { IObserver } from "../../types";
import { useRouteList } from "../list";
import { SearchFilter, SearchState } from "../list/types";
import { IRoutePageService, RouteItemProps, RoutePageDisplayProps  } from "./types";

@Singleton
export class RoutePageService extends IncyclistPageService implements IRoutePageService {

    protected serviceState: SearchState
    protected openedRoute: string|undefined

    protected updateStateHandler
    protected syncStartHandler
    protected syncStopHandler

    openPage(): IObserver {
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

        }
        return this.getPageObserver()

    }
    closePage(): void {
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
        const {filters} = this.serviceState

        const displayType = service.getDisplayType()
        const showImport = false // TODO
        const synchronizing = false // TODO
        const loading = this.serviceState===undefined
        const routes = this.getRoutesDisplayProps()

        const onImportClicked = this.onImportClicked.bind(this)
        const onFilterChanged = this.onFilterChanged.bind(this)

        return {loading,synchronizing, routes,displayType,
            onFilterChanged, onImportClicked}
        
    }


    onFilterChanged( filters:SearchFilter ) {
        this.serviceState = this.getRouteList().search(filters)
        this.getPageObserver().emit('page-update')
    }

    onImportClicked():void {
        // TODO
    }

    onSelect(id:string):void {
        this.openedRoute = id;

        // const service = this.getRouteList()
        // const card = service.getCard(id)
      

    }

    onDelete(id:string):void {
        const service = this.getRouteList()
        const card = service.getCard(id)
        if (card)
            card.delete()
    }

    protected getRoutesDisplayProps():Array<RouteItemProps> {
        const {routes} = this.serviceState

        // TODO
        
        return routes as Array<RouteItemProps>
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


    }


    @Injectable
    protected getRouteList() {
        return useRouteList()
    }



}