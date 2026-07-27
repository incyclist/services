import { Workout } from "../base/model"
import { StepDefinition } from "../base/model/types"

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
 *  value (in Watt) - 'ftp' when the step target is defined relative to FTP (the Workout FTP itself
 *  was scaled), 'targetPower' when the current step allows a power range (minPower!==maxPower) and
 *  the user is nudging the target within that range directly, without touching FTP at all. */
export interface PowerAdjustmentResult {
    type: 'ftp' | 'targetPower'
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
    canShowForward?: boolean
}