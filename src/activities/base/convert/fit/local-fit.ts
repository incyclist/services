import { Encoder, Profile } from '@garmin/fitsdk'
import { EventLogger } from 'gd-eventlog'
import { ActivityDetails, ActivityLogRecord, FitExportActivity, FitLapEntry, FitLogEntry, LapSummary } from '../../model'
import { useUserSettings } from '../../../../settings'
import { Injectable } from '../../../../base/decorators'
import { Sport } from 'incyclist-devices'

const DEG_TO_SEMICIRCLES = (2 ** 31) / 180

/**
 * Converts activity data into FIT format locally using the @garmin/fitsdk Encoder.
 *
 * Replaces the remote Java microservice previously used for FIT encoding.
 */
export class LocalFitConverter {

    protected logger: EventLogger

    constructor() {
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

    protected getFitActivity(activity: ActivityDetails): FitExportActivity {
        const { id, title, time, timeTotal, timePause, distance,sport='cycling' } = activity
        const status = 'created'

        const startTime = new Date(activity.startTime).toISOString()
        const logs = activity.logs.map(this.mapLogToFit.bind(this))
        const screenshots = []
        const laps = this.mapLapsToFit(activity.laps ?? [], activity.startTime)
        const user = {
            id: this.getUserSettings().get('uuid', undefined),
            weight: activity.user.weight
        }

        return { id, title, status, logs, laps, startTime, time, timeTotal, timePause, distance, user, screenshots,sport }
    }

    protected mapLapsToFit(laps: LapSummary[], activityStartTime: string): FitLapEntry[] {
        const activityStartMs = new Date(activityStartTime).getTime()
        return laps.map((lap, i) => {
            const prevDistance = i > 0 ? laps[i - 1].distance : 0
            return {
                lapNo: lap.num,
                startTime: new Date(lap.startTime).toISOString(),
                stopTime: new Date(lap.startTime + lap.rideTime * 1000).toISOString(),
                lapDistance: lap.distance - prevDistance,
                totalDistance: lap.distance,
                lapTime: lap.rideTime,
                totalTime: (lap.startTime - activityStartMs) / 1000 + lap.rideTime,
            }
        })
    }

    protected mapLogToFit(log: ActivityLogRecord): FitLogEntry {
        const { time, speed, slope, cadence: cadenceOrg, heartrate: heartrateOrg, distance, power: powerOrg, lat, lng, elevation } = log

        const cadence = Math.round(cadenceOrg)
        const heartrate = Math.round(heartrateOrg)
        const power = Math.round(powerOrg)

        return { time, speed, slope, cadence, heartrate, distance, power, lat, lon: lng, elevation }
    }

    /**
     * Encodes a FitExportActivity into a FIT binary using the @garmin/fitsdk Encoder.
     * @param {FitExportActivity} activity - Pre-mapped activity data.
     * @returns {ArrayBuffer} Encoded FIT file contents.
     */
    protected encode(activity: FitExportActivity): ArrayBuffer {
        const encoder = new Encoder()
        const startTime = new Date(activity.startTime)

        const manufacturer = this.getUserSettings().get('fitexport.manufacturer', 'garmin')
        const product = this.getUserSettings().get('fitexport.device', 3843)
        const serialNumber = (Math.random() * 0xFFFFFFFF) >>> 0

        encoder.onMesg(Profile.MesgNum.FILE_ID, {
            type: 'activity',
            manufacturer,
            product,
            serialNumber,
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

        if (activity.laps.length > 0) {
            activity.laps.forEach(lap => {
                const lapStart = new Date(lap.startTime)
                const lapEnd = new Date(lap.stopTime)
                encoder.onMesg(Profile.MesgNum.LAP, {
                    timestamp: lapEnd,
                    startTime: lapStart,
                    totalElapsedTime: lap.lapTime,
                    totalTimerTime: lap.lapTime,
                    totalDistance: lap.lapDistance,
                    event: 'lap',
                    eventType: 'stop',
                })
            })
        } else {
            encoder.onMesg(Profile.MesgNum.LAP, {
                timestamp: endTime,
                startTime,
                totalElapsedTime: activity.timeTotal,
                totalTimerTime: activity.time,
                totalDistance: activity.distance,
                event: 'lap',
                eventType: 'stop',
            })
        }

        encoder.onMesg(Profile.MesgNum.SESSION, {
            timestamp: endTime,
            startTime,
            totalElapsedTime: activity.timeTotal,
            totalTimerTime: activity.time,
            totalDistance: activity.distance,
            sport: this.mapSport(activity.sport),
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

    protected mapSport(incyclistSport?:Sport):string  {
        if( !incyclistSport || incyclistSport==='cycling') 
            return 'cycling'
        if( incyclistSport==='running') 
            return 'running'
        if( incyclistSport==='rowing') 
            return 'rowing'

    }

    // istanbul ignore next
    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }
}
