import { RoutePoint } from '../routes/base/types';
import {rad,abs}  from './math'


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

