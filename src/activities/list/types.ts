import { Avatar } from "../../avatars";
import { Observer } from "../../base/types";
import { RouteInfo } from "../../routes/base/types";
import { ActivityDetails, ActivityInfo, ActivitySearchCriteria, ActivityStats } from "../base";

export type PastActivityLogEntry = {
    routeHash?: string,
    routeId?:string,
    tsStart: number,
    title: string,
    time?: number,
    power?: number,
    heartrate?: number,    
    speed?:number,
    distance?: number,
    routeDistance?: number,
    lap?: number,
    timeGap: string,
    distanceGap: string,
    lat?:number,
    lng?:number
}

export type PastActivityInfo = Array<PastActivityLogEntry|null>

export interface PrevRidesListDisplayProps extends PastActivityLogEntry {
    position?: number;
    avatar?: Avatar
}

export type ActivityListDisplayProperties = {
    activities?: Array<ActivityInfo>,
    filter?: ActivitySearchCriteria,
    loading?: boolean
    observer?: Observer

}

export interface SelectedActivityResponse {
    title: string,     
}

export interface ActivityErrorDisplayProperties extends SelectedActivityResponse{ 
    error: string
}

export interface SelectedActivityDisplayProperties extends SelectedActivityResponse {
     
    distance: number,
    duration: number,
    elevation: number,
    startPos?: number
    segment?:  string
    started: Date
    showMap: boolean,
    points?: Array<{lat:number,lng:number}>
    activity: ActivityDetails
    exports: Array<DisplayExportInfo>
    canStart: boolean
    canOpen: boolean,
    uploads: Array<DisplayUploadInfo> 
}


export type DisplayExportInfo = {
    type: string,
    file?: string
    creating?: boolean
}

export type ActivityUploadStatus  = 'success' | 'failed' | 'unknown'
export type DisplayUploadInfo = {
    type: string,
    url?: string,
    status: ActivityUploadStatus
    text?: string
    synchronizing?: boolean
}

export interface ActivityDisplayProperties extends SelectedActivityDisplayProperties {
    distance: number,
    duration: number,
    elevation: number,
    started: Date
    startPos?:number,
    segment?:string,
    showMap: boolean,
    points: Array<{lat:number,lng:number}>
    activity: ActivityDetails
    stats: ActivityStats
    exports: Array<DisplayExportInfo>
    uploads: Array<DisplayUploadInfo>
    canStart: boolean
    canOpen: boolean
    
}

export type RideAgainResponse = {
    canStart: boolean
    route?:RouteInfo
}