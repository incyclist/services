import { RoutePoint } from "../../../routes/base/types"

export type ActivityUser = {
    uuid?:string
    weight: number,
    ftp: number
}

export type ActivityRoute = {
    id?:string
    hash: string,
    name: string
}

export type ActivityStatsRecord = {
    min: number,
    max: number,
    avg: number,
    cntVal: number,
    sum: number,
    minAllowed: number
}

export type ActivityLogRecord = {
    time: number,
    timeDelta: number,
    speed: number,
    slope: number,
    cadence: number,
    heartrate: number,
    distance: number,
    power: number,
    lat?: number,
    lon?: number,    
    elevation?:number
}


export type ActivityStats = {
    hrm?: ActivityStatsRecord,
    cadence?: ActivityStatsRecord,
    speed: ActivityStatsRecord,
    slope?: ActivityStatsRecord,
    power: ActivityStatsRecord,
}

export type StravaAppLink = {
    upload_id: number,
    activity_id: number,
}

export type ActivityAppLinks = {
    strava? : StravaAppLink
}



export type ScreenShotInfo = {
    fileName: string;
    position: RoutePoint;
    isHighlight?: boolean
}

export type ActivityType = 'IncyclistActivity'

export type UploadStatus = 'success' | 'failure'  

export type UploadInfo = {
    service: string;
    status: UploadStatus
}



export type ActivityDB = {
    /** a version string, so that code in the future can adapt to legacy database versions */
    version: string;
    /** the list of activities */
    activities: Array<ActivitySummary>
    /** identifies of a full directory scan has been completed when creating this DB*/
    isComplete: boolean;
}

export type ActivitySummary = {
    /** unique ID */
    id: string;

    /** Title as displayed */
    title: string;

    /** filename (without full path) */
    name:string

    routeId: string;
    previewImage?: string
    startTime: number
    rideTime: number
    distance: number
    startPos: number
    realityFactor: number

    uploadStatus: Array<UploadInfo>
    isCompleted?: boolean
    isSaved?:boolean
    saveRideTime?: number
    laps?: Array<LapSummary>

}

export type LapSummary  ={
    num: number;
    startPos: number
    distance: number
    startTime: number
    rideTime: number
}

export type ActivityDetails = {
    type?: ActivityType
    version?: string;

    /** name of the activity */
    title: string;

    /** unique ID of the activity */
    id: string;

    /** user information */
    user: ActivityUser;

    /** route information */
    route: ActivityRoute;

    /** Start time (UTC) of the activity*/
    startTime: string

    /** moving time (in secs)*/
    time: number

    /** total time (in secs)*/
    timeTotal: number

    /** pausing time (in secs)*/
    timePause: number

    /** distance [in m] ridden in this activity*/
    distance: number

    startPos: number,
    startpos: number
    endpos: number


    /** elevation gain in this activity */
    totalElevation: number

    stats: ActivityStats

    logs: Array<ActivityLogRecord>

    screenshots: Array<ScreenShotInfo>
    fileName?: string;
    tcxFileName?: string;
    fitFileName?: string;
    links?: ActivityAppLinks

    // v1
    realityFactor: number;
    laps?: Array<LapSummary>
    

}

export type ActivityInfo = {
    summary: ActivitySummary,
    details?: ActivityDetails
}