import { OAuthAppCredentials } from '../base/types'

export type TrainingPeaksCredentials = OAuthAppCredentials & {
    /** User-Agent that TrainingPeaks expects for requests of the integration, as defined by the auth-server */
    useragent?: string
}
