import { LatLng } from "../../utils/geo"
import { RouteCardType } from "./cards/cards"

export interface RouteStartSettings {
    type: RouteCardType,
}


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
