import { AxiosInstance } from 'axios';
import { ExternalApiClientInitProps } from './types';
import { getBindings } from '../bindings';
import { ApiClient } from './api';

/**
 * External  Incyclist APIs REST API CLient
 *
 * All Calls to the Incyclist REST API to external serverrs should be made using this class.
 *
 * It enriches the axios libary with the following features
 *  - Default Headers will be added, to better associate the requests with specific channels,versions and uuids
 *  - optional request logging
 *
 *
 * @example
 *
 *  const client = IncyclistExternalRestApiClient.getClient()
 *  const rides = await client.get('https://<url>/active-rides')
 *
 *
 * @noInheritDoc
 *
 */



export class IncyclistExternalRestApiClient  {

    protected static _api: ApiClient

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
    static getClient(requestLog?: boolean): AxiosInstance {


        const appInfo = getBindings().appInfo;


        const props: ExternalApiClientInitProps = {
            channel: appInfo?.getChannel(),
            appVersion: appInfo?.getAppVersion(),
            version: appInfo?.getUIVersion(),
            platform: appInfo?.getOS()?.platform,
            requestLog: requestLog ?? true
        };
        
        this.api().init(props);
        return this.api().client();
    }

    protected static api()  {
        if (!this._api)
            this._api = new ApiClient()
        return this._api
    }


}
