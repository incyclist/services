import { AxiosInstance } from 'axios';
import { ApiClient } from './api';


/**
 * REST API CLient
 *
 * All Calls to the Incyclist REST API should be made using this class.
 *
 * It enriches the axios libary with the following features
 *  - Default Headers will be added, to better associate the requests with specific channels,versions and uuids
 *
 *
 * @example
 *
 *  const client = RestApiClient.getClient()
 *  const rides = await client.get('https://someapi.com/somrequest')
 *
 *
 * @noInheritDoc
 *
 */



export class RestApiClient {
    static _api: ApiClient

    /**
     * Provides access to the axios client object
     *
     * The axios client object will be used to make the REST calls ( get(), post(), ...)
     * For methods exposed, please have a look at the Axios documentation
     *
     * This static method is a soprter alternative call for ApiClient.getInstance().getClient()
     *
     * @returns client object
     */
    static getClient(): AxiosInstance {
        return this.api().client();
    }

    protected static api()  {
        if (!this._api)
            this._api = new ApiClient()
        return this._api
    }


}
