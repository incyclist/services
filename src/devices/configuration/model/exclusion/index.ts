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

/**
 * A single capability excluded from the effective selection, in memory only - never written to
 * settings.
 *
 * Life cycle:
 * - created by `excludeCapability()`/`excludeDevice()`, bound to whichever device is that
 *   capability's persisted `selected` at that exact moment (see `udid` below)
 * - removed automatically the instant that capability's persisted `selected` changes for any
 *   reason - a new pick, an unselect, or a device being deleted and the slot reassigned - so an
 *   exclusion is never supposed to outlive the device it was raised against
 * - removed explicitly by `includeCapability()`/`clearExclusions()`, or once its `scope` expires
 *   (`until-next-pairing`)
 *
 * A reader that only has the capability name (not the current `selected`) must still re-check
 * `udid` against it before treating the exclusion as live, in case some future code path ever
 * skips the automatic removal above; `DeviceConfigurationService.findExclusion()` is that check,
 * and it's what every consumer of `excluded` (e.g. `isCapabilityActive()`) ultimately relies on.
 */
export interface CapabilityExclusion {
    capability: IncyclistCapability
    /** the device this exclusion binds to - must equal that capability's persisted `selected` for the exclusion to have any effect */
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
