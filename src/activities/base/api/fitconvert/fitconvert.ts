import { AxiosInstance } from "axios";
import { FitExportActivity } from "../../model";
import { useUserSettings } from "../../../../settings";
import { DEFAULT_FIT_API, FITCONVERT_API } from "./consts";
import { trimTrailingChars } from "../../../../utils";
import { IncyclistRestApiClient } from "../../../../api";

export class IncyclistFitConvertApi { 

    protected api: AxiosInstance

    async convertToFit(data:FitExportActivity):Promise<ArrayBuffer>{
        let url
        try {
            const baseUrl = this.getBaseUrl()
            const requestUrl = `${baseUrl}/activity/${data.id}`
            const response = await this.getApi().post( requestUrl,data);
            url = response.data;            
        }
        catch (error) {
            throw new Error(`convert failed: (phase convert), reason: ${error.message}`);
        }

        // download result
        try {
            const response = await this.getApi().get(url,{responseType: 'arraybuffer'})            
            return response.data
        }
        
        catch (error) {
            throw new Error(`convert failed: (phase download), reason: ${error.message}`);
        }
    }

    // istanbul ignore next
    protected getApi():AxiosInstance {
        if (!this.api) {
            this.api = IncyclistRestApiClient.getClient()
            return this.api
        }
        return this.api
    }

    protected getBaseUrl():string {        

        let baseUrl
        try {
            baseUrl = useUserSettings().get(FITCONVERT_API,DEFAULT_FIT_API)
        }
        catch {
            baseUrl = DEFAULT_FIT_API
        }
        return trimTrailingChars(baseUrl,'/')
    }


}