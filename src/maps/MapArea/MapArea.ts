import { EventLogger } from "gd-eventlog";
import { calculateHeaderFromPoints, LatLng } from "../../utils/geo";
import { Boundary, FreeRideDataSet, IMapArea, IncyclistNode, IncyclistWay, IncyclistWaySplit, NearestPathInfo, PathCrossingInfo, SegmentInfo, SplitPointInfo, WayInfo } from "./types";
import { distanceToPath, generateID, isOneWay, isRoundabout, isWay, isWithinBoundary, splitAtPoint, splitAtPointInfo } from "./utils";
import clone from "../../utils/clone";

/**
 * Represents a geographical area on a map, providing methods to interact with and manipulate map data.
 * 
 * The `MapArea` class is designed to handle operations related to a specific area on a map, such as querying
 * nodes, ways, boundaries, and performing operations like splitting paths, detecting roundabouts, and finding
 * the nearest paths to a given location. It also includes utility methods for managing and correcting map data.
 * 
 * This class works with OpenMap data structures, where:
 * - An OpenMap node represents a geographical point with coordinates.
 * - An OpenMap way represents a path or road connecting multiple nodes.
 * 
 * OpenMap specification details can be found at: https://wiki.openstreetmap.org/wiki/Elements
 * 
 * @template FreeRideDataSet - The dataset containing map data, including nodes, ways, and lookup tables.
 * @template IncyclistNode - Represents an OpenMap node in the map, typically a point with geographical coordinates.
 * @template IncyclistWay - Represents an OpenMap way in the map, typically a path or road connecting nodes.
 * @template Boundary - Represents the geographical boundary of the map area.
 * 
 * @class
 * 
 * @example
 * // Create a new MapArea 
 * const data = await useMapArea().load({lat:10,lng:20});
 * 
 * // Check if a location is within the boundary
 * const isWithin = mapArea.isWithinBoundary({ lat: 12, lng: 22 });
 * console.log(isWithin); // true or false
 * 
 * // Get the nearest path to a point
 * const nearestPath = mapArea.getNearestPath({ lat: 11, lng: 21 });
 * console.log(nearestPath);
 * 
 * // Split a way at the first branching point
 * const way = mapArea.getWay('123');
 * const splitResult = mapArea.splitAtFirstBranch(way);
 * console.log(splitResult);
 */


export class MapArea implements IMapArea{
    protected data: FreeRideDataSet
    protected queryLocation:IncyclistNode
    protected bounds: Boundary
    protected logger: EventLogger
    protected lastUsed: number
    

    constructor( data: FreeRideDataSet, queryLocation:IncyclistNode, bounds:Boundary) {
        this.data = data
        this.queryLocation = queryLocation
        this.bounds = bounds
        this.logger = new EventLogger('MapArea')
        this.lastUsed = Date.now()
        this.correctRoundabouts()
    }

    getQueryLocation():IncyclistNode {
        return this.queryLocation
    }

    getBoundary():Boundary {
        return this.bounds  
    }

    getWays():IncyclistWay[] {
        this.lastUsed = Date.now()
        return this.data.ways
    }

    getWay(id:string):IncyclistWay {
        this.lastUsed = Date.now()

        return this.data.waysLookup[id]
    }

    getNode(id:string):IncyclistNode {
        this.lastUsed = Date.now()
        return this.data.nodesLookup[id]
    }

    getStats():Record<string,number> {
        return this.data.typeStats
    }

    getLastUsed():number {
        return this.lastUsed
    }



    /**
     * Check if a given location is within the boundaries of this MapArea.
     * @param location the location to check
     * @returns true if the location is within the boundaries, false otherwise
     */
    isWithinBoundary(location:LatLng):boolean {
        this.lastUsed = Date.now()

        return isWithinBoundary(location, this.bounds)
    }


    /**
     * Returns the nearest path to the given point.
     * 
     * As the location set be the user may be outside of a (openmap) way, the function tries to find the nearest way & path to the location.
     * 
     * @param point the point to which we want to find the nearest path
     * @returns an object with the nearest  openmap way, the path and its distance to the location given
     */
    getNearestPath(point:IncyclistNode):NearestPathInfo {
        this.lastUsed = Date.now()

        const ways = this.data?.ways??[]

        if (!ways?.length )
            return;

        let w;
        let min = { path:undefined, distance:undefined, way:undefined  };
        
        for ( w of ways) {
            let distance = distanceToPath(point,w)
            if (distance!==undefined && (min.distance===undefined || distance<min.distance))  {
                min.distance = distance; 
                min.path = w.path
                min.way = w;
            }
        }

        return min;
    }


    /**
     * Identifies the first branching point in a given way.
     *
     * This function iterates through the nodes of a given way and checks if there is a branching point
     * where multiple ways intersect. It returns information about the first such branching point found, 
     * if any. The function ignores the first node in the path and can optionally ignore a specified way ID.
     *
     * @param way - The way to evaluate, which can be of type IncyclistWay or WaySplitInfo.
     * @param ignore - An optional way ID to ignore when determining branches.
     * @returns A SplitPointInfo object containing the branching point, its index, and an array of branches,
     *          or undefined if no branching point is found.
     */
    getFirstBranch(way:WayInfo,ignore?:string):SplitPointInfo {
        this.lastUsed = Date.now()

        if (way?.path===undefined)
            return;

        let pFound = undefined
        way.path.forEach( (node,idx)=> {

            if (idx===0 || node?.ways?.length<2 || pFound)
                return

            const branches = [];
            
            node.ways?.forEach( (wid) => {
                if (wid===way.id)
                    return;
                const branch = this.getWay(wid);

                // ignore one way streets that are crossing
                if (isOneWay(branch) && branch.path[branch.path.length-1].id===node.id) 
                    return;

                // we can specify ways to ignore 
                if (ignore && wid===ignore) 
                    return
                    
                branches.push(wid) 
            })

            pFound =  branches.length>0 ? {point:node,idx,branches} : undefined;
        }); 

        return pFound;
    }



    /**
     * Splits the given way at the first branching point.
     * 
     * This function identifies the first branching point in the path of the given way
     * and splits it into two segments: the main way and its branches. 
     * The main way is returned as the path up to the first branching point, 
     * and any additional paths from the branching point are treated as branches.
     * 
     * @param way - The way to split, which can be of type IncyclistWay or WaySplitInfo.
     * 
     * @returns An object of type IncyclistWaySplit containing the main way up to the first branch
     *          and an array of branches if any exist.
     */
    splitAtFirstBranch(way:WayInfo):IncyclistWaySplit {
        this.lastUsed = Date.now()

        if (way?.path===undefined)
            return;

        const path = [...way.path]
        const original = clone(way)
        
        const crossing = this.getFirstBranch(way);
        // no branches, we need to return the whole path ans keep branches empty
        if (!crossing) {

            return {
                wayId: original.id ,
                path,
                branches: []
            }
        }

        let result:IncyclistWaySplit = {
            wayId: way.id,
            branches: []
        }

        // split the way to a part before and after the crossing
        const [before,after] = splitAtPointInfo(way,crossing);
        result.path = before;

        // add remining part of same way as frist (prefered) branch
        const prefered= {id:way.id,path : after};
        if (prefered.path.length>1)
            result.branches.push(prefered);

        // add other branches ( ways crossing the same point )
        crossing.point.ways.forEach( (wid)=>{
            const option = this.getBranch(crossing,way.id,wid)
            if (option)
                result.branches.push(option)
        })



        //console.log('splitAtFirstBranch',way,'=>',result)
        return result
    }


    /**
     * Splits a way at a given crossing point and generates possible paths.
     *
     * This function evaluates the provided way and a crossing point to split the way into multiple segments.
     * The split is performed at the specified index of the crossing point. The function then generates
     * potential paths from the split point, considering various branches that may intersect at the crossing.
     * 
     * If the way has only a single point, the function checks for additional paths branching from that point
     * and includes them as options if they are not the current way. Reverses the path if needed to ensure
     * the correct starting point at the crossing.
     * 
     * The function does not consider potential additional crossings on the way itself, ie. it will always provide 
     * the full path before and after the crossing point.
     * 
     * @param way - The way to be split, which can be of type IncyclistWay or WaySplitInfo.
     * @param crossing - The crossing information including the index and point where the split occurs.
     * @returns An array of IncyclistWaySplit objects representing the split paths and branches.
     */

    splitAtCrossingPoint(way:IncyclistWay,crossing:PathCrossingInfo):Array<IncyclistWaySplit> {
        this.lastUsed = Date.now()

        if ( way?.path===undefined || crossing?.idx===undefined || crossing?.point===undefined)
            return;

        const {point,idx: crossingIdx,distance} = crossing

        const addWaysCrossing = (res:Array<IncyclistWaySplit>) =>{
            let optWay = way;
            point.ways.forEach(optId => {
                if (optId === way.id)
                    return;

                optWay = this.getWay(optId);
                if (!optWay?.path?.length)
                    return;

                if (optWay.path[optWay.path.length - 1].id === point.id)
                    optWay.path.reverse();
                
                else if (optWay.path[0].id !== point.id) {  // crossing in the middle of the street                    
                    const parts = splitAtPoint(optWay,point).filter(p=>p.path.length>1 && !p.onewayReverse);
                    parts.forEach(p=>res.push({wayId:p.id,path:p.path}));
                    return
                }

                if (optWay.path.length > 1)
                    res.push({ wayId: optWay.id, path: optWay.path });

            });
        }

        const addOption = (newPath:IncyclistNode[], res:Array<IncyclistWaySplit>, reverse:boolean) =>{
            let optWay = way;
            let path = []

            // in case the crossing point is exactly at the beginning or end of a way ( i.e. street)
            // we need to add the streets crossing at that point as options
            if (newPath.length===1 ) {
                addWaysCrossing(res);                
            }
            else if (newPath.length>1) {
                if (newPath.length===way.path.length && newPath[0].id===crossing.point.id && crossing.distance===0 &&
                    (newPath[0].id===way.path[0].id || 
                    newPath[0].id===way.path[way.path.length-1].id)) {
                        addWaysCrossing(res);                
                    }


                path = newPath
                if (reverse)
                    path.reverse();
                res.push({wayId:optWay.id,path})


            }
        }

        const res = [];
        let newPath=[];

        if (!point.ways)
            point.ways = [ way.id];



        way.path.forEach(  (p,i) => {
            if (i<crossingIdx || i>crossingIdx ) {
                newPath.push(p);
            }
            else  {
                if ( newPath?.length>0 && point.id!==newPath[newPath.length-1].id)
                    newPath.push( point);

                if (!isOneWay(way)) {
                    addOption(newPath,res,true)                    
                }

                newPath=[];
                newPath.push(point);
                if (point.id!==p.id)
                    newPath.push(p)
            }
        });

        addOption(newPath, res, false);

        

        return res;

    }


    /**
     * Constructs segment information from provided path options.
     *
     * This function processes an array of path options and splits each option
     * at its first branching point. It returns an object containing the segments
     * and points from these splits.
     *
     * @param from - The original way from which the path options are derived.
     * @param parts - An array of path options (result of previous split operation).
     * 
     * @returns An object containing:
     *          - segments: An array of segments, each with an ID and path, constructed
     *                      from splitting the path options at their first branching point.
     *          - points: An array containing all points that are included in any of these segments
     */

    buildSegmentInfo(from:IncyclistWay, parts:Array<IncyclistWaySplit>):SegmentInfo {
        this.lastUsed = Date.now()

        const segments = [];
        const points = [];

        parts.forEach( (option,i) => {
            const {wayId,path} = option
            const wayOriginal = this.getWay(wayId??from.id);

            if (path) {
                const wayOption = { ...wayOriginal, path};            
                let res = this.splitAtFirstBranch(wayOption)
                segments.push( {id:res.wayId,path:res.path})    
                points.push( ...res.path );    
            }
        })
        
        return {segments,points}

    }


    /**
     * Returns the direction (heading) of a street.
     * @param way    the way as returned by the MapArea
     * @param position  'start' (default) returns the direction when entering the street
     *                  'end'     returns the direction when leaving the street
     * @returns the direction in degrees as a number
     */
    getHeading(way:WayInfo, position:'start'|'end'='start'):number {
        this.lastUsed = Date.now()

        if ( way?.path?.length<2)
            return;
        let fullWay = this.getWay(way.id);
        
        if (!fullWay.roundabout && position==='start' )  // entering normal street
            return calculateHeaderFromPoints(way.path[0],way.path[1]);
        else if (position==='end') // leaving street
            return calculateHeaderFromPoints(way.path[way.path.length-2],way.path[way.path.length-1]);
        else {  // enteriong roundabout
            let heading = calculateHeaderFromPoints(way.path[0],way.path[1]);

            
            if ( fullWay.path.length>1){
                heading = calculateHeaderFromPoints(fullWay.path[0],fullWay.path[1]);
            }
        return heading

        }

    }



    /**
     * Processes all roundabouts in the map data.
     *
     * This function corrects the roundabouts in the map data by:
     * - Collecting all roundabouts (ways with tag roundabout=yes) or with first and last point equal
     * - Correcting roundabouts that consist of multiple ways into one Way and deleting the original ways
     * - Setting the roundabout tag on each roundabout
     *
     * The function does not return anything and is intended to be called
     * during the map loading process.
     */
    protected correctRoundabouts():void {
        let multiWayRoundabouts = [];   // roundabout is tagged as roundabout in OpenMap and consist of multiple ways
        let roundaboutsImplicit = [];   // roundabout with single way having first and last point are equal / may  not be tagged as roundabout
      

        try {
            // retrieve all roundabouts
            this.data?.ways.forEach( way => {
                if ( isRoundabout(way,true) ) {
                    let ways = this.collectRoundaboutWays(way);
                    if (ways?.length<2)  {
                        return;
                    }
                    let id = generateID(ways);
                    let found =  multiWayRoundabouts.find( e => e.id===id)
                    if (!found) {

                        const idxMatching = multiWayRoundabouts.findIndex( r => {
                            for (const w of ways) {
                                if (r.ways.includes(w)) {
                                    return true;
                                }
                            }
                            return false;
                        })
                        if (idxMatching>=0) { 
                            const matching = multiWayRoundabouts[idxMatching];
                            if (matching.ways.length<ways.length) {
                                multiWayRoundabouts[idxMatching] = {id,ways}
                                return
                            }
                        }
                        
                        found = (way.path[0].id===way.path[way.path.length-1].id);
                        if (found) {
                            roundaboutsImplicit.push(way);
                        }


                    }
                    if (!found) multiWayRoundabouts.push( {id,ways})
                }
                else if  (isRoundabout(way,false)) {
                    roundaboutsImplicit.push(way);
                }
            } )

            multiWayRoundabouts.forEach( ri => {

                let originalNodes = [];
                if (ri.ways.length<2) {
                    return
                }

                // 1st pass: collect nodes
                ri.ways.forEach( (wid,i) => {
                    let way = this.getWay(wid);
                    if (way===undefined)
                        return;
                    let path = way.path;
                    path.forEach( n => {
                        if ( originalNodes.length===0 ||
                                originalNodes[originalNodes.length-1]!==n.id)
                            originalNodes.push(n.id)                    
                    })
                })

                // 2nd pass: replace way IDs and collect original Ways
                ri.ways.forEach( (wid,i) => {
                    let way = this.getWay(wid)
                    this.replaceWayID(way,ri.id,i===0) 
                })

                // 3nd pass: combine nodes
                let roundabout = this.getWay(ri.id)
                roundabout.path = [];
                originalNodes.forEach( nid => {
                    let node = this.getNode(nid)
                    roundabout.path.push(node);
                })

                roundabout.tags.roundabout = 'yes';
            })    

            roundaboutsImplicit.forEach( roundabout => {
                if ( roundabout.tags===undefined)
                    roundabout.tags = {}
                roundabout.tags.roundabout = 'yes';
            })
                

        }
        catch (err) {
            this.logError(err,'correctRoundabouts')
        }
        
    }


    /**
     * Collects all ways that are belonging to the same roundabout into an array
     * @param {IncyclistWay} way to be evaluated
     * @returns {String[]} Array containing all IDs of ways that belong to this roundabout
     */
    protected collectRoundaboutWays   (way:IncyclistWay): Array<string>  {
        if (!isRoundabout(way,true))
            return undefined;
            
        const contains = (ways,wid) => {
            let found =  ways.find( id=> id===wid);
            return found!==undefined;
        }

        const addNodes = ( ways,way) => {
            const crossings = way.path.filter( (n,idx) => idx!==0 && n.ways?.length>1)

            crossings.forEach( n => {
                n.ways.forEach( wid => {
                    let w = this.getWay(wid)
                    if ( isRoundabout(w,true) && wid!==way.id && !contains(ways,wid)) {
                        ways.push(wid);
                        addNodes(ways,w)
                    }
                });    
            })    
        }

        let ways = [way.id];
        addNodes(ways,way);
        return ways;
    };

    /**
     * returns a branch, which is a way with a give id that starts at a crossing point and ends at the first branch
     * 
     * @param crossing - The crossing point
     * @param wayId - The id of the current way leading to the crossing point
     * @param targetId - The id of the way to check
     * @returns A branch of the way, or undefined if it is not a branch
     * 
     * The method checks if the way is a branch of the current way. If it is, it will be ignored
     * 
     * A branch is the part of a way that starts at the given crossing point and ends at the first crossing point on that way.
     * The branch is reversed if the given crossing point (starting point) is the last point of the branch.
     * 
     */
    protected getBranch(crossing:SplitPointInfo,wayId:string, targetId:string ) { 

        let w = clone(this.getWay(targetId));

        // nothing to do: it is the same way (i.e. was already added)
        if ( w?.id===wayId)
            return 


        
        // crossing is first point of branch
        if (w.path[0].id === crossing.point.id) {
            const res = this.getUntilFirstBranch(w,{ignore:wayId})
            if (res.path.length>1)
                return res
                

        }
        // crossing is last point of branch
        else if (w.path[w.path.length-1].id===crossing.point.id) {
            w.path.reverse();
            const res = this.getUntilFirstBranch(w,{ignore:wayId})
            if (res.path.length>1)
                return res
        }
        else { // crossing somwhere in the middle 
            let branches = splitAtPoint(w,crossing.point)

            let res = this.getUntilFirstBranch(branches[0],{ignore:wayId})
            if (res.path.length>1)
                return res

            res = this.getUntilFirstBranch(branches[1],{ignore:wayId})
            if (res.path.length>1)
                return res

        }

    }



    /* replaces the ID of a given way 
    * @param {MapAreay.way} way 
    * @param {String} newId 
    * @param {boolean} replaceLookup defines if the waysLookup entry should be replace 
    */
    protected replaceWayID   (way:IncyclistWay,newId:string,replaceLookup:boolean=true):IncyclistWay  {
        if (way===undefined || newId===undefined || way.id===undefined || way.path===undefined || !this.data) return;

        let oldId = way.id;
        let w = this.getWay(oldId)

        if (oldId===newId)
            return w;

        w.originalId = w.id;
        w.id = newId;
        w.path.forEach( (nx,j) => {
            w.path[j] = this.getNode(nx.id);
            let n = w.path[j];
            n.ways.forEach( (wid,i) => { if (wid===oldId) n.ways[i] = newId })
            // remove duplicates
            n.ways = [ ...new Set(n.ways)]
        })

        if(replaceLookup)
            this.data.waysLookup[newId] = w;
        delete this.data.waysLookup[oldId];
        return w;
    };    


    protected getUntilFirstBranch(w:WayInfo, props?:{reverse?:boolean, ignore?:string}):IncyclistWay {
        if (!w)
            return;

        const reverse = (props!==undefined) ? props.reverse : false;
        const ignore = (props!==undefined) ? props.ignore : undefined;
        let branch;

        let path = w.path;
        if (reverse) {
            w.path = [...path];
            w.path.reverse();
            path = w.path;
        }

        let piBranch = this.getFirstBranch(w,ignore);


        if (piBranch!== undefined) {
            branch={id:w.id,path:[]};
            path.forEach( (p,idx)=> {
                if ( idx<=piBranch.idx) branch.path.push(p)
            }); 
        }
        else {
            branch ={id:w.id,path:w.path}
        }
        return branch;
    }


    protected logError(err:Error, fn:string, args?) {
        const logInfo = args ?? {}

        this.logger.logEvent({message:'Error', fn, ...logInfo, error:err.message, stack:err.stack})
    }


}