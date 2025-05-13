import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Observer, Singleton } from "../base/types";
import { DEFAULT_POSITION } from "../maps/MapArea/consts";
import { useMapArea } from "../maps/MapArea/service";
import { FreeRideContinuation, IMapArea, IncyclistNode } from "../maps/MapArea/types";
import { getPointCrossingPath } from "../maps/MapArea/utils";
import { FreeRideOption } from "../routes/list/types";
import { useUserSettings } from "../settings";
import { LatLng } from "../utils/geo";

@Singleton
export class FreeRideService extends IncyclistService {

    protected observer:Observer
    protected startPosition:IncyclistNode
    protected startOptions:FreeRideContinuation[]
    protected selectedOption:FreeRideOption

    constructor() {
        super('FreeRide')
    }   


    startRouteDefinition( initialPosition?: LatLng ):Observer {
        if (this.observer)
            this.observer.stop()

        this.observer = new Observer()
        
        this.changeStartPosition(initialPosition, true)  
        
        return this.observer        
    }

    async changeStartPosition( position: LatLng, initial:boolean=false ) {
        this.setStartPosition(position)  

        const map = await this.getMapArea().load(this.startPosition)
       
        await this.getStartOptions(map,true)
        this.observer.emit(initial ? 'loaded' : 'updated')
    }

    select( option:FreeRideOption ) {
        this.selectedOption = option
    }

    getRouteDefinitionDisplayProps() {
        // TODO
        const options = this.buildFreeRideOptions()
        return {position:this.startPosition, options}
    }

    protected buildFreeRideOptions():FreeRideOption[] {
        const opts = this.startOptions??[]
        // TODO
        return opts.map( o => ({...o} as FreeRideOption) )

    }

    protected async getStartOptions(map:IMapArea,initial:boolean=false) {
        this.startOptions = []
        if (!map)
            return

        // get the nearest way 
        const {way} = map.getNearestPath(this.startPosition)??{}
        
        if (!way) {
            const {lat,lng} = this.startPosition
            this.logEvent({message:'no options found for',lat,lng, reason:'off track'})
            return
        }

        const crossing = getPointCrossingPath(this.startPosition, way.path,true)
        if (!crossing) {
            if ( way.path.length>1)
                this.startOptions = [ {path:way.path}] 
            return
        }

        // update start position to the crossing point with the nearest way
        this.setStartPosition(crossing.point)

        const optionManager = useMapArea().getOptionManager()
        optionManager.setMap(map)

        const options = await optionManager.getStartOptions(way,crossing)
        this.startOptions.push(...options)

    }

    protected setStartPosition( position?:LatLng ) {
        try {
            this.startPosition = position??this.getDefaultStartPosition()
            this.getUserSettings().set('preferences.routeSelection.freeRide.position',this.startPosition)
        }
        catch(err) {
            this.logError(err,'setStartPosition')
        }
    }

    protected getDefaultStartPosition():IncyclistNode {
        try {
            return this.getUserSettings().get('preferences.routeSelection.freeRide.position',DEFAULT_POSITION)
        }
        catch {
            return DEFAULT_POSITION
        }
    }



    @Injectable
    protected getMapArea() {
        return useMapArea()
    }

     @Injectable
     protected getUserSettings() {
         return useUserSettings()
     }  



}