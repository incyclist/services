import type { OAuthAppConfig, OAuthRefreshTokenResponse } from '../types'

/** Credentials of the TrainingPeaks athlete */
export type TrainingPeaksConfig = OAuthAppConfig & {
    /** User-Agent for the requests to TrainingPeaks, as defined by the auth-server (the same one the auth-server uses) */
    userAgent?: string
}

/** Response of the auth-server's `POST /trainingpeaks/refresh` */
export type TrainingPeaksRefreshTokenResponse = OAuthRefreshTokenResponse & {
    /** User-Agent for the requests to TrainingPeaks (not delivered by older versions of the auth-server) */
    user_agent?: string
}

/** Formats of a structured workout file that can be downloaded (as listed in `WorkoutFileFormats` of a workout) */
export type TrainingPeaksFileFormat = 'zwo' | 'erg' | 'mrc' | 'fit' | 'json'

/** Subset of the TrainingPeaks workout object that is required by Incyclist */
export type TrainingPeaksWorkout = {
    Id: number

    /** day of the workout (local time) */
    WorkoutDay: string

    /** e.g. Bike, Run, Swim, Brick, Day Off, ... (capitalization as provided by TrainingPeaks) */
    WorkoutType: string

    Title?: string
    Description?: string
    Completed?: boolean

    /** time of last modification (Mountain Time, without time zone information) */
    LastModifiedDate?: string

    /** start of a completed workout (local time of the athlete, without time zone information) */
    StartTime?: string

    /** formats in which the structured workout can be downloaded */
    WorkoutFileFormats?: Array<string>

    /**
     * Planned values: TrainingPeaks does not distinguish between a workout and an activity (e.g. an uploaded file).
     * An activity has no planned values (they are `null`), a workout that was planned has them, even after it was completed
     */
    TotalTimePlanned?: number | null
    DistancePlanned?: number | null
    TssPlanned?: number | null
    StartTimePlanned?: string | null
}

export type TrainingPeaksActivityType = 'swim' | 'bike' | 'run' | 'x-train' | 'mtb' | 'strength' | 'xc-ski' | 'rowing' | 'walk' | 'other'

export type TrainingPeaksUploadProps = {
    /** name of the file, including the extension (e.g. `ride.tcx`). Must not contain any of / \ ? % * : | " < > or a space */
    fileName: string

    /** Base64 encoded content of the file */
    data: string

    title?: string
    comment?: string

    /** Type of the activity. If omitted TrainingPeaks reads the type from the file */
    type?: TrainingPeaksActivityType
}

/** Request body of `POST /v3/file` */
export type TrainingPeaksUploadRequest = {
    UploadClient: string
    Filename: string
    Data: string
    Title?: string
    Comment?: string
    Type?: TrainingPeaksActivityType
}

/** Response of `GET /v3/status/{id}` */
export type TrainingPeaksFileStatus = {
    /** true if the processing has finished */
    Completed: boolean

    /** Success or error details */
    Status?: string

    /** ids of the workouts that were created */
    WorkoutIds?: Array<number>
}

export type TrainingPeaksUploadResult = {
    /** id of the workout that was created in TrainingPeaks */
    trainingPeaksId: string
}

/**
 * Signals that the activity was already uploaded to TrainingPeaks (HTTP 422, `File already processed.`).
 * TrainingPeaks does not tell the id of the existing workout
 */
export class TrainingPeaksDuplicateError extends Error {
    constructor(message = 'Activity already exists in TrainingPeaks') {
        super(message)
        this.name = 'TrainingPeaksDuplicateError'
    }
}
