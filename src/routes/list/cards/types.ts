import { ImportFilter } from "../../../base/cardlist/types";
import { Observer } from "../../../base/types/observer";
import { Unit } from "../../../i18n";
import { RouteInfo, RoutePoint } from "../../base/types";
import { SmoothingGradient } from "../../base/utils/smoothing";
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
    /** elevation smoothing strength: 0 (or absent) = off, 1..5 = increasing */
    smoothingLevel?:number

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
    /** identical to the stored value - a level has no unit, so no conversion applies */
    smoothingLevel?:number

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
    showWorkoutOption?:boolean
    canStart?:boolean
    videoMissing?:Promise<boolean>
    videoChecking?:boolean
    /** false while the route's details are still being loaded - everything derived from them
     *  (distance, elevation, video availability) is provisional until this turns true */
    detailsAvailable?:boolean
    totalDistance: { value:number, unit:Unit},
    totalElevation: { value:number, unit:Unit},
    xScale?: { value:number, unit:Unit},
    yScale?: { value:number, unit:Unit},
    /** false => the UI omits the smoothing row entirely (no disabled state, no caption) */
    smoothingAvailable: boolean,
    /** highest selectable level, so the UI does not have to hardcode the range */
    smoothingMaxLevel: number,
    /** present only while a level of 1..5 is in effect */
    smoothedElevation?: { value:number, unit:Unit},
    /** the preview curve for the elevation profile; present only while a level of 1..5 is in effect */
    smoothedPoints?: Array<RoutePoint>,
    /** what the level does to the gradient; present only while a level of 1..5 is in effect */
    smoothedGradient?: SmoothingGradient,
    updateStartPos?: (updated:number)=>{ value:number, unit:Unit}
    updateMarkers?: (settings: UIRouteSettings)=> UIRouteSettings
}

/**
 * Result of previewing a smoothing level. All fields are absent when there is nothing to
 * preview - level 0, an ineligible route, or a transform that could not be computed.
 */
export type SmoothingPreview = Pick<RouteCardProps,'smoothedElevation'|'smoothedPoints'|'smoothedGradient'>


