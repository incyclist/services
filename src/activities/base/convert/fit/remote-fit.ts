import { EventLogger } from 'gd-eventlog';
import { IncyclistFitConvertApi } from '../../api/fitconvert';
import { ActivityDetails, ActivityLogRecord, FitExportActivity, FitLogEntry } from '../../model';
import { useUserSettings } from '../../../../settings';


/**
 * Class responsible for converting activity data into FIT (Flexible and Interoperable Data Transfer) 
 * 
 * As the FIT SDK for encoding is not available in JavaScript/TypeScript, we are using a microservice via REST API
 * which does the actual encoding into FIT format. 
 * 
 * 
 */
export class RemoteFitConverter {

    protected logger: EventLogger
    protected api: IncyclistFitConvertApi

    constructor() {
        this.logger = new EventLogger('RemoteFitExporter')
    }

    /**
     * Converts the provided activity data into FIT format using a remote API.
     * @param {ActivityDetails} activity - The activity data to convert.
     * @returns {Promise<ArrayBuffer>} A promise resolving to the FIT formatted binary data.
     * @throws {Error} Thrown if an error occurs during the conversion process.
     */
    async convert(activity:ActivityDetails):Promise<ArrayBuffer> {

        try {
            this.logger.logEvent({message:'convert start',format:'FIT'})
  
            const content = this.getFitActivity(activity)
            const data = await this.getApi().convertToFit(content)
            this.logger.logEvent({message:'convert success',format:'FIT'})

            return data

        }
        catch(err) {
            this.logger.logEvent({message:'convert result',format:'FIT',result:'error', reason:err.message})
            throw err
        }
    }

    protected getApi() {
        if (!this.api)
            this.api = new IncyclistFitConvertApi()

        return this.api
    }

    /**
     * Converts the provided activity into a format required by the API
     */    
    protected getFitActivity(activity:ActivityDetails): FitExportActivity {
        const {id,title, time,timeTotal,timePause,distance } = activity
        const status = 'created'

        const startTime = new Date(activity.startTime).toISOString()
        const logs = activity.logs.map(this.mapLogToFit.bind(this) )
        const screenshots = [] // TODO
        const laps = [] // TODO
        const user = {
            id: this.getUserSettings().get('uuid',undefined),
            weight: activity.user.weight
        }

        return {id,title,status,logs,laps,startTime, time, timeTotal, timePause, distance, user, screenshots}
   }

    protected mapLogToFit(log:ActivityLogRecord): FitLogEntry {
        const {time,speed, slope, cadence, heartrate, distance, power, lat, lng,elevation} = log

        return {time,speed, slope, cadence, heartrate, distance, power, lat, lon:lng,elevation}

    }

    // accessors to other services
    // functions are created to simplify moacking of these servcies

    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }

}