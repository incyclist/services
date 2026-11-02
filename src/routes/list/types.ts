import { Observer } from "../../base/types";
import { Dimension, FormattedNumber, Unit } from "../../i18n";
import { IncyclistNode } from "../../maps/MapArea/types";
import { LatLng } from "../../utils/geo"
import { RouteApiDetail } from "../base/api/types";
import { RouteInfo, RoutePoint } from "../base/types";
import { RouteCard } from "./cards/RouteCard";
import { SummaryCardDisplayProps } from "./cards/types";
import { RouteCardType } from "./cards/types";

export interface RouteStartSettings {
    type: RouteCardType,
}

export type DisplayType = 'list' | 'tiles'

/** Persisted sort order for the route list/tile view. `'suggested'` is the default. */
export type RouteListSortOrder = 'suggested' | 'name' | 'distance' | 'elevation'

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

export type FreeRideManeuver = 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right'
    | 'sharp-left' | 'sharp-right' | 'keep-left' | 'keep-right' | 'u-turn' | 'roundabout' | 'unknown'

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

    /** 1-based number of the option, as shown (left to right) and used as hotkey */
    index?: number
    maneuver?: FreeRideManeuver
    /** turn word, e.g. 'Straight', 'Keep left' */
    maneuverText?: string
    /** compass word of the first segment, e.g. 'North' */
    compass?: string
    /** absolute bearing of the first segment (0-360) */
    heading?: number
    /** name of the road (name or ref tag), if known */
    roadName?: string
    /** display label of the road, never empty ('Unnamed road' if nothing is known) */
    roadLabel?: string
    /** the option that is taken if the rider does not choose */
    isDefault?: boolean
    /** only set on the selected option: chosen by the rider or taken automatically */
    selectedBy?: 'auto' | 'user'
    /** direction is not known: to be shown as a labelled placeholder, not as an arrow */
    degraded?: boolean
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
    maxDistance?: FormattedNumber
    maxElevation?: FormattedNumber
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

export type  SearchState = {
    routes: Array<SummaryCardDisplayProps>
    filters: SearchFilter
    observer: Observer
    cards?: Array<RouteCard>
    units?: Record<Dimension,Unit>
}