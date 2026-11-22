/** Why copying a route's video to this device did not (or could not) happen. */
export type RouteCopyFailure =
    | 'no-space'        // not enough free space on this device (checked before any byte is pulled), or the disk filled up
    | 'unreachable'     // no computer that has the route answers (any more)
    | 'gone'            // the computers that answered no longer have the file
    | 'details'         // the details of the route could not be loaded from a computer
    | 'cancelled'       // the user cancelled
    | 'not-supported'   // route sharing is not available, or this device can not store downloads
    | 'unknown-route'   // the route is not in the route list
    | 'unknown'         // the transfer failed for another reason

/** What the UI shows for the copy of one route. After a successful copy the state is `idle` and the route has a local copy. */
export type RouteCopyState =
    | { status: 'idle' }
    | {
        status: 'copying'
        /** 0..100 */
        progress: number
        /** display name of the computer the video comes from, once known */
        sourceLabel?: string
    }
    | {
        status: 'failed'
        reason: RouteCopyFailure
        /** `no-space` only: what the video needs and what is free (bytes), for the message */
        sizeBytes?: number
        freeBytes?: number
    }

/** Event payload of `state-changed`. */
export interface RouteCopyStateEvent {
    routeKey: string
    state: RouteCopyState
}
