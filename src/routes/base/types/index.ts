
export type RouteType = 'gpx' | 'video';
export type RouteCategory = 'Free' | 'Demo' | 'personal';
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
    localizedText
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
    infoTexts:RouteInfoText
    next?:string
};
export type RoutePoint = {
    lat: number;
    lng: number;
    routeDistance: number;
    elevation: number;
    slope?: number;
    distance?:number
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


export interface RouteInfo extends RouteBase{
    localizedTitle?: LocalizedText
    country?: string;
    isLoop?:boolean;
    distance?: number;
    elevation?: number;    
    category?: RouteCategory
    provider?: RouteProvider
    isLocal?:boolean;
    hasGpx?: boolean;
    hasVideo?: boolean;
    isDemo?: boolean;
    requiresDownload?: boolean;
    videoFormat?: string;   
    videoUrl?:string;
    previewUrl?:string;
    points?: Array<RoutePoint>|string,
    segments?:Array<RouteSegment>    
}
export type LocalizedText = { [index: string]: string; };

export interface ParseResult<T extends RouteBase> {
    data: RouteInfo
    details: T
}

export interface Parser<In, Out extends RouteBase> {
    import(data:In): Promise< ParseResult<Out>>
    supportsExtension(extension:string):boolean
    supportsContent(data:In):boolean
}

