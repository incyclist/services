import { FormattedNumber } from "../../i18n";
import { IncyclistNode } from "../../maps/MapArea/types";
import { LatLng } from "../../utils/geo"
import { RouteApiDetail } from "../base/api/types";
import { RouteInfo, RoutePoint } from "../base/types";
import { SummaryCardDisplayProps } from "./cards/RouteCard";
import { RouteCardType } from "./cards/types";

export interface RouteStartSettings {
    type: RouteCardType,
}

export type DisplayType = 'list' | 'tiles'

export interface FreeRidePoints extends LatLng {
    distance?: number;
    tag?
    ways?: Array<string>
}

export interface FreeRideSegment {
    id:string;
    path: Array<FreeRidePoints>
}

export type FreeRidePoint = IncyclistNode & RoutePoint

export interface FreeRideOption  {
    id:string;
    color:string;
    text:string;
    path: Array<FreeRidePoint> 
    selected?: boolean
    direction?: number
    next?: {
        distance: number,
        direction: number
    }
    
}

export interface FreeRideStartSettings  {
    position:LatLng,
    option:FreeRideOption
    type: RouteCardType,    
}


export interface MinMax {
    min?: number|FormattedNumber
    max?: number|FormattedNumber
}


export interface SearchFilter {
    title?: string,
    distance? : MinMax,
    elevation?: MinMax,
    country?: string,
    contentType?:string,
    routeType?:string
    routeSource?:string
    includeDeleted?:boolean
}

export interface SearchFilterOptions {
    countries: Array<string>
    contentTypes: Array<string>
    routeTypes: Array<string>
    routeSources: Array<string>
}

export interface RoutesRepoUpdates {
    prev?: number,
    current?: number,
    initial?:number
}

export interface RouteListLog {
    counts: Record<string,number>,
    titles?: Record<string,string>
}

export interface IRouteList {
    searchRepo( requestedFilters?:SearchFilter ): { routes: Array<SummaryCardDisplayProps>}
    getAllAppRoutes(source:string):Array<RouteInfo>
}

export type ActiveRideCount = {
    count: number,
    routeId: string,
    routeHash: string

}

export type RouteDetailUIItem = RouteApiDetail & {
    totalDistance: FormattedNumber
    totalElevation: FormattedNumber
}