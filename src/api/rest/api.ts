import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { EventLogger } from 'gd-eventlog';
import { v4 } from 'uuid';
import { ApiClientInitProps, ExternalApiClientInitProps, REDIRECT_NOT_ALLOWED } from './types';

/** the URL a response was finally served from (differs from the requested URL after a redirect) */
const getResponseUrl = (res: AxiosResponse): string | undefined => {
    return res?.request?.res?.responseUrl ?? res?.request?.responseURL
}

const getRequestUrl = (config: InternalAxiosRequestConfig): string => {
    try {
        return axios.getUri(config)
    }
    catch {
        return config.url
    }
}

/** the URL a redirect is about to be followed to (options of the `follow-redirects` library used by the Node adapter) */
const getRedirectUrl = (options: Record<string, any>): string | undefined => {
    if (typeof options?.href === 'string')
        return options.href
    if (!options?.protocol || !(options.host ?? options.hostname))
        return undefined
    return `${options.protocol}//${options.host ?? options.hostname}${options.path ?? ''}`
}

const redirectNotAllowed = (message: string, config: InternalAxiosRequestConfig, request?: unknown, response?: AxiosResponse) => {
    return new AxiosError(message, REDIRECT_NOT_ALLOWED, config, request, response)
}

export class ApiClient {


    protected axios: AxiosInstance;
    protected logger: EventLogger;
    protected requests: Array<{
        tid: string;
        ts: number;
    }>;

    private redirectSkipLogged = false;
    private requestInterceptorId?: number;
    private responseInterceptorId?: number;

    constructor() {
        this.logger = new EventLogger('API');        
        this.requests = [];
    }
    /**
     * Initialises the Api Client instance
     *
     * This method needs to be called once in the app before any Api calls can be made against
     * the Incyclist APIs
     *
     */
    init(props: ApiClientInitProps | ExternalApiClientInitProps): void {
        const { requestLog = true, version, appVersion, channel = 'desktop', platform } = props;


        const headers:Record<string,any> = {
            "x-app-channel": channel,
            "x-app-version": appVersion,
            "x-react-version": version
        };

        if (platform) {
            headers['x-app-platform'] = platform
        }

        if (props['uuid']) {
            headers['X-uuid'] = props['uuid']
        }
        if (props['apiKey']) {
            headers['X-API-Key'] = props['apiKey']
        }

        this.axios = axios.create({ headers });
        this.registerRedirectPolicy(this.axios)

        if (requestLog) {
            this.enableLogging()
        }

    }

    /**
     * Adds the handling of the per-request `redirectPolicy` option (see `RedirectPolicy`). Requests without
     * that option are not touched.
     *
     * - Node (http adapter): the policy is checked in `beforeRedirect`, so a refused redirect is never followed
     * - all adapters: the URL that the response was served from is checked once the response has arrived. This is
     *   all that can be done where the transport follows redirects invisibly (XHR). If that URL is not available,
     *   the request can not be verified and a message is logged.
     */
    protected registerRedirectPolicy(client: AxiosInstance) {
        client.interceptors.request.use( (config) => this.onRedirectPolicyRequest(config) )
        client.interceptors.response.use(
            (res) => this.onRedirectPolicyResponse(res),
            (err) => this.onRedirectPolicyError(err)
        )
    }

    protected onRedirectPolicyRequest(config: InternalAxiosRequestConfig) {
        const policy = config?.redirectPolicy
        if (!policy)
            return config

        const origin = getRequestUrl(config)
        const previous = config.beforeRedirect

        config.beforeRedirect = (options, responseDetails, requestDetails) => {
            previous?.(options, responseDetails, requestDetails)

            const target = getRedirectUrl(options)
            if (target && !policy(target, origin)) {
                this.logger.logEvent({ message: 'redirect refused', stage: 'before redirect' })
                throw redirectNotAllowed('redirect not allowed', config)
            }
        }
        return config
    }

    protected onRedirectPolicyResponse(res: AxiosResponse) {
        const config = res?.config
        const policy = config?.redirectPolicy
        if (!policy)
            return res

        const origin = getRequestUrl(config)
        const finalUrl = getResponseUrl(res)
        if (!finalUrl) {
            if (!this.redirectSkipLogged) {
                this.redirectSkipLogged = true
                this.logger.logEvent({ message: 'redirect check skipped', reason: 'final url not available' })
            }
            return res
        }
        if (finalUrl === origin)
            return res

        if (!policy(finalUrl, origin)) {
            this.logger.logEvent({ message: 'redirect refused', stage: 'response' })
            throw redirectNotAllowed('redirect not allowed', config, res.request, res)
        }
        return res
    }

    // the Node adapter wraps an error thrown in `beforeRedirect` (maybe more than once) as the cause of its own error
    protected onRedirectPolicyError(err) {
        let cause = err?.cause
        for (let depth = 0; cause && depth < 5 && err?.code !== REDIRECT_NOT_ALLOWED; depth++) {
            if (cause.code === REDIRECT_NOT_ALLOWED)
                err.code = REDIRECT_NOT_ALLOWED
            cause = cause.cause
        }
        return Promise.reject(err)
    }

    enableLogging() {

        const client = this.client()

        // guard against registering twice        
        if (this.requestInterceptorId !== undefined) return;

        this.requestInterceptorId = client.interceptors.request.use(
            (req) => this.onRequest(req)
        );
        this.responseInterceptorId = client.interceptors.response.use(
            (res) => this.onResponse(res),
            (err) => this.onError(err)
        );
    }

    disableLogging() {
        const client = this.client()

        if (this.requestInterceptorId !== undefined) {
            client.interceptors.request.eject(this.requestInterceptorId);
            this.requestInterceptorId = undefined;
        }
        if (this.responseInterceptorId !== undefined) {
            client.interceptors.response.eject(this.responseInterceptorId);
            this.responseInterceptorId = undefined;
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
        this.axios = this.axios ?? axios;
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
            this.logger.logEvent({ message: 'error', fn: 'onRequest()', error: err.message, stack: err.stack });
        }
        return req;

    }

    protected onResponse(res) {
        if (!res)
            return;
        
        const { config, status } = res ?? {};
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
            this.logger.logEvent({ message: 'error', fn: 'onResponse', error: err.message , tid, stack: err.stack });
        }

        return res;
    }

    /**
     * Logs requests that failed (HTTP status outside of the range accepted by `validateStatus`, or no response at all).
     * Only the status and the error message are logged, never the response body, as it might contain personal data.
     * The error is passed on unchanged.
     */
    protected onError(err) {
        try {
            const { config, response } = err ?? {};
            const { headers = {}, url, method, params } = config ?? {};
            const tid = headers['x-transaction-id'];

            const idx = tid ? this.requests.findIndex(r => r.tid === tid) : -1;
            if (idx !== -1) {
                const tsStart = this.requests[idx].ts;
                this.requests.splice(idx, 1);
                this.logger.logEvent({
                    message: 'api call', method, url, tid, status: response?.status ?? 'no response',
                    duration: Date.now() - tsStart, params, error: err.message
                });
            }
        }
        catch (e) {
            this.logger.logEvent({ message: 'error', fn: 'onError', error: e.message, stack: e.stack });
        }

        return Promise.reject(err);
    }

}
