import axios, { AxiosInstance } from 'axios';
import { EventLogger } from 'gd-eventlog';
import { v4 } from 'uuid';
import { ApiClientInitProps } from './types';

export class ApiClient {


    protected axios: AxiosInstance;
    protected logger: EventLogger;
    protected requests: Array<{
        tid: string;
        ts: number;
    }>;



    /**
     * Initialises the Api Client instance
     *
     * This method needs to be called once in the app before any Api calls can be made against
     * the Incyclist APIs
     *
     */
    init(props: ApiClientInitProps): void {
        const { uuid, apiKey, requestLog = true, version, appVersion, channel = 'desktop' } = props;


        const headers = {
            "X-uuid": uuid,
            "X-API-Key": apiKey,
            "x-app-channel": channel,
            "x-app-version": appVersion,
            "x-react-version": version
        };


        this.axios = axios.create({ headers });

        if (requestLog) {
            this.logger = new EventLogger('API');
            this.requests = [];
            this.axios.interceptors.request.use((req) => this.onRequest(req));
            this.axios.interceptors.response.use((res) => this.onResponse(res));
        }

    }

    /**
     * Provides access to the axios client object
     *
     * The axios client object will be used to make the REST calls ( get(), post(), ...)
     * For methods exposed, please have a look at the Axios documentation
     *
     * @returns client object
     */
    client(): AxiosInstance {
        if (!this.axios)
            this.axios = axios;
        return this.axios;

    }

    protected onRequest(req) {

        if (!req)
            return;
        try {
            const ts = Date.now();
            const tid = v4();
            req.headers['x-transaction-id'] = tid;
            this.requests.push({ tid, ts });

        }
        catch (err) {
            this.logger.logEvent({ message: 'error', fn: 'onRequest()', error: err.message || err, stack: err.stack });
        }
        return req;

    }

    protected onResponse(res) {
        if (!res)
            return;
        
        const { config, status } = res || {};
        const { headers = {}, url, method, params } = config;
        const tid = headers['x-transaction-id'];
        if (!tid)
            return res;

        try {


            const idx = this.requests.findIndex(r => r.tid === tid);
            if (idx !== -1) {
                const tsStart = this.requests[idx].ts;
                this.requests.splice(idx, 1);
                this.logger.logEvent({ message: 'api call', method, url, tid, status, duration: Date.now() - tsStart, params });
            }
        }
        catch (err) {
            this.logger.logEvent({ message: 'error', fn: 'onResponse', error: err.message || err, tid, stack: err.stack });
        }

        return res;
    }

}
