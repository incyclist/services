import { IPageService } from "../../base/pages";
import { SummaryCardDisplayProps } from "../list/cards/RouteCard";
import { DisplayType, SearchFilter } from "../list/types";



export interface RoutePageDisplayProps extends IPageCallBacks {
    loading: boolean
    synchronizing?: boolean,
    displayType?: DisplayType
    showImport?: boolean

    routes?: Array<RouteItemProps>
}


export interface RouteItemProps extends SummaryCardDisplayProps {
    onDelete: (id: string) => void;
    onSelect: (id: string) => void;
}


export interface IPageCallBacks  {
    onFilterChanged( filters:SearchFilter )
    onImportClicked():void
}

export interface IRoutePageService extends IPageService, IPageCallBacks {
    getPageDisplayProps():RoutePageDisplayProps


}