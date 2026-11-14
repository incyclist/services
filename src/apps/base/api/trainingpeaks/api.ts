import { AxiosInstance, AxiosResponse } from 'axios'
import { EventLogger } from 'gd-eventlog'
import { Observer } from '../../../../base/types/observer'
import { valid } from '../../../../utils/valid'
import { AppApiBase } from '../base'
import { IExternalAppApi } from '../types'
import { TrainingPeaksConfig, TrainingPeaksRefreshTokenResponse } from './types'

const API_BASE_URL = 'https://api.trainingpeaks.com'
const AUTH_SERVER_URL = 'https://auth.incyclist.com'

/**
 * Client for the subset of the TrainingPeaks API that is required by Incyclist.
 *
 * TrainingPeaks access tokens are short-lived (~10 minutes). Before every request the token
 * is verified and, if required, refreshed through the auth-server, so that the client
 * secret never has to be known by the app. Whenever a refresh happened, a `token.updated`
 * event is emitted on the Observer returned by `init()`, so that the owner can persist the new tokens.
 */
export class TrainingPeaksApi extends AppApiBase implements IExternalAppApi {

    protected config: TrainingPeaksConfig
    protected logger: EventLogger
    protected observer: Observer

    constructor() {
        super()
        this.logger = new EventLogger('TrainingPeaksApi')
        this.observer = new Observer()
    }

    /**
     * Initializes the API with the credentials of the user
     * @param config the credentials
     * @returns an Observer that emits `token.updated` after every token refresh
     */
    init(config: TrainingPeaksConfig): Observer {
        this.config = config
        this.observer = this.observer ?? new Observer()
        return this.observer
    }

    /**
     * Updates the credentials
     * @throws if the API was not initialized before
     */
    update(config: Partial<TrainingPeaksConfig>) {
        if (!this.config)
            throw new Error('update not allowed before init')

        this.config = { ...this.config, ...config }
    }

    /**
     * Checks if the user is authenticated.
     * @returns {boolean} Indicates if the user is authenticated.
     */
    isAuthenticated(): boolean {
        return valid(this.config?.accessToken)
    }

    /**
     * Performs an authenticated GET request, refreshing the access token first if required
     * @throws if not authenticated or the token could not be refreshed
     */
    protected async get(url: string, config?: object): Promise<AxiosResponse> {
        await this.verifyAuthentication()

        const request = {
            method: 'get',
            url: this.getBaseUrl() + url,
            headers: {
                Authorization: 'Bearer ' + this.config.accessToken
            },
            ...config
        }
        return await this.getApi().request(request)
    }

    protected async verifyAuthentication() {
        if (!this.isAuthenticated())
            throw new Error('not authenticated')

        await this.verifyToken()
    }

    protected async verifyToken() {
        if (this.isTokenStillValid())
            return

        try {
            await this.refreshToken()
        }
        catch {
            throw new Error('token refresh failed')
        }
    }

    protected isTokenStillValid(): boolean {
        const expiration = this.config?.expiration
        if (!expiration)
            return false

        return Date.now() < expiration.valueOf()
    }

    /**
     * Refreshes the access token.
     *
     * The refresh is performed server-side by `auth-server`'s `POST /trainingpeaks/refresh`
     * endpoint, which holds the client secret. The client only sends the refresh token it
     * already has and receives a fresh access/refresh token pair. As the refresh token
     * can change with every refresh, the new pair must always be persisted (see `token.updated`).
     */
    protected async refreshToken(): Promise<void> {
        this.logger.logEvent({ message: 'TrainingPeaks refresh token start' })

        const url = this.getAuthServerUrl() + '/trainingpeaks/refresh'

        try {
            const response = await this.getApi().request({
                method: 'post',
                url,
                data: { refresh_token: this.config.refreshToken }
            })

            const data = response.data as TrainingPeaksRefreshTokenResponse

            this.config.accessToken = data.access_token
            this.config.refreshToken = data.refresh_token
            this.config.expiration = this.getExpiration(data)

            this.logger.logEvent({ message: 'TrainingPeaks refresh token result', status: 'success' })
            this.observer.emit('token.updated', this.config)
        }
        catch (err) {
            const error = err.response ? `HTTP error ${err.response.status}: ${err.response.statusText}, url:${url}` : err.message
            this.logger.logEvent({ message: 'TrainingPeaks refresh token result', status: 'error', error })
            throw err
        }
    }

    protected getExpiration(data: TrainingPeaksRefreshTokenResponse): Date {
        const expiresIn = Number(data.expires_in)
        if (Number.isFinite(expiresIn))
            return new Date(Date.now() + expiresIn * 1000)

        // fall back to the value calculated by the auth-server (epoch milliseconds)
        return new Date(Number(data.expiration))
    }

    protected getAuthServerUrl(): string {
        try {
            return this.getUserSettings().get('TP_AUTH_SERVER_URL', AUTH_SERVER_URL)
        }
        catch {
            return AUTH_SERVER_URL
        }
    }

    protected getBaseUrl(): string {
        try {
            return this.getUserSettings().get('TP_API', API_BASE_URL)
        }
        catch {
            return API_BASE_URL
        }
    }

    protected getApi(): AxiosInstance {
        return super.getApi(true)
    }
}
