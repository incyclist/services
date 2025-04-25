import axios from 'axios';
import { Singleton } from '../../base/types';
import any from 'promise.any'

const OVERPASS_URL_ALT1 = 'https://overpass.kumi.systems/api/interpreter'
const OVERPASS_URL_ALT2 = 'https://lz4.overpass-api.de/api/interpreter';
const OVERPASS_URL_ALT3 = 'https://z.overpass-api.de/api/interpreter'

const mirrors = [OVERPASS_URL_ALT1,OVERPASS_URL_ALT2,OVERPASS_URL_ALT3];
export const OVERPASS_URL_DEFAULT = mirrors[0];

@Singleton
export class OverpassApi {

    protected url:string

    constructor(props?) {
        this.url = props?.url??  mirrors[0];
    }

    async bulkQuery( queryOL:string ):Promise<JSON|string> {
        
        const p1 = axios.post(mirrors[0],queryOL);
        const p2 = axios.post(mirrors[1],queryOL);
        const p3 = axios.post(mirrors[2],queryOL);

        const res = await any( [p1,p2,p3] )
        return res?.data
    }

    async singleQuery( queryOL:string ):Promise<JSON|string> {
        const res = await axios.post(this.url,queryOL);
        return res.data
    }

    rotateUrl () {
        const cntUrls = mirrors.length;
        const oldIdx = mirrors.findIndex(u=>u===this.url)
        const newIdx = (oldIdx+1) % cntUrls;
        this.url = mirrors[newIdx];
    }


    async query( queryOL:string):Promise<JSON|string> {
        return this.bulkQuery(queryOL)
            
    } 


}

export const useOverpassApi = ()=> new OverpassApi()