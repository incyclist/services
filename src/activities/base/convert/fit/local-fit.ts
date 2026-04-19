import { Encoder, Profile } from '@garmin/fitsdk'
import { EventLogger } from 'gd-eventlog'
import { ActivityDetails, FitExportActivity, FitLogEntry } from '../../model'
import { RemoteFitConverter } from './remote-fit'

const DEG_TO_SEMICIRCLES = (2 ** 31) / 180

/**
 * Converts activity data into FIT format locally using the @garmin/fitsdk Encoder.
 *
 * Extends RemoteFitConverter to reuse the field-mapping methods
 * (getFitActivity, mapLogToFit) and replaces only the encoding step,
 * eliminating the dependency on the remote Java microservice.
 */
export class LocalFitConverter extends RemoteFitConverter {

    constructor() {
        super()
        this.logger = new EventLogger('LocalFitExporter')
    }

    /**
     * Converts the provided activity data into FIT format using the local SDK.
     * @param {ActivityDetails} activity - The activity data to convert.
     * @returns {Promise<ArrayBuffer>} A promise resolving to the FIT formatted binary data.
     * @throws {Error} Thrown if an error occurs during the conversion process.
     */
    async convert(activity: ActivityDetails): Promise<ArrayBuffer> {
        try {
            this.logger.logEvent({ message: 'convert start', format: 'FIT' })

            const fitActivity = this.getFitActivity(activity)
            const data = this.encode(fitActivity)

            this.logger.logEvent({ message: 'convert success', format: 'FIT' })
            return data
        }
        catch (err) {
            this.logger.logEvent({ message: 'convert result', format: 'FIT', result: 'error', reason: err.message })
            throw err
        }
    }

    /**
     * Encodes a FitExportActivity into a FIT binary using the @garmin/fitsdk Encoder.
     * @param {FitExportActivity} activity - Pre-mapped activity data.
     * @returns {ArrayBuffer} Encoded FIT file contents.
     */
    protected encode(activity: FitExportActivity): ArrayBuffer {
        const encoder = new Encoder()
        const startTime = new Date(activity.startTime)

        encoder.onMesg(Profile.MesgNum.FILE_ID, {
            type: 'activity',
            manufacturer: 'development',
            product: 0,
            timeCreated: startTime,
        })

        encoder.onMesg(Profile.MesgNum.EVENT, {
            timestamp: startTime,
            event: 'timer',
            eventType: 'start',
            data: 0,
        })

        let lastTimestampMs = startTime.getTime()

        activity.logs.forEach((log: FitLogEntry) => {
            if (log.time != null) {
                lastTimestampMs = startTime.getTime() + log.time * 1000
            }

            const record: Record<string, unknown> = {
                timestamp: new Date(lastTimestampMs),
            }

            if (log.lat != null && log.lon != null) {
                record.positionLat = Math.round(log.lat * DEG_TO_SEMICIRCLES)
                record.positionLong = Math.round(log.lon * DEG_TO_SEMICIRCLES)
            }
            if (log.elevation != null) record.altitude = log.elevation
            if (log.heartrate != null) record.heartRate = log.heartrate
            if (log.cadence != null) record.cadence = log.cadence
            if (log.distance != null) record.distance = log.distance
            if (log.speed != null) record.speed = log.speed / 3.6
            if (log.power != null) record.power = log.power
            if (log.slope != null) record.grade = log.slope

            encoder.onMesg(Profile.MesgNum.RECORD, record)
        })

        const endTime = new Date(lastTimestampMs)

        encoder.onMesg(Profile.MesgNum.EVENT, {
            timestamp: endTime,
            event: 'timer',
            eventType: 'stopAll',
            data: 0,
        })

        encoder.onMesg(Profile.MesgNum.LAP, {
            timestamp: endTime,
            startTime,
            totalElapsedTime: activity.timeTotal,
            totalTimerTime: activity.time,
            totalDistance: activity.distance,
            event: 'lap',
            eventType: 'stop',
        })

        encoder.onMesg(Profile.MesgNum.SESSION, {
            timestamp: endTime,
            startTime,
            totalElapsedTime: activity.timeTotal,
            totalTimerTime: activity.time,
            totalDistance: activity.distance,
            sport: 'cycling',
            subSport: 'virtualActivity',
            event: 'session',
            eventType: 'stopDisableAll',
        })

        encoder.onMesg(Profile.MesgNum.ACTIVITY, {
            timestamp: endTime,
            totalTimerTime: activity.time,
            numSessions: 1,
            type: 'manual',
            event: 'activity',
            eventType: 'stop',
        })

        const uint8Array = encoder.close()
        return uint8Array.buffer as ArrayBuffer
    }
}
