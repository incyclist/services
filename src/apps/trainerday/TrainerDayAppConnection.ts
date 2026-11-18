import { Singleton } from '../../base/decorators'
import { TrainerDayApi, TrainerDayConfig } from '../base/api'
import { OAuthAppConnection } from '../base/app'
import { parseExpiration } from '../base/utils'
import { AppsOperation } from '../types'
import { TrainerDayCredentials } from './types'

/**
 * Manages the connection to TrainerDay: loads, validates and persists the credentials (`user.auth.trainerday`)
 * and owns the TrainerDayApi instance.
 *
 * The OAuth flow itself (and the token refresh) is handled by the auth-server, so no
 * client id/secret is required here.
 */
@Singleton
export class TrainerDayAppConnection extends OAuthAppConnection<TrainerDayCredentials, TrainerDayConfig, TrainerDayApi> {

    constructor() {
        super('TrainerDayAppConnection', 'trainerday')
    }

    getSupportedOperations(): AppsOperation[] {
        return []
    }

    getDefaultOperations(): AppsOperation[] {
        return []
    }

    protected get appName(): string {
        return 'TrainerDay'
    }

    protected createApi(): TrainerDayApi {
        return new TrainerDayApi()
    }

    protected createConfig(credentials: TrainerDayCredentials): TrainerDayConfig {
        return {
            id: credentials?.id === undefined ? undefined : String(credentials.id),
            accessToken: credentials?.accesstoken,
            refreshToken: credentials?.refreshtoken,
            expiration: parseExpiration(credentials?.expiration)
        }
    }

    protected createCredentials(config: TrainerDayConfig): TrainerDayCredentials {
        return {
            id: config.id,
            accesstoken: config.accessToken,
            refreshtoken: config.refreshToken,
            expiration: config.expiration?.toISOString()
        }
    }
}
