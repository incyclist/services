import type { RouteApiDetail } from '../base/api/types'
import type { RouteInfo } from '../base/types'
import { buildSummary } from './catalog'
import type { SharedRouteDescriptor, SharedRouteDescriptorVideo } from './types'

const DETAIL_KEYS = [
    'localizedTitle', 'country', 'distance', 'elevation', 'description', 'points', 'infoTexts', 'epp', 'gpxDisabled', 'elevationShifted',
] as const

const VIDEO_KEYS = ['framerate', 'width', 'height', 'format', 'mappings', 'selectableSegments', 'segments', 'informations'] as const

const pick = <T extends object>(source: T | undefined, keys: readonly (keyof T)[]): Partial<T> => {
    const target: Partial<T> = {}
    for (const key of keys) {
        if (source?.[key] !== undefined && source[key] !== null)
            target[key] = source[key]
    }
    return target
}

/**
 * Builds the document a computer hands to a paired phone so that it can show and ride a local route.
 *
 * Everything is copied from a whitelist; nothing is deleted from a copy of the stored record, so a
 * field added to the stored record later can not leak. In particular none of the following is part
 * of the result: video file or url, preview urls, source or provider information, references to
 * other routes, and usage or import timestamps.
 */
export const buildRouteDescriptor = (routeKey: string, descr: RouteInfo, details: RouteApiDetail): SharedRouteDescriptor => {
    const description: SharedRouteDescriptor['description'] = { ...buildSummary(descr) }
    if (descr.segments !== undefined)
        description.segments = descr.segments

    const result: SharedRouteDescriptor['details'] = { title: details.title ?? descr.title ?? '', ...pick(details, DETAIL_KEYS) }
    if (details.video)
        result.video = pick(details.video, VIDEO_KEYS) as SharedRouteDescriptorVideo
    // legacy records keep the selectable segments in the root of the details
    if (result.video && !result.video.selectableSegments && details.selectableSegments)
        result.video.selectableSegments = details.selectableSegments

    return { v: 1, routeKey, description, details: result }
}
