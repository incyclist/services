import { sha256Base64Url } from '../../../link/utils'
import type { RouteApiDetail } from '../../base/api/types'
import { getRouteHash } from '../../base/utils/route'
import type { RouteDescriptorResponseBody, SharedRouteDescriptor } from '../types'
import type { DescriptorFailure } from './types'

/** A computer's route details could not be loaded; nothing was persisted. */
export class DescriptorLoadError extends Error {
    constructor(public readonly reason: DescriptorFailure, public readonly httpStatus = 0) {
        super(reason)
        this.name = 'DescriptorLoadError'
    }
}

/** Document names the host uses for descriptors; checked before the name goes into a URL. */
export const DESCRIPTOR_NAME_PATTERN = /^rd-[0-9a-f]{16}$/

/**
 * The document name of a descriptor response.
 *
 * @throws DescriptorLoadError `malformed` if the reply does not name a document with digest and size
 */
export const getDescriptorDocument = (res: RouteDescriptorResponseBody): { name: string, sha256: string } => {
    if (typeof res.document !== 'string' || !DESCRIPTOR_NAME_PATTERN.test(res.document) || typeof res.sha256 !== 'string' || !res.sha256)
        throw new DescriptorLoadError('malformed')
    return { name: res.document, sha256: res.sha256 }
}

/**
 * Checks a downloaded descriptor: the digest announced by the computer, the shape, and that the
 * points hash to the route's key, so that a computer can not hand out other geometry than it announced.
 *
 * @throws DescriptorLoadError `hash-mismatch` or `malformed`
 */
export const parseDescriptor = (text: string, sha256: string, routeKey: string): SharedRouteDescriptor => {
    if (sha256Base64Url(text) !== sha256)
        throw new DescriptorLoadError('hash-mismatch')

    let descriptor: SharedRouteDescriptor
    try {
        descriptor = JSON.parse(text)
    }
    catch {
        throw new DescriptorLoadError('malformed')
    }
    const details = descriptor?.details
    if (descriptor?.v !== 1 || descriptor.routeKey !== routeKey || typeof details !== 'object' || details === null
        || !Array.isArray(details.points) || typeof details.video !== 'object' || details.video === null)
        throw new DescriptorLoadError('malformed')

    if (getRouteHash({ ...details, id: routeKey } as RouteApiDetail) !== routeKey)
        throw new DescriptorLoadError('hash-mismatch')
    return descriptor
}
