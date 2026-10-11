/**
 * Shape shared by {@link CapabilityData} and the narrower, display-facing capability shapes
 * that derive status/row text from it - just enough to decide whether a capability actually
 * takes part in pairing/readiness, regardless of which layer is asking.
 */
export interface ActivatableCapability {
    selected?: string
    disabled?: boolean
    excluded?: unknown
}

/**
 * Whether a capability counts as "taking part": it has a selected device, the rider hasn't
 * switched it off, and nothing has excluded it for this visit/session. A capability a reader
 * only wants to know "which device is remembered here" for (e.g. the tile's device name)
 * should keep reading `selected` directly instead of calling this.
 */
export const isCapabilityActive = (c: ActivatableCapability|undefined): boolean =>
    Boolean(c?.selected) && !c?.disabled && !c?.excluded
