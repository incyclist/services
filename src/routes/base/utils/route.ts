import { calculateDistance } from "../../../utils/geo";
import { Route } from "../../list";
import { RouteSegment } from "../types";

const MAX_LAPMODE_DISTANCE = 50;    // maximume distance between start and stop position

export const checkIsLoop = (route:Route):boolean =>  {
    const {data,details}    = route

    if ( !details?.points?.length) {
        data.isLoop = false;
        return false;
    }


    const points = details.points
    const maxDistance = MAX_LAPMODE_DISTANCE

    const p1 = points[0];
    const p2 = points[points.length-1];

    if (p1===undefined || p2===undefined) {
        data.isLoop = false;
        return false;
    }

    const dist = Math.abs( calculateDistance(p1.lat,p1.lng, p2.lat,p2.lng) );

    data.isLoop =  (dist<=maxDistance);
    return data.isLoop
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

