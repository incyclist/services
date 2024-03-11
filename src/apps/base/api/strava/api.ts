import { AppApiBase } from "../base"

const BASE_URL = 'https://www.strava.com/api/v3'

export class StravaApi extends AppApiBase{

    protected getBaseUrl() {
        try {
            return this.getUserSettings().get('STRAVA_API',BASE_URL)
        }
        catch {
            return BASE_URL
        }
    }


}