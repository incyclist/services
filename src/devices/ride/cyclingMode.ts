import { CyclingMode } from "incyclist-devices"

/**
 * Determines whether virtual shifting (gear-based load control) is active for the given cycling
 * mode.
 *
 * This is the single source of truth for this check - shared by
 * `RideDisplayService` (which uses it to decide whether to show the non-workout `ShiftingControl`)
 * and `WorkoutRide` (which uses it, via `getLoadButtonMode()` below, to decide what the workout
 * dashboard's load buttons should mean). Do not re-derive this check anywhere else.
 *
 * @param mode the rider's current cycling mode, or undefined if no device/mode is active yet
 */
export function isVirtualShiftingEnabled(mode: CyclingMode): boolean {
    try {
        if (!mode)
            return false

        if (mode.isSIM()) {
            const virtshiftMode = mode.getSetting('virtshift') as unknown as string
            return (virtshiftMode==='Mixed' || virtshiftMode==='Incyclist' || virtshiftMode==='SmartTrainer'|| virtshiftMode==='Enabled')
        }

        if (mode.isResistance()) {
            return true
        }

        return false
    }
    catch {
        return false
    }
}

/** What the workout dashboard's load-adjustment buttons should mean for the rider's current
 *  cycling mode (FIXES_BACKLOG #37). */
export type LoadButtonMode = 'power' | 'gear' | 'hidden'

/**
 * Determines the load-button semantics for the given cycling mode. An
 * explicit rule table, not an ERG-shaped default with carve-outs: anything that isn't ERG,
 * SIM+virtual-shifting, or Resistance is `'hidden'`, full stop.
 * - `'power'`  ERG mode (or no mode/device active yet) - buttons nudge `targetPower`/FTP, exactly
 *              as they always have (see `WorkoutRide.powerUp()`/`powerDown()`).
 * - `'gear'`   SIM mode with virtual shifting enabled - buttons perform a gear shift, via the
 *              exact same device mechanism a non-workout ride's `ShiftingControl` uses. Once the
 *              rider is in this mode, the current step's power target becomes purely
 *              informational - the rider manages load themselves via cadence and/or gear.
 *              Resistance mode (0-100%) is unconditionally the same: it's a gear-style stepped
 *              adjustment, not a power target, so it's handled identically to SIM + virtual
 *              shifting - not gated on `isVirtualShiftingEnabled()` for this branch.
 * - `'hidden'` Everything else: SIM mode with virtual shifting disabled (no gear concept, no power
 *              target to nudge), a PowerMeter-only mode (`incyclist-devices`'
 *              `PowerMeterCyclingMode`/`DaumPowerMeterCyclingMode`), or any other mode that is
 *              neither ERG, SIM, nor Resistance - nothing is controllable there, so neither Load
 *              nor Gear buttons mean anything.
 *
 * @param mode the rider's current cycling mode, or undefined if no device/mode is active yet
 */
export function getLoadButtonMode(mode: CyclingMode): LoadButtonMode {
    if (!mode)
        return 'power'

    if (mode.isERG())
        return 'power'

    if (mode.isSIM() && isVirtualShiftingEnabled(mode))
        return 'gear'

    if (mode.isResistance())
        return 'gear'

    return 'hidden'
}
