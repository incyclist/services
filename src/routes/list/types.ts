// External (Public) Interfaces

import { LatLng } from "../../utils/geo";
import { RouteApiDetail } from "../base/api/types";
import { LocalizedText, RoutePoint, RouteSegment, RouteState, RouteCategory, RouteProvider  } from "../base/types";

export interface IRouteListBinding {
    
}

export type RouteListStartProps = {
    onStatusUpdate: RouteListStatusUpdateCallback,
    language?:string,
    visibleCards?:number;
    visibleLists?:number;
}

export type CardType = 'route'|'free-ride'|'import'

export interface CardInfo {
    type: CardType
    state: RouteState;
    title?: string;
}

export interface RouteInfo  extends CardInfo{
    id?: string;   
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
    points?: Array<RoutePoint>|string,
    segments?:Array<RouteSegment>    
}


export interface RouteDBEntry extends RouteInfo {
    list: List,
    settings?: {
        position?: number,
        segment?:string,
        realityFactor?:number
    
    }
    cntStarts?:number,
    lastStart?: number

}

export type RoutesDB = { [index:string]:RouteDBEntry  }

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
    type?: CardType,
    startPos?:number,
    endPos?:number,
    segment?: string,
    realityFactor?: number,
    position?:LatLng,
    options?
}
export type RouteSettingsState = {
    route: RouteInfo
    settings: RouteStartSettings
} 

export type FreeRideSettings = {
    position?:LatLng
    options?
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
    preloadDone: boolean
    selectedType?:  CardType
    selectedPosition?: LatLng
    selectedOptions?

}

export type RouteStartState = 'idle' | 'preparing'| 'selected' | 'started'

export type Card<T> = {
    id: string;
    data: T
    details?: RouteApiDetail
    startSettings?: RouteStartSettings
    startState?:RouteStartState
}


export type CardListEntry<T> = {
    list:List,
    routes: Array<Card<T>>
}

export type Route = Card<RouteInfo>
export type RouteListEntry  = CardListEntry<RouteInfo>


export type List = 'myRoutes' | 'alternatives' | 'selected'