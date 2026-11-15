// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppCredentials {}   

/**
 * Credentials of an app that is connected via the OAuth flow of the auth-server.
 *
 * This is the contract between the UI and `AppsService.connect()`. It is identical for all OAuth apps,
 * the UI passes on what it received from the auth-server (all fields except the tokens are optional).
 */
export interface OAuthAppCredentials extends AppCredentials {
    /** id of the user at the app (if provided by the auth-server) */
    id?: string | number

    /** access token */
    accesstoken: string

    /** refresh token */
    refreshtoken: string

    /**
     * Expiration of the access token. The following formats are supported:
     * ISO date string (as persisted in the user settings), epoch milliseconds or epoch seconds (as string or number)
     */
    expiration?: string | number | null
}

export type * from './api/types'