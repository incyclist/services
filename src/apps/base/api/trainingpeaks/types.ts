export type TrainingPeaksConfig = {
    /** TrainingPeaks athlete id */
    id?: string

    /** access token */
    accessToken: string

    /** refresh token */
    refreshToken: string

    /** point in time when the access token expires */
    expiration?: Date
}

/** Response of the auth-server's `POST /trainingpeaks/refresh` */
export type TrainingPeaksRefreshTokenResponse = {
    /** The short-lived access token */
    access_token: string

    /** The refresh token to be used for the next refresh. It can change with every refresh */
    refresh_token: string

    /** Seconds until the access token expires */
    expires_in: number

    token_type?: string

    /** Expiration of the access token as epoch milliseconds (string), as calculated by the auth-server */
    expiration?: string
}
