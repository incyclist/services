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
    
    /** Client ID (Required for oauth) */
    clientId:string 

    /** Client Secret (Required for oauth) */
    clientSecret:string, 

    /** The grant type for the request. When refreshing an access token, must always be "refresh_token". */
    grant_type:string

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
        super(message??'Activity already exists')
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