export interface IExternalAppApi {
    isAuthenticated():boolean
}

/** Credentials of an app that is accessed with short-lived access tokens that are refreshed through the auth-server */
export type OAuthAppConfig = {
    /** athlete id */
    id?: string

    /** access token */
    accessToken: string

    /** refresh token (not available for apps with non-expiring tokens) */
    refreshToken?: string

    /** point in time when the access token expires */
    expiration?: Date
}

/** Response of the refresh endpoint of the auth-server */
export type OAuthRefreshTokenResponse = {
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

/** The differences between the apps that share the OAuth API client */
export type OAuthApiProps = {
    /** name of the app, used in log events and error messages (e.g. `TrainingPeaks`) */
    name: string

    /**
     * path of the refresh endpoint of the auth-server (e.g. `/trainingpeaks/refresh`).
     * Omit it for apps whose access tokens never expire: the token is then always considered valid and never refreshed
     */
    refreshPath?: string

    /**
     * path of a request that succeeds for every valid access token (e.g. the current user).
     * Only used for apps without refresh: a HTTP 401 only disconnects the app if this request is rejected with HTTP 401 as well
     */
    authCheckPath?: string

    /** url of the API of the app (default) */
    defaultApiUrl: string

    /** name of the user setting that overrides the url of the API */
    apiUrlSetting: string

    /** name of the user setting that overrides the url of the auth-server */
    authUrlSetting: string
}
