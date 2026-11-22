import { LINK_PROTOCOL_RANGE } from './consts'
import type { ClientHelloBody, LinkErrorBody, LinkProtocolRange, LinkProtocolVersion } from './types'

const isVersion = (v: unknown): v is LinkProtocolVersion => {
    const version = v as LinkProtocolVersion
    return Number.isInteger(version?.major) && Number.isInteger(version?.minor)
        && version.major >= 0 && version.minor >= 0
}

/** true if the value is a well-formed range with `min <= max` (compared by major, then minor). */
export const isLinkProtocolRange = (range: unknown): range is LinkProtocolRange => {
    const r = range as LinkProtocolRange
    if (!isVersion(r?.min) || !isVersion(r?.max))
        return false
    return r.min.major < r.max.major || (r.min.major === r.max.major && r.min.minor <= r.max.minor)
}

/** Highest minor a range supports within `major`, or `undefined` if the range does not bound it. */
const maxMinorWithin = (range: LinkProtocolRange, major: number): number | undefined =>
    range.max.major === major ? range.max.minor : undefined

/**
 * Picks the protocol version both ends speak.
 *
 * Only the major version decides compatibility: minors within a major are additive. The
 * chosen major is the highest one inside both ranges; the chosen minor is the lower of the
 * two ends' highest minor for that major.
 *
 * @param client the phone's supported range (from its `hello`)
 * @param server this end's supported range (default: {@link LINK_PROTOCOL_RANGE})
 * @returns the chosen version, or `undefined` if no common major exists (answer with
 *   {@link createUnsupportedProtocolError})
 */
export const negotiateLinkProtocol = (client: LinkProtocolRange, server: LinkProtocolRange = LINK_PROTOCOL_RANGE)
    : LinkProtocolVersion | undefined => {
    if (!isLinkProtocolRange(client) || !isLinkProtocolRange(server))
        return undefined
    const major = Math.min(client.max.major, server.max.major)
    if (major < Math.max(client.min.major, server.min.major))
        return undefined

    const minors = [maxMinorWithin(client, major), maxMinorWithin(server, major)]
        .filter((m): m is number => m !== undefined)
    return { major, minor: Math.min(...minors) }
}

/**
 * Desktop: the protocol version to answer a client `hello` with.
 *
 * @param hello the received `hello` body
 * @param server this end's supported range
 * @returns the chosen version, or `undefined` for a malformed hello or no common major
 */
export const negotiateLinkHello = (hello: ClientHelloBody, server: LinkProtocolRange = LINK_PROTOCOL_RANGE)
    : LinkProtocolVersion | undefined => {
    if (hello?.role !== 'client')
        return undefined
    return negotiateLinkProtocol(hello.protocol, server)
}

/**
 * Body of the explicit refusal sent when no common major version exists.
 *
 * @param server this end's supported range, so the phone can tell the user which side to update
 */
export const createUnsupportedProtocolError = (server: LinkProtocolRange = LINK_PROTOCOL_RANGE): LinkErrorBody => ({
    code: 'unsupported-protocol',
    supported: { min: { ...server.min }, max: { ...server.max } },
})

/**
 * Phone: checks the version chosen by the desktop's `hello`. Its major must be one the phone
 * supports; any minor is accepted, because minors are additive.
 *
 * @param chosen the `protocol` of the desktop's `hello`
 * @param client this end's supported range
 */
export const isLinkProtocolAccepted = (chosen: LinkProtocolVersion, client: LinkProtocolRange = LINK_PROTOCOL_RANGE): boolean =>
    isVersion(chosen) && chosen.major >= client.min.major && chosen.major <= client.max.major
