import { AppCredentials } from "../base/types";

export interface IntervalsCredentials extends AppCredentials {
    /** access token */
    accesstoken:string,  

    /** refresh token */
    refreshtoken:string

    expiration?: string

}