import { AxiosInstance, AxiosResponse } from 'axios'
import { EventLogger } from 'gd-eventlog'
import { Observer } from '../../../../base/types/observer'
import { valid } from '../../../../utils/valid'
import { AppApiBase } from '../base'
import { IExternalAppApi } from '../types'
import { sleep } from '../../../../utils/sleep'
import { isBase64, trimXmlTextNodes } from './utils'
import {
    TrainingPeaksConfig, TrainingPeaksDuplicateError, TrainingPeaksFileFormat, TrainingPeaksFileStatus, TrainingPeaksRefreshTokenResponse,
    TrainingPeaksUploadProps, TrainingPeaksUploadRequest, TrainingPeaksUploadResult, TrainingPeaksWorkout
} from './types'

const API_BASE_URL = 'https://api.trainingpeaks.com'
const AUTH_SERVER_URL = 'https://auth.incyclist.com'
const APP_URL = 'https://app.trainingpeaks.com'
const SANDBOX_APP_URL = 'https://app.sandbox.trainingpeaks.com'
const UPLOAD_CLIENT = 'Incyclist'

/** TrainingPeaks only supports a range of 45 days when requesting workouts */
const MAX_WORKOUT_RANGE_DAYS = 45
const UPLOAD_POLL_INTERVAL = 2000
const UPLOAD_TIMEOUT = 60000
const MAX_ERROR_DETAIL = 500

// The start of a workout is delivered in the time zone of the athlete's profile, without a time zone information.
// Time zone offsets are multiples of 15 minutes, so a workout is the same activity if its start differs by such an offset
// (the seconds are identical, as the file that was uploaded is the same)
const OFFSET_STEP_MS = 15 * 60 * 1000
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000
const MATCH_TOLERANCE_MS = 1000

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
     * @returns the url of the calendar in the web app of TrainingPeaks (the one of the sandbox, if the sandbox api is used).
     * TrainingPeaks does not support links to a single workout or to a date of the calendar
     */
    getCalendarUrl(): string {
        const isSandbox = this.getBaseUrl().toLowerCase().includes('sandbox')
        return (isSandbox ? SANDBOX_APP_URL : APP_URL) + '/#calendar'
    }

    /**
     * Retrieves the workouts of the athlete (planned and completed) for a range of days
     *
     * @param start first day (local time)
     * @param end last day (local time). The range must not exceed 45 days
     * @throws if the range is not valid, the user is not authenticated or the request failed
     */
    async getWorkouts(start: Date, end: Date): Promise<Array<TrainingPeaksWorkout>> {
        const days = (end.valueOf() - start.valueOf()) / 86400000
        if (days < 0 || days > MAX_WORKOUT_RANGE_DAYS)
            throw new Error(`invalid range: start and end must not be more than ${MAX_WORKOUT_RANGE_DAYS} days apart`)

        const response = await this.get(`/v2/workouts/${this.formatDay(start)}/${this.formatDay(end)}`)
        return (response.data ?? []) as Array<TrainingPeaksWorkout>
    }

    /**
     * Finds the completed cycling workout that started at the given time (e.g. the workout that exists already after an upload was rejected as duplicate)
     *
     * TrainingPeaks delivers the start of a workout in the time zone of the athlete's profile without telling it. A workout is therefore
     * seen as the same activity if its start differs from the start of the activity by a time zone offset (a multiple of 15 minutes, 14 hours at most)
     * and has the same seconds (a difference of less than one second is accepted, as TrainingPeaks might cut the milliseconds).
     *
     * @param start start of the activity
     * @returns the workout that matches best or `undefined` if there is none
     */
    async findWorkout(start: Date): Promise<TrainingPeaksWorkout | undefined> {
        // the days before and after are included, as the day of a workout is the day in the time zone of the athlete
        const from = new Date(start)
        from.setDate(from.getDate() - 1)
        const to = new Date(start)
        to.setDate(to.getDate() + 1)

        const workouts = await this.getWorkouts(from, to)

        const candidates = workouts
            .filter(w => w.Completed === true && w.WorkoutType?.toLowerCase() === 'bike')
            .map(workout => ({ workout, deviation: this.getStartDeviation(workout, start) }))
            .filter(c => c.deviation <= MATCH_TOLERANCE_MS)
            .sort((a, b) => a.deviation - b.deviation)

        return candidates[0]?.workout
    }

    /**
     * @returns how far the start of the workout is from the start of the activity, ignoring a time zone offset (in ms).
     *          `Infinity` if the workout has no (valid) start or the difference can not be a time zone offset
     */
    protected getStartDeviation(workout: TrainingPeaksWorkout, start: Date): number {
        if (!workout.StartTime)
            return Number.POSITIVE_INFINITY

        // no time zone information: the value is interpreted as UTC, the difference to the activity is the offset of the athlete's time zone
        const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(workout.StartTime)
        const diff = new Date(hasZone ? workout.StartTime : workout.StartTime + 'Z').valueOf() - start.valueOf()
        if (Number.isNaN(diff) || Math.abs(diff) > MAX_OFFSET_MS + MATCH_TOLERANCE_MS)
            return Number.POSITIVE_INFINITY

        const rest = ((diff % OFFSET_STEP_MS) + OFFSET_STEP_MS) % OFFSET_STEP_MS
        return Math.min(rest, OFFSET_STEP_MS - rest)
    }

    /**
     * Downloads the structured workout file of a workout
     *
     * @param workoutId id of the workout
     * @param format format of the file (must be one of the `WorkoutFileFormats` of the workout)
     * @returns the content of the file
     */
    async getWorkoutFile(workoutId: number | string, format: TrainingPeaksFileFormat = 'zwo'): Promise<string> {
        const response = await this.get(`/v2/workouts/wod/file/${workoutId}/?format=${format}`, { responseType: 'text' })
        return response.data as string
    }

    /**
     * Uploads a completed activity to TrainingPeaks.
     *
     * TrainingPeaks processes uploads asynchronously: the upload is accepted first and the result is polled afterwards
     *
     * @throws if not authenticated, the upload was rejected (e.g. the activity already exists), failed or did not finish in time
     */
    async upload(props: TrainingPeaksUploadProps): Promise<TrainingPeaksUploadResult> {
        if (!isBase64(props.data))
            throw new Error('Upload failed, reason: data is not base64 encoded')

        const data = this.prepareData(props)
        // sizes in bytes: shows if the content of a TCX file was modified before it was sent
        this.logger.logEvent({
            message: 'TrainingPeaks upload', format: props.fileName.split('.').at(-1)?.toLowerCase(),
            bytes: this.getBase64Size(props.data), bytesSent: this.getBase64Size(data)
        })

        const request: TrainingPeaksUploadRequest = {
            UploadClient: UPLOAD_CLIENT,
            Filename: props.fileName,
            Data: data,
            Title: props.title,
            Comment: props.comment,
            Type: props.type
        }

        const trackingId = await this.createUpload(request)
        const trainingPeaksId = await this.waitForUploadResult(trackingId)
        return { trainingPeaksId }
    }

    /**
     * TrainingPeaks does not understand the padding around the values that the TCX exporter writes
     * (the upload is accepted and the processing fails with `FileNotUnderstood`), so it is removed from TCX files.
     * All other files are sent as they are.
     */
    protected prepareData(props: TrainingPeaksUploadProps): string {
        if (!props.fileName.toLowerCase().endsWith('.tcx'))
            return props.data

        const xml = Buffer.from(props.data, 'base64').toString('utf-8')
        return Buffer.from(trimXmlTextNodes(xml), 'utf-8').toString('base64')
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

    /** @returns the tracking id of the upload (used to poll the status) */
    protected async createUpload(request: TrainingPeaksUploadRequest): Promise<string> {
        let response: AxiosResponse
        try {
            response = await this.request('post', '/v3/file', request)
        }
        catch (err) {
            throw this.mapUploadError(err)
        }

        // the status url is delivered in the Location header: .../v3/status/{trackingId}
        const location: string = response.headers?.location ?? response.headers?.Location
        const trackingId = location?.split('?')[0].split('/').findLast(part => part.length > 0)
        if (!trackingId)
            throw new Error('Upload failed, reason: no status url received')

        return trackingId
    }

    /** polls the status of the upload until the processing is completed (the status is requested one after the other, not in parallel) */
    protected async waitForUploadResult(trackingId: string, attempt = 0): Promise<string> {
        if (attempt >= Math.ceil(UPLOAD_TIMEOUT / UPLOAD_POLL_INTERVAL))
            throw new Error('Upload failed, reason: timeout')

        const response = await this.get(`/v3/status/${trackingId}`)
        const status = response.data as TrainingPeaksFileStatus

        if (status?.Completed) {
            const id = status.WorkoutIds?.[0]
            if (id === undefined)
                throw new Error('Upload failed, reason: ' + (status.Status ?? 'unknown'))
            return String(id)
        }

        await this.waitForReady()
        return await this.waitForUploadResult(trackingId, attempt + 1)
    }

    protected async waitForReady() {
        await sleep(UPLOAD_POLL_INTERVAL)
    }

    protected mapUploadError(err): Error {
        const status = err.response?.status
        if (status === 422)
            return new TrainingPeaksDuplicateError()
        if (status === 415)
            return new Error('File format is not supported by TrainingPeaks')
        if (status) {
            // the response of TrainingPeaks explains why the request was rejected (e.g. which field is not valid)
            const detail = this.getErrorDetail(err.response.data)
            return new Error(`Upload rejected by TrainingPeaks (HTTP ${status})${detail ? ': ' + detail : ''}`)
        }
        return err
    }

    protected getErrorDetail(data: unknown): string | undefined {
        if (data === undefined || data === null || data === '')
            return undefined

        const text = typeof data === 'string' ? data : JSON.stringify(data)
        return text.length > MAX_ERROR_DETAIL ? text.substring(0, MAX_ERROR_DETAIL) + '...' : text
    }

    /** @returns the size (in bytes) of the content of a base64 encoded string */
    protected getBase64Size(base64: string): number {
        const padding = base64.endsWith('==') ? 2 : Number(base64.endsWith('='))
        return Math.floor(base64.length * 3 / 4) - padding
    }

    protected formatDay(date: Date): string {
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${date.getFullYear()}-${month}-${day}`
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
            const TP_AUTH_SERVER_URL= this.getUserSettings().get('TP_AUTH_SERVER_URL', null)
            const oauthUrl= this.getUserSettings().get('oauthUrl', null)
            return TP_AUTH_SERVER_URL??oauthUrl??AUTH_SERVER_URL

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
