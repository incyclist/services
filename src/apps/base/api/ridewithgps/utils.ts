import {
    RideWithGpsRoute, RideWithGpsTask, RideWithGpsTaskError, RideWithGpsTimeDataMissingError, RideWithGpsUploadResult
} from './types'

/** a route with at least this share of unpaved surface is not a road route */
export const UNPAVED_THRESHOLD_PCT = 50

const OFFROAD_TYPES = new Set(['cycling:gravel', 'cycling:mountain', 'cycling:cyclocross'])
const OTHER_SPORTS = ['walking:', 'running:', 'driving:', 'motorcycling:', 'swimming:', 'snow:']

const isClearlyNotRoad = (type: string): boolean => OFFROAD_TYPES.has(type) || OTHER_SPORTS.some(sport => type.startsWith(sport))

/**
 * Checks if a route is relevant for Incyclist: any kind of road cycling.
 *
 * Routes are only excluded if they are clearly marked otherwise: all activity types are other sports, mountain biking or gravel
 * (or, without activity types, the route is mostly unpaved). If the type or the surface is not known, the route is included.
 *
 * Note: the list of routes does not contain `activity_types`, only the detail of a route does
 */
export const isRoadCyclingRoute = (route: RideWithGpsRoute): boolean => {
    const types = route.activity_types
    if (Array.isArray(types) && types.length > 0)
        return !types.every(isClearlyNotRoad)

    return !(typeof route.unpaved_pct === 'number' && route.unpaved_pct >= UNPAVED_THRESHOLD_PCT)
}

/**
 * Checks if a route is one of the (not archived) routes of the user.
 * `archived` is `null` for routes that are not owned by the user
 *
 * @param route the route of the list
 * @param userId the id of the user (if known)
 */
export const isOwnActiveRoute = (route: RideWithGpsRoute, userId?: string): boolean => {
    if (route.archived === true || route.archived === null)
        return false

    return !(userId && route.user_id !== undefined && String(route.user_id) !== userId)
}

const describeError = (error: RideWithGpsTaskError): string =>
    `Upload rejected by RideWithGPS: ${error.code}${error.message ? ' (' + error.message + ')' : ''}`

/**
 * Evaluates a completed upload task
 *
 * @returns the id of the created trip, or the information that the trip already existed
 * @throws RideWithGpsTimeDataMissingError if the file has no time data
 * @throws Error if no trip was created
 */
export const getUploadResult = (task: RideWithGpsTask): RideWithGpsUploadResult => {
    const created = task.items?.find(item => item.item_type === 'trip') ?? task.items?.[0]
    if (created)
        return { tripId: String(created.item_id) }

    const errors = task.errors ?? []
    const duplicate = errors.find(e => e.code === 'duplicate')
    if (duplicate) {
        const tripId = duplicate.item_id === undefined || duplicate.item_id === null ? undefined : String(duplicate.item_id)
        return { tripId, duplicate: true }
    }

    const timeMissing = errors.find(e => e.code === 'time_data_missing')
    if (timeMissing)
        throw new RideWithGpsTimeDataMissingError(describeError(timeMissing))

    throw new Error(errors.length > 0 ? describeError(errors[0]) : 'RideWithGPS did not create a trip')
}
