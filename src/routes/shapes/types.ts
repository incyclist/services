/**
 * One point of a route's decimated preview shape.
 *
 * Carries exactly what the route list row draws from: the map reads `lat`/`lng`, the elevation
 * strip plots `{x: routeDistance, y: elevation}`. `lat`/`lng` are absent for a route without
 * geo coordinates (e.g. a video route that only has an elevation profile), `elevation` is absent
 * for a route without elevation data.
 */
export interface RouteShapePoint {
    lat?: number
    lng?: number
    elevation?: number
    routeDistance: number
}

/** A route's decimated preview shape (~100 points), ordered by `routeDistance`. */
export type RouteShape = Array<RouteShapePoint>

/**
 * The persisted record - one per route id, in its own repository so the route descriptions
 * record is not affected by it.
 */
export interface RouteShapeRecord {
    id: string
    /** Version of the decimation that produced `points`; a record of another version is ignored
     *  and recomputed on the next details load. */
    version: number
    points: RouteShape
}
