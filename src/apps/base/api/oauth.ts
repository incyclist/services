import { AxiosInstance, AxiosResponse } from 'axios'
import { EventLogger } from 'gd-eventlog'
import { Observer } from '../../../base/types/observer'
import { valid } from '../../../utils/valid'
import { getErrorDetail } from '../utils'
import { AppApiBase } from './base'
import { IExternalAppApi, OAuthApiProps, OAuthAppConfig, OAuthRefreshTokenResponse } from './types'

const AUTH_SERVER_URL = 'https://auth.incyclist.com'

/**
 * Shared logic of the API clients of apps that are accessed with short-lived access tokens.
 *
 * Before every request the token is verified and, if required, refreshed through the auth-server, so that the client
 * secret never has to be known by the app. Whenever a refresh happened, a `token.updated`
 * event is emitted on the Observer returned by `init()`, so that the owner can persist the new tokens.
 */
export abstract class OAuthAppApiBase<
    TConfig extends OAuthAppConfig = OAuthAppConfig,
    TRefresh extends OAuthRefreshTokenResponse = OAuthRefreshTokenResponse
> extends AppApiBase implements IExternalAppApi {

    protected config: TConfig
    protected logger: EventLogger
    protected observer: Observer

    /** the refresh that is currently running (refresh tokens rotate, so concurrent requests must share one refresh) */
    protected refreshPromise?: Promise<void>

    protected constructor(loggerName: string, protected readonly props: OAuthApiProps) {
        super()
        this.logger = new EventLogger(loggerName)
        this.observer = new Observer()
    }

    /**
     * Initializes the API with the credentials of the user
     * @param config the credentials
     * @returns an Observer that emits `token.updated` after every token refresh
     */
    init(config: TConfig): Observer {
        this.config = config
        return this.observer
    }

    /**
     * Updates the credentials
     * @throws if the API was not initialized before
     */
    update(config: Partial<TConfig>) {
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

    /** @returns the point in time when the access token expires, as delivered by the refresh endpoint */
    protected abstract getExpiration(data: TRefresh): Date

    /**
     * Performs an authenticated request, refreshing the access token first if required
     * @throws if not authenticated, the token could not be refreshed or the request failed
     */
    protected async request(method: 'get' | 'post', url: string, data?: object, config?: object): Promise<AxiosResponse> {
        await this.verifyAuthentication()

        const request = {
            method,
            url: this.getBaseUrl() + url,
            data,
            headers: {
                Authorization: 'Bearer ' + this.config.accessToken
            },
            validateStatus: (status: number) => status >= 200 && status < 300,
            ...config
        }
        return await this.getApi().request(request)
    }

    protected async get(url: string, config?: object): Promise<AxiosResponse> {
        return await this.request('get', url, undefined, config)
    }

    /** @returns the error for a rejected upload (the response of the app explains why the request was rejected) or the original error if there was no response */
    protected mapUploadRejection(err): Error {
        const status = err.response?.status
        if (status) {
            const detail = getErrorDetail(err.response.data)
            return new Error(`Upload rejected by ${this.props.name} (HTTP ${status})${detail ? ': ' + detail : ''}`)
        }
        return err
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
            await this.refreshTokenOnce()
        }
        catch {
            throw new Error('token refresh failed')
        }
    }

    /**
     * Refreshes the token, making sure that only one refresh runs at a time: the refresh token is rotated by every refresh,
     * so a second refresh with the old token would be rejected (invalid_grant). Concurrent callers wait for the same refresh.
     */
    protected refreshTokenOnce(): Promise<void> {
        this.refreshPromise ??= this.refreshToken().finally(() => { this.refreshPromise = undefined })
        return this.refreshPromise
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
     * The refresh is performed server-side by the auth-server, which holds the client secret. The client only sends the
     * refresh token it already has and receives a fresh access/refresh token pair. As the refresh token
     * can change with every refresh, the new pair must always be persisted (see `token.updated`).
     */
    protected async refreshToken(): Promise<void> {
        const { name, refreshPath } = this.props
        this.logger.logEvent({ message: `${name} refresh token start` })

        const url = this.getAuthServerUrl() + refreshPath

        try {
            const response = await this.getApi().request({
                method: 'post',
                url,
                data: { refresh_token: this.config.refreshToken }
            })

            const data = response.data as TRefresh

            this.config.accessToken = data.access_token
            this.config.refreshToken = data.refresh_token
            this.config.expiration = this.getExpiration(data)

            this.logger.logEvent({ message: `${name} refresh token result`, status: 'success' })
            this.observer.emit('token.updated', this.config)
        }
        catch (err) {
            const error = err.response ? `HTTP error ${err.response.status}: ${err.response.statusText}, url:${url}` : err.message
            this.logger.logEvent({ message: `${name} refresh token result`, status: 'error', error })
            throw err
        }
    }

    /** reads a user setting, falling back to the default if the settings are not available (yet) */
    protected getSetting<T>(key: string, defValue: T | null): T | null {
        try {
            const settings = this.getUserSettings()
            if (settings?.isInitialized === false)
                return defValue
            return settings.get(key, defValue) ?? defValue
        }
        catch {
            return defValue
        }
    }

    protected getAuthServerUrl(): string {
        return this.getSetting<string>(this.props.authUrlSetting, null)
            ?? this.getSetting<string>('oauthUrl', null)
            ?? AUTH_SERVER_URL
    }

    protected getBaseUrl(): string {
        return this.getSetting<string>(this.props.apiUrlSetting, this.props.defaultApiUrl) ?? this.props.defaultApiUrl
    }

    protected getApi(): AxiosInstance {
        return super.getApi(true)
    }
}
