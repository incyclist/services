import { ImportFilter } from "../../../base/cardlist/types";
import { Observer } from "../../../base/types/observer";
import { Unit } from "../../../i18n";
import { RouteInfo } from "../../base/types";
import { DownloadObserver } from "../../download/types";
import { RouteStartSettings } from "../types";


export type RouteCardType = 'Import' | 'Route' | 'Free-Ride' | 'ActiveImport';



export interface RouteImportProps {
    title: string;
    filters: Array<ImportFilter>;
    visible: boolean;
}

export interface RouteActiveImportProps {
    name: string;
    error?: Error
    visible: boolean;
    observer: Observer
}

export interface SummaryCardDisplayProps extends RouteInfo{
    loaded:boolean
    ready:boolean
    state:string
    visible:boolean
    canDelete:boolean
    observer:Observer
    initialized:boolean;
    loading?:boolean
    isNew?:boolean
    cntActive?:number
    totalDistance?: {value:number, unit:Unit},
    totalElevation?: {value:number, unit:Unit}
    downloadObserver?: DownloadObserver
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DetailCardDisplayProps  {}

export interface StartSettings {
    segment?:string
    startPos:number,
    endPos?:number,
    realityFactor:number,
    downloadProgress?:number,
    convertProgress?:number,
    loopOverwrite?: boolean,
    nextOverwrite?:boolean,
    showPrev?:boolean

}
export interface UIStartSettings {
    segment?:string
    startPos: { value:number,unit: Unit}
    endPos?: { value:number,unit: Unit}
    realityFactor:number,
    downloadProgress?:number,
    convertProgress?:number,
    loopOverwrite?: boolean,
    nextOverwrite?:boolean,
    showPrev?:boolean

}

export type RouteSettings = StartSettings & RouteStartSettings
export type UIRouteSettings = UIStartSettings & {
    prevRides?:Array<any>
}

export type RouteCardProps = {
    settings:UIRouteSettings,
    showLoopOverwrite:boolean,
    showNextOverwrite:boolean,
    hasWorkout?:boolean
    canStart?:boolean
    videoMissing?:Promise<boolean>
    videoChecking?:boolean
    totalDistance: { value:number, unit:Unit},
    totalElevation: { value:number, unit:Unit},
    xScale?: { value:number, unit:Unit},
    yScale?: { value:number, unit:Unit},
    updateStartPos?: (updated:number)=>{ value:number, unit:Unit}
    updateMarkers?: (settings: UIRouteSettings)=> UIRouteSettings
}


