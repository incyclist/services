import { Avatar } from "../../avatars";
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
    activities: Array<ActivityInfo>,
    filter: ActivitySearchCriteria
}

export interface SelectedActivityDisplayProperties {
    title: string,
}

export interface ActivityErrorDisplayProperties extends SelectedActivityDisplayProperties{ 
    error: string
}

export type DisplayExportInfo = {
    type: string,
    file?: string
}

export type ActivityUploadStatus  = 'success' | 'failed' | 'unknown'
export type DisplayUploadInfo = {
    type: string,
    url?: string,
    status: ActivityUploadStatus
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