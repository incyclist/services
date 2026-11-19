import { OAuthAppCredentials } from '../base/types'

/** RideWithGPS tokens do not expire: the credentials only consist of the user id and the access token */
export type RideWithGpsCredentials = OAuthAppCredentials
