import { geo } from "../../../utils";
import clone from "../../../utils/clone";
import { LatLng, calculateDistance, calculateHeaderFromPoints } from "../../../utils/geo";
import { valid } from "../../../utils/valid";
import { RouteApiDetail } from "../api/types";
import { Route } from "../model/route";
import { RouteInfo, RoutePoint, RouteSegment } from "../types";
import crypto from 'crypto'

const MAX_LAPMODE_DISTANCE = 50;    // maximume distance between start and stop position

export const checkIsLoop = (_route:Route|Array<RoutePoint>):boolean =>  {

    let points;
    let route;

    if (!_route)
        return false;

    if (Array.isArray(_route)) {
        points = _route
    }
    else {
        route = _route
        points = route.details?.points
        const data = route?.data
        const isLoop = checkIsLoop(points)
        if (data)
            data.isLoop = isLoop 
        return isLoop
    }



    if ( !points?.length) {
        return false;
    }

    
    const maxDistance = MAX_LAPMODE_DISTANCE
    const p1 = points[0];
    const p2 = points[points.length-1];

    if (p1===undefined || p2===undefined) {
        return false;
    }

    const dist = Math.abs( calculateDistance(p1.lat,p1.lng, p2.lat,p2.lng) );

    return  (dist<=maxDistance)
    
}

export const validateSlopes = (points: Array<RoutePoint>):void => {
    updateSlopes(points, true)

}

export const updateSlopes = (points: Array<RoutePoint>, validateOnly=false):void => {
    let prevPoint = null;

    if (!validateOnly) {
        const lapMode = checkIsLoop(points)
        if (lapMode) {
            const distance = geo.distanceBetween(points[0], points[points.length-1]);
            let elevationShift
            if (distance === 0) {
                elevationShift = points[0].elevation - points[points.length-1].elevation;
            }
            else {
                const distanceLast = geo.distanceBetween(points[points.length-2], points[points.length-1]);
                const slopeLast = (points[points.length-1].elevation - points[points.length-2].elevation) / distanceLast * 100;
                const targetElevationLast = points[0].elevation - slopeLast * distance/100;
                elevationShift = targetElevationLast-points[points.length-1].elevation;
            }
    
            validateDistance(points)
            const totalDistance = points[points.length-1].routeDistance
            points.forEach( (point) => { 
                point.elevation += elevationShift*(point.routeDistance/totalDistance)
            })
        }
            
    }

    points.forEach( (point) => {
        const i = point.cnt
        if (validateOnly && point.slope!==undefined)
            return;

        if ( i>0) {
            updateSlopePrevPoint(point, prevPoint, points);
        }
        
        if (i===points.length-1 && points.length>1)  {
            updateSlopeFinalPoint(point, prevPoint, points);
        }
        prevPoint = point;
    })
}

const updateSlopePrevPoint = (point: RoutePoint, prevPoint: any, points: RoutePoint[]) => {
    
    
    point.distance = point.distance ?? geo.distanceBetween(prevPoint, point);
    
    if (!point.isCut)
        prevPoint.slope = (point.elevation - prevPoint.elevation) / point.distance * 100;
    else if (prevPoint.slope === undefined || prevPoint.slope > 50) {
        const i = point.cnt
        const nextPoint = points[i + 1];
        prevPoint.slope = point.slope ?? (nextPoint.elevation - point.elevation) / nextPoint.distance * 100;
    }
}


const updateSlopeFinalPoint = (point: RoutePoint, prevPoint: any,  points: RoutePoint[]) =>{
    const lapMode = checkIsLoop(points)

    point.slope = prevPoint.slope;
    if (lapMode) {
        const p1 = point;
        const p2 = points[0];
        const distance = geo.calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        if (distance === 0) {
            point.slope = p2.slope;
            point.elevation = p2.elevation;
        }
        else {
            point.slope = (p2.elevation - p1.elevation) / distance * 100;

        }
    }
}




export const getSegments = (route:Route):Array<RouteSegment> => {
    const {description: data,details}    = route

    
    if (data?.segments) {
        return data.segments
    }

    if ( details?.video?.segments ) {
        const segments = []
        
        details.video.segments.forEach( sx => { 
            if (!sx || typeof sx !== 'object')
                return;

            const additional = sx.segment.map ( s => { 
                const segment = s['$'] 
                if (segment.start!==undefined) segment.start = parseInt(segment.start);
                if (segment.end!==undefined) segment.end = parseInt(segment.end);
                return segment;
            }) 
            segments.push( ...additional);
                
            
        })           
        if (data)
            data.segments = segments
        return segments;
    }
}


export const addDetails =(route:Route, details:RouteApiDetail):void => {
    addGenericDetails(details, route);
    
    if (route.description.hasVideo) {
        addVideoDetails(route, details);
    }
}

const addGenericDetails = (details: RouteApiDetail, route: Route) => {
    const points = details.points;

    route.details = details;
    route.description.points = details.points;
    route.description.distance = details.distance ?? points[points.length - 1].routeDistance;
    route.description.isLoop = checkIsLoop(route.description.points);

    if (!valid(route.description.routeHash))
        route.description.routeHash = details.routeHash;
}


const addVideoDetails = (route: Route, details: RouteApiDetail)  => {
    if (!valid(route.description.requiresDownload))
        route.description.requiresDownload = details.requiresDownload ?? valid(details.downloadUrl);

    if (!valid(route.description.downloadUrl))
        route.description.downloadUrl = details.downloadUrl;

    if (!valid(route.description.videoUrl)) {
        route.description.videoUrl = details.video.url;
    }
    if (!valid(route.description.videoUrl)) {
        if (valid(details.video?.file)) {
            route.description.videoUrl = details.video.file.startsWith('http') ? details.video.file : 'video:///' + details.video.file ;
        }
        
    }

    if (!valid(route.description.videoFormat)) {
        route.description.videoFormat = details.video.format;
    }
    if (!valid(route.description.previewUrl)) {
        route.description.previewUrl = details.previewUrl;
    }

    route.description.hasGpx = details.points.find(p => p.lat && p.lng) !== undefined;
    route.description.next = details.video?.next;
}



export const validateRoute = (route:Route|RouteApiDetail):void =>{
    if (!route?.points?.length)
        return;

    validateDistance(route.points)    
    validateSlopes(route.points)
    updateElevationGain(route.points)

    route.distance = route.points[ route.points.length-1].routeDistance
}

export const validateDistance = (points:Array<RoutePoint>) => {
    let prev = undefined

    addMissingIndexes(points)

    points.forEach( (p,idx) => {

        if (p.routeDistance===undefined || p.routeDistance===null) {
            addMissingRouteDistance(p, prev);            
        }
        else if (p.routeDistance!==undefined && p.routeDistance!==null && (p.distance===undefined || p.distance===null) ) {
            addMissingDistance(p, prev);
        }

        prev = p;
    })
}

const addMissingRouteDistance = (p: RoutePoint, prev: RoutePoint) => {

    const idx = p.cnt
    if (idx == 0) {
        p.routeDistance = 0;
    }
    else if (p.distance === undefined) {
        p.distance = calculateDistance(prev.lat, prev.lng, p.lat, p.lng);
        p.routeDistance = (prev.routeDistance || 0) + p.distance;
    }
    else {
        p.routeDistance = (p.distance) + (prev?.routeDistance || 0);
    }
}
const addMissingDistance = (p: RoutePoint, prev: RoutePoint) => {
    const idx = p.cnt
    if (idx == 0)
        p.distance = 0;

    else
        p.distance = p.routeDistance - prev.routeDistance;
}


export const getTotalElevation = (route:RouteApiDetail):number =>{
    if (!route?.points?.length)
        return 0;

    const lastPoint = route.points[route.points.length-1]
    if (lastPoint.elevationGain===undefined)
        updateElevationGain(route.points)
    
    return lastPoint.elevationGain;
}

export const getElevationGainAt = (route:Route, routeDistance:number):number => {


    let distance = routeDistance
    let elevationGain = 0;
    const lastPoint = route.points[route.points.length-1]

    const isLoop = checkIsLoop(route)
    const totalDistance = lastPoint.routeDistance
    if (isLoop&& routeDistance>totalDistance) {
        
        distance = routeDistance % totalDistance
        const lapsCompleted = Math.floor(routeDistance / totalDistance)
        elevationGain += getTotalElevation(route.details)*lapsCompleted
    }


    let point = getPointAtDistance(route,distance,true)
    if (point.elevationGain===undefined) {
        updateElevationGain(route.points)
        point = getPointAtDistance(route,distance,true)
    }
    elevationGain+= point.elevationGain
    
    return elevationGain
}


export const updateElevationGain = (points:Array<RoutePoint>):void =>{
    if (!points?.length)
        return;

    let elevationGain = 0;
    let prev = undefined
    points.forEach( (p,idx)=>{

        if (idx>0) {
            const gain = p.elevation - prev.elevation
            if (gain>0)
                elevationGain+=gain
            p.elevationGain = elevationGain
        }
        else {
            p.elevationGain = 0
        }
        prev = p;
    })    
}

export const getTotalDistance = (route:RouteApiDetail):number =>{
    if (!route?.points?.length)
        return 0;

    return route.points[ route.points.length-1].routeDistance
}

export const getRouteHash = (route:RouteApiDetail):string => {
    let json;
    if (!route?.points) {

        if ( route.epp?.programData ) {
            // generate unique hash from epp
            const programData = route.epp.programData;
            json = { decoded:programData.map( p => ({d:p.distance, e:p.elevation})) }                        
        }        
        else {
            return undefined
        }
    }
    else if (route.gpxDisabled) {
        json = { decoded:route.points.map( p => ({d:Math.round(p.routeDistance), e:Math.round(p.elevation)})) }            
    }
    else {
        json = { decoded:route.points.map( p => ({lat:p.lat, lng: p.lng})) }            
    }

    const routeHash = crypto.createHash('md5').update(JSON.stringify(json)).digest('hex');
    return routeHash;
}


export interface LapPoint extends RoutePoint {
    lap?:number
    totalDistance?: number
}

export interface GetNextPositionProps {
    // position from start of route
    routeDistance?:number,   

    // distance to prev point
    distance?: number,      
    prev?:LapPoint    
}

export const getNextPosition = ( route:Route, props:GetNextPositionProps ):LapPoint => {
    const points = route.points

    if (props===undefined) {
        return;
    }
    if ( props.distance===undefined && props.routeDistance===undefined) {
        return;
    }
    if ( props.routeDistance===undefined && (props.prev?.routeDistance===undefined))  {
        return;
    }
        
    let pPrev={...(props.prev || { ...points[0],lap:1,cnt:0})};       

    if (props.routeDistance===0 && !props.prev) {
        return {...points[0],lap:1,cnt:0, totalDistance:0}
        
    }
    
    const searchTarget = getNextPositionSearchTarget(route, pPrev,props);

    const {pSearchStart,point}  = searchNextPoint(route,pPrev,props,searchTarget)
    pPrev = pSearchStart

    const lapPoint =  point??pPrev
    lapPoint.lap = searchTarget.lap
    lapPoint.totalDistance = getLapTotalDistance(route,lapPoint)
    return lapPoint
        
    

}

export interface GetPositionProps {
    cnt?: number        // index in Array
    distance?: number

    nearest?: boolean
    latlng?: LatLng
}

    /**
     * Returns a point from the route
     * 
     * @param route The route Object
     * @param props Object with parameters
     * 
     * @returns a RoutePoint
     * 
     * @example
     * 
     * const point = route.getPosition({cnt:3}) // returns the point at index 3
     * const point = route.getPosition({distance:300}) // returns the point at distance 300
     * const point = route.getPosition({latlng: {lat:12.3, lng:45.6}}) // returns the point at the given latlng
     */
export const getPosition = (route:Route,  props:GetPositionProps) => {
    if (props===undefined || route.points===undefined)
        return;

    const {cnt,distance, nearest=true, latlng} = props
    if (props.cnt!==undefined) {
        return getPointAtIndex(route,cnt)
    }

    if (props.distance!==undefined) {
        return getPointAtDistance(route, distance, nearest)
    }

    if (props.latlng!==undefined) {
        return getPointAtLatLng(route, latlng, nearest)
    }
}

    /**
     * Calculates the heading (initial bearing) at a given point on the route
     * 
     * @param route The route Object
     * @param props Object with parameters
     * 
     * @returns the heading in degrees
     * 
     * @example
     * 
     * const heading = route.getHeading({cnt:3}) // returns the heading at the point at index 3
     * const heading = route.getHeading({distance:300}) // returns the heading at the point at distance 300
     * const heading = route.getHeading({latlng: {lat:12.3, lng:45.6}}) // returns the heading at the point at the given latlng
     */
export const getHeading  = ( route:Route, point: RoutePoint) => {

        if (!route.description.hasGpx || !route.points?.length  )
            return;

        const points = route.points
        
        
        point.cnt = point.cnt??points.indexOf(point)
        
        if (point.cnt===undefined || points.length<2)
            return 180;
        
        let p1,p2;

        if ( point.cnt===points.length-1) {
            p1 = points[point.cnt-1];
            p2 = point;
        }
        else {
            p1 = point;
            p2 = points[point.cnt+1];
        }
        return calculateHeaderFromPoints( p1,p2);        
}



/**
 * returns a copy of the point at a specifc index in the points array
 * 
 * 
 * @param route The route Object
 * @param idx   index 
 * 
 * @returns a copy of the RoutePoint at the given index
 */
const getPointAtIndex = (route:Route,idx:number):RoutePoint => {
    const points = route.points
    if (idx>=points.length || idx<0)
        return;

    const point = {...points[idx]}
    point.cnt = idx
    return point;
}

/**
 * returns a copy of the point at a specifc routeDistance
 * 
 * @param route the route object
 * @param routeDistance the distance we would like to have the point 
 * @param nearest  if set to true, it will deliver the point nearest to the routeDistance, otherwise it will only return a point if the point's routeDistance matches exactly the requested one 
 * @returns a copy of the RoutePoint at the given position
 */
export const getPointAtDistance = (route:Route|RouteApiDetail,routeDistance:number, nearest:boolean=true):RoutePoint => {
    const points = route.points
    if (!points)
        return;


    const exact = !nearest
    let cnt = 0;
    let closestDistance=undefined;
    let point:RoutePoint

    points.forEach( p => {
        if (exact) {
            if (p.routeDistance===routeDistance) {
                point = {...p};
                point.cnt=cnt;    
            }
        }
        else {
            let distance =   p.routeDistance-routeDistance;

            if(distance<0) distance = distance*-1;
            if (closestDistance===undefined || distance<closestDistance) {
                point = {...p};
                point.cnt=cnt;    
                closestDistance = distance;                        
            }
        }
        cnt++;
    })
    return point;
}



const getPointAtLatLng = (route:Route, latlng:LatLng, nearest:boolean=true):RoutePoint => {
    const points = route.points
    if (!points || !route.description.hasGpx)
        return;


    const exact = !nearest
    let cnt = 0;
    let closestDistance=undefined;
    let point

    points.forEach( p => {
        if (exact) {
            if (p.lat===latlng.lat && p.lng===latlng.lng) {
                point = {...p};
                point.cnt=cnt;    
            }
        }
        else {
            const distance = Math.abs(geo.calculateDistance(p.lat,p.lng, latlng.lat,latlng.lng) )
            if (closestDistance===undefined || distance<closestDistance) {
                point = {...p};
                point.cnt=cnt;    
                closestDistance = distance;                        
            }
        }
        cnt++;

    })
    return point;
}


const getLapTotalDistance = ( route:Route, point:LapPoint):number =>{
    const lap = valid(point?.lap) ? point.lap : 1
    const pointDistance = point?.routeDistance
    return (lap-1)*route.description.distance + (pointDistance??0)
}



function getNextPositionSearchTarget(route: Route, pPrev:LapPoint,props:GetNextPositionProps) {
    let lap = pPrev?.lap ?? 1
    let searchStart = pPrev.cnt??0
    const distance = props.distance ?? props.routeDistance-getLapTotalDistance(route,pPrev);
    const targetRouteDistance = props.routeDistance ?? getLapTotalDistance(route,pPrev)+distance;


    let targetRouteInLap;
    if (checkIsLoop(route)) {

        targetRouteInLap = targetRouteDistance % route.description.distance;
        const prevTargetRouteinLap = pPrev.routeDistance;

        if (prevTargetRouteinLap > targetRouteInLap) {
            searchStart = 0;
            lap++;
        }
    }
    else {
        lap = 1;
        targetRouteInLap = Math.min(targetRouteDistance, route.description.distance);
    }
    return {lap,targetRouteInLap,searchStart,distance}
}

function searchNextPoint(route:Route,pPrev:LapPoint,props:GetNextPositionProps,searchTarget) {
    const {lap,targetRouteInLap,searchStart: searchStartIdx,distance} = searchTarget
    const points = route.points

    let pSearchStart = pPrev

    for ( let cnt = searchStartIdx;cnt<points.length;cnt++) {
        const p = points[cnt];
        if ( p.routeDistance>=targetRouteInLap) {            
            const point = updatePoint(p, pPrev, props,  distance, targetRouteInLap, route, lap);
            return {pSearchStart,point}; 
        }   
        pPrev = p;
    }

    if (route.description.isLoop) {
        const point = updatePoint(points[0], pPrev, props,  distance, targetRouteInLap, route, lap);
        return {pSearchStart,point}
        
    }
    return {pSearchStart}

}

function updatePoint(originalPoint: LapPoint, pPrev: LapPoint, props: GetNextPositionProps,  distance: number, targetRouteInLap: number, route: Route, lap: number) {
    let pDest;
    const point = {...originalPoint};

    // first point ... just return a copy
    if (pPrev===undefined ){
        return point
    }

    if (pPrev.cnt === point.cnt) {
        pDest = geo.getPointBetween(props.prev, originalPoint, distance);
    }
    else {
        const distanceToPrev = targetRouteInLap - pPrev.routeDistance;
        pDest = geo.getPointBetween(pPrev, originalPoint, distanceToPrev);
        point.cnt = pPrev.cnt;
        point.slope = pPrev.slope
    }
    point.lat = pDest.lat;
    point.lng = pDest.lng;
    point.routeDistance = targetRouteInLap;
    point.distance = point.routeDistance - pPrev.routeDistance;
    point.elevation = pPrev.elevation + point.distance * pPrev.slope / 100;

    if (route.description.isLoop) {
        point.lap = lap;
    }
    return point
}


const buildRouteInfo = (descr:RouteApiDetail):RouteInfo => {
    const { points,id,title,country,distance,elevation, category,provider, video,routeHash} = descr
    
    const data:RouteInfo = { id,title,country,distance,elevation,provider,category,routeHash}

    data.hasVideo = false;
    data.isLocal = true

    data.hasGpx = points?.find( p=> p.lat!==undefined) !== undefined

    if (category?.toLowerCase()==='demo') 
        data.isDemo = true;

    if (video) {
        data.hasVideo = true;
        if (video.format) data.videoFormat = video.format
        if (video.url && !data.videoUrl) data.videoUrl = video.url            
    }

    return data;
}

interface LegacyRouteApiDetail extends RouteApiDetail {
    decoded? : Array<RoutePoint>
}

export const createFromJson = (r:LegacyRouteApiDetail) => {
    const data = clone(r)
    if (data.decoded) {
        data.points = data.decoded
        delete data.decoded
    }
    
    const routeInfo = buildRouteInfo(data)
    const route = new Route(routeInfo,data)
    validateRoute(route)

    return route;
}

const addMissingIndexes =(points:Array<RoutePoint>) => {
    points.forEach( (p,idx) =>{        
        p.cnt=p.cnt??idx    
    })

}
