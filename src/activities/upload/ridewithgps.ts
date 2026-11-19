import { RideWithGpsAuthError, RideWithGpsTimeDataMissingError, RideWithGpsTimeoutError, RideWithGpsTripActivityType, RideWithGpsUploadResult } from '../../apps/base/api/ridewithgps'
import { RideWithGpsAppConnection } from '../../apps/ridewithgps/RideWithGpsAppConnection'
import { Injectable } from '../../base/decorators/Injection'
import { IncyclistService } from '../../base/service'
import { Singleton } from '../../base/types'
import { ActivityDetails } from '../base'
import { ActivityUploadFactory } from './factory'
import { IActivityUpload } from './types'

export const RIDEWITHGPS_URL = 'https://ridewithgps.com'

/** the formats that are accepted by RideWithGPS and created by Incyclist */
const FORMATS = ['tcx', 'fit']

/**
 * Represents a service that can be used by Incyclist to upload an activity to RideWithGPS.
 *
 * The file is sent in the requested format. If RideWithGPS does not accept it, the other format
 * (TCX or FIT) is tried, if the activity has a file for it.
 *
 * @example
 * const rwgps = new RideWithGpsUpload()
 * rwgps.upload(activity,'tcx')
 *
 * @class
 * @public
 */
@Singleton
export class RideWithGpsUpload extends IncyclistService implements IActivityUpload {

    protected isInitialized: boolean
    protected connection = new RideWithGpsAppConnection()

    constructor() {
        super('RideWithGpsUpload')
        this.isInitialized = false
        this.init()
    }

    init(): boolean {
        if (this.isInitialized)
            return true
        this.isInitialized = this.getRideWithGpsAppConnection().init()
        return this.isInitialized
    }

    /**
     * Indicates whether the user has connected his Incyclist account to RideWithGPS
     *
     * @returns {boolean} True if the user has stored a connection to RideWithGPS
     */
    isConnected(): boolean {
        return this.getRideWithGpsAppConnection().isConnected()
    }

    /**
     * Uploads an activity to RideWithGPS.
     *
     * If the activity is uploaded successfully (or RideWithGPS already has it), the links property of the activity is updated
     * with the activity_id and the url. If the upload fails, the links property is updated with the error message.
     *
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The preferred format of the activity (TCX or FIT).
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format: string = 'TCX'): Promise<boolean> {

        if (!this.ensureInitialized()) {
            this.logEvent({ message: 'RideWithGPS Upload skipped', reason: 'not initialized' })
            return false
        }

        if (!this.isConnected())
            return false

        try {
            const res = await this.uploadFirstAccepted(activity, format.toLowerCase())

            this.logEvent({ message: 'RideWithGPS Upload success', activityId: res.tripId, duplicate: res.duplicate })
            this.setLink(activity, this.buildLink(res))
            return true
        }
        catch (err) {
            const error = err?.message ?? String(err)
            this.logEvent({ message: 'RideWithGPS Upload failure', error })
            this.setLink(activity, { error })
            return false
        }
    }

    /**
     * Returns the URL of a trip on RideWithGPS.
     *
     * @param {string} activityId - The id of the trip.
     * @returns {string} The URL of the trip.
     */
    getUrl(activityId: string): string {
        return `${RIDEWITHGPS_URL}/trips/${activityId}`
    }

    protected async uploadFirstAccepted(activity: ActivityDetails, preferred: string): Promise<RideWithGpsUploadResult> {
        const formats = [preferred, ...FORMATS.filter(f => f !== preferred)].filter(f => FORMATS.includes(f) && activity[`${f}FileName`])
        if (formats.length === 0)
            throw new Error('no TCX or FIT file available for this activity')

        let lastError: Error
        for (const format of formats) {
            try {
                this.logEvent({ message: 'RideWithGPS Upload', format: format.toUpperCase() })
                // sequential on purpose: the next format is only tried if the previous one was not accepted
                return await this.getApi().uploadActivity({ // NOSONAR
                    fileName: activity[`${format}FileName`],
                    name: activity.title?.trim() || undefined,
                    activityType: this.getActivityType(activity)
                })
            }
            catch (err) {
                if (this.isFinal(err))
                    throw err

                this.logEvent({ message: 'RideWithGPS Upload not accepted', format: format.toUpperCase(), error: err.message })
                lastError = err
            }
        }
        throw lastError
    }

    /**
     * Errors that do not depend on the format: the content is the same in all formats (a missing time can not be fixed),
     * a rejected token is rejected for every file, and after a timeout the file might still be processed (a second upload could create a second trip)
     */
    protected isFinal(err: Error): boolean {
        return err instanceof RideWithGpsTimeDataMissingError || err instanceof RideWithGpsAuthError || err instanceof RideWithGpsTimeoutError
    }

    protected getActivityType(activity: ActivityDetails): RideWithGpsTripActivityType {
        const isFreeRide = activity.routeType === 'Free-Ride' || activity.routeType === 'None'
        return isFreeRide ? 'cycling:indoor' : 'cycling:virtual'
    }

    /** a link only counts as success with an id: if RideWithGPS did not tell the id of an existing trip, the list of the trips is linked */
    protected buildLink(res: RideWithGpsUploadResult): { activity_id: string, url: string } {
        if (res.tripId)
            return { activity_id: res.tripId, url: this.getUrl(res.tripId) }
        return { activity_id: 'existing', url: `${RIDEWITHGPS_URL}/trips` }
    }

    protected setLink(activity: ActivityDetails, link: { activity_id?: string, url?: string, error?: string }) {
        activity.links = { ...activity.links, ridewithgps: link }
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }

    @Injectable
    // istanbul ignore next
    protected getRideWithGpsAppConnection() {
        return this.connection
    }

    protected getApi() {
        return this.getRideWithGpsAppConnection().getApi()
    }
}

const factory = new ActivityUploadFactory()
factory.add('ridewithgps', new RideWithGpsUpload())
