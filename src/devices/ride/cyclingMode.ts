import { CyclingMode } from "incyclist-devices"

/**
 * Determines whether virtual shifting (gear-based load control) is active for the given cycling
 * mode.
 *
 * This is the single source of truth for this check (FIXES_BACKLOG #37) - shared by
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
 * Determines the load-button semantics for the given cycling mode (FIXES_BACKLOG #37):
 * - `'power'`  ERG mode (or no mode/device active yet) - buttons nudge `targetPower`/FTP, exactly
 *              as they always have (see `WorkoutRide.powerUp()`/`powerDown()`).
 * - `'gear'`   SIM/Resistance mode with virtual shifting enabled - buttons perform a gear shift,
 *              via the exact same device mechanism a non-workout ride's `ShiftingControl` uses.
 *              Once the rider is in this mode, the current step's power target becomes purely
 *              informational - the rider manages load themselves via cadence and/or gear.
 * - `'hidden'` SIM/Resistance mode with virtual shifting disabled - there is no gear concept and
 *              no power target to nudge, so the buttons are meaningless and should not be shown.
 *
 * @param mode the rider's current cycling mode, or undefined if no device/mode is active yet
 */
export function getLoadButtonMode(mode: CyclingMode): LoadButtonMode {
    if (!mode)
        return 'power'

    if (mode.isSIM() || mode.isResistance()) {
        return isVirtualShiftingEnabled(mode) ? 'gear' : 'hidden'
    }

    return 'power'
}
