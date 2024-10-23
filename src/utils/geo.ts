import { RoutePoint } from '../routes/base/types';
import {rad,abs, degrees}  from './math'
import { Vector } from './vector';


const rEarth = 6378.100;

export type LatLng = {
    lat:number;
    lng:number
}

/**
 * Calculates the distance between the two points using the haversine method.
 * @param {number} lat1 The latitude of the first point.
 * @param {number} lon1 The longtitude of the first point.
 * @param {number} lat2 The latitude of the first point.
 * @param {number} lon2 The longtitude of the first point.
 * @returns {number} The distance in meters between the two points.
**/
export const calculateDistance = (lat1:number, lon1:number, lat2:number, lon2:number, radius=rEarth*1000):number =>{
    const R = radius;
    const dLat = rad(lat2 - lat1),dLon = rad((lon2 - lon1));

	lat1 = rad(lat1);
	lat2 = rad(lat2);

	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance =  abs(R * c);
    
    return distance;
}

/**
 * calculate the distance between two points or route points
 * 
 * @param p1 The first point
 * @param p2 The second point
 * @param props.abs  defines if the absolute value of the disctance should nbe returned
 * @param props.latLng  if true the distance will be calculated based on the coordinates, otherwise it will calculate based on the distance on the route
 *
 * @returns {LatLng} The resulting distance (in meters)
**/

export const distanceBetween = (p1:LatLng|RoutePoint,p2:LatLng|RoutePoint,props={abs:true,latLng:true}):number => {
    if (p1===undefined)
        return 0;

    let dist;

    const rp1 = p1 as RoutePoint;
    const rp2 = p2 as RoutePoint;
    if (!props.latLng && rp1.routeDistance!==undefined && rp2.routeDistance!==undefined) 
        dist=rp2.routeDistance-rp1.routeDistance;
    else 
        dist=calculateDistance(p1.lat,p1.lng,p2.lat,p2.lng);
    
    return props.abs ? abs(dist) : dist;
}

/**
 * returns a point that lies between two points specified
 * 
 * @param {LatLng} p1 The first point
 * @param {LatLng} p2 The second point
 * @param {LatLng} offset  distance in meter to the first point
 *
 * @returns {LatLng} The resulting point
**/
export const getPointBetween = (p1:LatLng,p2:LatLng,offset:number):LatLng => {
    const distanceBetweenP1P2 = distanceBetween(p1,p2) ;
    if (offset>distanceBetweenP1P2)
        return p2;

    const m = offset/distanceBetweenP1P2;
    const lat= p1.lat + (p2.lat-p1.lat)*m;
    const lng = p1.lng + (p2.lng-p1.lng)*m;
    return {lat,lng};
}

/**
 * returns a point that lies on the continuation on the line between two points
 * @param {LatLng} p1 The first point
 * @param {LatLng} p2 The second point
 * @param {LatLng} offset The distance in meters after point 2 
 *
 * @returns {LatLng} The resulting point
**/
export const getPointAfter = (p1:LatLng,p2:LatLng,offset:number):LatLng => {
    const distanceBetweenP1P2 = distanceBetween(p1,p2) ;

    const m = (offset+distanceBetweenP1P2)/distanceBetweenP1P2;
    const lat= p1.lat + (p2.lat-p1.lat)*m;
    const lng = p1.lng + (p2.lng-p1.lng)*m;
    return {lat,lng};
}

export const getLatLng = (position:LatLng|Array<number>):LatLng => {
    
    if ( Array.isArray(position)) {
        return { lat:position[0],lng:position[1] }
    }

    if ( position.lat!==undefined && position.lng!==undefined)  {
        return position;
    }
}



/**
 * Returns the (initial) bearing between two points identified by lat1,lon1 and lat2,lon2
 * 
 * @param   {number} lat1 - Latitude of starting point
 * @param   {number} lon1 - longitude of starting point
 * @param   {number} lat2 - latitude of destination point
 * @param   {number} lon2 - longitude of destination point
 * @returns {number} Initial bearing in degrees from north.
 *
 * @example
 *     var b1 = calculateHeaderFromPoints(52.205, 0.119,48.857, 2.351 ); // 156.2°
 */

export const calculateHeaderFromPoints = (p1:LatLng, p2:LatLng):number => {

	// tanθ = sinΔλ⋅cosφ2 / cosφ1⋅sinφ2 − sinφ1⋅cosφ2⋅cosΔλ
	// see mathforum.org/library/drmath/view/55417.html for derivation
    try {
        if (!p1?.lat || !p1?.lng || !p2?.lat || !p2?.lng)
        return;

        const φ1 = rad(p1.lat);
        const φ2 = rad(p2.lat);    
        const Δλ = rad(p2.lng-p1.lng)

        const y  = Math.sin(Δλ) * Math.cos(φ2);
        const x  = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
        const θ  = Math.atan2(y, x);

        return ( degrees(θ)+360) % 360;

    }
    catch {
        return;
    }
}

/* 
    return the crossing point between the two vectors AB and CD

*/

export function crossing( AB, CD, AC ) {
    if ( AB===undefined || (!Vector.isVector(AB) && !Array.isArray(AB)) ) throw new Error('AB is not a vector');
    if ( CD===undefined || (!Vector.isVector(CD) && !Array.isArray(CD)) ) throw new Error('CD is not a vector');
    if ( AC===undefined || (!Vector.isVector(AC) && !Array.isArray(AC)) ) throw new Error('AC is not a vector');

    // if both lines are parallel, we only need to check if they are overlapping
    if ( AB.isParallel(CD) ) {
        return crossingParallel(AB,CD,AC);
    }
    else {
        return crossingNotParallel(AB,CD,AC);
    }
}

const crossingParallel = (AB,CD,AC) =>{
    if (!AB.isParallel(AC))
        return undefined;

    // are both lines pointing in the same direction?
    if ( AB.isSameDirection(CD)) {
        if ( AB.isSameDirection(AC) && AB.len()>=AC.len() )
            return AC;
        else    
            return undefined;
    }

    let AD = Vector.add(AC,CD);

    // CD is pointing in the oposite direction, D->C
    if (AB.isParallel(AD) && AB.len()>=AD.len() ){
        // we need to check if point D is closer to A than point C (ie. vector CD shows in the oposite direction)
        let da = AD.len();
        let dc = da-CD.len();
        if ( dc>=0 ) 
            return AD
        else
            return new Vector([0,0])
    } 
    else {
        return undefined
    }
}

const crossingNotParallel = (AB,CD,AC) =>{
    /* Crossing is when: 
        [AB]*x  = [AC]+[CD]*y
        =>
        AB.x*x = AC.x+CD.x*y
        AB.y*x = AC.y+CD.y*y
    */
        let x,y;
        if (abs(AB.x)<0.0001) {
            y = AC.x/CD.x*-1;
            x = (AC.y+CD.y*y)/AB.y;
            return Vector.multiply(x,AB); 
        }
        if (abs(AB.y)<0.0001) {
            y = AC.y/CD.y*-1;
            x = (AC.x+CD.x*y)/AB.x;
            return Vector.multiply(x,AB); 
        }
        if (abs(CD.x)<0.0001) {
            x = AC.x/AB.x;        
            return Vector.multiply(x,AB); 
        }
        if (abs(CD.y)<0.0001) {
            x = AC.y/AB.y;        
            return Vector.multiply(x,AB); 
        }

        y = (AB.x*AC.y/AB.y-AC.x)/(CD.x-AB.x*CD.y/AB.y)
        x = (AC.y+CD.y*y)/AB.y
        return Vector.multiply(x,AB); 
    
}
