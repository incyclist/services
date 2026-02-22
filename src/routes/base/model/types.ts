import { RouteApiDetail } from "../api/types"
import { RouteInfo, RoutePoint } from "../types"

export interface IRoute  {

    readonly description:RouteInfo
    details:RouteApiDetail 
    readonly points:Array<RoutePoint> 
    distance:number
    readonly title:string

    addDetails(details:RouteApiDetail) 
    getLocalizedTitle(language:string):string
       clone():IRoute

    updateCountryFromPoints(): Promise<boolean>
}