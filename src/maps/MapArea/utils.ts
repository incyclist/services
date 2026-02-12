import { EventLogger } from "gd-eventlog";
import { Vector, geo } from "../../utils";
import { LatLng, crossing } from "../../utils/geo";
import { abs, cos, degrees, rad, sin } from "../../utils/math";
import { GET_WAYS_IN_AREA, MAX_DISTANCE_FROM_PATH, RADIUS_EARTH } from "./consts";
import { Boundary, CrossingInfo, IncyclistNode, OverpassResult, OverpassWay, IncyclistWay, FreeRideDataSet, SplitPointInfo, PathCrossingInfo, WayInfo } from "./types";
import { RoutePoint } from "../../routes/base/types";


export function addNode(node:number,nodesLookup:Record<string,IncyclistNode>,id:number,path:Array<IncyclistNode>):void {
    let point = nodesLookup[node];

    if (point!==undefined )
        path.push ( point)

    
    point.ways= point.ways??[];
    let found = point.ways.find ( e=> (e.toString()===id.toString()) );

    if (found===undefined) nodesLookup[node].ways.push(id.toString());
}



export function addWay(w:IncyclistWay,ways:Array<IncyclistWay>,waysLookup:Record<string, IncyclistWay>):void {
    if ( waysLookup[w.id]!==undefined)
        ways = ways.filter( e => e.id!==w.id )
    ways.push(w);        
    waysLookup[w.id.toString()] =w; 
}

export function updateTypeStats(types:Record<string,number>,type:string):void {
    let t = (type ?? '-');
    if (types[t]!==undefined)   
        types[t]++;
    else   
        types[t]=1;    
}



export function parseMapData(str:JSON|string,filter):FreeRideDataSet {
    if (str===undefined) 
        return;

    let data: OverpassResult

    if ( typeof(str)==='string') {
        try {
            data = JSON.parse(str);
        }
        catch (err) {
            const logger = new EventLogger('MapArea')
            logger.logEvent({message:"_parse: parsing error:",error:err.message, stack:err.stack})
            return;
        }    
    }
    else {
        data = str as unknown as  OverpassResult;
    }
    if ( data.elements===undefined)
        return;

    let nodesLookup:Record<string, IncyclistNode> = {};
    let waysLookup:Record<string, IncyclistWay> = {}
    let ways: Array<IncyclistWay> = []
    let types: Record<string,number> = {}
    let idx = 0;
    let id;

    // 1st pass search all nodes
    data.elements.forEach(element => {
        if (element.type==='node') {
            id =  ( element.id!==undefined && typeof  element.id ==='number' )  ? element.id.toString() : '_INT_'+idx;
            nodesLookup[element.id.toString()] = {  id, lat:element.lat, lng:element.lon, tags: element.tags} ;
            idx++;
        }
    });

    // 2nd pass search all ways, if node id is present, but lat/lon is missing enrich with node data
    idx=0;
    data.elements.forEach(element => {
        let path = [];
        if (element.type==='way') {

            const way = element as OverpassWay
            id =  ( element.id!==undefined && typeof  element.id ==='number' )  ? element.id.toString() : '_INT_'+idx;
            const name = element.tags?.name;
            const type = element.tags?.highway;

            // in some cases individual legs of a roundabout are tagged with highway=service, which would break the roundabout detection
            const isRoundabout = (element.tags?.junction==='roundabout' || element.tags?.roundabout==='true');

            if ( isRoundabout || (type!==undefined && (filter===undefined || filter.find( e => e===type)===undefined)) ) {

                way.nodes?.forEach( node => {
                    addNode(node, nodesLookup,id,path)
                });

                updateTypeStats(types,type);
                addWay({ id:id.toString(),path, type, name, tags: element.tags, bounds:way.bounds},ways,waysLookup)
                idx++;    

            } 
        }
    });


    return {ways,nodesLookup,waysLookup,typeStats:types}
}

export function splitAtIndex(way, idxSplit) {
    let path=way.path;
    let result= [ [],[]]
    path.forEach( (p,idx)=> {

        if ( idx<=idxSplit) result[0].push(p);
        if ( idx>=idxSplit) result[1].push(p);
    });
    return result;
}


/**
 * Concatenates two paths.
 * @param path the first path
 * @param path2 the second path
 * @param position 'before' or 'after'. If 'before', the second path will be inserted before the first node of the original path. If 'after', the second path will be appended after the last node of the original path.
 * @param wayId the id of the way that the nodes of the path belong to
 * @returns nothing, the path is updated in place.
 */
export function concatPaths(path:IncyclistNode[]|RoutePoint[],path2:IncyclistNode[]|RoutePoint[],
                            position:'before'|'after', wayId?:string):void {  

    // create a new path containing the values of path2 - don't copy by reference
    const append = path2.map( p => ({...p}) )
    if (wayId!==undefined) {
        append.forEach( p => {p.wayId = wayId})
    }
    
    if ( position==='after') {
        append.shift();
        path.push(...append)
    }
    else { // before
        path.shift();               // remove first element from original array
        path.unshift(...append);    // insert new elements to the beginning
    }
}





/**
 * Splits a path at a split point, which is a point with more than two ways.
 * The function returns an array of two paths.
 * 
 * The first path is the part of the way up to the split point.
 * The second path is the remaining part of the way from the split point up to the next branch (if any), 
 * 
 * @param way - The way to split, which can be of type IncyclistWay or WaySplitInfo.
 * @param split - The split info. This object must contain the index of the split point in the path.
 * @returns An array of two paths. The first path is the part of the way up to the split point,
 *          and the second path is the part of the way from the split point, plus any additional branches of the split point.
 */
export function splitAtPointInfo(way:WayInfo,split:SplitPointInfo):Array< Array<IncyclistNode> > {
    if (!way)
        return;

    let path=way.path;
    let result= [ [],[]]
    let hasNextBranch=false;
    path.forEach( (node,idx)=> {

        if ( idx<=split.idx) result[0].push(node)
        if ( idx===split.idx) {
            result[1].push(node)
        } 
        if ( !hasNextBranch && idx>split.idx && node.ways.length===1) result[1].push(node)
        if ( !hasNextBranch && idx>split.idx && node.ways.length>1) {
            if ( findAdditional( split.branches, node.ways,way.id, (id1,id2)=>(id1===id2) )!==undefined) 
                hasNextBranch = true;
            result[1].push(node);

        } 
    });
    return result;
}




/**
 * Determines if a given WaySplitInfo represents a roundabout.
 * A roundabout is determined by the following criteria in order of preference:
 * 1. `roundabout` or `junction` tag is set to "roundabout"
 * 2. The first and last nodes in the path match (i.e. the roundabout is a loop)
 * If strictCheck is true, then the function will return false if the first
 * criteria is not met.
 * @param {WaySplitInfo} w - WaySplitInfo object to check
 * @param {boolean} [strictCheck=false] - Whether to check the presence of the roundabout tag
 * @returns {boolean} Whether the WaySplitInfo represents a roundabout
 */
export function isRoundabout(w:IncyclistWay, strictCheck=false) {
    if (!w)
        return;

    let roundabout  = (w.tags!==undefined && (w.tags.roundabout===true || w.tags.junction==='roundabout'));
    if ( roundabout) return true;

    if (strictCheck) return false;
    
    if ( w.path===undefined || w.path.length<2)
        return false;

    roundabout= (w.path[0].id===w.path[w.path.length-1].id);
    return roundabout;
}


/**
 * Remove duplicates from an array of path options.
 * A path option is considered a duplicate if it has the same end node ID as a previous option.
 * Only the first occurrence of a path option is kept.
 * The function returns a new array with the duplicates removed.
 * @param options The array of path options to remove duplicates from.
 * @returns A new array with the duplicates removed.
 */
export function removeDuplicates(options) {
    const unique = [];
    const uniqueUsed = []

    const endPoints = options
        .filter(o=>o.path?.length>0)
        .map( (o) => o.path[ o.path.length-1].id) 

    endPoints.forEach( (id) => {
        if ( unique.indexOf(id)<0 ) {
            unique.push(id);
            uniqueUsed.push(false);
        }
    })

    return options.filter( (o) => {
        if (o.path?.length===0) return false;
        
        const id = o.path[ o.path.length-1].id;
        const idx = unique.indexOf(id);
        if (idx>=0 && !uniqueUsed[idx]) {
            uniqueUsed[idx] = true;
            return true;
        }
        return false;
    } )


}


/**
 * Remove duplicates from an array of path options.
 * A path option is considered a duplicate if it has the same node-ids as a previous option.
 * Only the first occurrence of a path option is kept.
 * The function returns a new array with the duplicates removed.
 * @param options The array of path options to remove duplicates from.
 * @returns A new array with the duplicates removed.
 */
export function removeDuplicatePaths(options) {
    const unique = [];

    return options.filter( (o) => {
        if (o.path?.length===0) return false;
        
        const id = `${o.path.map(n=>n.id??(n.lat+','+n.lng)).join(',')}`
        const idx = unique.indexOf(id);
        if (idx<0) {
            unique.push( id)
            return true;
        }
        return false;
    } )


}


/**
 * Splits a way into two parts at the given point.
 * 
 * If the way is a roundabout, this function returns two parts
 *    The first part is the part of the path from the beginning up to the given point,
 *    and the second part is the part of the path from the given point to the end.
 * 
 * Otherwise, it loops through the path of the way, and when it finds the given point,
 * it splits the path into two parts.
 *    The first part is the part of the path from the beginning up to the given point,
 *    and the second part is the part of the path from the given point to the end.
 * 
 * The two parts are then returned as an array of two WaySplitInfo objects.
 * 
 * @param way the way to split
 * @param point the point to split at
 * @returns an array of two WaySplitInfo objects, each containing a part of the way
 */
export function splitAtPoint(way:IncyclistWay, point:IncyclistNode):Array<WayInfo> {

    if (isRoundabout(way))
        return splitRoundabout(way,point);        

    const path=way.path;
    const result= [ {id:way.id,path:[],onewayReverse:false},{id:way.id,path:[],onewayReverse:false}]
    let found = false;
        
    path.forEach( (p,idx)=> {
        if ( !found) result[0].path.push(p);
        if (!found)
            found =  pointEquals(p,point) ;
        if ( found) result[1].path.push(p);
    });

    result[0].path.reverse();    
    if ( isOneWay(way))
        result[0].onewayReverse = true;

    return result;
}

/**
 * Splits a roundabout into two parts at the given point.
 * 
 * Loops through the path of the roundabout, and when it finds the given point,
 * it splits the path into two parts.
 * The first part is the part of the path from the beginning up to the given point,
 * and the second part is the part of the path from the given point to the end.
 * The two parts are then returned as an array of two WaySplitInfo objects.
 * 
 * @param way the roundabout to split
 * @param point the point to split at
 * @returns an array of two WaySplitInfo objects, each containing a part of the roundabout
 */
function splitRoundabout(way:IncyclistWay, point:IncyclistNode):Array<WayInfo> {
    let path=way.path;
    let result= [ {id:way.id,path:[],onewayReverse:false},{id:way.id,path:[],onewayReverse:false}]
    let found = false;

    // loop until point
    let idx = undefined;
    
    path.forEach( (p,i)=> {
        if (!found) {
            found =  pointEquals(p,point) ;
            if (found)
                idx = i;
        }
    });
    if (idx!==undefined) {
        let i;
        for (i=0;i<path.length;i++) {
            let len = path.length;
            let p = path[(idx+i)%len];
            let q = path[(idx-i+len)%len];
            if ( result[0].path.length===0 || 
                    (p.id!==result[0].path[result[0].path.length-1].id && p.id!==result[0].path[0].id) )
                result[0].path.push(p);
            if ( result[1].path.length===0 || 
                    (q.id!==result[1].path[result[1].path.length-1].id && q.id!==result[1].path[0].id) )
                result[1].path.push(q);
        }

        if ( isOneWay(way)) {
            result[1].onewayReverse = true;
        }

    }
    else {
        return ([])
    }

    return result
}


/* Generates a unique ID for an array of way-id's. Changing the order of the ways whould result into the same ID
* @param {MapAreay.String[]} Array containing all IDs of ways 
* @returns {String} Unique ID
*/
export function  generateID   (ways)  {
    if (ways?.length===0) return;
    if (ways.length<2) return ways[0];

    let w = [...ways];
    w.sort((a, b) => a.localeCompare(b))
    const widStr = 'R:'+w.join(',');

    return widStr;
};


export function buildQuery(template,boundary:Boundary):string {
    if (template===undefined)
        return;
    return template.replace('__boundary__',boundaryToString(boundary))
}

export function generateQuery(location:LatLng,radius:number):string {
    const boundary = getBounds(location.lat,location.lng,radius);
    const template = GET_WAYS_IN_AREA;
    return buildQuery(template,boundary)
}


export function boundaryToString(boundary:Boundary) {
    if ( boundary===undefined )
        return 'undefined';

    let ne = boundary.northeast;
    let sw = boundary.southwest;

    if (ne!==undefined && (ne.lat===undefined || ne.lng===undefined))
        return 'error: northeast incorrect' 
    if (sw!==undefined && (sw.lat===undefined || sw.lng===undefined))
        return 'error: southwest incorrect' 

    ne = ne??sw;
    sw = sw??ne;

    if (sw===undefined)
        return'undefined';

    return  sw.lat + ',' + sw.lng +','+ ne.lat + ',' + ne.lng;    
}


export function pointEquals(p1,p2) {
    if (p1===undefined || p2===undefined)
        return false;
    return (p1.id===p2.id || (p1.lat!==undefined && p1.lng!==undefined && p1.lat===p2.lat&&p1.lng===p2.lng) )
}

export function isWay(p) {
    if (p===undefined || p===null || p.id===undefined || p.path===undefined || p.tags===undefined)
        return false;
    
    return true;
}

export function isNode(p) {
    if (p===undefined || p===null || p.id===undefined || p.lat===undefined || p.lng===undefined || p.ways===undefined)
        return false;
    
    return true;
}

/**
 * Returns true if the path defined by way can be traversed from from to to.
 * 
 * The function works as follows:
 * 
 * 1. If from is a node on the path, and it's not a one-way, then the path can be traversed in both directions.
 * 2. If from is the first node of the path, or if from is the last node of the path and the way is not a one-way, then the path can be traversed.
 * 3. If to is a node on the path, and it's the last node of the path, then the path can be traversed.
 * 4. If to is a node on the path, and from is a node on the path, and the way is not a one-way, then the path can be traversed in both directions.
 * 5. If none of the above conditions apply, then the path can be traversed if the way is not a one-way and fromIdx<toIdx.
 * 
 * If none of the above conditions apply, the function returns undefined.
 * 
 * @param way the way to be evaluated
 * @param from the node where the evaluation starts
 * @param to the node where the evaluation ends
 * @returns true if the path can be traversed, false if not, undefined if the result is unknown
 */
export function isAllowed( way:IncyclistWay, from:IncyclistNode, to?:IncyclistNode ) {

    if (!isNode(from) || !isWay(way)) 
        return undefined;

    const fromIdx = way.path.findIndex( p => p.id===from.id);
    // point is on the path - if it's not a one way, that's all we need to know
    if (fromIdx!==-1 && !isOneWay(way))
        return true;

    const pWayStart = way.path[0];
    const pWayEnd = way.path[way.path.length-1];

    // FROM is the first point of the way -> can be traversed (as this would be the last )
    if (from.id===pWayStart.id)
        return true;

    // FROM is a the the last point of the way -> can be traversed only if the way is not one way
    if ( from.id!==pWayStart.id && from.id===pWayEnd.id)
        return !isOneWay(way);
    
    
    if ( isNode(to) && to.id === pWayEnd.id)
        return true;

    if ( isNode(from) && isNode(to )) {
        const toId   = way.path.findIndex( p => p.id===to.id);
        if ( fromIdx===-1 || toId===-1)
            return;
        return !isOneWay(way) || fromIdx<toId;
    }



    return undefined;
} 

/**
 * Determines if a given way is a one-way street.
 *
 * @param way - The way to be evaluated, which includes a set of tags.
 * @returns True if the way is marked as one-way ('true' or 'yes'), false otherwise.
 */

export function isOneWay(way:IncyclistWay):boolean {
    if ( !way?.tags?.oneway)
        return false; 
    let ow = way.tags.oneway; 
    return (ow.toString()==='true' || ow==='yes')
}


/**
 * Finds additional elements in a2 that are not in a1 and not equal to id3.
 * 
 * The function takes two arrays of strings, a3, and a callback function that takes two strings and returns a boolean.
 * The callback function is used to compare elements of the two arrays and determine if they are equal.
 * 
 * The function iterates over each element of a1 and a2 and checks if the element is not equal to id3 and
 * if the callback function returns false when comparing the element with any element of a1.
 * If the element is not equal and the callback function returns false, the element is added to the result array.
 * If the result array is empty at the end of the iteration, the function returns undefined.
 * Otherwise, the function returns the result array.
 * 
 * @param {Array<string>} a1 - The first array of strings
 * @param {Array<string>} a2 - The second array of strings
 * @param {string} id3 - The string to ignore
 * @param {Function} fnCompare - The callback function to compare elements of the two arrays
 * @returns {Array<string>|undefined} - The array of additional elements or undefined if no additional elements are found.
 */
export function findAdditional( a1:Array<string>, a2:Array<string>, id3:string, fnCompare) {
    let res= [];

    a1.forEach ( e1 => {
        a2.forEach( e2 => {
            if ( !fnCompare(e1,e2) && !fnCompare(e1,id3) && !fnCompare(e2,id3))
                res.push(e2)
        })
    })
    if ( res.length===0)
        return undefined;
    return res;
}

/**
 * Finds the point on a line between two points that is closest to the given point.
 * 
 * @param {LatLng} point The point to find the closest point on the line for
 * @param {LatLng} p1 The first point of the line
 * @param {LatLng} p2 The second point of the line
 * @returns {LatLng} The point on the line closest to the given point
 */
export function getPointOnLine(point:LatLng,p1:LatLng,p2:LatLng):LatLng {
    let bL = initialBearingTo(p1,p2);
    let bP = bL+90;
    let p3 = destinationPoint(point,100,bP);
    
    return getCrossing( p1,p2,point,p3,false)
}

    /**
     * Tests if a point is on a path between two points.
     * The point is considered to be on the path if it is within MAX_DISTANCE_FROM_PATH of the path
     * and the angle between the path and the point is less than 30 degrees.
     * 
     * @param {LatLng} point The point to be tested
     * @param {LatLng} p1 The first point of the path
     * @param {LatLng} p2 The second point of the path
     * @returns {{between:boolean, offset:number}} The result of the test, with a boolean indicating if the point is on the path and the distance from the start of the path to the point.
     */
export function isBetween(point:LatLng,p1:LatLng,p2:LatLng):{between:boolean, offset:number} {
    if (point===undefined|| p1===undefined || p2===undefined || 
        point.lat===undefined|| point.lng===undefined ||
        p1.lat===undefined|| p1.lng===undefined ||
        p2.lat===undefined|| p2.lng===undefined 
        ) return undefined;

    let d = geo.distanceBetween(p1,point);    
    let bDest = initialBearingTo(p1,p2);
    let bPoint = initialBearingTo(p1,point);
    let angle = bPoint-bDest; 
    if ( abs(angle) > 30) // more than 30 degree difference: point is not on path
        return {between:false, offset:d };

    let dP2 = geo.distanceBetween(p1,p2);    
    let offset = abs(d*sin(angle));

    if (offset<MAX_DISTANCE_FROM_PATH && dP2>d) {
        return {between:true, offset};
    }
    return {between:false, offset:(dP2-d)};
}



/**
 * Calculate the shortest distance between a point and a way.
 * It returns the distance in meters.
 * 
 * @param point The point to calculate the distance from.
 * @param way The way to calculate the distance to.
 * @return The shortest distance in meters.
 */
export function distanceToPath(point:LatLng,way:IncyclistWay) {
    if (point?.lat===undefined|| point?.lng===undefined || !way?.path?.length) 
        return undefined;

    let minDistance;
    let minIdx = -1;
    let prev;
    let foundExact = false;

    const analyzeData = () => {
        way.path.forEach ( (element,idx) => {
            // exact match
            if (element.lat===point.lat && element.lng===point.lng) {
                minDistance = 0;
                foundExact = true;
                return;
            }
    
            if ( foundExact)
                return;
    
            if (prev!==undefined) {
                let res = isBetween(point,prev,element);
                if (res?.between)  {
                    minDistance = res.offset;
                    foundExact = true;
                    return;
                }
            }
    
            let distance = geo.distanceBetween(element,point);  
            if (minDistance===undefined || distance<minDistance) {
                minDistance = distance;
                minIdx = idx;
            }
    
            prev = element;
        });           
    }

    const calculateDistanceWithinPath = () => {
        const alpha = initialBearingTo(way.path[minIdx-1],way.path[minIdx]);
        const alpha2 = initialBearingTo(way.path[minIdx-1],point)
        let beta  =  alpha2- alpha;
        if ( beta>270 ) beta -=360;
        if ( ( beta>-90 && beta<90)) {

            const dist = sin( abs(beta)) * geo.distanceBetween(way.path[minIdx-1],point);
            const distPath = cos( abs(beta)) * geo.distanceBetween(way.path[minIdx-1],point);
            if ( dist<minDistance && distPath>0 && distPath <geo.distanceBetween(way.path[minIdx-1],way.path[minIdx]))
                minDistance = dist;
        }

    }

    const calculateDistanceAtStart = ()=>{
        const alpha = initialBearingTo(way.path[minIdx],way.path[minIdx+1]);
        let beta  = initialBearingTo(way.path[minIdx],point) - alpha;
        if ( beta>270 ) beta -=360;
        if ( ( beta>-90 && beta<90)) {
            const dist = sin(abs(beta)) * geo.distanceBetween(way.path[minIdx],point);
            const distPath = cos( abs(beta)) * geo.distanceBetween(way.path[minIdx],point);
            if ( dist<minDistance && distPath>0 && distPath <geo.distanceBetween(way.path[minIdx],way.path[minIdx+1]))
                minDistance = dist;
        }
    }

    analyzeData()

    if ( foundExact)
        return minDistance;
    
    if ( minIdx>0) {
        calculateDistanceWithinPath();        
    }
    else if ( minIdx<way.path.length-2) {
        calculateDistanceAtStart()
    }

    return minDistance;
}



export function  isWithinRange(distance) {        
    return abs(distance)<MAX_DISTANCE_FROM_PATH
}

/* Returns the point where the two lines A->B and C->D are crossing
* @param {LatLng} A    starting point 1st line
* @param {LatLng} B    ending point 1st line
* @param {LatLng} C    starting point 2nd line
* @param {LatLng} D    ending point 2nd line
* @param {boolean} exact  true: crossing must happen within both lines, 
*                       false: crossing just based on direction of both lines 
* @returns  the crossing point or undefined if no corssing point could be found
*/

export function getCrossing( A:LatLng,B:LatLng,C:LatLng,D:LatLng,exact=true):CrossingInfo { 
    let AB = getVector(A,B)
    let CD = getVector(C,D);
    let AC = getVector(A,C);
    
    const ciA = {...A, distance:0}
    const ciB = {...B, distance:geo.distanceBetween(A,B)}

    // first check if we have overlaps 
    if (isWithinRange(geo.distanceBetween(A,C))) 
        return ciA;
    if (isWithinRange(geo.distanceBetween(A,D)))
        return ciA;
    if (isWithinRange(geo.distanceBetween(B,C)))
        return ciB;
    if (isWithinRange(geo.distanceBetween(B,D)))
        return ciB;

    const V = crossing( AB,CD,AC); // vector from point A to crossing     
    if (V===undefined)
        return undefined;  
    
    
    const p1Len = AB.len();
    const distance =V.len();

    if ( AB.isSameDirection(V) && ( distance<p1Len || isWithinRange(p1Len-distance))){
        let X = geo.getPointBetween(A,B,distance);
        let CX= getVector(C,X);
        if (!exact || (CX.len()<CD.len() ||isWithinRange(CD.len() -CX.len()))) {            
            return {...X,distance}
        }
    }
    return undefined;
    
}



/**
 * Returns the point on the path that is crossed by the perpendicular drawn from the given point
 * 
 * @param point - Point to be tested
 * @param path - Path of points to be tested against
 * @param closest - If true, returns the closest point of the path to the point, even if there is no crossing
 * @returns The point and distance on the path that is crossed
 */
export function getPointCrossingPath( point:LatLng,path:IncyclistNode[],closest=false):PathCrossingInfo {
    let pPrev=undefined;
    let pCrossing = undefined;
    let pClosest = undefined

    if (path===undefined)
        return undefined;

    path.forEach ( ( p,i ) =>{
        let pDist =  abs(geo.distanceBetween(p,point));
        if (pDist===0) {
            pCrossing  = pClosest = { distance:0, point:p, idx:i}
            return 
        }
        if ( pClosest===undefined || pClosest.distance>pDist) {
            pClosest= { distance:pDist, point:p, idx:i}
        }
        if (pPrev!==undefined) {
            let pX = getPointOnLine(point,pPrev,p);
            if (pX!==undefined) {
                let dist = abs(geo.distanceBetween(pX,point))
                if ( pCrossing===undefined || (pCrossing.distance>dist) ) {
                    pCrossing = { point:pX, distance:dist,idx:i}
                }
            }   
        }
        pPrev =p;
    });
    if ( pCrossing!==undefined) {
        return pCrossing
    }
    else if (closest) {
        return pClosest
    }
}


/* Provides information of the first crossing between two MapArea Ways ( i.e. parts of streets)
* @param {MapArea.way} way1 1st way
* @param {MapArea.way} way2 2nd way
* @returns { {point,idx1,idx2} } point: the crossing point, idx1: Index of that point in 1st way, idx2: Index of that point in 2nd way
*/
export function getCrossingInfo ( way1, way2) {
    if (way1===undefined || way1.path===undefined || way2===undefined|| way2.path===undefined) 
        return;
    let crossing =undefined;

    way1.path.forEach ( (p1,i) => {
        way2.path.forEach ( (p2,j) => {
            if ( crossing===undefined && p1.id === p2.id) {
                crossing =  {point:p1, idx1:i, idx2: j} 
            }
        });

    } )
    return crossing;
}


/* Creates a vector that represents the path between the points p1 and p2
* @param {latNg} p1 coordinates of the starting point.
* @param {latNg} p2 coordinates of the end point
* @returns {Vector} The vector
*/
export function getVector( p1:LatLng, p2:LatLng) {
    if (p1===undefined) throw new Error("missing mandatory argument: p1");
    if (p2===undefined) throw new Error("missing mandatory argument: p2");

    let distance = geo.distanceBetween(p1,p2);    
    if (distance===0) {
        return new Vector([0,0])
    }
    let bearing = initialBearingTo(p1,p2);

    return new Vector( { path:{bearing,distance}} );
}


export function getBounds( lat:number, lng:number, offset:number ):Boundary {
    const pi = Math.PI;
    const m =  (1 / ((2 * pi / 360) * RADIUS_EARTH)) / 1000;  //1 meter in degree;
    
    let boundary = {
        northeast:{lat:undefined, lng:undefined},
        southwest:{lat:undefined, lng:undefined}
    }    

    boundary.northeast.lat = lat+offset*m;
    boundary.northeast.lng = lng+(offset*m)/Math.cos(lat*pi/180)
    boundary.southwest.lat = lat-offset*m;
    boundary.southwest.lng = lng-(offset*m)/Math.cos(lat*pi/180)
    return boundary;
}

export function isWithinBoundary( location:LatLng, boundary:Boundary) {
    if (location?.lat===undefined || location?.lng===undefined)
        return false;
    
    const lat = location.lat;
    const lng = location.lng;
    const sw = boundary.southwest;
    const ne = boundary.northeast;

    return ( lat>=sw.lat && lat<=ne.lat  && lng>=sw.lng && lng<=ne.lng)
}

/**
 * Returns the initial bearing from ‘this’ point to destination point.
 *
 * @param   {LatLon} p1 - Latitude/longitude of originating point.
 * @param   {LatLon} p2 - Latitude/longitude of destination point.
 * @returns {number} Initial bearing in degrees from north (0°..360°).
 *
 * @example
 *   const p1 = new LatLon(52.205, 0.119);
 *   const p2 = new LatLon(48.857, 2.351);
 *   const b1 = p1.initialBearingTo(p2); // 156.2°
 */
export function initialBearingTo(p1:LatLng,p2:LatLng) {
    if (p1===undefined || p2===undefined || (p1.lat===p2.lat && p1.lng===p2.lng) )
        return;

    // tanθ = sinΔλ⋅cosφ2 / cosφ1⋅sinφ2 − sinφ1⋅cosφ2⋅cosΔλ
    // see mathforum.org/library/drmath/view/55417.html for derivation

    const φ1 = rad(p1.lat)
    const φ2 = rad(p2.lat);
    const Δλ = rad(p2.lng - p1.lng);

    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const θ = Math.atan2(y, x);

    const bearing = degrees(θ);

    return bearing;
}




/**
 * Returns how far a given point is along a path from from start-point, heading towards end-point.
 * That is, if a perpendicular is drawn from ‘this’ point to the (great circle) path, the
 * along-track distance is the distance from the start point to where the perpendicular crosses
 * the path.
 *
 * @param   {LatLon} point - point to be verified.
 * @param   {LatLon} pathStart - Start point of great circle path.
 * @param   {LatLon} pathEnd - End point of great circle path.
 * @param   {number} [radius=6371e3] - (Mean) radius of earth (defaults to radius in metres).
 * @returns {number} Distance along great circle to point nearest ‘this’ point.
 *
 * @example
 *   const pCurrent = new LatLon(53.2611, -0.7972);
 *   const p1 = new LatLon(53.3206, -1.7297);
 *   const p2 = new LatLon(53.1887,  0.1334);
 *   const d = pCurrent.alongTrackDistanceTo(p1, p2);  // 62.331 km
 */
export function alongTrackDistanceTo(point:LatLng, pathStart:LatLng, pathEnd:LatLng, radius:number=RADIUS_EARTH*1000) {
    if (point===undefined || pathStart===undefined || pathEnd===undefined)
        return;

    const R = radius;
    const δ13 = geo.calculateDistance(pathStart.lat,pathStart.lng,point.lat,point.lng,R) / R;
    const θ13 = rad(initialBearingTo(pathStart,point));
    const θ12 = rad(initialBearingTo(pathStart,pathEnd));



    const δxt = Math.asin(Math.sin(δ13) * Math.sin(θ13-θ12));

    const δat = Math.acos(Math.cos(δ13) / Math.abs(Math.cos(δxt)));

    let d = δat*Math.sign(Math.cos(θ12-θ13)) * R;
   
    return d;
}

/**
 * Returns the destination point from ‘this’ point having travelled the given distance on the
 * given initial bearing (bearing normally varies around path followed).
 *
 * @param   {LatLng} start - starting point
 * @param   {number} distance - Distance travelled, in same units as earth radius (default: metres).
 * @param   {number} bearing - Initial bearing in degrees from north.
 * @param   {number} [radius=6371e3] - (Mean) radius of earth (defaults to radius in metres).
 * @returns {LatLon} Destination point.
 *
 * @example
 *   const p1 = new LatLon(51.47788, -0.00147);
 *   const p2 = p1.destinationPoint(7794, 300.7); // 51.5136°N, 000.0983°W
 */
export function destinationPoint(start:LatLng, distance:number, bearing:number, radius:number=RADIUS_EARTH*1000) {
    // sinφ2 = sinφ1⋅cosδ + cosφ1⋅sinδ⋅cosθ
    // tanΔλ = sinθ⋅sinδ⋅cosφ1 / cosδ−sinφ1⋅sinφ2
    // see mathforum.org/library/drmath/view/52049.html for derivation

    const δ = distance / radius; // angular distance in radians
    const θ = rad(bearing);

    const φ1 = rad(start.lat), λ1 = rad(start.lng);

    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
    const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    const lat = degrees(φ2);
    const lng = degrees(λ2);

    return {lat,lng}
}

/** from: http://www.movable-type.co.uk/scripts/latlong.html
     * Returns the destination point from ‘this’ point having travelled the given distance on the
     * given initial bearing (bearing normally varies around path followed).
     *
     * @param   {number} lat - Latitude of original point
     * @param   {number} lon - Longitude of original point.
     * @param   {number} distance - Distance travelled, in same units as earth radius (default: metres).
     * @param   {number} bearing - Initial bearing in degrees from north.
     * @param   {number} [radius=6378100] - (Mean) radius of earth (defaults to radius in metres).
     * @returns {LatLng} Destination point.
     *
     */

/* (More correct) alternative to getBounds():

destinationPoint(lat,lon,distance, bearing, radius= 6378100) {
    // sinφ2 = sinφ1⋅cosδ + cosφ1⋅sinδ⋅cosθ
    // tanΔλ = sinθ⋅sinδ⋅cosφ1 / cosδ−sinφ1⋅sinφ2
    // see mathforum.org/library/drmath/view/52049.html for derivation

    const angDist = distance / radius; // angular distance in radians
    const bearingRad = rad(bearing);

    const latRad = rad(lat), lonRad = rad(lon);

    const sinLat2Rad = Math.sin(latRad) * Math.cos(angDist) + Math.cos(latRad) * Math.sin(angDist) * Math.cos(bearingRad);
    const lat2Rad = Math.asin(sinLat2Rad);
    const y = Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latRad);
    const x = Math.cos(angDist) - Math.sin(latRad) * sinLat2Rad;
    const lon2Rad = lonRad + Math.atan2(y, x);

    let point = {
        lat : degrees(lat2Rad),
        lng : degrees(lon2Rad)
    }

    return point;
}
*/
