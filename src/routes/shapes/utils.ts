import type { RoutePoint } from '../base/types'
import type { RouteShape, RouteShapePoint } from './types'

/** Number of points a route shape is decimated to. */
export const ROUTE_SHAPE_POINTS = 100

/** Decimal places kept per value - ~1 m for lat/lng, far beyond what a thumbnail can show. */
export const ROUTE_SHAPE_DIGITS = 5

const FACTOR = 10**ROUTE_SHAPE_DIGITS

/** Rounds to {@link ROUTE_SHAPE_DIGITS} decimals; `undefined` for anything that is not a finite number. */
export const roundShapeValue = (value:number):number|undefined => {
    if (typeof value!=='number' || !Number.isFinite(value))
        return undefined
    return Math.round(value*FACTOR)/FACTOR
}

const isFiniteNumber = (value:unknown):value is number => typeof value==='number' && Number.isFinite(value)

/**
 * Largest-Triangle-Three-Buckets: selects `threshold` indices out of `n` points so that the
 * polyline through them keeps the visual shape of the original (peaks, turns) - unlike an even
 * stride, which silently drops a switchback or a summit that falls between two samples.
 *
 * Always keeps the first and the last point. Selection is invariant to scaling either axis, so
 * no projection or normalisation of the input is needed.
 *
 * @param xs x value per point
 * @param ys y value per point
 * @param threshold number of indices to select
 * @returns selected indices in ascending order
 */
export const selectLttbIndices = (xs:Array<number>, ys:Array<number>, threshold:number):Array<number> => {
    const n = xs.length
    if (threshold>=n || threshold<3)
        return Array.from({length:n}, (_,i)=>i)

    const selected:Array<number> = [0]
    const bucketSize = (n-2)/(threshold-2)
    let a = 0

    for (let i=0; i<threshold-2; i++) {
        const [avgX,avgY] = getBucketAverage(xs, ys, Math.floor((i+1)*bucketSize)+1, Math.min(Math.floor((i+2)*bucketSize)+1, n))
        const next = getLargestTriangleIndex(xs, ys, a, avgX, avgY, Math.floor(i*bucketSize)+1, Math.floor((i+1)*bucketSize)+1)
        selected.push(next)
        a = next
    }

    selected.push(n-1)
    return selected
}

const getBucketAverage = (xs:Array<number>, ys:Array<number>, start:number, end:number):[number,number] => {
    let sumX = 0
    let sumY = 0
    for (let j=start; j<end; j++) {
        sumX += xs[j]
        sumY += ys[j]
    }
    const cnt = Math.max(end-start, 1)
    return [sumX/cnt, sumY/cnt]
}

const getLargestTriangleIndex = (xs:Array<number>, ys:Array<number>, a:number, avgX:number, avgY:number, start:number, end:number):number => {
    let maxArea = -1
    let idx = start
    for (let j=start; j<end; j++) {
        const area = Math.abs( (xs[a]-avgX)*(ys[j]-ys[a]) - (xs[a]-xs[j])*(avgY-ys[a]) )
        if (area>maxArea) {
            maxArea = area
            idx = j
        }
    }
    return idx
}

/**
 * Selects the indices of the points to keep for a route shape of at most `target` points.
 *
 * The shape has two consumers with different geometries - the map (lat/lng) and the elevation
 * strip (routeDistance/elevation) - so when both are available the budget is split between them
 * and the two selections are merged: a long straight climb keeps its elevation profile even if
 * the map selection spends its points on switchbacks elsewhere.
 *
 * @param points the route's points (all with a finite `routeDistance`)
 * @param hasGeo true when every point has finite lat/lng
 * @param hasElevation true when every point has a finite elevation
 * @param target maximum number of points to keep
 */
export const selectShapeIndices = (points:Array<RoutePoint>, hasGeo:boolean, hasElevation:boolean, target:number=ROUTE_SHAPE_POINTS):Array<number> => {
    const byDistance = () => selectLttbIndices(points.map(p=>p.routeDistance), points.map(p=>p.elevation), hasGeo ? Math.floor(target/2) : target)
    const byGeo = () => selectLttbIndices(points.map(p=>p.lng), points.map(p=>p.lat), hasElevation ? Math.ceil(target/2) : target)

    if (points.length<=target)
        return Array.from({length:points.length}, (_,i)=>i)

    if (hasGeo && hasElevation) {
        const merged = new Set([...byGeo(), ...byDistance()])
        return [...merged].sort((a,b)=>a-b)
    }
    if (hasGeo)
        return byGeo()
    if (hasElevation)
        return byDistance()

    // neither: nothing but distance to go by - an even stride is all that is left
    return selectLttbIndices(points.map(p=>p.routeDistance), points.map(()=>0), target)
}

const toShapePoint = (p:RoutePoint, hasGeo:boolean, hasElevation:boolean):RouteShapePoint => {
    const point:RouteShapePoint = { routeDistance: roundShapeValue(p.routeDistance) }
    if (hasGeo) {
        point.lat = roundShapeValue(p.lat)
        point.lng = roundShapeValue(p.lng)
    }
    if (hasElevation)
        point.elevation = roundShapeValue(p.elevation)
    return point
}

/**
 * Builds the decimated preview shape of a route: at most {@link ROUTE_SHAPE_POINTS} points,
 * each value rounded to {@link ROUTE_SHAPE_DIGITS} decimals.
 *
 * @param points the route's full point list
 * @returns the shape, or `undefined` if the route has no usable points
 */
export const buildRouteShape = (points:Array<RoutePoint>|undefined):RouteShape|undefined => {
    if (!Array.isArray(points))
        return undefined

    const usable = points.filter( p => isFiniteNumber(p?.routeDistance))
    if (!usable.length)
        return undefined

    const hasGeo = usable.every( p => isFiniteNumber(p.lat) && isFiniteNumber(p.lng))
    const hasElevation = usable.every( p => isFiniteNumber(p.elevation))

    return selectShapeIndices(usable, hasGeo, hasElevation).map( idx => toShapePoint(usable[idx], hasGeo, hasElevation))
}
