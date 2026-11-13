export type StravaConfig = {
    /** access token */
    accessToken:string,  

    /** refresh token */
    refreshToken:string

    /** Client ID (Required for oauth) */
    clientId: string

    /** Client Secret (Required for oauth) */
    clientSecret: string

    expiration?: Date

}

export type StravaRefreshTokenRequest = {

    /** The refresh token for this user, to be used to get the next access token for this user. Please expect that this value can change anytime you retrieve a new access token. Once a new refresh token code has been returned, the older code will no longer work.*/
    refresh_token: string

}

export type StravaRefreshTokenResponse = {
    /** The short-lived access token */
    access_token: string
    
    /** The number of seconds since the epoch when the provided access token will expire */
    expires_at: number
    
    /** Seconds until the short-lived access token will expire */
    expires_in: number 
    
    /** The refresh token for this user, to be used to get the next access token for this user. Please expect that this value can change anytime you retrieve a new access token. Once a new refresh token code has been returned, the older code will no longer work. */
    refresh_token: string
   
}

export type StravaActivityType = 'AlpineSki' | 'BackcountrySki' | 'Badminton' | 'Canoeing' | 'Crossfit' | 'EBikeRide' | 'Elliptical' | 'EMountainBikeRide' | 'Golf' | 'GravelRide' | 'Handcycle' | 'HighIntensityIntervalTraining' | 'Hike' | 'IceSkate' | 'InlineSkate' | 'Kayaking' | 'Kitesurf' | 'MountainBikeRide' | 'NordicSki' | 'Pickleball' | 'Pilates' | 'Racquetball' | 'Ride' | 'RockClimbing' | 'RollerSki' | 'Rowing' | 'Run' | 'Sail' | 'Skateboard' | 'Snowboard' | 'Snowshoe' | 'Soccer' | 'Squash' | 'StairStepper' | 'StandUpPaddling' | 'Surfing' | 'Swim' | 'TableTennis' | 'Tennis' | 'TrailRun' | 'Velomobile' | 'VirtualRide' | 'VirtualRow' | 'VirtualRun' | 'Walk' | 'WeightTraining' | 'Wheelchair' | 'Windsurf' | 'Workout' | 'Yoga'

export type StravaUploadRequest = {
    /** filename of the file o be uploded */
    file

    /** The desired name of the acitvity in Strava, defaults to name within the payload */
    name: string

    /** The desired description of the resulting activity. */
    description: string

    /** Whether the resulting activity should be marked as having been performed on a trainer. */
    trainer: string

    /** Whether the resulting activity should be tagged as a commute. */
    commute: string

    /** file format ( TCX,FIT,...), needs to be supproted by Strava*/
    data_type?: StravaFormat

    /** The desired external identifier of the resulting activity. */
    external_id: string

    sport_type: StravaActivityType
}

export type StravaUploadResponse  ={
    /** The unique identifier of the upload */
    id: number

    /** The unique identifier of the upload in string format*/
    id_str: string

    /** The external identifier of the upload */
    external_id?: string

    /** The error associated with this upload */
    error?: string

    /** The status of this upload */
    status?: string

    /** The identifier of the activity this upload resulted into */
    activity_id?: string
}

export type StravaUploadResult  = {
    /** The Strava identifier of the qctivity */
    stravaId?: string

    /** The external (i.e. incyclist) identifier of the upload */
    externalId?: string
}

export type StravaFormat = 'fit' | 'fit.gz' | 'tcx'  | 'tcx.gz' | 'gpx' | 'gpx.gz'


export type getLoggedInAthleteActivitiesProps = {
    before?: number,     /** An epoch timestamp to use for filtering activities that have taken place before a certain time. */
    after?: number,      /** An epoch timestamp to use for filtering activities that have taken place after a certain time. */
    page?: number,       /** Page number. Defaults to 1. */
    per_page?: number    /** Number of items per page. Defaults to 30. */
}

export type GetRoutesByAthleteIdProps = {
    page?: number,       /** Page number. Defaults to 1. */
    per_page?: number    /** Number of items per page. Defaults to 30. */
}

export type StravaRoutesFilters = {
    sport?:string,
    after?:Date,
    lastUpdateAfter?:Date
}


export interface SummaryActivity  {
    id: number,
    external_id: number,
    upload_id: number,
    athlete,
    name: string,
    distance: number,
    moving_time: number,
    elapsed_time: number,
    total_elevation_gain: number,
    elev_high: number, 
    elev_low: number,
    sport_type: StravaActivityType,
    start_date: string, // ISO time
    start_date_local : string,
    timezone: string,
    utc_offset: number,
    start_latlng: Array<number>,
    end_latlng: Array<number>,
    location_city: string,
    location_state: string,
    location_country: string,
    achievement_count: number,
    kudos_count: number,
    comment_count: number,
    athlete_count: number,
    photo_count: number,
    map: { id: string, summary_polyline: string, resource_state: number },
    trainer: boolean,
    commute: boolean,
    manual: boolean,
    private: boolean,
    visibility: string,
    flagged: boolean,
    gear_id: null,
    average_speed: number,
    max_speed: number,
    has_heartrate: boolean,
    heartrate_opt_out: boolean,
    display_hide_heartrate_option: boolean,
    upload_id_str: string,
    from_accepted_tag: boolean,
    pr_count: number,
    total_photo_count: number,
    has_kudoed: boolean
}

export interface DetailedActivity extends SummaryActivity { 
    descrciption: string,
    photos

}

export type StravaStreamType = 'time' | 'distance' | 'latlng' |'altitude'| 'velocity_smooth' | 'heartrate' | 'cadence' | 'watts' | 'temp' | 'moving' | 'grade_smooth'

export interface ActivityStreamEntry {
    type: StravaStreamType
    data
}

export type StravaUploadProps = {
    /** file format ( TCX,FIT,...), needs to be supproted by VeloHero */
    format?: StravaFormat

    /** The desired name of the acitvity in Strava, defaults to name within the payload */
    name?: string

    /** The desired description of the resulting activity. */
    description?: string

    /** Whether the resulting activity should be marked as having been performed on a trainer. */
    trainer?: boolean

    /** Whether the resulting activity should be tagged as a commute. */
    commute?: boolean

    /** The desired external identifier of the resulting activity. */
    externalId?: string

    /** The desired activity type to be shown in Strava ( cycling, running, virtual cycling,....). */
    activityType?: StravaActivityType

}

export class DuplicateError extends Error {
    constructor( public stravaId, message?:string){
        super(message??'Activity already exists: id='+stravaId)
    }
}


export type StravaAthleteResponse = {
    id: number,
    resource_state?: number,
    firstname?: string,
    lastname?: string,
    profile_medium?: string,
    profile?: string,
    city?: string,
    state?:string,
    country?:string,
    sex?: string,
    premium?:boolean,
    summit?: boolean,
    follower_count?:number,
    friend_count?:number,
    measurement_preference?:string,
    ftp?:number,
    weight?:number,
    clubs,
    bikes,
    shoes
}

export type StravaApiErrorResponse<T> = {
    props:T,
    error:string

}

/** [latitude, longitude] */
export type StravaLatLng = [number, number];

/** 1 = meta, 2 = summary, 3 = detail */
export type StravaResourceState = 1 | 2 | 3;

/** 1 = Ride, 2 = Run, 3 = Walk, 4 = Hike, 5 = Trail Run, 6 = Gravel Ride, 7 = Mountain Bike Ride */
export type StravaRouteType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 1 = road, 2 = mountain bike, 3 = cross, 4 = trail, 5 = mixed */
export type StravaRouteSubType = 1 | 2 | 3 | 4 | 5;

export interface StravaRoute {
  athlete?: StravaSummaryAthlete;
  /** The description of the route */
  description?: string;
  /** The route's distance, in meters */
  distance?: number;
  /** The route's elevation gain, in meters */
  elevation_gain?: number;
  /** The unique identifier of this route (may exceed Number.MAX_SAFE_INTEGER; prefer id_str) */
  id?: number;
  /** The unique identifier of the route in string format */
  id_str?: string;
  map?: StravaPolylineMap;
  /** The name of this route */
  name?: string;
  /** Whether this route is private */
  private?: boolean;
  /** Whether this route is starred by the logged-in athlete */
  starred?: boolean;
  /** Epoch timestamp of when the route was created */
  timestamp?: number;
  /** This route's type (1 for ride, 2 for run) */
  type?: StravaRouteType;
  /** This route's sub-type */
  sub_type?: StravaRouteSubType;
  /** ISO 8601 date-time the route was created */
  created_at?: string;
  /** ISO 8601 date-time the route was last updated */
  updated_at?: string;
  /** Estimated time in seconds for the authenticated athlete to complete the route */
  estimated_moving_time?: number;
  /** The segments traversed by this route */
  segments?: StravaSummarySegment[];
  /** The custom waypoints along this route */
  waypoints?: StravaWaypoint[];
}

export interface StravaWaypoint {
  /** Location along the route that the waypoint is closest to */
  latlng?: StravaLatLng;
  /** Location off-route that the waypoint is referencing */
  target_latlng?: StravaLatLng;
  /** Categories that the waypoint belongs to */
  categories?: string[];
  /** A title for the waypoint */
  title?: string;
  /** A description for the waypoint (optional) */
  description?: string;
  /** Distance along the route that the waypoint is the closest, in meters */
  distance_into_route?: number;
}

export interface StravaPolylineMap {
  /** The identifier of the map */
  id?: string;
  /** The polyline of the map; only returned for detailed representation */
  polyline?: string;
  /** The summary polyline of the map */
  summary_polyline?: string;
}

export interface StravaSummaryAthlete {
  id?: number;
  resource_state?: StravaResourceState;
  firstname?: string;
  lastname?: string;
  /** URL to a 62x62 pixel profile picture */
  profile_medium?: string;
  /** URL to a 124x124 pixel profile picture */
  profile?: string;
  city?: string;
  state?: string;
  country?: string;
  /** The athlete's sex */
  sex?: 'M' | 'F';
  /** @deprecated Use `summit` instead */
  premium?: boolean;
  /** Whether the athlete has any Summit subscription */
  summit?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type StravaSegmentActivityType = 'Ride' | 'Run' | 'Swim';

export interface StravaSummarySegment {
  id?: number;
  name?: string;
  activity_type?: StravaSegmentActivityType;
  /** In meters */
  distance?: number;
  /** Percent */
  average_grade?: number;
  /** Percent */
  maximum_grade?: number;
  /** In meters */
  elevation_high?: number;
  /** In meters */
  elevation_low?: number;
  start_latlng?: StravaLatLng;
  end_latlng?: StravaLatLng;
  /** 0 = uncategorized … 5 = hors catégorie */
  climb_category?: 0 | 1 | 2 | 3 | 4 | 5;
  city?: string;
  state?: string;
  country?: string;
  private?: boolean;
  athlete_pr_effort?: StravaSummaryPRSegmentEffort;
  athlete_segment_stats?: StravaSummarySegmentEffort;
}

export interface StravaSummaryPRSegmentEffort {
  /** ID of the activity that set the PR */
  pr_activity_id?: number;
  /** In seconds */
  pr_elapsed_time?: number;
  /** ISO 8601 date the PR was set */
  pr_date?: string;
  /** Number of efforts by the athlete on this segment */
  effort_count?: number;
}

export interface StravaSummarySegmentEffort {
  id?: number;
  activity_id?: number;
  /** In seconds */
  elapsed_time?: number;
  start_date?: string;
  start_date_local?: string;
  /** In meters */
  distance?: number;
  /** Whether this effort is the current best on the leaderboard */
  is_kom?: boolean;
}

