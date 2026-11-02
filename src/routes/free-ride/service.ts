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
import { buildOptionLabels, getCompassWord, getLayoutOrder, getRoadLabel } from "./option-labels";

const INIT_RETRY = 15*1000; // 15s
const MAX_RETRIES = 1

@Singleton
export class FreeRideService extends IncyclistService {

    protected startPosition:IncyclistNode
    protected startOptions:FreeRideContinuation[]
    protected selectedOption:FreeRideContinuation
    protected options:FreeRideContinuation[]
    protected currentSegment: FreeRideContinuation
    protected lastOptionsQueryValid: boolean = true
    protected initialized: boolean = false
    protected ivInit?: NodeJS.Timeout
    protected cntInitRetry:number = 0
    protected rideSeq:number = 0
    protected selectedBy: 'auto'|'user' = 'auto'
    protected startSource: 'default'|'last'|'search'|'map' = 'default'

    constructor() {
        super('FreeRide')
        this.options = []
    }   

    init() {
        this.logEvent({message:'init free ride service'})
        this.selectStartPosition()
        .catch( err=> {
            this.logError(err,'init')
        })
        .finally( ()=>{
            
            this.logEvent({message:'init free ride service result', success:this.initialized})

            // retries are only needed if the initial attempt failed. A later retry would rebuild the start options 
            // while a ride might already be running
            if (this.initialized)
                return

            this.ivInit = setInterval( ()=>{
                if (this.cntInitRetry<MAX_RETRIES) {
                    this.cntInitRetry++;
                    this.logEvent({message:'init free ride service retry'})
                    this.selectStartPosition().catch( err=> { this.logError(err,'init')})
                }
                else {
                    clearInterval(this.ivInit)
                    delete this.ivInit
                }

            }, INIT_RETRY)
        })
       
    }

    isInitialized() {
        return this.initialized
    }

    /**
     * Sets the start position for the free ride and loads the map area. 
     * @param position - The position to set as the start position. If not given, the default position is used.
     * @returns The route definition display props containing the start position and the free ride options.
     */
    async selectStartPosition( position?: LatLng|undefined, opts?:{source?:'search'|'map'}) {
        const rideSeq = this.rideSeq
        const keepSource = !position && (this.startSource==='search' || this.startSource==='map')
        this.startSource = opts?.source ?? (keepSource ? this.startSource : this.getDefaultSource(position))
        this.setStartPosition(position)  

        const map = await this.getMapArea().load(this.startPosition)
        if (!this.initialized && map) {
            this.setInitialized()
        }

        // a ride was started while the map was loading (e.g. slow network): the start options are obsolete
        // and must not replace the options of the running ride
        if (rideSeq !== this.rideSeq) {
            this.logEvent({message:'start position update ignored', reason:'ride started'})
            return this.getRouteDefinitionDisplayProps()
        }
       
        await this.getStartOptions(map, rideSeq)

        return this.getRouteDefinitionDisplayProps()
    }

    /**
     * Returns the start position. If no start position has been set, the default start position is returned.
     * @returns The start position.
     */
    /**
     * Where the start position of the ride came from, for diagnostics: 
     * 'default' (example position), 'last' (position of the previous ride), 'search' or 'map' (chosen by the rider)
     */
    getStartSource():'default'|'last'|'search'|'map' {
        return this.startSource
    }

    protected getDefaultSource(position?:LatLng):'default'|'last' {
        const {lat,lng} = position ?? this.getDefaultStartPosition()
        return lat===DEFAULT_POSITION.lat && lng===DEFAULT_POSITION.lng ? 'default' : 'last'
    }

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

        
        let loadAsync = true
        if (from?.options?.length > 0) {
            loadAsync = false
            this.options = this.evaluateOptions(from.options, from);
            if (this.options?.length) { 
                prepared = true
                        
                // pre-calculate one level deeper
                this.getNextLevelOptions(from.options).catch( err=>{ this.logError(err,'getNextLevelOptions') });
            }
            else {
                loadAsync = true
            }
        }
        
        if (loadAsync) {
            // otherwise load the continuation options            
            this.options =  await this.loadNextOptions(from,forStart);
        }


        const message = forStart ? 'start options updated' : 'free ride options updated'
        this.logEvent({message,prepared, options: optionsInfo(this.options), from: this.buildId(from), ...this.getOptionsLogProps()})

        if (this.options?.length > 0) {
            this.selectOption(this.options[0]);
        }
        else {
            this.selectedOption = undefined
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

    protected setInitialized() {
        this.initialized = true
        if (this.ivInit) {
            clearInterval(this.ivInit)
            delete this.ivInit
            this.logEvent({message:'init free ride service success'})
        }
        this.emit('initialized')
    }

    protected getOption(option:FreeRideOption):FreeRideContinuation {
        return (this.options??[]).find( o => o.ui?.id === option.id)
    }

    private async loadNextOptions(from: FreeRideContinuation,forStart?:boolean): Promise<FreeRideContinuation[]> {

        const optionManager = useMapArea().getOptionManager()
        const result = await optionManager.getNextOptions(from)
        let opts = result.options

        this.lastOptionsQueryValid = result.isValid

        if (!result.isValid) {
            return []
        }

        opts = this.evaluateOptions(opts, from);
        // for each of the options, get next options
        if (forStart )
            await this.getNextLevelOptions(opts);
        else {
            from.options = from.options ?? opts
            this.getNextLevelOptions(from.options).catch( err=>{ this.logError(err,'loadNextOptions') });
        }

        return opts

    }

    private evaluateOptions(original: FreeRideContinuation[], from: FreeRideContinuation) {

        let opts = original
        if (!opts?.length && from!=null) {
            opts = this.addLastSegmentReverse(opts,from);
        }
        
        if (!from) return opts ?? [] 

        opts = this.filterOptions(opts, from);
        opts = this.sortOptions(opts, from);

        return opts;
    }

    protected addLastSegmentReverse(original: FreeRideContinuation[],from: FreeRideContinuation):FreeRideContinuation[] {
        const options = original??[]
        const currentSegment = from??this.currentSegment

        try {
            if (!currentSegment?.path?.length) {
                return options
            }

            let path = [...currentSegment.path]
            let map: IMapArea

            if (!path[0].id) {
                map = from?.map ?? this.getMapArea().getMap(path[0])
                path = this.processPathWithoutNodeId(map, currentSegment.id, path)
            } else {
                map = currentSegment.map
                path.reverse()
            }

            const option = this.validateAndAddWay(path, map, currentSegment)
            if (option) {
                options.push(option)
            }

            return options
        }
        catch(err:any) {
            this.logError(err,'addLastSegmentReverse',{original,from})
            return []
        }
    }

    private processPathWithoutNodeId(map: IMapArea, segmentId: string, path: IncyclistNode[]): IncyclistNode[] {
        const way = map.getWay(segmentId)
        if (!way) {
            return []
        }

        const end = path.at(-1)
        const newSegment = end.id === way.path.at(-1).id
            ? { ...way, path: [...way.path].reverse() }
            : { ...way }

        const result = map.splitAtFirstBranch(newSegment)
        return result?.path ?? []
    }

    private validateAndAddWay(path: IncyclistNode[], map: IMapArea, currentSegment: FreeRideContinuation): FreeRideContinuation | null {
        if (!path.length) {
            return null
        }

        const wayId = path[0].ways?.length === 1 ? path[0].ways[0] : path[1].ways[0]
        const way = map?.getWay(wayId)

        if (!way) {
            return null
        }

        if (isOneWay(way) && way.path[0].id !== path[0].id) {
            return null
        }

        return { ...currentSegment, path, id: way.id }
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

        const from = fromPath.at(-1);

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
        const onSegmentUpdate = () => { segmentUpdated = true }
        this.once('segment-update', onSegmentUpdate)

        const optionManager: OptionManager = useMapArea().getOptionManager()        

        // the listener is only removed by the event itself, which is not emitted at every junction.
        // Without removing it here, one listener per junction would pile up
        try {
            // run in sequence to not overload overpass servers
            for (const o of opts??[]) {

                if (segmentUpdated)
                    return


                let segment = o;
                let done = false
                let isSingle = false
                let lastHandlerWasNoOption = false

                do {
                    const nextOptsResult = await optionManager.getNextOptions(segment);
                    const nextOpts = nextOptsResult.options
                    const isValid = nextOptsResult.isValid

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
                                segment.options = segment.options.filter( o => o.path.at(-1).id !== originatingPoint.id);
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

                        if (lastHandlerWasNoOption) {
                            o.options = []
                            done = true
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
    
                            if ( !isOneWay(way) ||  isAllowed(way, newPath[0], newPath.at(-1))) {
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
                        lastHandlerWasNoOption = false
                    }
                    else if (!nextOpts?.length && isValid) {
                        handleNoOption()
                        lastHandlerWasNoOption = true
                    }
                    else if (!nextOpts?.length && !isValid) {
                        o.options = []
                        done = true
                        lastHandlerWasNoOption = false
                    }
                    else {
                        o.options = nextOpts;
                        done = true
                        lastHandlerWasNoOption = false
                    }

                    await waitNextTick()
                } while (!done);
            }
        }
        finally {
            this.off('segment-update', onSegmentUpdate)
        }

    }

    protected buildId (opt:FreeRideContinuation):string {
        if (!opt) {
            return 
        }

        return `${opt.id}:${opt.path[0].id??'crossing'}-${opt.path.at(-1).id??'crossing'}`        
    }

    getOptions():FreeRideContinuation[] {
        return this.options
    }

    isLastQueryValid():boolean {
        return this.lastOptionsQueryValid
    }


    /**
     * Selects an option on behalf of the rider (click or key). Unlike selectOption() the selection is remembered
     * as the rider's choice, so that the UI can tell it from the automatically selected default.
     */
    selectOptionByUser( option:FreeRideContinuation|string|number ):FreeRideContinuation[]{
        const options = this.selectOption(option)
        if (this.selectedOption)
            this.selectedBy = 'user'
        return options
    }

    selectOption( option:FreeRideContinuation|string|number ):FreeRideContinuation[]{

        const current = this.selectedOption
        const options = this.options??[]

        let opt;
        switch (typeof option) {
            case 'number':
                opt = options[option-1]
                break;
            case 'string':
                opt = options.find( o => this.buildId(o) === option);
                if (!opt) {
                    const wayId = option.split(':')[0]
                    opt = options.find( o => o.id === wayId)
                }
                if (!opt) { 
                    opt = current
                }                      
                break
            default:
                opt = option
        }


        this.selectedOption = options?.find( o=> this.buildId(o) === this.buildId(opt)) 
        this.selectedBy = 'auto'

        if (!this.selectedOption) {
            const requested = typeof option === 'object' ? this.buildId(option) : option
            this.logEvent({message:'free ride option selection failed', requested, type:typeof option, count: options.length, optionKeys: options.map(o => this.buildId(o)).join('|')} )

        }

        return this.options
        
    }

    applyOption( option?:FreeRideContinuation ) {
        if (option) {
            // applying must not turn the rider's choice into an automatic selection
            const by = this.selectedBy
            const sameAsSelected = this.buildId(option) === this.buildId(this.selectedOption)
            this.selectOption(option)
            if (sameAsSelected)
                this.selectedBy = by
        }

        this.logEvent({message:'free ride option applied', option: this.buildId(this.selectedOption), ...this.getSelectionLogProps()})

        this.currentSegment = this.selectedOption
    }

    applyStartOption( startOption?:FreeRideOption ) {
        // invalidates start position updates that are still in progress
        this.rideSeq++

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

        // the same option must never be shown twice. (Same way with a different target is a different option)
        const seen = new Set<string>()
        const unique = opts.filter( o => { 
            const id = this.buildId(o)
            if (seen.has(id)) 
                return false
            seen.add(id)
            return true
        })

        const selectedId = this.buildId(this.selectedOption)
        const infos = unique.map( option => ({
            option,
            id: this.buildId(option),
            tags: this.getWayTags(option),
            compass: this.getOptionText(option),
            heading: this.getOptionHeading(option),
            roundabout: !!option.roundabout
        }))

        // numbering and order: left to right as the roads leave the junction. 
        // The internal order (default option first) is not touched, as it is also used for the colors
        const order = getLayoutOrder(infos.map( i=> ({direction: i.option.direction, roundabout:i.roundabout })))
        const ordered = order.map( idx => ({...infos[idx], defaultIdx:idx}))
        const labels = buildOptionLabels(ordered.map( i=> ({ id:i.id, direction:i.option.direction, roundabout:i.roundabout, compass:i.compass, tags:i.tags})))

        const result = ordered.map( (info,pos) => {
            const {option,id,compass,heading,defaultIdx} = info
            const selected = id === selectedId
            const color = this.getOptionColor(defaultIdx, { isStartPos: false, selected})
            const label = labels[pos]

            const uiOption:FreeRideOption = { 
                id, color, text:compass, path: this.getPath(option), selected, direction:option.direction,
                index: pos+1, maneuver: label.maneuver, maneuverText:label.maneuverText, 
                compass, heading, roadName: label.roadName, roadLabel: label.roadLabel, 
                isDefault: defaultIdx===0, degraded: label.degraded
            }
            if (selected)
                uiOption.selectedBy = this.selectedBy
            option.ui = uiOption
            return uiOption
        })

        return result
    }


    protected buildStartOptions():FreeRideOption[] {
        const opts = this.startOptions??[]
        

        if (opts.length<1)
            return []

        const build = ( option:FreeRideContinuation, color:string, text:string):FreeRideOption => {
            const id = this.buildId(option)
            const {roadName,roadLabel} = getRoadLabel(this.getWayTags(option))
            const compass = this.getOptionText(option)
            const uiOption:FreeRideOption = {id,color,text,path:this.getPath(option), compass, heading:this.getOptionHeading(option), roadName, roadLabel}
            option.ui = uiOption
            return uiOption
        }

        if (opts.length<2) {
            return [build(opts[0],'blue','OK')]
        }

        return opts.map( (option,idx) => build(option, this.getOptionColor(idx, {isStartPos:true}), this.getOptionText(option)) )
    }

    protected getWayTags(option:FreeRideContinuation):Record<string,string>|undefined {
        try {
            const map = option?.map ?? (option?.path?.length ? this.getMapArea().getMap(option.path[0]) : undefined)
            return map?.getWay(option?.id)?.tags
        }
        catch {
            return undefined
        }
    }

    protected getOptionHeading(option:FreeRideContinuation):number|undefined {
        const path = option?.path??[]
        if (path.length<2)
            return undefined
        const heading = getHeadingBetween(path[0],path[1])
        return Number.isFinite(heading) ? ((heading % 360)+360)%360 : undefined
    }

    protected getOptionsLogProps() {
        const options = this.options??[]
        const named = options.filter( o => { const t = this.getWayTags(o); return !!(t?.name||t?.ref) }).length
        const degraded = options.filter( o => !Number.isFinite(o.direction) ).length
        return { count: options.length, named, degraded }
    }

    protected getSelectionLogProps() {
        const options = this.options??[]
        const selected = this.selectedOption
        const idx = selected ? options.findIndex( o=> this.buildId(o)===this.buildId(selected)) : -1
        const tags = this.getWayTags(selected)

        const props:Record<string,string|number|boolean> = { by: this.selectedBy, count: options.length }
        if (idx>=0) {
            props.index = idx+1
            props.named = !!(tags?.name || tags?.ref)
            if (Number.isFinite(selected.direction))
                props.direction = Math.round(selected.direction)
        }
        return props
    }

    protected async getStartOptions(map:IMapArea, rideSeq:number = this.rideSeq) {
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

        // a ride might have been started while the options were calculated
        if (rideSeq !== this.rideSeq) {
            this.logEvent({message:'start options update ignored', reason:'ride started'})
            return
        }

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
            if (position.lat===undefined || Number.isNaN(position.lat) || position.lng===undefined|| Number.isNaN(position.lng)) {
                return DEFAULT_POSITION
            }
            return position
        }
        catch {
            return DEFAULT_POSITION
        }
    }

    protected getOptionText(option:FreeRideContinuation):string {
        const heading = this.getOptionHeading(option)
        return heading===undefined ? undefined : getCompassWord(heading)
    }

    protected getOptionColor(idx:number, props?:{isStartPos?:boolean,selected?:boolean}):string {

        // no green: green marks the road that will be taken
        if (props?.isStartPos) { 
            const colors = [ '#e5484d','#3e8ef7','#d23fa0','#14a3b8','#8b5cf6','#a0643c'] 
            return colors[idx % colors.length]
        }

        if (props?.selected)
            return '#8dc100'

        const colors = ['red', 'purple', 'magenta', 'orange', 'brown','royalblue', 'teal', 'deeppink']
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