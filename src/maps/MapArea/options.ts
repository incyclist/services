import { EventLogger } from "gd-eventlog";
import clone from "../../utils/clone";
import { FreeRideContinuation, GetNextOptionProps, IMapArea, IMapAreaService, IncyclistNode, IncyclistWay, PathCrossingInfo, WayInfo } from "./types";
import { concatPaths, isAllowed, isOneWay, isRoundabout, pointEquals, removeDuplicates, splitAtIndex, splitAtPoint  } from "./utils";
import { calculateDistance } from "../../utils/geo";
import { waitNextTick } from "../../utils";

export class OptionManager {
    
    protected logger:EventLogger 
    constructor( protected service: IMapAreaService, protected map?: IMapArea) {
        this.logger = new EventLogger('OptionManager')
    }

    setMap(map:IMapArea) {
        this.map = map
    }

    async getStartOptions( way:IncyclistWay, crossing:PathCrossingInfo ): Promise<Array<FreeRideContinuation>> {
        const options: Array<FreeRideContinuation> = []
        const parts = this.map.splitAtCrossingPoint(way,crossing)
        const {segments,points} = this.map.buildSegmentInfo(way,parts)
        

        
        for (const segment of segments) {
            try {
                const path =segment.path

                const opts = await this.getNextOptions(segment)
    
                // if there is only one continuation option, extend the path
                if (opts?.length===1) {

                    // same route, just extend path
                    if ( opts[0].id !== segment.id) { 
                        concatPaths( path, opts[0].path,'after' )    
                    }
                    else {
                        // different route, which might include a point we already have
                        let foundSameSegment = false;
                        options[0].path.forEach( (point,j) => {
                            if (j===0)
                                return;
                            foundSameSegment =  (points.find ( pAll => pAll.id===point.id)!==undefined)
                        } )
                        if ( !foundSameSegment) {
                            concatPaths( path, opts[0].path,'after' )        
                        }
                    }
                }
                const option = {id:segment.id,path,map:this.map}
                options.push(option);
                await waitNextTick()
    
            }
            catch(err) {
                this.logError(err,'getStartOptions')
            }

        }
            
            


        
        // TODO

        return options

        
    }

    async getNextOptions( from:WayInfo|FreeRideContinuation, props?:GetNextOptionProps ): Promise<Array<FreeRideContinuation>> {

    
        if (from?.id===undefined || from?.path===undefined || from?.path.length<1)  {
            return []
        }

        // ensure we have a proper way object (not just the WayInfo)
        const way = {...this.getWay(from.id),path:from.path}

        // get last location of way, if it has no id, get second to last 
        let location = way.path[way.path.length-1];
        if (location.id===undefined) {
            if (way.path.length>1)
                location = way.path[way.path.length-2];
            else {
                return []
            }
        }

        // get updated map (if required)
        const map = await this.service.load(location)

        if (!map)  {
            if (!this.map)
                return []
        }
        else {
            this.setMap(map)
        }


        // get node and remaining part of way
        const node = this.getNode(location);
        const remaining = this.getRemaining(way);

                
        let options:Array<FreeRideContinuation> = [];

        if (node!==undefined ) {
            node.ways.forEach( (wid) => {
                if ( wid===remaining.id) {
                    options = this.getOptionsOnCurrentWay(node,remaining,options)           
                }
                else {
                    const w = this.getWay(wid);
                    options = this.checkOptionsOnDifferentWay(node,w,options)         
                }
            })
                
        }

        const currentDirection = this.map.getHeading(way, 'end');
        options.forEach( (option) => {
            const direction = this.map.getHeading(option as WayInfo, 'start');
            option.direction = direction-currentDirection
            if (option.direction>180) 
                option.direction = option.direction-360;
        })

        this.sortOptions(options)

        if (props?.minDistance) {
            await this.checkMinDistance(options,props.minDistance)
        }


        return options;        
    }

    protected sortOptions(options:Array<FreeRideContinuation>) {

        //TODO
/*
            options.sort((a, b) => {
                let dA = a.direction;
                let dB = b.direction;
    
                if (dA > 180) dA = dA - 360;
                if (dB > 180) dB = dB - 360;
                if (dA > dB) return 1
                if (dA < dB) return -1;
                return 0;
            })
*/
    }


    protected async checkMinDistance(options:Array<FreeRideContinuation>,minDistance:number) {
        // TODO: if any of the options is less than minDistance( in meters), add branches to these options

        for (const option of options) {
            if (option?.path?.length > 0) {
                const distance = this.getDistance(option.path);
                if (distance < minDistance) {
                    const branches = await this.getNextOptions(option,{minDistance:minDistance-distance});
                    option.options = branches??[]
                    
                }
            }
        };
    }



    protected getDistance(path:IncyclistNode[]):number {
        if (!path || path.length<2)
            return 0;
        let distance = 0;

        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            const s = calculateDistance(p1.lat,p1.lng,p2.lat,p2.lng);
            if (s!==undefined && !isNaN(s)) 
                distance += s;
        }
        return distance;
    }

    protected checkOptionsOnDifferentWay(location:IncyclistNode,w:IncyclistWay,options:FreeRideContinuation[] ):FreeRideContinuation[]{
        if (!w?.path || !location) return;

        let roundabout = isRoundabout(w);
        if (roundabout)
            return this.getOptionsRoundabout(location,w,options);
        
        if (w.path[0].id===location.id ) {
            this.getOptionsFirstPoint(location,w,options);
        }
        else if (w.path[w.path.length-1].id===location.id) {
            this.getOptionsLastPoint(location,w,options);
        }
        else {
            this.getOptionsMiddle(location,w,options);
        }    
        
        return removeDuplicates(options);

    }


    protected getOptionsFirstPoint(location:IncyclistNode,w:IncyclistWay,options:FreeRideContinuation[] ){ 
        let result = this.map.splitAtFirstBranch(w);
        let expand = false;

        // no crossing before end of path
        if ( result.path.length === w.path.length) {
            const pLast = w.path[ w.path.length-1];
            if ( pLast.ways.length===2 ) {
                const wIdNext = pLast.ways.find( wid => wid!==w.id )
                const wNext = this.getWay(wIdNext) 
                if (!isRoundabout(wNext)) {
                    
                    // if we are at the beginning or end of the next way
                    const pNextStart = wNext.path[0];
                    const pNextEnd = wNext.path[ wNext.path.length-1];
                    if ( pNextStart.id===pLast.id   ) {
                        expand = true;
                        const segment = this.map.splitAtFirstBranch(wNext)
                        const combined  = { 
                            id: segment.wayId,
                            path: w.path.concat( segment.path.slice(1) ),
                            map:this.map
                        }
                        options.push(combined)
                    }
                    else if ( pNextEnd.id===pLast.id ) {
                        const wReverse = this.getRemaining(wNext);
                        if (wReverse?.path ) {
                            wReverse.path.reverse();
                            const segment = this.map.splitAtFirstBranch(wNext)
                            const combined  = { 
                                id: segment.wayId,
                                path: w.path.concat( segment.path.slice(1) ),
                                map:this.map
                            }
                            options.push(combined)
                        }
                        else {
                            console.log(' ~~~~ unexpected', wNext, wReverse)
                        }
                    }
                    else { // we are in the middle of the next way
                        const idxSplit = wNext.path.findIndex( (p) => p.id===pLast.id );
                        if (idxSplit!==1) {
                            const nextPaths = splitAtIndex( wNext, idxSplit);
                            nextPaths.forEach( (p) => {   
                                

                                if ( p[0].ways.find( wid => wid===w.id )) {
                                    expand = true;

                                    const wFull = {...this.map.getWay(wIdNext),path:p.slice(1)};
                                    const segment = this.map.splitAtFirstBranch(wFull);
                                    const combined  = {
                                        id: segment.wayId,
                                        path: w.path.concat( segment.path.slice(1) ),
                                        map:this.map
                                    }

                                    options.push(combined)
                                }
                                else if ( p[p.length-1].ways.find( wid => wid===w.id )) {
                                    expand = true;
                                    p.reverse()
                                    const wFull = {...this.map.getWay(wIdNext),path:p};
                                    const segment = this.map.splitAtFirstBranch(wFull);

                                    const combined  = {
                                        id: segment.wayId,
                                        path: w.path.concat( segment.path.slice(1) ),
                                        map:this.map
                                    }
                                    options.push(combined)
                                }
                            })
                        }


                    
                    }

                }
            }

        }

        if (!expand)
            options.push({id:result.wayId,path:result.path,map:this.map});
        

    }


    protected getOptionsLastPoint(location:IncyclistNode,w:IncyclistWay,options:FreeRideContinuation[] ){ 
        w.path.reverse();
        const result = this.map.splitAtFirstBranch(w);
        const onewayReverse = isOneWay(w)        
        options.push({id:result.wayId, path:result.path, onewayReverse,map:this.map});

    }

    protected getOptionsMiddle(location:IncyclistNode,w:IncyclistWay,options:FreeRideContinuation[] ){ 
        let ways = splitAtPoint(w,location);
        if ( !ways[0].onewayReverse ) {
            const result = this.map.splitAtFirstBranch( ways[0]);
            options.push({id:result.wayId, path:result.path,map:this.map});
        }
        if ( !ways[1].onewayReverse ) {
            const result = this.map.splitAtFirstBranch(ways[1]);
            options.push({id:result.wayId, path:result.path,map:this.map});
        }

    }

    protected getOptionsRoundabout(location:IncyclistNode,w:IncyclistWay,options:FreeRideContinuation[] ){
        let r =  splitAtPoint(w,location);
        if (!r?.length)
            return;

        let path=[];
        
        r[0].path.forEach( (p,idx) => {

            if (idx===0) {
                path.push(p);    
                return;                                    
            }

            if (p.ways.length>1) {
                p.ways.forEach ( owid => {
                    if (owid!==w.id) {
                        let ow = clone(this.map?.getWay(owid));
                        if (ow!==undefined) {
                            if ( !isAllowed(ow,p)) 
                                return;

                            if ( ow.path[ow.path.length-1].id === p.id)
                                ow.path.reverse();
                            let optPath1 = this.map.splitAtFirstBranch(ow);
                            let optPath  = [...path];
                            optPath.push(...optPath1.path)
                            let o = {
                                roundabout:w.id,
                                id: ow.id,
                                path: optPath,
                                map: this.map
                            }
                                options.push(o);    
                        }

                    }

                }) 
            }
            path.push(p);  
        })

        return removeDuplicates(options);

    }




    /**
     * Given a way ID or a way object (with id/path properties), return a clone of the way.
     * If no argument is given, return undefined.
     * @param props - either a string (way ID) or an object with id/path properties
     * @returns a clone of the way
     */
    protected getWay( props:string|IncyclistWay):IncyclistWay {
        if (!props) return;

        if ( typeof props === 'string') {
            return clone(this.map?.getWay(props))
        }
        if ( props.id !==undefined)
            return clone(this.map?.getWay(props.id));
    }

    /**
     * Given a node ID or a node object (with lat/lng/ways), return a clone of the node.
     * If no argument is given, return the current location.
     * @param props - either a string (node ID) or an object with lat/lng/ways properties
     * @returns a clone of the node
     */
    protected getNode( props?:string|IncyclistNode):IncyclistNode {
        if (!props) return this.map.getQueryLocation();

        if ( typeof props === 'string') {
            return clone(this.map?.getNode(props))
        }
        if ( typeof props === 'object' && props.id===undefined && props.lat!==undefined && props.lng!==undefined && props.ways!==undefined) {
            return clone(props)
        }
        if ( props.id !==undefined) {
            return clone(this.map?.getNode(props.id));
        }
    }


    /**
     * Retrieves the remaining path of a given partial way.
     *
     * This function takes a partial way and determines the remaining path 
     * by comparing the last two points of the partial path with the original path.
     * If the way is part of a roundabout, it returns the original way with a roundabout flag.
     * Otherwise, it slices the original path to get the remaining path after the last point
     * of the partial path. If the path is in reverse order, it reverses the sliced path.
     *
     * @param partial - The partial way whose remaining path needs to be determined.
     * @returns The original way with the updated remaining path and a roundabout flag if applicable.
     */

    getRemaining (partial:IncyclistWay): IncyclistWay {

        const originalWay= this.getWay(partial) 
        const path=originalWay.path;
        const roundabout = isRoundabout(originalWay);
        if (roundabout)
            return {...originalWay, roundabout}

        let newPath = path;
    
        const last = partial.path[partial.path.length-1];
        const prev = partial.path[partial.path.length-2];

        const idxLast = path.findIndex( (p) => pointEquals(p,last) )
        let idxPrev = path.findIndex( (p) => pointEquals(p,prev) )
        if (idxPrev===-1) idxPrev = this.findClosestPoint(path,prev, last);


        // check if we are already at the end
        let lastOriginal;
        if (idxPrev>idxLast) {
            lastOriginal = originalWay.path[0];
        }
        else  {
            lastOriginal = originalWay.path[originalWay.path.length-1];
        }       
        if (last.id===lastOriginal.id) {
            return {...originalWay,path:[],roundabout:false}
        }

        // copy remaining part of original path
        if (idxLast!==-1 && idxPrev!==-1) {               
            if ( idxPrev<idxLast) // original path is in the same order
                newPath = path.slice(idxLast)
            else {
                newPath = path.slice(0,idxLast+1);
                newPath.reverse();
            }
        }
    
        return {...originalWay,path:newPath,roundabout};
    }

    protected findClosestPoint(path:IncyclistNode[],point:IncyclistNode,exclude:IncyclistNode) {
        let found=-1;
        let minDistance = Number.MAX_VALUE;
        path.forEach( (p,i) => {
            if (p.id!==exclude.id) {
                const d = calculateDistance(p.lat, p.lng,point.lat,point.lng);
                if (d<minDistance) {
                    minDistance = d;
                    found = i;
                }
            }
        })
        return found        
    }
    
    getOptionsOnCurrentWay (location:IncyclistNode,way:IncyclistWay,options:Array<FreeRideContinuation>):Array<FreeRideContinuation> {

        try {
            if ( way.path.length>1) {
                let prev = way.path[way.path.length-2];
                const w = this.getWay(way)
                if (w.roundabout) {
                    let branches = splitAtPoint(w,location);
                    branches.forEach ( b => {
                        if (b.path.length>1 && b.path[1].id !== prev.id) {
                            const {id,path} = b
                            options.push({id,path,map:this.map})
                        }
                    })    
                }
                else if ( w.path.length>1) {
                    let result = this.map.splitAtFirstBranch(way);
                    options.push({id:result.wayId, path:result.path,map:this.map});
                }
                // don't add a single node way as option
                

            }
        }
        catch (e) {
            console.log(e)
        }

        return removeDuplicates(options)

    }


    protected logError(err:Error, fn:string, args?) {
        const logInfo = args ?? {}

        this.logger.logEvent({message:'Error', fn, ...logInfo, error:err.message, stack:err.stack})
    }





}



