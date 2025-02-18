import { LatLng } from "../../utils/geo"
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

export interface FreeRideOption {
    color:string;
    path: Array<FreeRidePoints>;
    polyline: Array< Array<number> >;
    segments:Array<FreeRideSegment>
    way: FreeRideSegment
}

export interface FreeRideStartSettings  {
    position:LatLng,
    option:FreeRideOption
    type: RouteCardType,
}

export interface MinMax {
    min?: number,
    max?: number
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
}