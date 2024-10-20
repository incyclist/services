import { EventLogger } from 'gd-eventlog'
import {Activity, ActivityList, TrainingCenterDatabase, TrackPoint,ActivityLap,HeartRateInBeatsPerMinute,Track,Position,HeartRateBpm,TrackPointExtensions}  from 'tcx-builder'
import { IActivityConverter } from '../types'
import { ActivityDetails } from '../../model'
import { useActivityRide } from '../../../ride'

/**
 * Class responsible for converting activity data into TCX (Training Center XML) format.
 * @implements {IActivityConverter}
 * @public
 * @noInheritDoc
 */
export class TcxConverter implements IActivityConverter{
    
    protected logger: EventLogger

    constructor() {
        this.logger = new EventLogger('TcxExporter')
    }

    /**
     * Converts the provided activity data into TCX format.
     * @param {ActivityDetails} activity - The activity data to convert.
     * @returns {Promise<string>} A promise resolving to the TCX formatted XML string.
     * @throws {Error} Thrown if an error occurs during the conversion process.
     */
    async convert(activity:ActivityDetails) { 

 
        this.logger.logEvent({message:'convert start',format:'TCX'})
        try {
            const startTime =new Date( activity.startTime)

            const trackPoints =  this.creatTrackPoints(activity, startTime)
            const laps = this.createLaps(startTime, activity, trackPoints)
            const tcxActivity = new Activity( 'Biking', {Id:startTime, Notes:'Incyclist Ride', Laps:laps}  )
            const activityList = new ActivityList({ activity: [tcxActivity] });  
            const tcxObj = new TrainingCenterDatabase({ activities: activityList });
    
            const xml = tcxObj.toXml();
            this.logger.logEvent({message:'convert success',format:'TCX'})

            return xml;
    
        }
        catch(err) {
            this.logger.logEvent({message:'convert result',format:'TCX',result:'error',error:err.message})
            throw err
        }
    }

    protected createLaps(startTime: Date, activity: ActivityDetails, trackPoints: TrackPoint[]) {
        const lap = new ActivityLap(startTime, {
            Calories: 0,
            DistanceMeters: activity.distance,
            Intensity: 'Active',
            TotalTimeSeconds: activity.time,
            TriggerMethod: 'Distance',
            MaximumSpeed: activity.stats?.speed?.max || 0,
            MaximumHeartRateBpm: activity.stats?.hrm ? new HeartRateInBeatsPerMinute({ value: activity.stats.hrm?.max }) : undefined,
            AverageHeartRateBpm: activity.stats?.hrm ? new HeartRateInBeatsPerMinute({ value: activity.stats.hrm?.avg }) : undefined,
            Cadence: activity.stats?.cadence?.avg,

            Track: new Track({ trackPoints })
        })
        return [lap]
    }

    protected creatTrackPoints(activity: ActivityDetails, startTime: Date) {
        return activity.logs.map((log) => {

            const tp = new TrackPoint({
                time: log ? new Date(startTime.valueOf() + log.time * 1000) : undefined,
                altitudeMeters: log?.elevation,
                distanceMeters: log?.distance,
                heartRateBpm: log?.heartrate ? new HeartRateBpm(log.heartrate) : undefined,
                cadence: log?.cadence,
                sensorState: 'Present',
                extensions: new TrackPointExtensions({
                    Speed: log?.speed,
                    Watts: log?.power,
                }),
            })

            const lat = log?.lat
            let lng
            if (activity?.type === 'IncyclistActivity') {
                lng = log?.lng
            }
            else {
                lng = log?.lon
            }


            if (!isNaN(Number(lat ?? 'XX')) && !isNaN(Number(lng ?? 'XX')))
                tp.Position = new Position(lat, lng)


            return tp

        })
    }

    // istanbul ignore next
    protected getRideService() {
        return useActivityRide()
    }

}