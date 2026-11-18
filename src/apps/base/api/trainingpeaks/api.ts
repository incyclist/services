import { AxiosResponse } from 'axios'
import { sleep } from '../../../../utils/sleep'
import { trimXmlTextNodes } from '../../../../utils/xml'
import { formatDay } from '../../utils'
import { OAuthAppApiBase } from '../oauth'
import { base64Size, isBase64 } from '../../../../utils/base64'
import {
    TrainingPeaksConfig, TrainingPeaksDuplicateError, TrainingPeaksFileFormat, TrainingPeaksFileStatus, TrainingPeaksRefreshTokenResponse,
    TrainingPeaksUploadProps, TrainingPeaksUploadRequest, TrainingPeaksUploadResult, TrainingPeaksWorkout
} from './types'

const APP_URL = 'https://app.trainingpeaks.com'
const SANDBOX_APP_URL = 'https://app.sandbox.trainingpeaks.com'
const UPLOAD_CLIENT = 'Incyclist'

/** TrainingPeaks only supports a range of 45 days when requesting workouts */
const MAX_WORKOUT_RANGE_DAYS = 45
const UPLOAD_POLL_INTERVAL = 2000
const UPLOAD_TIMEOUT = 60000

// The start of a workout is delivered in the time zone of the athlete's profile, without a time zone information.
// Time zone offsets are multiples of 15 minutes, so a workout is the same activity if its start differs by such an offset
// (the seconds are identical, as the file that was uploaded is the same)
const OFFSET_STEP_MS = 15 * 60 * 1000
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000
const MATCH_TOLERANCE_MS = 1000

/**
 * Client for the subset of the TrainingPeaks API that is required by Incyclist.
 *
 * TrainingPeaks access tokens are short-lived (~10 minutes), see `OAuthAppApiBase` for the token handling.
 */
export class TrainingPeaksApi extends OAuthAppApiBase<TrainingPeaksConfig, TrainingPeaksRefreshTokenResponse> {

    constructor() {
        super('TrainingPeaksApi', {
            name: 'TrainingPeaks',
            refreshPath: '/trainingpeaks/refresh',
            defaultApiUrl: 'https://api.trainingpeaks.com',
            apiUrlSetting: 'TP_API',
            authUrlSetting: 'TP_AUTH_SERVER_URL'
        })
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

        const response = await this.get(`/v2/workouts/${formatDay(start)}/${formatDay(end)}`)
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
            bytes: base64Size(props.data), bytesSent: base64Size(data)
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
        return this.mapUploadRejection(err)
    }

    protected getExpiration(data: TrainingPeaksRefreshTokenResponse): Date {
        const expiresIn = Number(data.expires_in)
        if (Number.isFinite(expiresIn))
            return new Date(Date.now() + expiresIn * 1000)

        // fall back to the value calculated by the auth-server (epoch milliseconds)
        return new Date(Number(data.expiration))
    }
}
