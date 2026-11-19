import type { OAuthAppConfig } from '../types'

/** RideWithGPS access tokens never expire and there is no refresh token */
export type RideWithGpsConfig = OAuthAppConfig

/** Activity types that can be assigned to a route (`activity_types` of the Route schema) */
export type RideWithGpsRouteActivityType =
    'cycling:generic' | 'cycling:road' | 'cycling:gravel' | 'cycling:mountain' | 'cycling:commute' |
    'walking:generic' | 'walking:hiking' | 'running:generic' | 'driving:generic' | 'motorcycling:generic' |
    'swimming:generic' | 'snow:generic'

/** Activity types that are used for the trips that are uploaded by Incyclist (subset of `activity_type` of the TripPayload schema) */
export type RideWithGpsTripActivityType = 'cycling:virtual' | 'cycling:indoor'

/** A route in the list of routes (RouteSummary in the API spec) */
export type RideWithGpsRoute = {
    id: number
    user_id?: number
    html_url?: string
    visibility?: string
    name: string
    description?: string | null
    locality?: string | null
    administrative_area?: string | null

    /** ISO 3166 alpha-2 country code */
    country_code?: string | null

    /** distance in meters */
    distance?: number

    /** elevation gain in meters */
    elevation_gain?: number
    elevation_loss?: number
    first_lat?: number
    first_lng?: number
    last_lat?: number
    last_lng?: number
    track_type?: string | null
    terrain?: string | null
    difficulty?: string | null

    /** share of the route that is not paved (percent) */
    unpaved_pct?: number | null
    surface?: string | null

    /** `null` for routes that are not owned by the user */
    archived?: boolean | null
    created_at?: string
    updated_at?: string

    /** only part of the detail response of a route (not of the list) according to the API spec */
    /** see RideWithGpsRouteActivityType for the known values */
    activity_types?: Array<string>
}

/** A collection of the user (CollectionSummary in the API spec). `url` and `html_url` can contain privacy codes: never log them */
export type RideWithGpsCollectionSummary = {
    id: number
    user_id?: number
    visibility?: string

    /** the system collections are called `pinned` and `{{bucket_list}}` */
    name: string
    created_at?: string
    updated_at?: string
}

export type RideWithGpsCollection = RideWithGpsCollectionSummary & {
    routes?: Array<RideWithGpsRoute>
}

export type RideWithGpsPagination = {
    record_count: number
    page_count: number
    page_size: number

    /** `null` for the last page */
    next_page_url?: string | null
}

export type RideWithGpsGetRoutesProps = {
    /** first page is 1 */
    page?: number

    /** 20 - 200 */
    pageSize?: number

    /** only routes that are (not) archived */
    archived?: boolean
}

export type RideWithGpsRoutesPage = {
    routes: Array<RideWithGpsRoute>
    pagination?: RideWithGpsPagination
}

/** A point of the track of a route (TrackPointRoute in the API spec) */
export type RideWithGpsTrackPoint = {
    /** longitude */
    x: number

    /** latitude */
    y: number

    /** distance from start in meters */
    d?: number

    /** elevation in meters */
    e?: number
}

export type RideWithGpsRouteDetail = RideWithGpsRoute & {
    track_points?: Array<RideWithGpsTrackPoint>
}

export type RideWithGpsTaskItem = {
    item_type: string
    item_id: number
    item_url?: string | null
}

/** Reasons why the processing of an upload failed (`code` of a TaskError) */
export type RideWithGpsTaskErrorCode =
    'duplicate' | 'time_data_missing' | 'no_tracks' | 'empty_file' | 'parse_failed' | 'failed_to_process' | 'weigh_in_failed' | 'build_failed' | 'error'

export type RideWithGpsTaskError = {
    /** see RideWithGpsTaskErrorCode for the known values */
    code: string
    message?: string

    /** set if the error refers to an existing asset, as for a duplicate */
    item_type?: string | null
    item_id?: number | null
    item_url?: string | null
}

/** A background task, as returned for uploads */
export type RideWithGpsTask = {
    id: number
    type?: string

    /** `pending` until the task has run, then `completed` */
    status: string
    items?: Array<RideWithGpsTaskItem>
    errors?: Array<RideWithGpsTaskError>
}

export type RideWithGpsUploadProps = {
    /** the full path of the file to be uploaded (TCX, FIT, GPX) */
    fileName: string

    /** name of the trip (otherwise taken from the file) */
    name?: string
    description?: string

    /** if set, the activity type of the trip is updated after the upload was completed */
    activityType?: RideWithGpsTripActivityType
}

export type RideWithGpsUploadResult = {
    /** id of the trip. For a duplicate, this is the id of the existing trip (if RideWithGPS told it) */
    tripId?: string

    /** true if RideWithGPS already had this activity */
    duplicate?: boolean
}

/** The file has no time data (e.g. a planned route) and can therefore not be imported as a trip */
export class RideWithGpsTimeDataMissingError extends Error {
    constructor(message?: string) {
        super(message ?? 'Upload rejected by RideWithGPS: the file has no time data')
    }
}

/** RideWithGPS did not finish processing the upload in time. The file might still be processed, so it must not be uploaded again */
export class RideWithGpsTimeoutError extends Error {
    constructor(message?: string) {
        super(message ?? 'RideWithGPS did not finish processing the upload in time')
    }
}

/** The upload was rejected because the access token is not accepted (HTTP 401) */
export class RideWithGpsAuthError extends Error {}
