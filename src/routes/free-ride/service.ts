import { Injectable } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import {  Singleton } from "../../base/types";
import { DEFAULT_POSITION } from "../../maps/MapArea/consts";
import { useMapArea } from "../../maps/MapArea/service";
import { FreeRideContinuation, IMapArea, IncyclistNode, IncyclistWay } from "../../maps/MapArea/types";
import { concatPaths, getPointCrossingPath, isAllowed, isOneWay, isRoundabout } from "../../maps/MapArea/utils";
import { RoutePoint } from "../base/types";
import { FreeRideOption, FreeRidePoint } from "../list/types";
import { useUserSettings } from "../../settings";
import { distanceBetween, calculateHeaderFromPoints as getHeadingBetween, LatLng } from "../../utils/geo";
import { OptionManager } from "../../maps/MapArea/options";
import { waitNextTick } from "../../utils";
import clone from "../../utils/clone";


@Singleton
export class FreeRideService extends IncyclistService {

    protected startPosition:IncyclistNode
    protected startOptions:FreeRideContinuation[]
    protected selectedOption:FreeRideContinuation
    protected options:FreeRideContinuation[]
    protected currentSegment: FreeRideContinuation
    

    constructor() {
        super('FreeRide')
        this.options = []
    }   


    /**
     * Sets the start position for the free ride and loads the map area. 
     * @param position - The position to set as the start position. If not given, the default position is used.
     * @returns The route definition display props containing the start position and the free ride options.
     */
    async selectStartPosition( position: LatLng|undefined) {
        this.setStartPosition(position)  

        const map = await this.getMapArea().load(this.startPosition)
       
        await this.getStartOptions(map,true)

        return this.getRouteDefinitionDisplayProps()
    }

    /**
     * Returns the start position. If no start position has been set, the default start position is returned.
     * @returns The start position.
     */
    getStartPosition():IncyclistNode {  
        return this.startPosition??this.getDefaultStartPosition()
    }


    /**
     * Returns the properties to be used by the RouteDefinition UI component
     * @returns The route definition display props.
     */
    getRouteDefinitionDisplayProps() {        
        const options = this.buildStartOptions()
        return {position:this.startPosition, options}
    }

    /**
     * Gets the next ride continuation options after the current option has been selected.
     * 
     * In order to avoid waiting time, this class always tries to caclulate one level in advance, so that ff the next options have already been calculated, 
     * they are returned immediately and the next level of options is calculated in the background.
     * 
     * @returns A promise that resolves to the next options.
     */
    async getNextOptions(forStart?:boolean):Promise<FreeRideContinuation[]> {
        
        let prepared = false

        // if we already have calculated the next level of options, return them immeditately and calculate the next level
        const from = this.selectedOption

        const optionsInfo = (opts:FreeRideContinuation[]) => {
            return opts?.map( o => this.buildId(o)).join('|') ??'none'
        }                

        
        if (from?.options?.length > 0) {
            this.options = this.evaluateOptions(from.options, from);
            prepared = true
                     
            // pre-calculate one level deeper
            this.getNextLevelOptions(from.options);                    
        }
        else {
            // otherwise load the continuation options
            
            this.options =  await this.loadNextOptions(from,forStart);
        }


        const message = forStart ? 'start options updated' : 'free ride options updated'
        this.logEvent({message,prepared, options: optionsInfo(this.options), from: this.buildId(from)})

        if (this.options?.length > 0) {
            this.selectOption(this.options[0]);
        }
        return this.options

    }

    getCurrentSegment():FreeRideContinuation {
        return this.currentSegment
    }

    setCurrentSegment(segment:FreeRideContinuation) {
        this.selectedOption  = this.currentSegment = segment        
        delete this.options
        this.emit('segment-update',segment)

        this.logEvent({message:'current segment changed', segment: this.buildId(this.selectedOption)})

    }

    protected getOption(option:FreeRideOption):FreeRideContinuation {
        return (this.options??[]).find( o => o.ui?.id === option.id)
    }

    private async loadNextOptions(from: FreeRideContinuation,forStart?:boolean): Promise<FreeRideContinuation[]> {    

        const optionManager = useMapArea().getOptionManager()
        let opts =  await optionManager.getNextOptions(from) ?? [];

        opts = this.evaluateOptions(opts, from);
        // for each of the options, get next options
        if (forStart )
            await this.getNextLevelOptions(opts);
        else {
            from.options = from.options ?? opts
            this.getNextLevelOptions(from.options);
        }

        return opts

    }

    private evaluateOptions(original: FreeRideContinuation[], from: FreeRideContinuation) {

        let opts = original
        if (!opts?.length) {
            opts = this.addLastSegmentReverse(opts,from);
        }

        opts = this.filterOptions(opts, from);
        opts = this.sortOptions(opts, from);

        return opts;
    }

    protected addLastSegmentReverse(original: FreeRideContinuation[],from: FreeRideContinuation):FreeRideContinuation[] {
        const options = original??[]
        const currentSegment = from??this.currentSegment
        let map

        if (currentSegment?.path?.length>0) {
            let path = [...currentSegment.path]

            // starting point from route selectoin (without node ID?)
            if (!path[0].id) {
                map = from.map ?? this.getMapArea().getMap(path[0])
                const way = map.getWay(currentSegment.id)
                const end = path[path.length-1]
                let newSegment:FreeRideContinuation
                if (end.id===way.path[way.path.length-1].id) { 
                    path = way.path 
                    path.reverse()
                    newSegment = {...way,path}

                }
                else {
                    newSegment = {...way}
                }
                const result = map.splitAtFirstBranch(newSegment)
                path = result?.path??[]
            }
            else {
                map = currentSegment.map
                path.reverse()
            }
            
            const wayId = path[0].ways?.length===1  ?  path[0].ways[0] : path[1].ways[0]
            const way = map?.getWay(wayId)     
            if ( way && isOneWay(way) && way.path[0].id!==path[0].id) {
                // don't add if we are not allowed to ride in this direction
                return
            }
            
            const option = { ...currentSegment, path, id:way.id }
            options.push(option);
        }
        return options
    }

    protected filterOptions(opts:FreeRideContinuation[],from: FreeRideContinuation):FreeRideContinuation[] {
        return this.filterOneWayOptions(opts,from);
        
    }

    /**
     * Filters out one-way options that cannot be traversed from the current segment.
     * 
     * @returns An array of filtered options that can be traversed from the current segment.
     */

    protected filterOneWayOptions(opts:FreeRideContinuation[],currentSegment: FreeRideContinuation):FreeRideContinuation[] {
        const options = opts
        const map = currentSegment.map ?? this.getMapArea().getMap(currentSegment.path[0])
        const fromPath = currentSegment.path
        const fromWay:IncyclistWay = map ? {...map.getWay(currentSegment.id), path:currentSegment.path} : undefined
            
        if ( fromWay===undefined || !options?.length)
            return [];

        // roundabouts already have filtered out one ways
        if ( fromWay.roundabout)
            return options;

        const from = fromPath[ fromPath.length-1];

        const filtered = options.filter( o => { 
            const way = {...map.getWay(o.id), path:o.path}
            if (!isRoundabout(way))
                return true;
            
            return  isAllowed(way,from);
        })

        // don't remove one-way if it is the only option available. (as last resort)
        if (filtered.length<1)
            return options;
        
        return filtered;
    }
    
    protected sortOptions(options:FreeRideContinuation[],currentSegment: FreeRideContinuation):FreeRideContinuation[] {
        if (options.length === 0)
            return


        const map = currentSegment.map ?? this.getMapArea().getMap(currentSegment.path[0])
        const way:IncyclistWay = map ? {...map.getWay(currentSegment.id), path:currentSegment.path} : currentSegment as IncyclistWay

        const byDirectionChange = (a,b) => Math.abs(a.direction) - Math.abs(b.direction)

        // perform intial sort by direction change (will be used if no other criteria is met)
        options.sort(byDirectionChange)
        let sorted = options
        

        const sameWay = options.filter( o => o.id===way.id )??[]

        let selected, selectedIdx

        // prioritize staying on the same way id ...
        if (!way.roundabout && sameWay.length>0) {
            const same = [...sameWay]
            same.sort(byDirectionChange)

            selected = same[0]
            selectedIdx = options.indexOf(selected)
        }
        // ... unless we just left a roundabout ( same way id typically points back to roundabout)
        else if (way.roundabout && sameWay.length>0) {
            selectedIdx = options.findIndex( w => way.id !==w.id)
            selected = options[selectedIdx]
        }
        
        // prioritize staying on the road with the same name
        else if ( !way.roundabout && way.tags?.name) {
            const sameName = this.getOptionsWithSameName(options,way)
            if (sameName.length>0) {
                const same = [...sameName]
                same.sort(byDirectionChange)   
                selected = same[0]
                selectedIdx = options.indexOf(selected)                    
            }
        }

        // bring selected to the front
        if (selectedIdx!==undefined && selected!==undefined) {
            options.splice(selectedIdx,1)
            sorted = [selected,...options]                
        }

        return sorted
    }

    protected getOptionsWithSameName(options:FreeRideContinuation[],src:IncyclistWay) {
        const same = []
        options.forEach( o => {
            const map = o.map ?? this.getMapArea().getMap(o.path[0])
            const way:IncyclistWay = map?.getWay(o.id) 

            if (way?.tags?.name === src.tags?.name) {
                same.push(o)
            }
        })
        return same
    }


    protected async getNextLevelOptions(opts: FreeRideContinuation[] ) {

        let segmentUpdated = false
        this.once('segment-update', () => { segmentUpdated = true } )

        const optionManager: OptionManager = useMapArea().getOptionManager()        

        const segmentLog = (o:FreeRideContinuation) =>  {
            if (!o?.path?.length)
                return o?.id+':no path'

            return `${o.id}:(${o.path.length}):${o.path[0].id}->${o.path[o.path.length-1].id}`
        }

        // run in sequence to not overload overpass servers
        for (const o of opts??[]) {

            if (segmentUpdated)
                return


            let segment = o;
            let done = false
            let isSingle = false

            do {
                const nextOpts = await optionManager.getNextOptions(segment);

                const handleSingleOption = () => {
                    if (segmentUpdated)
                        return
                    isSingle = true
        
                    try {
                        segment = nextOpts[0];
                        concatPaths(o.path, segment.path, 'after');
                        const originatingPoint = segment.path[1];
        
                        
        
                        // remove option that poins back to the originating point
                        if (segment.options?.length > 0) {
                            segment.options = segment.options.filter( o => o.path[o.path.length-1].id !== originatingPoint.id);
                        }
    
                    }
                    catch(err) {
                        this.logError(err,'getNextLevelOptions#handleSingleOption')                        
                    }

                }

                const handleNoOption = () => { 
                    if (segmentUpdated)
                        return

                    // if we are looking for the continuation of a single option, we can stop here.
                    if (isSingle) {
                        o.options = [segment]
                        done = true;
                        return 
                    }
        
                    try {
                        const map = segment.map ?? this.getMapArea().getMap(segment.path[0])
    
                        const newPath = []
                        segment.path.forEach( p => { 
                            newPath.push( clone(p) )
                        })
                        newPath.reverse()
    
                        
    
                        const way = map?.getWay(segment.id)
    
                        if ( !isOneWay(way) ||  isAllowed(way, newPath[0], newPath[newPath.length-1])) {
                            segment = {
                                id:o.id,
                                map:o.map,                            
                                direction: 180,
                                path: newPath
    
                            }
                            
                            concatPaths(o.path, newPath, 'after');
    
                        }
                        else {
                            o.options = []
                            done = true
                        }
    
                    }
                    catch(err) {
                        this.logError(err,'getNextLevelOptions#handleNoOption')
                    }

                }
    


                if (nextOpts?.length === 1) {
                    handleSingleOption()
                }
                else if (!nextOpts?.length) {
                    handleNoOption()           
                }
                else {
                    o.options = nextOpts;
                    done = true                           
                }

                await waitNextTick()
            } while (!done);
        }

    }

    protected buildId (opt:FreeRideContinuation):string {
        if (!opt) {
            return 
        }

        return `${opt.id}:${opt.path[0].id??'crossing'}-${opt.path[opt.path.length-1].id??'crossing'}`        
    }

    getOptions():FreeRideContinuation[] {
        return this.options
    }


    selectOption( option:FreeRideContinuation|string|number ):FreeRideContinuation[]{

        const current = this.selectedOption

        let opt;
        switch (typeof option) {
            case 'number':
                opt = this.options?.[option-1]
                break;
            case 'string':
                opt = this.options.find( o => this.buildId(o) === option);
                if (!opt) {
                    const wayId = option.split(':')[0]
                    opt = this.options.find( o => o.id === wayId)
                }
                if (!opt) { 
                    opt = current
                }                      
                break
            default:
                opt = option
        }

        this.selectedOption = this.options.find( o=> this.buildId(o) === this.buildId(opt)) 

        if (!this.selectedOption) {
            this.logEvent({message:'free ride option selection failed', requested: option, type:typeof option, options: this.options, optionKeys: this.options.map(o => this.buildId(o))} )

        }

        return this.options
        
    }

    applyOption( option?:FreeRideContinuation ) {
        if (option)
            this.selectOption(option)

        this.logEvent({message:'free ride option applied', option: this.buildId(this.selectedOption)})

        this.currentSegment = this.selectedOption
    }

    applyStartOption( startOption?:FreeRideOption ) {
        const option = this.options.find( o => this.buildId(o) === startOption?.id)

        this.applyOption(option)
    }

    getSelectedOption():FreeRideContinuation|undefined { 
        return this.selectedOption
    }

    turnAround() {
        // TODO
    }


    protected getPath  (option:FreeRideContinuation):FreeRidePoint[] {
        
        const continuation = option?.path??[]
        let path:RoutePoint[]   = continuation.map( p=> ({...p, distance:0, routeDistance:0, elevation:0, slope:0}) )


        path = path.map( (p,idx)=> {
            if (idx===0)
                return p
            const distance = distanceBetween(path[idx-1],p)
            const routeDistance = (path[idx-1].routeDistance??0) + distance
            return {...p, distance, routeDistance}
            
            

        })
        return path
    }

    buildUIOptions(opts: FreeRideContinuation[] = this.options??[]): FreeRideOption[] {
        
        return opts.map((option, idx) => {
            const id = this.buildId(option)
            const selected = id === this.buildId(this.selectedOption)
            const text = this.getOptionText(option);
            const color = this.getOptionColor(idx, { isStartPos: false, selected});
            
            const uiOptions =  { id,  color, text,path: this.getPath(option),selected,direction:option.direction };
            option.ui = uiOptions
            return uiOptions

        });
    }


    protected buildStartOptions():FreeRideOption[] {
        const opts = this.startOptions??[]
        

        if (opts.length<1)
            return []

        if (opts.length<2) {
            const option = opts[0]
            const id = this.buildId(option)
            const uiOption = {id,color:'blue',text:'OK',path:this.getPath(option)}
            option.ui = uiOption
            return [uiOption]
        }

        return opts.map( (option,idx) => { 
            const text = this.getOptionText(option)
            const color = this.getOptionColor(idx, {isStartPos:true})
            const id = this.buildId(option)
            const uiOption = {id,color,text,path:this.getPath(option)}            
            option.ui = uiOption
            return uiOption
        })


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

        this.options = this.startOptions
    }

    protected setStartPosition( position?:LatLng ) {
        try {
            this.startPosition = position??this.getDefaultStartPosition()
            const {lat,lng} = this.startPosition
            this.getUserSettings().set('routeSelection.freeRide.position',{lat,lng})
        }
        catch(err) {
            this.logError(err,'setStartPosition')
        }
    }

    protected getDefaultStartPosition():IncyclistNode {
        try {
            const position = this.getUserSettings().get('routeSelection.freeRide.position',DEFAULT_POSITION)
            if (position.lat===undefined || isNaN(position.lat) || position.lng===undefined|| isNaN(position.lng)) {
                return DEFAULT_POSITION
            }
            return position
        }
        catch {
            return DEFAULT_POSITION
        }
    }

    protected getOptionText(option:FreeRideContinuation):string {

        const path = option?.path??[];
        if (path.length<2)
            return 
        
        const heading =getHeadingBetween(path[0],path[1]) % 360;
        const idx = Number(heading/45).toFixed(0);
        const texts = ['North','Northeast','East','Southeast','South','Southwest','West','Northwest','North']
        
        return texts[idx]       
    }

    protected getOptionColor(idx:number, props?:{isStartPos?:boolean,selected?:boolean}):string {

        if (props?.isStartPos) { 
            const colors = [ 'red','green','blue','yellow', 'orange','gray','pink','brown'] 
            return colors[idx % colors.length]
        }

        if (props?.selected)
            return 'green'

        const colors = ['red', 'purple', 'black', 'magenta', 'orange', 'brown','royalblue', 'silver']
        return colors[idx % colors.length]       
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

export const useFreeRideService = () => new FreeRideService()