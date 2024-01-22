import { DaumEpp, LocalizedText, RouteBase, RouteCategory, RouteInfoText, RoutePoint, RouteProvider, RouteType, VideoDescription } from "../types"

export type RouteDescriptionQuery = {
    category?: string
    categories?: Array<string>
    type:RouteType
}

export interface RouteApiDescription extends RouteBase {
    routeId?: string;   
    hash?: string;
    routeHash?: string;
    title: string;
    private?: boolean;
    country?: string;
    distance?: number;
    elevation?: number
    points?: { id: string};
    version?:number;
    category?: RouteCategory
    provider?: RouteProvider
    video?: VideoDescription   
    type?: RouteType,
    localizedTitle?:LocalizedText,
    previewUrl?:string,
    isDeleted?:boolean
    
}

export type LegacyRouteGpxRepoDescription = {
    id: string;   
    hash?: string; 
    routeHash?: string; 
    title: string; //
    private?: boolean;
    distance?: number;
    elevation?: number
    author?: { id:string} 
    points?: { id: string}; 
    __v:number;
    category?: RouteCategory 
}

export type RouteApiDetail = {
    id: string;   
    originalName?:string;
    routeId?: string; 
    hash?: string;
    routeHash?: string;
    title: string;
    private?: boolean;
    country?: string;
    distance?: number;
    elevation?: number
    points?: Array<RoutePoint> 
    downloadUrl?:string
    downloadType?: string
    gpxDisabled?: boolean
    version?:string;
    category?: RouteCategory
    provider?: RouteProvider
    video?: VideoDescription   
    epp?:DaumEpp
    infoTexts?:Array<RouteInfoText>
    localizedTitle?:LocalizedText
    previewUrl?:string
    previewUrlLocal?:string
    description?:LocalizedText
    next?:string
    

}    


