import { RoutePoint } from "../../../routes/base/types"

export const DEFAULT_ACTIVITY_TITLE = 'Incyclist Ride'

export type ActivityUser = {
    uuid?:string
    weight: number,
    ftp?: number
}

export type ActivityRoute = {
    id?:string
    hash: string,
    name: string
    title?:string
}


export type ActivityStatsRecord = {
    min: number,
    max: number,
    avg: number,
    cntVal: number,
    sum: number,
    minAllowed?: number
    weighted?:number

}



export type ActivityStats = {
    hrm?: ActivityStatsRecord,
    cadence?: ActivityStatsRecord,
    speed: ActivityStatsRecord,
    slope?: ActivityStatsRecord,
    power: ActivityStatsRecord,
    powerCurve?: Record<string,number>
}

export interface ActivityAppLink  {
    error?: string
    activity_id?: string,
    url?:string
}


export type ActivityAppLinks = {
    strava? : ActivityAppLink
    velohero?: ActivityAppLink
    intervals?: ActivityAppLink
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

    /** unique id of route (or "free ride") */
    routeId: string;
    routeHash: string;


    previewImage?: string
    startTime: number
    rideTime: number
    distance: number
    startPos: number
    endPos?:number
    segment?:string,
    realityFactor: number
    totalElevation: number

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

export type ActivityRouteType = 'Free-Ride'|'GPX'|'Video'

export type FitLogEntry = {
    time?: number
    lat?: number
    lon?:number
    speed?: number
    slope?: number
    cadence?: number
    heartrate?: number
    distance?: number
    power?: number
    elevation?: number

}
export type FitLapEntry = {
    lapNo: number;
    startTime: string
    stopTime: string
    totalDistance: number
    lapDistance: number
    totalTime: number
    lapTime: number

}
export type FitUser = {
    id: string
    weight: number
}

export type FitScreenshots = {
    fileName:string
    position: FitLogEntry
}

export type FitExportActivity = {
    id: string;
    title: string;
    status: string;
    logs: Array<FitLogEntry>
    laps: Array<FitLapEntry>
    startTime: string
    stopTime?: string
    time: number
    timeTotal:number
    distance: number
    timePause: number
    href?: string
    user: FitUser
    screenshots: Array<FitScreenshots>
}

export interface ActivityDetails  {
    /** file type - always has to be "IncyclistActivity" */    
    type?: ActivityType     

    /** file version - at the moment always "3" */    
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

    /** starting position [in m] of this activity*/
    startPos: number,

    /** user selected end position [in m] of this activity*/
    endPos?: number,

    /** user selected segment of this activity*/
    segment?: string,
    

    /** @deprecated */
    startpos?: number
    /** @deprecated */
    endpos?: number

    /** total elevation gain of this activity */
    totalElevation: number

    /** all log records */
    logs: Array<ActivityLogRecord>

    /** Statistcs ( max,min,avg) for power, speed,cadence and hrm */
    stats?: ActivityStats

    /** reference to screenshots made during the ride */
    screenshots?: Array<ScreenShotInfo>

    // v1
    /** selected route type ( Free-Ride vs. Route)  */
    routeType?: ActivityRouteType;

    /** selected reality factor  */
    realityFactor: number;

    /** information about all laps taken in a loop route   */
    laps?: Array<LapSummary>

    /** information about all workout steps taken in a workout activity   */
    workoutSteps?: Array<LapSummary>

    /** filename (without full path) */
    name?:string
    /** full file name (incl. path) of the activity */
    fileName?: string;
    /** full file name (incl. path) of the TCX representation of this activity */
    tcxFileName?: string;
    /** full file name (incl. path) of the FIT representation of this activity */
    fitFileName?: string;

    /** information about synchronizations to connected apps */
    links?: ActivityAppLinks
}

export type ActivityLogRecord = {
    /** time (in s) since start */
    time: number,       

    /** time (in s) since prev. log */
    timeDelta: number,  
    
    /** current speed (in km/h)  */
    speed: number,      
    
    /** current slope (in %)  */
    slope?: number,     

    /** current cadence (in rpm)  */
    cadence?: number,    
    
    /** current heartrate (in bpm)  */
    heartrate?: number, 

    /** current distance (in m) since start  */
    distance?: number,  
    
    /** current power (in W)  */
    power: number,      
    
    /** current latitude  */
    lat?: number,       
    
    /** current longitude  */
    lng?: number,       
    
    /** current elevation (in m)  */
    elevation?:number   

    // @deprecated
    lon?: number,  
}


export type ActivityInfo = {
    summary: ActivitySummary,
    details?: ActivityDetails
}