import { StravaConfig } from "../base/api";
import { AppCredentials } from "../base/types";

export interface StravaCredentials extends AppCredentials {
    /** access token */
    accesstoken:string,  

    /** refresh token */
    refreshtoken:string

    expiration?: string

}