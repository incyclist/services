import any from 'promise.any'

import { Singleton } from '../../base/types';
import { sleep } from '../../utils/sleep';
import { AppApiBase } from '../../apps/base/api/base';

const OVERPASS_URL_ALT1 = 'https://overpass.kumi.systems/api/interpreter'
const OVERPASS_URL_ALT2 = 'https://lz4.overpass-api.de/api/interpreter';
const OVERPASS_URL_ALT3 = 'https://z.overpass-api.de/api/interpreter'

export const OVERPASS_URL_DEFAULT = OVERPASS_URL_ALT1;


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


@Singleton
export class OverpassApi extends AppApiBase {

    protected url:string
    protected mirrors:string[] = []

    constructor(props?) {
        super()
        this.mirrors = [OVERPASS_URL_ALT1,OVERPASS_URL_ALT2,OVERPASS_URL_ALT3]    
        this.url = props?.url??  this.mirrors[0];
        if (props?.url) {
            if ( this.mirrors.indexOf(props.url)===-1) {
                this.mirrors.push(props.url)
            }
        }
    }


    /**
     * Executes a Overpass query and returns the result. If a timeout is specified, the first result that comes back within the timeout will be returned. If no result comes back within the timeout, the function will return undefined.
     * 
     * As overpass servers are not 100% reliable or implement strct rate limits, the query is executed against multiple mirrors, the first successful response will be returned.
     * 
     * @param queryOL the Overpass query language query
     * @param timeout the timeout in ms
     * @returns The result of the query as a JSON object or string
     */
    async query( queryOL:string, timeout?:number):Promise<JSON|string> {
        return this.bulkQuery(queryOL, timeout)
            
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

    protected async bulkQuery( query:string, timeout?:number ):Promise<JSON|string> {
        
        const promises:Promise<JSON|string>[] = []

        this.mirrors.forEach(mirror=>{
            promises.push(this.post(mirror,query).then((res)=>res?.data));
        })        
        if ( timeout!==undefined && timeout!==null) {            
            promises.push( sleep(timeout).then(()=>'timeout' ));
        }

        const res = await any( promises)
        if (res === 'timeout') {
            return undefined
        }

        return res
    }

    reset() {
        this.mirrors = [OVERPASS_URL_ALT1,OVERPASS_URL_ALT2,OVERPASS_URL_ALT3]    
        this.url = this.mirrors[0]
    }


}

export const useOverpassApi = ()=> new OverpassApi()