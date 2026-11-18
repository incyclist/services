import type { OAuthAppConfig, OAuthRefreshTokenResponse } from '../types'

/** Credentials of the TrainerDay athlete */
export type TrainerDayConfig = OAuthAppConfig

/** Response of the auth-server's `POST /trainerday/refresh` (the access token is valid for 6 hours) */
export type TrainerDayRefreshTokenResponse = OAuthRefreshTokenResponse

export type TrainerDayTargetType = 'primary' | 'cadence' | 'slope' | 'heart_rate'

export type TrainerDaySegmentTarget = {
    /** minimum target value */
    min: number

    /** maximum target value (null for single-value targets) */
    max?: number | null

    type: TrainerDayTargetType
}

export type TrainerDaySegmentNote = {
    /** offset in seconds from the segment start */
    timeOffset: number
    text: string
}

export type TrainerDayControlMode = 'slope' | 'hr' | 'erg' | 'resistance'

export type TrainerDaySegmentType =
    'warm-up' | 'active' | 'cooldown' | 'interval' | 'rest' | 'free-ride' | 'open-ended' | 'sfr' | 'lap' | 'climb' | 'slope' | 'hr' | 'erg' | '+' | '-'

export type TrainerDayBlockSegment = {
    name?: string
    controlMode?: TrainerDayControlMode | null
    segmentType?: TrainerDaySegmentType | null

    /** unit of the duration (default: second) */
    durationType?: 'second' | 'meter'

    /** duration in seconds or meters, depending on the durationType */
    durationValue: number
    pressLapButton?: boolean
    targets?: TrainerDaySegmentTarget[]
    notes?: TrainerDaySegmentNote[]
}

export type TrainerDayWorkoutBlock = {
    /** cumulative block start position in seconds */
    start?: number

    /** cumulative block end position in seconds */
    end?: number
    segments: TrainerDayBlockSegment[]

    /** number of repetitions (null or 1 for single-pass blocks) */
    reps?: number | null
    type: 'segment' | 'repetition' | 'set'
}

/** A workout of the TrainerDay calendar (Calendar_workout_v2 in the API spec) */
export type TrainerDayCalendarWorkout = {
    eventId?: string

    /** can be negative */
    workoutId?: number

    /** day, formatted as YYYY-MM-DD */
    date?: string
    title?: string
    description?: string
    durationMinutes?: number
    author?: string
    bikeStress?: number
    intensity?: number

    /** time in zones, not modelled in detail */
    timeInZones?: unknown
    workoutBlocks?: TrainerDayWorkoutBlock[]
    tags?: string[]
    workoutType?: 'bike' | 'swim' | 'rowing' | 'run'
    intensityMetric?: 'percentOfFtp' | 'percentOfHr'
    lengthUnit?: string
    intensityUnit?: string
}

export type TrainerDayUploadProps = {
    /** name of the activity */
    name: string

    /** format of the file */
    dataType: 'tcx' | 'gpx' | 'fit'

    /** file content: a string is expected to be base64 encoded already, binary content is encoded by the client */
    data: string | Uint8Array

    /** internal id, will be included in the activity body at TrainerDay */
    externalId?: string
    sportType?: 'bike' | 'swim'
}

/** Result of an upload */
export type TrainerDayUploadResult = {
    /** id of the activity on TrainerDay. For a duplicate, this is the id of the activity that already exists */
    activityId: string
    /** true if TrainerDay already had this activity (HTTP 200 with `{ duplicate: true, id }`) */
    duplicate?: boolean
}
