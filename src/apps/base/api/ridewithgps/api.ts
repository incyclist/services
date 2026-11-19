import { sleep } from '../../../../utils/sleep'
import { OAuthAppApiBase } from '../oauth'
import {
    RideWithGpsCollection, RideWithGpsCollectionSummary, RideWithGpsConfig, RideWithGpsGetRoutesProps, RideWithGpsRouteDetail, RideWithGpsRoutesPage, RideWithGpsTask,
    RideWithGpsTripActivityType, RideWithGpsUploadProps, RideWithGpsUploadResult
} from './types'
import { getUploadResult } from './utils'

const POLL_INTERVAL_MS = 1000
const MAX_POLLS = 60

/**
 * Client for the subset of the RideWithGPS API that is required by Incyclist.
 *
 * The access tokens of RideWithGPS never expire and there is no refresh token. A token that is rejected with HTTP 401 was revoked,
 * which is reported by the `auth.failed` event (see `OAuthAppApiBase`).
 *
 * How the requests are authenticated is decided by `getAuthHeaders()` of `OAuthAppApiBase` (Bearer token).
 * It can be overridden in this class if RideWithGPS requires other headers (e.g. `x-rwgps-api-key` and `x-rwgps-auth-token`).
 */
export class RideWithGpsApi extends OAuthAppApiBase<RideWithGpsConfig> {

    constructor() {
        super('RideWithGpsApi', {
            name: 'RideWithGPS',
            defaultApiUrl: 'https://ridewithgps.com',
            apiUrlSetting: 'RWGPS_API',
            authUrlSetting: 'RWGPS_AUTH_SERVER_URL'
        })
    }

    /** @returns the id of the user at RideWithGPS (as delivered by the auth-server) */
    getUserId(): string | undefined {
        const id = this.config?.id
        return id === undefined || id === null ? undefined : String(id)
    }

    /**
     * Retrieves a page of the routes of the user (`GET /api/v1/routes.json`)
     *
     * @throws if the response does not contain a list of routes
     */
    async getRoutes(props: RideWithGpsGetRoutesProps = {}): Promise<RideWithGpsRoutesPage> {
        const params: Record<string, string | number> = {}
        if (props.page !== undefined) params.page = props.page
        if (props.pageSize !== undefined) params.page_size = props.pageSize
        if (props.archived !== undefined) params.archived = String(props.archived)

        const response = await this.get('/api/v1/routes.json', { params })

        if (!Array.isArray(response.data?.routes))
            throw new Error('Unexpected response from RideWithGPS routes: expected a list of routes')

        return { routes: response.data.routes, pagination: response.data.meta?.pagination }
    }

    /**
     * Retrieves the collections of the user (`GET /api/v1/collections.json`), the response is not paginated
     * @throws if the response does not contain a list of collections
     */
    async getCollections(): Promise<Array<RideWithGpsCollectionSummary>> {
        const response = await this.get('/api/v1/collections.json', { params: { page_size: 100 } })

        if (!Array.isArray(response.data?.collections))
            throw new Error('Unexpected response from RideWithGPS collections: expected a list of collections')

        return response.data.collections
    }

    /**
     * Retrieves a collection including its routes (`GET /api/v1/collections/{id}.json`)
     * @throws if the collection is missing in the response
     */
    async getCollection(id: string | number): Promise<RideWithGpsCollection> {
        const response = await this.get(`/api/v1/collections/${id}.json`)

        if (!response.data?.collection)
            throw new Error('Unexpected response from RideWithGPS collection: collection is missing')

        return response.data.collection
    }

    /** Retrieves a route including its track points (`GET /api/v1/routes/{id}.json`) */
    async getRoute(id: string | number): Promise<RideWithGpsRouteDetail> {
        const response = await this.get(`/api/v1/routes/${id}.json`)

        if (!response.data?.route)
            throw new Error('Unexpected response from RideWithGPS route: route is missing')

        return response.data.route
    }

    /**
     * Downloads a route as GPX track (`GET /api/v1/routes/{id}.gpx`)
     * @returns the content of the GPX file
     */
    async getRouteAsGPX(id: string | number): Promise<string> {
        const response = await this.get(`/api/v1/routes/${id}.gpx`, { responseType: 'text' })

        if (typeof response.data !== 'string' || response.data.length === 0)
            throw new Error('Unexpected response from RideWithGPS route: no GPX content')

        return response.data
    }

    /**
     * Uploads a completed activity as trip (`POST /api/v1/trips`, multipart) and waits until RideWithGPS has processed the file.
     *
     * If the upload was completed and an activity type was requested, the type of the trip is updated. A failure of that update
     * does not fail the upload.
     *
     * @returns the id of the trip. For a duplicate `duplicate` is set and the id is the one of the existing trip (if known)
     * @throws RideWithGpsTimeDataMissingError if the file has no time data
     * @throws Error if not authenticated, the upload was rejected or not processed in time
     */
    async uploadActivity(props: RideWithGpsUploadProps): Promise<RideWithGpsUploadResult> {
        await this.verifyAuthentication()

        const task = await this.createUpload(props)
        const completed = await this.waitForTask(task)
        const result = getUploadResult(completed)

        if (result.tripId && !result.duplicate && props.activityType)
            await this.setActivityType(result.tripId, props.activityType)

        return result
    }

    protected async createUpload(props: RideWithGpsUploadProps): Promise<RideWithGpsTask> {
        // fields without value must not be part of the form
        const fields: Record<string, unknown> = { file: { type: 'file', fileName: props.fileName } }
        if (props.name) fields.name = props.name
        if (props.description) fields.description = props.description

        this.logger.logEvent({ message: 'RideWithGPS upload' })

        try {
            const form = await this.createForm('/api/v1/trips.json', fields, { headers: this.getAuthHeaders() })
            const response = await this.postForm(form)

            if (!response.data?.task)
                throw new Error('Unexpected response from RideWithGPS upload: task is missing')
            return response.data.task
        }
        catch (err) {
            this.checkRevoked(err)
            throw this.mapUploadRejection(err)
        }
    }

    protected async getTask(id: number): Promise<RideWithGpsTask> {
        const response = await this.get(`/api/v1/tasks/${id}.json`)
        return response.data.task
    }

    protected async waitForTask(initial: RideWithGpsTask): Promise<RideWithGpsTask> {
        let task = initial

        for (let polls = 0; task.status !== 'completed'; polls++) {
            if (polls >= MAX_POLLS)
                throw new Error('RideWithGPS did not finish processing the upload in time')

            await sleep(POLL_INTERVAL_MS)
            task = await this.getTask(task.id)
        }
        return task
    }

    protected async setActivityType(tripId: string, activityType: RideWithGpsTripActivityType): Promise<void> {
        try {
            await this.request('put', `/api/v1/trips/${tripId}.json`, { trip: { activity_type: activityType } })
        }
        catch (err) {
            // the trip exists, the type is only a nice to have
            this.logger.logEvent({ message: 'RideWithGPS set activity type failed', tripId, activityType, error: err.message })
        }
    }

    protected getExpiration(): Date {
        // tokens do not expire and are never refreshed, so this is never used
        return new Date(8.64e15)
    }
}
