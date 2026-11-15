import { Singleton } from '../../base/decorators'
import { TrainingPeaksApi, TrainingPeaksConfig } from '../base/api'
import { OAuthAppConnection } from '../base/app'
import { parseExpiration } from '../base/utils'
import { AppsOperation } from '../types'
import { TrainingPeaksCredentials } from './types'

/**
 * Manages the connection to TrainingPeaks: loads, validates and persists the credentials (`user.auth.trainingpeaks`)
 * and owns the TrainingPeaksApi instance.
 *
 * The OAuth flow itself (and the token refresh) is handled by the auth-server, so no
 * client id/secret is required here.
 */
@Singleton
export class TrainingPeaksAppConnection extends OAuthAppConnection<TrainingPeaksCredentials, TrainingPeaksConfig, TrainingPeaksApi> {

    constructor() {
        super('TrainingPeaksAppConnection', 'trainingpeaks')
    }

    getSupportedOperations(): AppsOperation[] {
        return ['ActivityUpload', 'WorkoutDownload']
    }

    getDefaultOperations(): AppsOperation[] {
        return ['ActivityUpload', 'WorkoutDownload']
    }

    protected get appName(): string {
        return 'TrainingPeaks'
    }

    protected createApi(): TrainingPeaksApi {
        return new TrainingPeaksApi()
    }

    protected createConfig(credentials: TrainingPeaksCredentials): TrainingPeaksConfig {
        return {
            id: credentials?.id === undefined ? undefined : String(credentials.id),
            accessToken: credentials?.accesstoken,
            refreshToken: credentials?.refreshtoken,
            expiration: parseExpiration(credentials?.expiration)
        }
    }

    protected createCredentials(config: TrainingPeaksConfig): TrainingPeaksCredentials {
        return {
            id: config.id,
            accesstoken: config.accessToken,
            refreshtoken: config.refreshToken,
            expiration: config.expiration?.toISOString()
        }
    }
}
