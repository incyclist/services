import { IPageService } from "../../base/pages";
import { ImportDisplayProps, IObserver, RouteImportStatus } from "../../types";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { DisplayType, SearchFilter, SearchFilterOptions } from "../list/types";



export interface RoutePageDisplayProps  {
    loading: boolean            // indicates that the service is still loading the routes
    synchronizing?: boolean,    // indicates that a background synch is ongoing
    displayType?: DisplayType   // indicates the prefered display type (always 'list' for now)
    showImport?: boolean        // defines if the UI should render an Import button (always false for now)
    filters: SearchFilter;
    filterVisible: boolean;
    filterOptions?: SearchFilterOptions
    routes?: Array<RouteItemProps>
    detailRouteId?: string    
    downloadObserver?: IObserver
    showImportDialog?: boolean

}


export type RouteItemProps = SummaryCardDisplayProps


export interface IPageCallBacks  {
    onFilterChanged( filters:SearchFilter ):void
    onImportClicked():void
    onFilterVisibleChange(visible:boolean):void
}

export interface RouteImportDisplayProps {
    id: string
    status: RouteImportStatus
    fileName?: string
    error?: string
}



export interface IRoutePageService extends IPageService, IPageCallBacks {
    getPageDisplayProps():RoutePageDisplayProps
    onImportClosed(): void   // called when user explicitly closes dialog
    getImportDisplayProps(): ImportDisplayProps
}

export type DownloadStatus = 'downloading' | 'done' | 'failed' | 'required'

export interface DownloadRowDisplayProps {
    routeId: string
    title: string
    status: DownloadStatus
    pct?: number      // 0–100, present when status === 'downloading'
}