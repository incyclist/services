import { Injectable } from "../../../base/decorators";
import { Countries } from "../../../i18n/countries";
import clone from "../../../utils/clone";
import { RouteApiDetail } from "../api/types";
import { RouteInfo, RoutePoint } from "../types";
import { getLocalizedText } from "../utils/localization";

export class Route {

    private readonly _description:RouteInfo
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

        return points
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

    set distance(distance:number) {
        this._description.distance = distance
        this._details.distance =distance
    }

    get title():string {
        // TODO: detect language
        const language = 'en'

        return this.getLocalizedTitle(language)

    }

    getLocalizedTitle(language:string) {
        if (this._details)
            return getLocalizedText(this._details.localizedTitle,language)??this._details.title
        else 
            return getLocalizedText(this._description.localizedTitle,language)??this._description.title
    }

    clone() {
        const description = clone(this._description)
        const details = clone(this._details)

        return new Route( description,details)
    }

    updateCountryFromPoints = async (): Promise<boolean> =>{
        let updated = false;
    
        if (!this._description.country && this._description.hasGpx) {
            
            try {
                const iso =  await this.getCountries().getIsoFromLatLng(this._description?.points?.[0]??this._details?.points?.[0])
                if (iso) {
                    updated = true;
                    this._description.country = iso
                }
                
            }
            catch {  
                // ignore errors 
            }
        }    
        return updated
    } 
    

    @Injectable
    protected getCountries() {
        return new Countries()
    }


}