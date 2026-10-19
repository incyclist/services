import { Singleton } from '../../base/types';
import { sleep } from '../../utils/sleep';
import { AppApiBase } from '../../apps/base/api/base';
import { EventLogger } from 'gd-eventlog';
import { Injectable } from '../../base/decorators';
import { getBindings, IncyclistRestApiClient } from '../../api';
import { UserSettingsService, useUserSettings } from '../../settings';
import { AxiosInstance, AxiosResponse } from 'axios';
import type { IFetchBinding } from '../../api/fetch/types';

const OVERPASS_URL_PRIMARY = 'https://overpass-api.de/api/interpreter';
//const OVERPASS_URL_ALT1 = 'https://overpass.private.coffee';
const OVERPASS_URL_ALT2 = 'https://lz4.overpass-api.de/api/interpreter';
const OVERPASS_URL_ALT3 = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

export const OVERPASS_URL_DEFAULT = OVERPASS_URL_PRIMARY;

// The self-hosted cluster proxy, tried before the public mirrors. Overridable via the
// `OVERPASS_API` user setting (a test instance, never an off switch - there is no empty-string
// escape hatch, see query()).
const OVERPASS_SELF_HOSTED_URL_DEFAULT = 'https://overpass.incyclist.com/api/v1/interpreter';

// Upper bound on the self-hosted attempt, independent of the caller's overall timeout - leaves
// enough of the caller's budget for the public-mirror fallback (see query()).
const SELF_HOSTED_MAX_TIMEOUT_MS = 5000;


/**
 * Class which encapsulates the interaction with the Overpass API.
 * The Overpass API is a read-only API that serves up custom selected parts of the OSM map data.
 * For more information see the official documentation at https://wiki.openstreetmap.org/wiki/Overpass_API
 *
 * @example
 * 
 * 1: Run a query against a set of pre-defined mirrors
 * const overpass = new OverpassApi()
 * const result = await overpass.query('[out:json];(._;>;);out geom;')
 * 
 * 2. Run a query against a single server
 * const overpass = new OverpassApi({url: 'https://overpass.kumi.systems/api/interpreter'})
 * const result = await overpass.singleQuery('[out:json];(._;>;);out geom;')
 * 
 */

const DEFAULT_MIRRORS = [OVERPASS_URL_PRIMARY,OVERPASS_URL_ALT2,OVERPASS_URL_ALT3]

@Singleton
export class OverpassApi extends AppApiBase {

    protected url:string
    protected mirrors:string[] = []
    protected logger:EventLogger
    protected restClient:AxiosInstance

    constructor(props?:{url:string}) {
        super()
        // Copy, not the shared DEFAULT_MIRRORS array itself - push() below (and on every other
        // instance) would otherwise mutate the shared default for everyone, including reset().
        this.mirrors = [...DEFAULT_MIRRORS]
        this.url = props?.url??  this.mirrors[0];
        this.logger = new EventLogger('Overpass')
        if (props?.url) {
            if ( this.mirrors.indexOf(props.url)===-1) {
                this.mirrors.push(props.url)
            }
        }
    }

    protected getOverpassHeaders() {
        const version = this.getAppVersion()
        const userId = this.getUserId()

        let userAgent = `Incyclist/${version}`
        if (userId) {
            try {
                const crypto = this.getBindings()?.crypto
                const hashedId = crypto ? crypto.createHash('sha256').update('OAPI:'+userId).digest('hex').substring(0, 8) : undefined
                if (hashedId) {
                    userAgent += ` (${hashedId})`
                }
            } catch (err) {
                this.logger.logEvent({message: 'failed to hash userId', error: (err as Error).message})
            }
        }

        return {
            'User-Agent': userAgent,
            'Referer': 'https://incyclist.com'
        }
    }

    // Used only for the public mirrors - see trySelfHosted() for the self-hosted request,
    // which goes through IncyclistRestApiClient instead (same client the app already uses to
    // talk to other Incyclist backends), not through this method.
    protected async post(url:string, data?:object|string, conf?:object):Promise<AxiosResponse> {
        // Desktop: issue the request from the Electron main process via the `fetch` binding,
        // so a cross-origin Referer can be set with referrerPolicy:'unsafe-url' - the renderer's
        // network stack silently cancels such requests otherwise (see electron/electron#33092).
        // Not implemented on mobile - those platforms fall through to the legacy paths below.
        const fetchBinding = this.getBindings()?.fetch
        if (fetchBinding) {
            return await this.postViaFetchBinding(fetchBinding, url, data);
        }

        try {
            // Try Node.js https first (available in Electron with nodeIntegration: true)
            // This allows us to set forbidden headers like User-Agent and Referer
            // which are blocked by browser APIs (XMLHttpRequest, Fetch)
            const https = require('https');
            return await this.postViaNodeHttps(https, url, data);
        } catch {
            // Fall back to axios for browser/other environments where Node.js is not available
            const cfg = conf??{}
            const config = {
                ...cfg,
                headers: this.getOverpassHeaders()
            }
            return await super.post(url, data, config)
        }
    }

    protected async postViaFetchBinding(fetchBinding: IFetchBinding, url: string, data?: object | string): Promise<AxiosResponse> {
        const headers = this.getOverpassHeaders();
        const body = typeof data === 'string' ? data : JSON.stringify(data);

        //this.logger.logEvent({message:'fetch', url,data})

        const res = await fetchBinding.fetch(url, {
            method: 'POST',
            headers,
            body,
            referrerPolicy: 'unsafe-url'
        });

        //this.logger.logEvent({message:'fetch result', url,data, status:res.status, hasData:res.data!=null})

        return {
            data: res.data,
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
            config: {} as AxiosResponse['config']
        };
    }

    protected async postViaNodeHttps(https: any, url: string, data?: object | string): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqUrl = new URL(url);
            const headers = this.getOverpassHeaders();
            const queryData = typeof data === 'string' ? data : JSON.stringify(data);

            const options = {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(queryData)
                }
            };

            const req = https.request(reqUrl, options, (res: any) => {
                let body = '';
                res.on('data', (chunk: any) => body += chunk);
                res.on('end', () => {
                    resolve({
                        data: body,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers
                    });
                });
            });

            req.on('error', reject);
            req.write(queryData);
            req.end();
        });
    }


    /**
     * Executes an Overpass query against the self-hosted proxy first, falling back to the
     * public mirrors on any failure (network error, HTTP>=400, timeout, or an unparseable
     * body). A 200 response carrying an Overpass `remark` (partial/empty result from the
     * server's own timeout or memory limit) is not a failure - it is returned as-is, exactly
     * as a mirror response would be today.
     *
     * The self-hosted URL is never part of the mirrors' `Promise.any` race: it is tried alone
     * first, with its own bounded timeout, specifically so a slow/down self-hosted path cannot
     * eat the caller's whole budget before the fallback even starts.
     *
     * @param queryOL the Overpass query language query
     * @param timeout the overall timeout in ms, shared between the self-hosted attempt and the fallback
     * @returns The result of the query as a JSON object or string
     */
    async query( queryOL:string, timeout?:number):Promise<JSON|string|undefined> {
        const ts = Date.now()
        const queryId = ts
        this.logger.logEvent({message:'query', queryOL, queryId, timeout})

        const hasOverallTimeout = timeout!==undefined && timeout!==null
        const selfHostedTimeout = hasOverallTimeout ? Math.min(timeout/2, SELF_HOSTED_MAX_TIMEOUT_MS) : SELF_HOSTED_MAX_TIMEOUT_MS

        const selfHosted = await this.trySelfHosted(queryOL, queryId, selfHostedTimeout)
        if (selfHosted.ok) {
            this.logger.logEvent({message:'query result', queryId, hasData:true, duration:Date.now()-ts, source:'self-hosted', fallback:false, cache:selfHosted.cache})
            return selfHosted.data
        }

        const remaining = hasOverallTimeout ? Math.max(timeout-(Date.now()-ts),0) : undefined
        const res = await this.bulkQuery(queryOL, remaining)

        this.logger.logEvent({message:'query result', queryId, hasData: res!==undefined, duration: Date.now()-ts, source: res!==undefined?'public':'none', fallback:true, cache:'n/a'})
        return res
    }

    // Single attempt against the self-hosted proxy, bounded by its own timeout so it can never
    // consume the caller's entire budget. Uses the same sleep-race idiom as bulkQuery()'s
    // timeout handling, for consistency, rather than a true request abort.
    protected async trySelfHosted(queryOL:string, queryId:number, timeoutMs:number): Promise<{ok:boolean, data?:JSON|string, cache?:string}> {
        const ts = Date.now()
        const url = this.getSelfHostedUrl()

        try {
            // validateStatus:()=>true - resolve instead of throwing on 4xx/5xx, so the status
            // checks below run uniformly for every outcome except a genuine network/timeout
            // failure (caught below). Content-Type must be set explicitly: axios only infers
            // one for a plain object body (JSON-stringifying it), never for a string, and a
            // request with no Content-Type at all arrives at the proxy's bodyParser.text() as
            // an empty body on some transports (confirmed: React Native's networking layer
            // refuses to send a body with no Content-Type at all; axios in Node sends it but
            // without a header). Desktop's own Chromium-based XHR path happened to add
            // text/plain by itself, which is why this wasn't caught earlier.
            const outcome = await Promise.race([
                this.getRestClient().post(url, queryOL, {headers: {'Content-Type': 'text/plain'}, validateStatus: () => true}),
                sleep(timeoutMs).then(()=>'timeout' as const)
            ])

            if (outcome==='timeout') {
                this.logger.logEvent({message:'self-hosted failed', queryId, reason:'timeout', duration:Date.now()-ts})
                return {ok:false}
            }

            if (outcome.status>=400) {
                this.logger.logEvent({message:'self-hosted failed', queryId, reason:'http', httpStatus:outcome.status, duration:Date.now()-ts})
                return {ok:false}
            }

            if (!this.isValidOverpassBody(outcome.data)) {
                this.logger.logEvent({message:'self-hosted failed', queryId, reason:'invalid-body', duration:Date.now()-ts})
                return {ok:false}
            }

            return {ok:true, data:outcome.data, cache:this.extractCacheHeader(outcome)}
        }
        catch {
            this.logger.logEvent({message:'self-hosted failed', queryId, reason:'network', duration:Date.now()-ts})
            return {ok:false}
        }
    }

    // Only non-empty responses count as parseable - MapAreaService.createMapData() already
    // tolerates either a JSON object or a raw string, so this deliberately doesn't sniff the
    // body's shape any further.
    protected isValidOverpassBody(data:JSON|string|undefined|null):boolean {
        if (data===undefined || data===null) return false
        if (typeof data === 'string') return data.trim().length>0
        return true
    }

    protected extractCacheHeader(res:AxiosResponse):string {
        const headers = res.headers as Record<string,unknown>|undefined
        if (!headers) return 'n/a'
        const value = headers['x-cache'] ?? headers['X-Cache']
        return typeof value === 'string' ? value : 'n/a'
    }

    // getUserSettings().get(...) (not getValue()) follows the ACTIVE_RIDES_API/KOMOOT_API
    // pattern: an unset/empty setting falls through to the compiled-in default, there is no
    // off switch (see query()'s doc comment).
    protected getSelfHostedUrl():string {
        try {
            return this.getUserSettings().get('OVERPASS_API', OVERPASS_SELF_HOSTED_URL_DEFAULT)
        }
        catch {
            return OVERPASS_SELF_HOSTED_URL_DEFAULT
        }
    }

    // IncyclistRestApiClient already attaches X-uuid/X-API-Key/x-app-channel (and more) to
    // every request it makes - see IncyclistRestApiClient.getClient()/ApiClient.init(). Cached
    // per instance, same pattern as IncyclistRoutesApi.getApi() - the header values (uuid,
    // channel, version, key) don't change within a running session, so there's no reason to
    // reinitialise it on every query.
    protected getRestClient():AxiosInstance {
        if (!this.restClient) {
            this.restClient = IncyclistRestApiClient.getClient()
        }
        return this.restClient
    }

    /**
     * Executes a Overpass query and returns the result. The query is executed against a single server, specified by the `url` property.
     *
     * @param queryOL the Overpass query language query
     * @returns The result of the query as a JSON object or string
     */
    async singleQuery( queryOL:string ):Promise<JSON|string> {
        const res = await this.post(this.url,queryOL);        
        return res.data
    }

    /**
     * Rotate the Overpass url to the next one in the list of mirrors
     * 
     * The `url` property is updated with the new value.
     * 
     * This function can be used if a specific mirror is not responsive.
     * 
     * @returns {undefined}
     */
    rotateUrl () {
        const cntUrls = this.mirrors.length;
        const oldIdx = this.mirrors.findIndex(u=>u===this.url)
        const newIdx = (oldIdx+1) % cntUrls;
        this.url = this.mirrors[newIdx];
    }



    protected getBaseUrl(): string {
        return '' // no base url as we want to switch between mirrors
    }

    protected extractErrorInfo(err: any, mirror: string): {mirror: string, status?: number, statusText?: string, error: string} {
        return {
            mirror,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            error: err?.message ?? 'overpass query failed'
        }
    }

    protected logUnexpectedErrors(fn:string, errors: Array<{mirror: string, status?: number, statusText?: string, error: string}>): void {
        const unexpectedErrors = errors.filter(e => {
            const status = e.status;
            if (!status || status === 408 || status === 504) return false;
            return status >= 406 && status < 500;
        });

        if (unexpectedErrors.length > 0 && unexpectedErrors.length === errors.length) {
            unexpectedErrors.forEach(err => {
                this.logger.logEvent({
                    message: 'error',
                    fn,
                    mirror: err.mirror,
                    status: err.status,
                    statusText: err.statusText,
                    error: err.error??'all mirrors failed with 4xx error'
                });
            });
        }
    }

    protected async bulkQuery( query:string, timeout?:number ):Promise<JSON|string|undefined> {
        const errors: Array<{mirror: string, status?: number, statusText?: string, error: string}> = [];
        const promises:Promise<JSON|string>[] = []

        this.mirrors.forEach(mirror=>{
            promises.push(
                this.post(mirror, query)
                    .then((res) => {
                        if (res?.status >= 400) {
                            const err = Object.assign(new Error(`HTTP ${res.status}`), { response: res })
                            errors.push(this.extractErrorInfo(err, mirror));
                            throw err;
                        }
                        return res?.data
                    })
                    .catch(err => {
                        if (!errors.find(e => e.mirror === mirror))
                            errors.push(this.extractErrorInfo(err, mirror));
                        throw err;
                    })
            );
        })
        if ( timeout!==undefined && timeout!==null) {
            promises.push( sleep(timeout).then(()=>{ 
                return 'timeout' 
            }));
        }

        try {
            const res = await Promise.any( promises)
            if ( res === 'timeout') {
                return undefined
            }
            return res
        } catch(err) {
            this.logUnexpectedErrors('bulkQuery',errors);
            throw  err
        }
    }

    protected async sequentialQuery( query:string, timeout?:number ):Promise<JSON|string|undefined> {
        const startTime = Date.now();
        const errors: Array<{mirror: string, status?: number, statusText?: string, error: string}> = [];
        let lastError:any

        for (const mirror of this.mirrors) {
            if (timeout !== undefined && timeout !== null) {
                const elapsed = Date.now() - startTime;
                if (elapsed >= timeout) {
                    return undefined;
                }
            }

            try {
                const res = await this.post(mirror, query);
                if (res?.status >= 400) {
                    throw Object.assign(new Error(`HTTP ${res.status}`), { response: res })
                }
                return res?.data;
            } catch (err) {
                lastError = err
                errors.push(this.extractErrorInfo(err, mirror));
                if (mirror !== this.mirrors[this.mirrors.length - 1]) {
                    await sleep(100);
                }
            }
        }

        this.logUnexpectedErrors('sequentialQuery',errors);
        throw lastError
    }

    reset() {
        this.mirrors = [...DEFAULT_MIRRORS]
        this.url = this.mirrors[0]
    }

    protected getAppVersion():string {
        return this.getBindings()?.appInfo?.getAppVersion()??''
    }

    protected getUserId():string {
        
        return this.getUserSettings().getValue('uuid','')
    }

    @Injectable
    protected getUserSettings(): UserSettingsService {
        return useUserSettings()
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }


}

export const useOverpassApi = ()=> new OverpassApi()