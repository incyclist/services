import { RouteInfo, RoutePoint } from "../types";

export class Route {

    private _description:RouteInfo

    get description():RouteInfo {
        return this._description
    }

    get points():Array<RoutePoint> {
        const points = this._description?.points 

        if (typeof points==='string') {
            // TODO: decode
        }
        return points as Array<RoutePoint>
    }

    constructor( info:RouteInfo) {
        this._description = info
    }

    


}