import { AxiosInstance, AxiosResponse } from 'axios'
import { EventLogger } from 'gd-eventlog'
import { Observer } from '../../../../base/types/observer'
import { valid } from '../../../../utils/valid'
import { AppApiBase } from '../base'
import { IExternalAppApi } from '../types'
import { trimXmlTextNodes } from '../../../../utils/xml'
import { getErrorDetail, formatDay, toBase64, fromBase64, utf8Encode, utf8Decode, getTokenExpiration } from './utils'
import {
    TrainerDayCalendarWorkout, TrainerDayConfig, TrainerDayRefreshTokenResponse, TrainerDayUploadProps, TrainerDayUploadResult
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

    /** the refresh that is currently running (refresh tokens rotate, so concurrent requests must share one refresh) */
    protected refreshPromise?: Promise<void>

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
     * Retrieves the planned workouts of a range of days (`GET /api/v2/calendar`, scope `calendar:read`)
     *
     * @param startDate first day (`YYYY-MM-DD`) or a Date (local day)
     * @param endDate last day (`YYYY-MM-DD`) or a Date (local day)
     * @returns the workouts of the calendar
     * @throws if the response is not a list of workouts
     */
    async getCalendar(startDate: string | Date, endDate: string | Date): Promise<TrainerDayCalendarWorkout[]> {
        const params = { startDate: formatDay(startDate), endDate: formatDay(endDate) }
        const response = await this.get('/api/v2/calendar', { params })

        if (!Array.isArray(response.data))
            throw new Error('Unexpected response from TrainerDay calendar: expected an array')

        return response.data as TrainerDayCalendarWorkout[]
    }

    /**
     * Uploads a completed activity (`POST /api/v1/activities/upload`, scope `activities:write`) as JSON,
     * with the file content base64 encoded.
     *
     * The upload is asynchronous on the side of TrainerDay: the activity data may not be available for a couple of minutes
     * after the upload.
     *
     * @returns the id of the activity
     * @throws if not authenticated or the upload was rejected: `Upload rejected by TrainerDay (HTTP <status>): <details>`
     */
    async uploadActivity(props: TrainerDayUploadProps): Promise<TrainerDayUploadResult> {
        const { name, dataType, externalId, sportType } = props
        const data = this.prepareData(props)

        this.logger.logEvent({ message: 'TrainerDay upload', format: dataType, bytes: Math.floor(data.length * 3 / 4) })

        const body = { name, dataType, data, externalId, sportType }

        let response: AxiosResponse
        try {
            response = await this.request('post', '/api/v1/activities/upload', body)
        }
        catch (err) {
            throw this.mapUploadError(err)
        }

        // a duplicate is answered with HTTP 200 and `{ duplicate: true, id: <id of the existing activity> }`
        if (response.data?.duplicate === true) {
            const activityId = response.data.id ?? response.data.activityId
            this.logger.logEvent({ message: 'TrainerDay upload duplicate', activityId })
            return { activityId, duplicate: true }
        }

        return { activityId: response.data?.activityId }
    }

    /**
     * Returns the file content as base64.
     *
     * TrainerDay silently drops TCX/GPX activities with padded text values (the upload is accepted with HTTP 200 and an activityId,
     * but the activity never shows up), so the padding that the TCX exporter writes is removed from XML files. FIT files are sent as they are.
     */
    protected prepareData(props: TrainerDayUploadProps): string {
        const isXml = props.dataType === 'tcx' || props.dataType === 'gpx'
        const bytes = typeof props.data === 'string' ? undefined : props.data

        if (!isXml)
            return bytes ? toBase64(bytes) : props.data as string

        const xml = utf8Decode(bytes ?? fromBase64(props.data as string))
        return toBase64(utf8Encode(trimXmlTextNodes(xml)))
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
        return getTokenExpiration(data)
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
