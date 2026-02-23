import { IPageService } from "../../base/pages";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { DisplayType, SearchFilter, SearchFilterOptions } from "../list/types";



export interface RoutePageDisplayProps extends IPageCallBacks {
    loading: boolean            // indicates that the service is still loading the routes
    synchronizing?: boolean,    // indicates that a background synch is ongoing
    displayType?: DisplayType   // indicates the prefered display type (always 'list' for now)
    showImport?: boolean        // defines if the UI should render an Import button (always false for now)
    filters: SearchFilter;
    filterVisible: boolean;
    filterOptions: SearchFilterOptions
    routes?: Array<RouteItemProps>
    detailRouteId?: string    
}


export interface RouteItemProps extends SummaryCardDisplayProps {
    onDelete: (id: string) => void;
    onSelect: (id: string) => void;
}


export interface IPageCallBacks  {
    onFilterChanged( filters:SearchFilter )
    onImportClicked():void
    onFilterVisibleChange(visible:boolean):void
}

export interface IRoutePageService extends IPageService, IPageCallBacks {
    getPageDisplayProps():RoutePageDisplayProps
}