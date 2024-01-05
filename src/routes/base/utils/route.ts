import { geo } from "../../../utils";
import { calculateDistance } from "../../../utils/geo";
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

    updateSlopes(route.points);
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




