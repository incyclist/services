import { Singleton } from '../../base/decorators'
import { RideWithGpsApi, RideWithGpsConfig } from '../base/api'
import { OAuthAppConnection } from '../base/app'
import { AppsOperation } from '../types'
import { RideWithGpsCredentials } from './types'

/**
 * Manages the connection to RideWithGPS: loads, validates and persists the credentials (`user.auth.ridewithgps`)
 * and owns the RideWithGpsApi instance.
 *
 * The OAuth flow is handled by the auth-server. The access token never expires and there is no refresh token,
 * so only the user id and the access token are persisted. If the token was revoked, the connection is removed.
 */
@Singleton
export class RideWithGpsAppConnection extends OAuthAppConnection<RideWithGpsCredentials, RideWithGpsConfig, RideWithGpsApi> {

    constructor() {
        super('RideWithGpsAppConnection', 'ridewithgps')
    }

    getSupportedOperations(): AppsOperation[] {
        return ['ActivityUpload', 'RouteDownload']
    }

    getDefaultOperations(): AppsOperation[] {
        return ['ActivityUpload', 'RouteDownload']
    }

    protected get appName(): string {
        return 'RideWithGPS'
    }

    protected createApi(): RideWithGpsApi {
        return new RideWithGpsApi()
    }

    protected createConfig(credentials: RideWithGpsCredentials): RideWithGpsConfig {
        return {
            id: credentials?.id === undefined || credentials.id === null ? undefined : String(credentials.id),
            accessToken: credentials?.accesstoken
        }
    }

    protected createCredentials(config: RideWithGpsConfig): RideWithGpsCredentials {
        return { id: config.id, accesstoken: config.accessToken }
    }
}
