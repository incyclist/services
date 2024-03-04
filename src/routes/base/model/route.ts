import { Countries } from "../../../i18n/countries";
import { RouteApiDetail } from "../api/types";
import { RouteInfo, RoutePoint } from "../types";

export class Route {

    private _description:RouteInfo
    private _details:RouteApiDetail
    

    constructor( info:RouteInfo, raw?:RouteApiDetail) {
        this._description = info
        if (raw)
            this._details = raw;        
    }

    get description():RouteInfo {
        return this._description
    }

    get points():Array<RoutePoint> {
        const points = this._details?.points ?? this._description?.points 

        if (typeof points==='string') {
            // TODO: decode
        }
        return points as Array<RoutePoint>
    }


    addDetails(details:RouteApiDetail) {
        this._details = details
    }

    get details():RouteApiDetail {
        return this._details
    }

    set details(details:RouteApiDetail) {
        this._details = details
    }

    get distance():number {
        const points = this._details?.points ?? this._description?.points ?? []
        if (!points?.length)
            return null
        return points[points.length-1].routeDistance
            
    }

    protected getCountiesApi() {
        return new Countries()
    }

    updateCountryFromPoints = async (): Promise<boolean> =>{
        let updated = false;
    
        if (!this._description.country && this._description.hasGpx) {
            
            try {
                const iso =  await this.getCountiesApi().getIsoFromLatLng(this._details.points[0])
                if (iso) {
                    updated = true;
                    this._description.country = iso
                }
                
            }
            catch { // ignore errors
            }
        }    
        return updated
    } 
    


}