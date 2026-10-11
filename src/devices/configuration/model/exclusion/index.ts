import { IncyclistCapability } from "incyclist-devices"

/**
 * Why a capability is temporarily excluded from the effective selection, without touching the
 * rider's persisted choice of device.
 */
export type ExclusionReason = 'not-available' | 'user'

/**
 * How long an exclusion lasts.
 * - `until-next-pairing`: cleared the next time the Pairing page is opened.
 * - `app-session`: survives Pairing page opens, cleared only by an explicit include or app exit.
 */
export type ExclusionScope = 'until-next-pairing' | 'app-session'

/** A single capability excluded from the effective selection, in memory only. */
export interface CapabilityExclusion {
    capability: IncyclistCapability
    /** the configured device this exclusion binds to; dropped once that capability's persisted selection changes */
    udid: string
    reason: ExclusionReason
    scope: ExclusionScope
    /** whether the device was connected at the moment it was excluded */
    wasConnected: boolean
    since: number
}

/** Input to excludeCapability()/excludeDevice(); `wasConnected` defaults to `false`. */
export type ExclusionOptions = Pick<CapabilityExclusion, 'reason' | 'scope'> & { wasConnected?: boolean }

/** Selects which exclusions clearExclusions() removes; an unset field matches anything. */
export interface ExclusionFilter {
    capability?: IncyclistCapability
    udid?: string
    scope?: ExclusionScope
}
