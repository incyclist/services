// External (Public) Interfaces

import { RouteApiDetail } from "../base/api/types";
import { RouteState, RouteCategory, RouteProvider  } from "../base/types";

export interface IRouteListBinding {
    
}

export type RouteListStartProps = {
    onStatusUpdate: RouteListStatusUpdateCallback,
    language?:string,
    visibleCards?:number;
    visibleLists?:number;
}

export type RoutePoint = {
    lat: number
    lng: number
    routeDistance: number
    elevation: number
    slope:number
}

export type LocalizedText = { [index:string]:string  }


export type RouteInfo = {
    state: RouteState;
    id?: string;   
    title?: string;
    localizedTitle?: LocalizedText
    country?: string;
    distance?: number;
    elevation?: number;    
    category?: RouteCategory
    provider?: RouteProvider
    hasGpx?: boolean;
    hasVideo?: boolean;
    isDemo?: boolean;
    requiresDownload?: boolean;
    videoFormat?: string;   
    videoUrl?:string;
    previewUrl?:string;
    points?: Array<RoutePoint> 
}

export type RouteListDateEntry = {
    list: List,
    listHeader: string,
    routes: Array<RouteInfo>
}

export type RouteListData = {
    pageId: string,    
    lists: Array<RouteListDateEntry>
}


export type RouteListStatusUpdateCallback = (data:RouteListData)=>void

// --------------------------------------
// Internal (Protected) Interfacs
// --------------------------------------


export type Page = {
    id:string, 
    state: RouteListData
    language:string,
    onStatusUpdate: RouteListStatusUpdateCallback
}

export interface LoadingState {
    promise,    
}

export interface InternalRouteListState {
    initialized: boolean
    pages: Array<Page>
    loading?:LoadingState 
}

export type Route = {
    id: string;
    data: RouteInfo
    details?: RouteApiDetail
}

export type RouteListEntry = {
    list:List,
    routes: Array<Route>
}

export type List = 'myRoutes' | 'alternatives' | 'selected'