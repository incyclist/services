import type { ExclusionReason, ExclusionScope } from '../configuration/model/exclusion'

/**
 * Shape shared by {@link CapabilityData} and the narrower, display-facing capability shapes
 * that derive status/row text from it - just enough to decide whether a capability actually
 * takes part in pairing/readiness, regardless of which layer is asking.
 *
 * `disabled` (the rider's saved tile switch) and `excluded` (a session-only exclusion, never
 * persisted) are kept apart because they mean different things on screen, even though both
 * take a capability out of readiness.
 *
 * `excluded`, when set, always describes `selected` itself - never some other device still
 * remembered for this capability. Whoever fills in this shape (today, only
 * `DeviceConfigurationService`, via `findExclusion()`) is responsible for that guarantee;
 * `isCapabilityActive()` below just trusts it rather than re-deriving it.
 */
export interface ActivatableCapability {
    selected?: string
    disabled?: boolean
    excluded?: { reason: ExclusionReason, scope: ExclusionScope }
}

/**
 * Whether a capability counts as "taking part": it has a selected device, the rider hasn't
 * switched it off, and nothing has excluded it for this visit/session. A capability a reader
 * only wants to know "which device is remembered here" for (e.g. the tile's device name)
 * should keep reading `selected` directly instead of calling this.
 */
export const isCapabilityActive = (c: ActivatableCapability|undefined): boolean =>
    Boolean(c?.selected) && !c?.disabled && !c?.excluded
