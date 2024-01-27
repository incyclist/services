import { geo } from "../../../utils";
import { LatLng, calculateDistance } from "../../../utils/geo";
import { valid } from "../../../utils/valid";
import { RouteApiDetail } from "../api/types";
import { Route } from "../model/route";
import { RoutePoint, RouteSegment } from "../types";
import md5 from 'md5'

const MAX_LAPMODE_DISTANCE = 50;    // maximume distance between start and stop position

export const checkIsLoop = (_route:Route|Array<RoutePoint>):boolean =>  {

    let points;
    let route;

    if (!_route)
        return false;

    if (Array.isArray(_route)) {
        points = _route as Array<RoutePoint>
    }
    else {
        route = (_route as Route)
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

export const updateSlopes = (points: Array<RoutePoint>):void => {
   
    const lapMode = checkIsLoop(points)

    let prevPoint = null;

    points.forEach( (point,i) => {
    
        if ( i>0) {
            if (point.distance===undefined) {
                point.distance = geo.distanceBetween(prevPoint,point);
            }
            prevPoint.slope = (point.elevation-prevPoint.elevation)/point.distance*100;
        }
    
        
        if (i===points.length-1 && points.length>1)  {

            point.slope = prevPoint.slope;
            if (lapMode) {
                const p1 = point;
                const p2 = points[0];
                const distance = geo.calculateDistance(p1.lat,p1.lng,p2.lat,p2.lng);
                if ( distance===0) {
                    point.slope = p2.slope;
                    point.elevation = p2.elevation;
                }
                else {
                    point.slope = (p2.elevation-p1.elevation)/distance*100;
    
                }
            }
        }
        prevPoint = point;

    })

}



// TODO: RepoDetaisl might already have selectableSegments member
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


export const validateRoute = (route:RouteApiDetail):void =>{
    if (!route?.points?.length)
        return;

    validateDistance(route.points)
    updateSlopes(route.points);

}

export const validateDistance = (points:Array<RoutePoint>) => {
    let prev = undefined
    points.forEach( (p,idx) => {
        if (!p.routeDistance) {
            if (idx==0) {
                p.routeDistance=0;
            }
            else {
                p.routeDistance = (prev?.distance||0)+(prev?.routeDistance||0)
            }
        }
        prev = p;
    })

}


export const getTotalElevation = (route:RouteApiDetail):number =>{
    if (!route?.points?.length)
        return 0;

    let elevation = 0;
    let prev = undefined
    route.points.forEach( (p,idx)=>{

        if (idx>0) {
            const e = p.elevation - prev.elevation
            if (e>0)
                elevation+=e
        }
        prev = p;
    })
    return elevation
}

export const getTotalDistance = (route:RouteApiDetail):number =>{
    if (!route?.points?.length)
        return 0;

    return route.points[ route.points.length-1].routeDistance
}

export const getRouteHash = (route:RouteApiDetail):string => {
    let json;
    if (!route?.points) {

        if ( route.epp && route.epp.programData ) {
            // generate unique hash from epp
            const programData = route.epp.programData;
            json = { decoded:programData.map( p => ({d:p.distance, e:p.elevation})) }                        
        }        
        return undefined
    }
    else {
        json = { decoded:route.points.map( p => ({lat:p.lat, lng: p.lng})) }            
    }

    const routeHash = md5(JSON.stringify(json));
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

const getLapTotalDistance = ( route:Route, point:LapPoint):number =>{
    const lap = valid(point.lap) ? point.lap : 1
    return (lap-1)*route.description.distance + point.routeDistance
}


export const getNextPosition = ( route:Route, props:GetNextPositionProps ) => {
    const points = route.points

    if (props===undefined) {
        return;
    }
    if ( props.distance===undefined && props.routeDistance===undefined) {
        return;
    }
    if ( props.routeDistance===undefined && (props.prev===undefined || props.prev.routeDistance===undefined))  {
        return;
    }
        
    
    const distance = props.distance !== undefined ? props.distance: props.routeDistance-getLapTotalDistance(route,props.prev);
    const targetRouteDistance = props.routeDistance!==undefined ? props.routeDistance : getLapTotalDistance(route,props.prev)+distance;


    let pPrev=props.prev || { ...points[0],lap:1};        
    let point,p;

    let lap = valid(pPrev.lap)? pPrev.lap : 1
    let cnt = props.prev?.cnt || 0
    
    let targetRouteInLap;
    if( route.description.isLoop ) {
        
        targetRouteInLap = targetRouteDistance % route.description.distance
        const prevTargetRouteinLap =  props.prev.routeDistance

        if ( prevTargetRouteinLap>targetRouteInLap) {
            cnt=0;
            lap++;
        }
    }
    else {
        lap=1;
        targetRouteInLap = targetRouteDistance
    }


    for ( ;cnt<points.length;cnt++) {
        p = points[cnt];
        if ( p.routeDistance>=targetRouteInLap) {
            point = {...p};

            if (pPrev!==undefined ){
                let pDest;
                if ( pPrev.cnt===point.cnt) {
                    pDest = geo.getPointBetween( props.prev,p, distance);   
                }
                else {
                    const distanceToPrev = targetRouteInLap-pPrev.routeDistance;
                    pDest = geo.getPointBetween( pPrev,p, distanceToPrev);    
                    point.cnt = pPrev.cnt
                }
                point.lat = pDest.lat;
                point.lng = pDest.lng;
                point.routeDistance = targetRouteInLap;
                point.distance  = point.routeDistance-pPrev.routeDistance

                if ( route.description.isLoop) {
                    point.lap = lap;
                }
            }
             
            return point; 

        }   
        pPrev = p;
    }

    return;

}

interface GetPositionProps {
    cnt?: number        // index in Array
    distance?: number

    nearest?: boolean
    latlng?: LatLng
}

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

const getPointAtIndex = (route:Route,idx:number):RoutePoint => {
    const points = route.points
    if (idx>=points.length || idx<0)
        return;

    const point = {...points[idx]}
    point.cnt = idx
    return point;
}

const getPointAtDistance = (route:Route,routeDistance:number, nearest:boolean=true):RoutePoint => {
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




