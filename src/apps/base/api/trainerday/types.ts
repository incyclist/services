export type TrainerDayConfig = {
    /** TrainerDay athlete id */
    id?: string

    /** access token */
    accessToken: string

    /** refresh token */
    refreshToken: string

    /** point in time when the access token expires */
    expiration?: Date
}

/** Response of the auth-server's `POST /trainerday/refresh` */
export type TrainerDayRefreshTokenResponse = {
    /** The access token (valid for 6 hours) */
    access_token: string

    /** The refresh token to be used for the next refresh. It can change with every refresh */
    refresh_token: string

    /** Seconds until the access token expires */
    expires_in: number

    token_type?: string

    /** Expiration of the access token as epoch milliseconds (string), as calculated by the auth-server */
    expiration?: string
}

/**
 * Raw body of a TrainerDay response. The structure of the responses is not verified yet,
 * so callers have to inspect the content before using it.
 */
export type TrainerDayRawResponse = unknown

export type TrainerDayUploadProps = {
    /** name of the file, including the extension (`.tcx`, `.gpx` or `.fit`) */
    fileName: string

    /** binary content of the file */
    data: Uint8Array
}

/** Result of an upload: the status and the body as delivered by TrainerDay (the structure is not verified yet) */
export type TrainerDayUploadResult = {
    status: number
    body: TrainerDayRawResponse
}

/**
 * Signals that the activity was already uploaded to TrainerDay.
 * Currently not thrown by the API client: how TrainerDay reports a duplicate is not verified yet.
 */
export class TrainerDayDuplicateError extends Error {
    constructor(message = 'Activity already exists in TrainerDay') {
        super(message)
        this.name = 'TrainerDayDuplicateError'
    }
}
