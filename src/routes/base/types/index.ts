
export type RouteType = 'gpx' | 'video';
export type RouteCategory = 'Free' | 'Demo';
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
    width: number;
    height: number;
    segments;
    informations;
    mappings: VideoMapping;
    format: string;
    selectableSegments
    infoTexts:RouteInfoText
};
