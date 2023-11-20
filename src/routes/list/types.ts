// External (Public) Interfaces

import { RouteApiDetail } from "../base/api/types";
import { RoutePoint, RouteSegment } from "../base/types";
import { RouteState, RouteCategory, RouteProvider  } from "../base/types";

export interface IRouteListBinding {
    
}

export type RouteListStartProps = {
    onStatusUpdate: RouteListStatusUpdateCallback,
    language?:string,
    visibleCards?:number;
    visibleLists?:number;
}

export type LocalizedText = { [index:string]:string  }


export type RouteInfo = {
    state: RouteState;
    id?: string;   
    title?: string;
    localizedTitle?: LocalizedText
    country?: string;
    isLoop?:boolean;
    distance?: number;
    elevation?: number;    
    category?: RouteCategory
    provider?: RouteProvider
    isLocal?:boolean;
    hasGpx?: boolean;
    hasVideo?: boolean;
    isDemo?: boolean;
    requiresDownload?: boolean;
    videoFormat?: string;   
    videoUrl?:string;
    previewUrl?:string;
    points?: Array<RoutePoint>,
    segments?:Array<RouteSegment>    

}

export type RouteListDateEntry = {
    list: List,
    listHeader: string,
    routes: Array<RouteInfo>
    startIdx?:number,
    endIdx?:number
}



export type onRouteStatusUpdateCallback = (route:RouteInfo)=>void
export type onCarouselStateChangedCallback = (state:{initialized:boolean,visible:boolean})=>void

export type RouteListData = {
    pageId: string,    
    lists: Array<RouteListDateEntry>
}


export type RouteListStatusUpdateCallback = (data:RouteListData)=>void

export type RouteStartSettings = {
    startPos?:number,
    endPos?:number,
    segment?: string,
    realityFactor?: number
}
export type RouteSettingsState = {
    route: RouteInfo
    settings: RouteStartSettings
} 

// --------------------------------------
// Internal (Protected) Interfacs
// --------------------------------------


export type Page = {
    id:string, 
    state: RouteListData
    settingsState?: RouteSettingsState;
    language:string,
    onStatusUpdate: RouteListStatusUpdateCallback
    onRouteUpdate: { [index:string]: {idx:number, onRouteStateChanged:onRouteStatusUpdateCallback  }}
    onCarouselStateChanged: { [index:string]:{idx:number, onCarouselStateChanged:onCarouselStateChangedCallback  }}
}

export interface LoadingState {
    promise,    
}

export interface InternalRouteListState {
    initialized: boolean
    pages: Array<Page>
    loading?:LoadingState 
}

export type RouteStartState = 'idle' | 'preparing'| 'selected' | 'started'

export type Route = {
    id: string;
    data: RouteInfo
    details?: RouteApiDetail
    startSettings?: RouteStartSettings
    startState?:RouteStartState
}

export type RouteListEntry = {
    list:List,
    routes: Array<Route>
}

export type List = 'myRoutes' | 'alternatives' | 'selected'