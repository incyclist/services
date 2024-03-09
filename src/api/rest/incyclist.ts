import { AxiosInstance } from 'axios';
import { ApiClientInitProps } from './types';
import { getBindings } from '../bindings';
import { useUserSettings } from '../../settings';
import { ApiClient } from './api';

/**
 * Incyclist REST API CLient
 *
 * All Calls to the Incyclist REST API should be made using this class.
 *
 * It enriches the axios libary with the following features
 *  - Default Headers will be added, to better associate the requests with specific channels,versions and uuids
 *  - Request Authorisation
 *  - optional request logging
 *
 *
 * @example
 *
 *  const client = IncylcistRestApiClient.getClient()
 *  const rides = await client.get('https://incyclist.com/active-rides')
 *
 *
 * @noInheritDoc
 *
 */



export class IncyclistRestApiClient  {

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
    static getClient(requestLog?: boolean): AxiosInstance {


        const appInfo = getBindings().appInfo;

        let uuid;
        const apiKey= getBindings().secret?.getSecret('INCYCLIST_API_KEY')

        try {
            uuid = useUserSettings().get('uuid', null);
        }
        catch {
            uuid = null;
        }

        const props: ApiClientInitProps = {
            channel: appInfo?.getChannel(),
            appVersion: appInfo?.getAppVersion(),
            version: appInfo?.getUIVersion(),
            requestLog: requestLog ?? true,
            apiKey,
            uuid
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
