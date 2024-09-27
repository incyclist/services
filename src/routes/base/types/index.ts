import { FileInfo } from "../../../api";
import { LatLng } from "../../../utils/geo";

export type RouteType = 'gpx' | 'video';
export type RouteCategory = 'Imported' | 'Free' | 'Demo' | 'personal';
export type RouteState = 'prepared' | 'loading' | 'loaded' | 'error';

export type RouteProvider = {
    name: string;
    url: string;
    logo: string;
};

export type VideoMapping = {
    videoSpeed: number
    time: number
    frame: number
    distance: number
}

export type RouteInfoText = {
    distance: number
    localizedText:LocalizedText
    text: string 
}

export type VideoDescription = {
    file: string;
    url: string;
    framerate: number;
    width?: number;
    height?: number;
    segments?;
    informations?;
    mappings: Array<VideoMapping>;
    format: string;
    selectableSegments: Array<RouteSegment>
    next?:string
};

export type DaumEppProgramEntry = {
    elevation:number,
    x: number,
    distance:number
}

export type DaumEpp = {
    header:string
    version:number
    time:number
    name:string,
    description: string
    programType: number
    min:number,
    max:number,
    cnt:number,
    sampleRate:number,
    validFor:number  // //BITs: 1: bike, 2: lyps, 4: run
    elevationStart: number,
    powerLimit: number
    hrmLimit: number,
    speedLimit:number
    programData: Array<DaumEppProgramEntry>
}


export interface RoutePoint extends LatLng {
    cnt?: number,
    heading?: number,
    routeDistance: number;
    elevation: number;
    elevationGain?:number
    slope?: number;
    distance?:number
    videoSpeed?:number,
    videoTime?:number
    isCut?:boolean
};

export interface VideoRoutePoint extends RoutePoint {
    videoSpeed: number;
    videoTime: number;
}

export type RouteSegment = {
    start:number;    
    end:number;
    name:string;
};

export interface RouteBase  {
    id?: string;   
    title?: string;
}


export interface    RouteInfo extends RouteBase{
    localizedTitle?: LocalizedText
    country?: string;
    isLoop?:boolean;
    distance?: number;
    elevation?: number;    
    category?: RouteCategory
    provider?: RouteProvider
    routeHash?:string,
    isLocal?:boolean;
    hasGpx?: boolean;
    hasVideo?: boolean;
    isDemo?: boolean;
    requiresDownload?: boolean;
    videoFormat?: string;   
    videoUrl?:string;
    downloadUrl?:string,
    previewUrl?:string;
    points?: Array<RoutePoint>,
    segments?:Array<RouteSegment>,
    tsImported?: number,
    tsLastStart?: number,
    next?:string,
    legacyId?:string,
    isDownloaded?:boolean  
    isDeleted?:boolean  
    originalName?:string 
    version?:number,    
}

export type LocalizedText = { [index: string]: string; };

export interface ParseResult<T extends RouteBase> {
    data: RouteInfo
    details: T
}

export interface Parser<In, Out extends RouteBase> {
    import(file: FileInfo, data?:In): Promise< ParseResult<Out>>
    supportsExtension(extension:string):boolean
    supportsContent(data:In):boolean
    getData(info:FileInfo,data?:In):Promise<In>
}
export interface AppStatus {
    isOnline?: boolean;
}

