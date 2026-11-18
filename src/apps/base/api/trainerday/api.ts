import { AxiosInstance, AxiosResponse } from 'axios'
import { EventLogger } from 'gd-eventlog'
import { Observer } from '../../../../base/types/observer'
import { valid } from '../../../../utils/valid'
import { AppApiBase } from '../base'
import { IExternalAppApi } from '../types'
import { getErrorDetail, formatDay } from './utils'
import {
    TrainerDayConfig, TrainerDayRawResponse, TrainerDayRefreshTokenResponse, TrainerDayUploadProps, TrainerDayUploadResult
} from './types'

const API_BASE_URL = 'https://api.trainerday.com'
const AUTH_SERVER_URL = 'https://auth.incyclist.com'

/**
 * Client for the subset of the TrainerDay API that is required by Incyclist.
 *
 * TrainerDay access tokens are valid for 6 hours. Before every request the token
 * is verified and, if required, refreshed through the auth-server, so that the client
 * secret never has to be known by the app. Whenever a refresh happened, a `token.updated`
 * event is emitted on the Observer returned by `init()`, so that the owner can persist the new tokens.
 */
export class TrainerDayApi extends AppApiBase implements IExternalAppApi {

    protected config: TrainerDayConfig
    protected logger: EventLogger
    protected observer: Observer

    constructor() {
        super()
        this.logger = new EventLogger('TrainerDayApi')
        this.observer = new Observer()
    }

    /**
     * Initializes the API with the credentials of the user
     * @param config the credentials
     * @returns an Observer that emits `token.updated` after every token refresh
     */
    init(config: TrainerDayConfig): Observer {
        this.config = config
        this.observer = this.observer ?? new Observer()
        return this.observer
    }

    /**
     * Updates the credentials
     * @throws if the API was not initialized before
     */
    update(config: Partial<TrainerDayConfig>) {
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
     * Retrieves the planned workouts of a range of days (`GET /api/v1/calendar`, scope `calendar:read`)
     *
     * @param startDate first day (`YYYY-MM-DD`) or a Date (local day)
     * @param endDate last day (`YYYY-MM-DD`) or a Date (local day)
     * @returns the parsed response body (structure not verified yet)
     */
    async getCalendar(startDate: string | Date, endDate: string | Date): Promise<TrainerDayRawResponse> {
        const params = { startDate: formatDay(startDate), endDate: formatDay(endDate) }
        const response = await this.get('/api/v1/calendar', { params })
        return response.data
    }

    /**
     * Uploads a completed activity file (TCX, GPX or FIT) as multipart/form-data, field `file`
     * (`POST /api/v1/activities/upload`, scope `activities:write`)
     *
     * @returns the HTTP status and the parsed body as delivered by TrainerDay
     * @throws if not authenticated or the upload was rejected: `Upload rejected by TrainerDay (HTTP <status>): <details>`
     */
    async uploadActivity(props: TrainerDayUploadProps): Promise<TrainerDayUploadResult> {
        const form = new FormData()
        form.append('file', new Blob([props.data as BlobPart]), props.fileName)

        this.logger.logEvent({
            message: 'TrainerDay upload', format: props.fileName.split('.').at(-1)?.toLowerCase(), bytes: props.data.byteLength
        })

        let response: AxiosResponse
        try {
            response = await this.request('post', '/api/v1/activities/upload', form)
        }
        catch (err) {
            throw this.mapUploadError(err)
        }
        return { status: response.status, body: response.data }
    }

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

    protected mapUploadError(err): Error {
        const status = err.response?.status
        if (status) {
            // the response of TrainerDay explains why the request was rejected
            const detail = getErrorDetail(err.response.data)
            return new Error(`Upload rejected by TrainerDay (HTTP ${status})${detail ? ': ' + detail : ''}`)
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
     * The refresh is performed server-side by `auth-server`'s `POST /trainerday/refresh`
     * endpoint, which holds the client secret. The client only sends the refresh token it
     * already has and receives a fresh access/refresh token pair. As the refresh token
     * can change with every refresh, the new pair must always be persisted (see `token.updated`).
     */
    protected async refreshToken(): Promise<void> {
        this.logger.logEvent({ message: 'TrainerDay refresh token start' })

        const url = this.getAuthServerUrl() + '/trainerday/refresh'

        try {
            const response = await this.getApi().request({
                method: 'post',
                url,
                data: { refresh_token: this.config.refreshToken }
            })

            const data = response.data as TrainerDayRefreshTokenResponse

            this.config.accessToken = data.access_token
            this.config.refreshToken = data.refresh_token
            this.config.expiration = this.getExpiration(data)

            this.logger.logEvent({ message: 'TrainerDay refresh token result', status: 'success' })
            this.observer.emit('token.updated', this.config)
        }
        catch (err) {
            const error = err.response ? `HTTP error ${err.response.status}: ${err.response.statusText}, url:${url}` : err.message
            this.logger.logEvent({ message: 'TrainerDay refresh token result', status: 'error', error })
            throw err
        }
    }

    protected getExpiration(data: TrainerDayRefreshTokenResponse): Date {
        const expiresIn = Number(data.expires_in)
        if (Number.isFinite(expiresIn))
            return new Date(Date.now() + expiresIn * 1000)

        // fall back to the value calculated by the auth-server (epoch milliseconds)
        return new Date(Number(data.expiration))
    }

    /** reads a user setting, falling back to the default if the settings are not available (yet) */
    protected getSetting<T>(key: string, defValue: T | null): T | null {
        try {
            const settings = this.getUserSettings()
            if (!settings?.isInitialized)
                return defValue
            return settings.get(key, defValue) ?? defValue
        }
        catch {
            return defValue
        }
    }

    protected getAuthServerUrl(): string {
        return this.getSetting<string>('TRAINERDAY_AUTH_SERVER_URL', null)
            ?? this.getSetting<string>('oauthUrl', null)
            ?? AUTH_SERVER_URL
    }

    protected getBaseUrl(): string {
        return this.getSetting<string>('TRAINERDAY_API', API_BASE_URL) ?? API_BASE_URL
    }

    protected getApi(): AxiosInstance {
        return super.getApi(true)
    }
}
