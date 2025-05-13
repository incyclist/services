import { OverpassApi } from "../../api";
import { distanceBetween } from "../../utils/geo";
import { Observer, Singleton } from "../../base/types";
import { IncyclistService } from "../../base/service";
import { FreeRideDataSet,  IncyclistNode, FreeRidePosition, IMapAreaService, IMapArea } from "./types";
import { DEFAULT_MIN_WAYS, DEFAULT_MAX_WAYS, DEFAULT_RADIUS, GET_WAYS_IN_AREA, MAX_DISTANCE_FROM_PATH, DEFAULT_FILTER} from "./consts";
import { buildQuery,getBounds, parseMapData } from "./utils";
import { Injectable } from "../../base/decorators";
import { MapArea } from "./MapArea";
import { OptionManager } from "./options";


type MapAreaRecord = {
    map: MapArea
    lastUsed: number
    radius: number
}
const MAX_MAPS = 5

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

        const reloadRequires = this.requiresReload(location)
        if (!reloadRequires) {
            this.getMapForLocation(location).lastUsed = Date.now()
            return this.getMap(location)
        }
        

        let ts
        try {                       
            const bounds = getBounds(location?.lat,location?.lng,this.radius)
            const query = buildQuery(GET_WAYS_IN_AREA,bounds);
            const {id,lat,lng} = location;


            this.logEvent({message:'overpass query',query,location:{id,lat,lng}, radius:this.radius});
            console.log('load map',location,query, this.radius)
            ts = Date.now();
            const openmapData = await this.getOverpassAPI().query(query);                  
            this.logEvent({message:'overpass query result',status:'success',duration:(Date.now()-ts)});

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


    protected requiresReload(location:IncyclistNode):boolean {
        if (!this.hasLocationCovered(location))
            return true

        const record = this.getMapForLocation(location)
        const {map,radius} = record
        if (!map)
            return true

        const dist = distanceBetween(location,map.getQueryLocation())
        const updateRequired = dist>(radius/5); // 20%
        this.logEvent( {message:'distance between previous overpass request',dist,updateRequired, pct:dist/radius*100});

        return updateRequired
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

        // replace existing map if it exisst
        const existing = Object.values(this.maps).findIndex(m=>m.map.isWithinBoundary(location))        
        if (existing!==-1) {
            const key  = Object.keys(this.maps)[existing]
            delete this.maps[key]
        }

        this.maps[this.mapsKey(location)] = {map,lastUsed:Date.now(), radius:this.radius}
    }

    protected getMapForLocation(location:IncyclistNode):MapAreaRecord {        
        return Object.values(this.maps).find(m=>m.map.isWithinBoundary(location))        
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

        if (deleteTarget.length>MAX_MAPS)
            deleteTarget.forEach(m=>delete this.maps[this.mapsKey(m.map.getQueryLocation())])        
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