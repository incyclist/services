import { AxiosResponse } from 'axios'
import { trimXmlTextNodes } from '../../../../utils/xml'
import { OAuthAppApiBase } from '../oauth'
import { base64Size, fromBase64, toBase64 } from '../../../../utils/base64'
import { utf8Decode, utf8Encode } from '../../../../utils/utf8'
import { formatDay, getTokenExpiration } from '../../utils'
import {
    DEFAULT_TOKEN_LIFETIME_MS, TrainerDayCalendarWorkout, TrainerDayConfig, TrainerDayRefreshTokenResponse, TrainerDayUploadProps, TrainerDayUploadResult
} from './types'

/**
 * Client for the subset of the TrainerDay API that is required by Incyclist.
 *
 * TrainerDay access tokens are valid for 6 hours (see `OAuthAppApiBase` for the token handling).
 */
export class TrainerDayApi extends OAuthAppApiBase<TrainerDayConfig, TrainerDayRefreshTokenResponse> {

    constructor() {
        super('TrainerDayApi', {
            name: 'TrainerDay',
            refreshPath: '/trainerday/refresh',
            defaultApiUrl: 'https://api.trainerday.com',
            apiUrlSetting: 'TRAINERDAY_API',
            authUrlSetting: 'TRAINERDAY_AUTH_SERVER_URL'
        })
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

        this.logger.logEvent({ message: 'TrainerDay upload', format: dataType, bytes: base64Size(data) })

        const body = { name, dataType, data, externalId, sportType }

        let response: AxiosResponse
        try {
            response = await this.request('post', '/api/v1/activities/upload', body)
        }
        catch (err) {
            throw this.mapUploadRejection(err)
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

    protected getExpiration(data: TrainerDayRefreshTokenResponse): Date {
        return getTokenExpiration(data, DEFAULT_TOKEN_LIFETIME_MS)
    }
}
