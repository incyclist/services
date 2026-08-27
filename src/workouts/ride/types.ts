import { Workout } from "../base/model"
import { StepDefinition } from "../base/model/types"
import { LoadButtonMode } from "../../devices"

export type { LoadButtonMode }

export interface WorkoutRequest {
    time: number
    minPower?: number
    maxPower?: number
    targetPower?: number
    minCadence?: number
    maxCadence?: number
    minHrm?: number
    maxHrm?: number
}

export interface ActiveWorkoutLimit extends WorkoutRequest{
    duration: number
    remaining: number
    /** The raw step definition this limit was resolved from (power/hrm/cadence Limits, steady/cooldown
     *  flags) - lets consumers (e.g. getStepTargetText) build a full target description without
     *  re-deriving it from the already-flattened min/max/target numbers above. */
    step?: StepDefinition
}

/** Result of WorkoutRide.powerUp()/powerDown(): which quantity was actually adjusted, and its new
 *  value - 'ftp' when the step target is defined relative to FTP (the Workout FTP itself was
 *  scaled, value in Watt), 'targetPower' when the current step allows a power range
 *  (minPower!==maxPower) and the user is nudging the target within that range directly, without
 *  touching FTP at all (value in Watt), 'gear' when `getLoadButtonMode()==='gear'` (SIM/Resistance
 *  mode with virtual shifting enabled, FIXES_BACKLOG #37) and the click performed a gear shift
 *  instead (value is the signed gearDelta that was applied, positive to shift up). */
export interface PowerAdjustmentResult {
    type: 'ftp' | 'targetPower' | 'gear'
    value: number
}

export interface WorkoutDisplayProperties {
    workout?:Workout,
    title?:string,
    ftp?:number,
    current?:ActiveWorkoutLimit,
    start?:number,
    stop?:number
    mode?: string,
    canShowBackward?: boolean,
    canShowForward?: boolean,
    /** What a click on the dashboard's load-adjustment buttons currently does (FIXES_BACKLOG #37) -
     *  see `getLoadButtonMode()` in `incyclist-devices`' ride module for the exact semantics of each
     *  value. `web-ui`/`mobile` use this to hide the four load buttons entirely when `'hidden'`, and
     *  to know that a click routes to a gear shift rather than a power/FTP adjustment when `'gear'`.
     *  Undefined when the workout isn't active (same states under which the rest of this object is
     *  empty). */
    loadButtonMode?: LoadButtonMode,
    /** Labels for the dashboard's load-adjustment buttons, reflecting what a click on each will
     *  actually do: when `loadButtonMode==='power'`, `+5W`/`+1W`/`-1W`/`-5W` if it will nudge
     *  `targetPower` within the current step's power range, `+5%`/`+1%`/`-1%`/`-5%` if it will scale
     *  the Workout FTP instead (see `WorkoutRide.isPowerRangeAdjustable()`); when
     *  `loadButtonMode==='gear'`, the bare gear-step text `+5`/`+1`/`-1`/`-5` (no unit), matching
     *  `ShiftingControl`'s existing button-text convention. Undefined when the workout isn't active
     *  (same states under which the rest of this object is empty). */
    loadButtons?: { inc5:string, inc1:string, dec1:string, dec5:string }
}

/** Payload of WorkoutRide's 'step-countdown' event - fired at 4s, 3s, 2s, 1s and 0s (the
 *  transition instant itself) before/at a leaf step with a known duration ends. Not fired across
 *  group/repeat-block boundaries, or when the step's duration is unknown. Precisely scheduled via
 *  wall-clock timers (see WorkoutRide.rescheduleStepCountdown()) rather than detected reactively
 *  on the polling loop, so consumers can rely on this for audio/visual cue timing without the
 *  jitter of 'step-changed'/'update' (which are tied to that 500ms loop and can be delayed under
 *  event-loop load). secondsRemaining:0 is the step-change tone/flash trigger - consumers no
 *  longer need to also watch 'step-changed' for that. */
export interface StepCountdownTick {
    secondsRemaining: 4 | 3 | 2 | 1 | 0
}