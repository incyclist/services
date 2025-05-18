import { distanceBetween } from "../../utils/geo";
import { Observer, Singleton } from "../../base/types";
import { IncyclistService } from "../../base/service";
import { FreeRideDataSet,  IncyclistNode, IMapAreaService, IMapArea } from "./types";
import { DEFAULT_MIN_WAYS, DEFAULT_MAX_WAYS, DEFAULT_RADIUS, GET_WAYS_IN_AREA, MAX_DISTANCE_FROM_PATH, DEFAULT_FILTER} from "./consts";
import { buildQuery,getBounds, parseMapData } from "./utils";
import { Injectable } from "../../base/decorators";
import { MapArea } from "./MapArea";
import { OptionManager } from "./options";
import { OverpassApi } from "../../services/overpass";
import { waitNextTick } from "../../utils";

const DEFAULT_TIMEOUT = 10000

type MapAreaRecord = {
    map: MapArea
    lastUsed: number
    radius: number
}
const MAX_MAPS = 5

export const getMapInfo = (m ) => {
    if (!m)
        return 'no map'
    try {
        const boundary = m.map.getBoundary()
        const bInfo = `${boundary.northeast.lat},${boundary.northeast.lng},${boundary.southwest.lat},${boundary.southwest.lng}`

        return `${m.radius},[${bInfo}]`
    }
    catch {
        return ''
    }
}

export const getMapsInfo = (maps, key:string) => {
    try {
        const m = maps[key]
        return `${key}:${getMapInfo(m)}`
    
    }
    catch {
        return ''
    }
}


@Singleton
export class MapAreaService extends IncyclistService implements IMapAreaService {
    protected static consts = { DEFAULT_RADIUS,DEFAULT_MIN_WAYS,DEFAULT_MAX_WAYS,MAX_DISTANCE_FROM_PATH,GET_WAYS_IN_AREA }


    protected overpass:OverpassApi
    protected loaded: 'success' | 'failure' |'unknown' = 'unknown'
    protected observer: Observer
    protected current: MapArea
    
    
    protected minWays: number
    protected maxWays: number
    protected radius: number
    protected filter:Array<string>
    protected maps: Record<string,MapAreaRecord> 
    protected optionManager: OptionManager
    protected iv: NodeJS.Timeout


    constructor () {
        super('MapArea')

        this.minWays = DEFAULT_MIN_WAYS
        this.maxWays = DEFAULT_MAX_WAYS
        this.radius  = DEFAULT_RADIUS
        this.filter  = DEFAULT_FILTER
        this.maps = {}
    }

    /**
     * Load a new map area for a given location. If the same location is already loaded, return the existing map.
     * @param location - the location to load the map for
     * @returns a promise that resolves when the map is loaded, or rejects if the load fails
     */
    async load( location: IncyclistNode):Promise<IMapArea> {

        const map = await this.findBestMap(location)
        if (map) {
            return map
        }        

        return this.loadMap(location)
    }

    getMap(location:IncyclistNode):MapArea {
        const maps = this.getAllMaps()??[]
        return maps.find(m=>m.isWithinBoundary(location))        
    }

    getOptionManager():OptionManager {
        this.optionManager = this.optionManager ?? new OptionManager(this)
        return this.optionManager
    }

    setFilter(filter:Array<string>|null) {
        this.filter = filter??undefined
    }


    protected async findBestMap(location:IncyclistNode):Promise<IMapArea|undefined> {
        if (!this.hasLocationCovered(location))
            return undefined

        const records = this.getMapsForLocation(location)

        let updateRequired = true
        let minDist = Number.MAX_VALUE
        let minPct
        let best:MapAreaRecord|undefined
        do {
            if (records.length===0)
                break

            const record = records.pop()
            const {map,radius} = record
            if (!map)
                continue
    
            const dist = distanceBetween(location,map.getQueryLocation())
            updateRequired = dist>(radius/5); // 20%

            if (!updateRequired) { 
                minDist = dist
                minPct = minDist/radius*100
                best = record
            }

            else if (dist<minDist) {
                minDist = dist
                minPct = minDist/radius*100
            }   

            await waitNextTick()
        } while (records.length>0 && updateRequired)    

        const {lat,lng,id} = location
        this.logEvent( {message:'distance between previous overpass request',location:{lat,lng,id},dist:minDist,pct:minPct,updateRequired, map:getMapInfo(best?.map)});

        return best?.map
    }

    async loadMap( location: IncyclistNode):Promise<IMapArea> {
        let ts
        try {                       
            const bounds = getBounds(location?.lat,location?.lng,this.radius)
            const query = buildQuery(GET_WAYS_IN_AREA,bounds);


            const openmapData = await this.getOverpassAPI().query(query,DEFAULT_TIMEOUT);                  
            if (!openmapData){
                // TODO: offer retry
                return
            }

            const data = this.createMapData(openmapData);    
            const map = new MapArea(data,location,bounds)
            this.addMap(map,location)
            this.getOptionManager().setMap(map)

            this.checkRadiusAdjustment(map);
            
            this.startGarbageCollection()

            return map
        }
        catch (error) {
            const duration = ts? Date.now()-ts : undefined
            this.logEvent({message:'overpass query result',status:'failure',error:{code:error.code,response:error.response},duration});
        }

    }


   

    protected hasLocationCovered(location:IncyclistNode):boolean {
        const maps = this.getAllMaps()??[]
        return maps.some(m=>m.isWithinBoundary(location))        
    }


    protected mapsKey(location:IncyclistNode):string {
        return `${location.lat},${location.lng}`        
    }

    protected getAllMaps():MapArea[] {
        return Object.values(this.maps).map(m=>m.map)
    }

    protected addMap(map:MapArea,location:IncyclistNode) {
        this.current = map

        this.maps[this.mapsKey(location)] = {map,lastUsed:Date.now(), radius:this.radius}
        this.logEvent({message:'Map added',cnt:Object.keys(this.maps).length,maps:Object.keys(this.maps).map(k=>getMapsInfo(this.maps,k))})
    }

    protected getMapsForLocation(location:IncyclistNode):MapAreaRecord[] {        
        return Object.values(this.maps).filter(m=>m.map.isWithinBoundary(location))        
    }


    createMapData( openmapData):FreeRideDataSet {
        

        let ts = Date.now();
        const data = parseMapData(openmapData,this.filter); 
        let ts1 = Date.now(); 

        /* istanbul ignore next */ 
        this.logger.logEvent({message:'Parse',duration:(ts1-ts),
                                ways:data?.ways.length??0,
                                nodes:Object.keys(data?.nodesLookup??{}).length,
                                typeStats:data?.typeStats
                            });

        if (data!==undefined) {
            this.loaded = 'success';
        }
        else {
            this.loaded = 'failure'
        }

        return data

    }

    /**
     * Check if the number of ways found in the map is within the expected range (minWays,maxWays).
     * If the number of ways is below the minimum, adjust the radius to find more ways during next query
     * If the number of ways is above the maximum, adjust the radius to find fewer ways  during next query
     * @param map The map to check
     */
    protected checkRadiusAdjustment(map:MapArea) {
        const ways = map.getWays()
        if (ways.length < this.minWays) {
            if (ways.length > 0) {
                let gap = this.minWays / ways.length;
                this.radius = this.radius * Math.sqrt(gap);
            }
            else {
                this.radius = this.radius * 2;
            }
        }
        else if (ways.length > this.maxWays) {
            let gap = ways.length / this.maxWays;
            this.radius = this.radius / Math.sqrt(gap);
        }
    }

    protected startGarbageCollection() {
        if (this.iv)
            return;

        this.logEvent({message:'Garbage collection started',frequency:'5min'})
        this.iv = setInterval(() => {
            this.garbageCollection()
        }, 1000 * 60 * 5);
    }

    protected stopGarbageCollection() {
        if (!this.iv)
            return;
        
        clearInterval(this.iv)
        this.iv = undefined 
    }

    protected garbageCollection() {
        const now = Date.now();
        const maps = Object.values(this.maps).filter(m=>now-m.lastUsed<1000*60*5);

        // Always keep the last map (this.current)  even if it has not been used for a while
        const keyLastUsed = this.mapsKey(this.current.getQueryLocation())        
        const deleteTarget  = maps.filter(m=>this.mapsKey(m.map.getQueryLocation())!==keyLastUsed)

        if (deleteTarget.length>MAX_MAPS)  {
            deleteTarget.forEach(m=> {                
                delete this.maps[this.mapsKey(m.map.getQueryLocation())]
            })        
        }
        this.logEvent({message:'Garbage collection done',cnt:Object.keys(this.maps).length,maps:Object.keys(this.maps).map(k=>getMapsInfo(this.maps,k))})

    }



    @Injectable
    protected getOverpassAPI() {
        this.overpass = this.overpass??new OverpassApi();
        return this.overpass

    }


    reset() {
        this.stopGarbageCollection()    
        super.reset()

    }

}



export const useMapArea = () => new MapAreaService()