import { geo } from "../../../utils";
import { calculateDistance } from "../../../utils/geo";
import { Route } from "../../list";
import { RoutePoint, RouteSegment } from "../types";

const MAX_LAPMODE_DISTANCE = 50;    // maximume distance between start and stop position

export const checkIsLoop = (_route:Route|Array<RoutePoint>):boolean =>  {

    let points;
    let route;

    if (!_route)
        return false;

    if (Array.isArray(route)) {
        points = route as Array<RoutePoint>
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



    if ( points?.length) {
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
            point.slope = (point.elevation-prevPoint.elevation)/point.distance*100;
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
    const {data,details}    = route

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

