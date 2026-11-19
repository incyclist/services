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

const SYNCED_COLLECTIONS = new Set(['pinned', 'bucket list'])

/**
 * Checks if a collection is one of the system collections whose routes are synced (pinned routes and bucket list).
 * The names are `pinned` and `{{bucket_list}}`, but are matched case insensitively and without the decoration
 */
export const isSyncedCollection = (collection: { name?: string }): boolean => {
    const name = (collection.name ?? '').toLowerCase().replaceAll(/[{}_]/g, ' ').trim().replaceAll(/\s+/g, ' ')
    return SYNCED_COLLECTIONS.has(name)
}

/**
 * Checks if a route of the list of routes of the user is active: not archived.
 * (`archived` is `null` for routes that are not owned by the user. The list of the user only contains own routes, so the
 * owner is deliberately not compared with the user id: a mismatch of ids would hide all routes)
 */
export const isOwnActiveRoute = (route: RideWithGpsRoute): boolean => route.archived !== true && route.archived !== null

const describeError = (error: RideWithGpsTaskError): string =>
    `Upload rejected by RideWithGPS: ${error.code}${error.message ? ' (' + error.message + ')' : ''}`

/** @returns the error for a task that ended with another status than `completed` */
export const getTaskFailure = (task: RideWithGpsTask): Error =>
    task.errors?.length ? new Error(describeError(task.errors[0])) : new Error(`RideWithGPS upload ended with status ${task.status}`)

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
