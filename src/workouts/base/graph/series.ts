import { Step, Workout } from "../model"
import { PowerLimit, StepDefinition, WorkoutDefinition } from "../model/types"
import { WorkoutGraphPlanBar, WorkoutGraphSeriesOptions } from "./types"

/**
 * Zone colors, indexed by the `zone` (1..7) reported on a {@link WorkoutGraphPlanBar}.
 * Index 0 ('white') is used for uncolored/free-ride bars.
 */
export const WORKOUT_ZONE_COLORS = [
    'white',    // 0
    '#7f7f7f',  // 1
    '#338cff',  // 2
    '#59bf59',  // 3
    '#ffcc3f',  // 4
    '#ff6639',  // 5
    '#ff330c',  // 6
    '#ea39ff'   // 7
]

function getMinPower(step: StepDefinition, ftp?: number): number | undefined {
    if (step?.power === undefined)
        return undefined

    const p = step.power
    if (p.max !== undefined && p.min !== undefined && p.max === p.min)
        return 0

    if (p.min === undefined)
        return undefined

    let res = Math.round(p.min)
    if (p.type === 'watt' && ftp !== undefined)
        res = Math.round(p.min / ftp * 100)
    return res
}

function getMaxPower(step: StepDefinition, ftp?: number): number | undefined {
    if (step?.power === undefined)
        return 0

    const p = step.power
    if (p.max === undefined)
        return undefined

    let res = Math.round(p.max)
    if (p.type === 'watt' && ftp !== undefined)
        res = Math.round(p.max / ftp * 100)
    return res
}

function getZone(power?: number, ftp?: number): number | undefined {
    if (power === undefined)
        return undefined
    if (ftp === undefined)
        return 0
    if (power <= 55) return 1
    if (power <= 75) return 2
    if (power <= 90) return 3
    if (power <= 105) return 4
    if (power <= 120) return 5
    if (power <= 150) return 6
    return 7
}

/** @return string a human readable duration, e.g. "30s", "10min", "1h" */
export function getStepDuration(step: StepDefinition): string {
    if (step.duration <= 60)
        return `${step.duration}s`
    if (step.duration <= 3600)
        return `${step.duration / 60}min`
    return `${step.duration / 3600}h`
}

/**
 * Renders "low-highUNIT" (or just "highUNIT" for a single value, or '' if high is undefined).
 * `low`/`high` are already in display order - ascending for a normal range, descending for a
 * cooldown ramp - callers pick which of min/max is `low` vs `high`.
 */
function formatPowerText(low: number | undefined, high: number | undefined, unit: string, rangePrefix: string): string {
    if (low !== undefined && high !== undefined && low !== high)
        return `${rangePrefix}${Math.round(low)}-${Math.round(high)}${unit}`
    if (high !== undefined)
        return `${Math.round(high)}${unit}`
    return ''
}

/** Appends the same range/value, converted to the other unit (%FTP <-> Watts), in parentheses. */
function appendConvertedSuffix(text: string, low: number | undefined, high: number | undefined, unit: string, ftp?: number): string {
    if (text === '' || ftp === undefined)
        return text

    const isPct = unit === '%'
    const convert = (v: number) => isPct ? Math.round(v / 100 * ftp) : Math.round(v * 100 / ftp)
    const suffixUnit = isPct ? 'W' : '%'

    const range = (low !== undefined && high !== undefined && low !== high)
        ? `${convert(low)}-${convert(high)}`
        : `${convert(high as number)}`

    return `${text} (${range}${suffixUnit})`
}

/**
 * Formats a step's power target for display, e.g. "260W", "95% (250W)", "Ramp 200-260W (77-100%)".
 * Returns '' if the step has no power limit defined.
 */
export function getStepPower(step: StepDefinition, ftp?: number): string {
    if (step.power === undefined)
        return ''

    const { min, max, type } = step.power
    const unit = type === 'watt' ? 'W' : '%'

    // a cooldown ramp (steady:false, cooldown:true) is the only case rendered high-to-low
    const ascending = step.steady || step.cooldown === false
    const low = ascending ? min : max
    const high = ascending ? max : min
    const rangePrefix = step.steady ? '' : 'Ramp '

    const stepText = formatPowerText(low, high, unit, rangePrefix)
    return appendConvertedSuffix(stepText, low, high, unit, ftp)
}

/**
 * Resolves a step's power Limit to absolute Watts. `{type:'watt'}` passes through unchanged;
 * `{type:'pct of FTP'}` needs `ftp` to convert (undefined min/max stay undefined without it).
 * Separate from `getMinPower`/`getMaxPower` above, which resolve to %FTP (for zone-coloring) -
 * this resolves the other direction, to Watts, for `getStepTargetText`'s Zwift-style phrasing.
 */
function resolvePowerWatts(power: PowerLimit | undefined, ftp?: number): { min?: number, max?: number } {
    if (!power)
        return {}

    const toWatts = (v?: number) => {
        if (v === undefined)
            return undefined
        if (power.type === 'watt')
            return Math.round(v)
        return ftp === undefined ? undefined : Math.round(v / 100 * ftp)
    }

    return { min: toWatts(power.min), max: toWatts(power.max) }
}

/** Renders "low-highUNIT" (rangePrefix only applies to the range case), "highUNIT" for a single value, or '' if both are undefined. */
function formatRange(low: number | undefined, high: number | undefined, unit: string, rangePrefix = ''): string {
    if (low !== undefined && high !== undefined && Math.round(low) !== Math.round(high))
        return `${rangePrefix}${Math.round(low)}-${Math.round(high)}${unit}`
    const v = high ?? low
    return v === undefined ? '' : `${Math.round(v)}${unit}`
}

/**
 * Formats a step's full target description, Zwift-style, e.g. "260W", "260W at 100-120HR",
 * "100-120 rpm", "Ramp 100-200W". Combines whichever of power/heartrate/cadence the step
 * defines (power first, then heartrate, then cadence), joined with " at ". Power always renders
 * in absolute Watts (via `resolvePowerWatts`, not `getStepPower`'s native-unit-first text - this
 * phrase is meant to stand alone, without a parenthetical %FTP/Watts conversion suffix) and,
 * mirroring `getStepPower`, is direction-aware for a non-steady step ("Ramp low-high" ascending,
 * "Ramp high-low" for a cooldown ramp). Heartrate/cadence ranges have no direction concept and
 * always render low-high. Returns 'free' when the step carries no target at all.
 *
 * `powerOverrideWatts`, when given, replaces the step's own power resolution for the min/max
 * Watts used in the text (direction/prefix still come from the step's steady/cooldown flags).
 * Needed for the *current* step only: `WorkoutRide.getCurrentLimits()` already resolves power
 * including the live manual-power offset from a swipe-triggered load adjustment (powerUp/
 * powerDown) - re-deriving from the raw step definition here would ignore that offset and show
 * a stale target the moment the rider adjusts load on a Watt-defined step. Upcoming steps have
 * no such live offset yet, so they omit this and resolve straight from the step definition.
 */
export function getStepTargetText(
    step: StepDefinition,
    ftp?: number,
    powerOverrideWatts?: { min?: number, max?: number }
): string {
    const { min: minPower, max: maxPower } = powerOverrideWatts ?? resolvePowerWatts(step.power, ftp)
    const ascending = step.steady || step.cooldown === false
    const lowPower = ascending ? minPower : maxPower
    const highPower = ascending ? maxPower : minPower
    const rangePrefix = step.steady ? '' : 'Ramp '

    const powerText = formatRange(lowPower, highPower, 'W', rangePrefix)
    const hrText = formatRange(step.hrm?.min, step.hrm?.max, 'HR')
    const cadenceText = formatRange(step.cadence?.min, step.cadence?.max, ' rpm')

    const parts = [powerText, hrText, cadenceText].filter(Boolean)
    return parts.length ? parts.join(' at ') : 'free'
}

function coerceToWorkout(workout: Workout): Workout | undefined {
    if (workout instanceof Workout)
        return workout

    try {
        return new Workout(workout as unknown as WorkoutDefinition)
    }
    catch {
        return undefined
    }
}

/** One zone-colored bar spanning a whole steady step, or undefined if it has no usable power data. */
function buildSteadyBar(step: Step, stepStart: number, ftp: number | undefined, absValues: boolean): WorkoutGraphPlanBar | undefined {
    const x0 = stepStart
    const x = stepStart + step.getDuration()
    let y = getMaxPower(step, ftp)
    let y0 = getMinPower(step, ftp)
    const zone = getZone(y, ftp)

    if (absValues && ftp) {
        y = ftp * y / 100
        y0 = ftp * y0 / 100
    }

    if (y === undefined || Number.isNaN(y))
        return undefined
    if (y0 !== undefined && !Number.isNaN(y0))
        return { x, x0, y, y0, zone }
    if (y0 === undefined)
        return { x, x0, y, y0: 0, zone }
    return undefined
}

/** Ten thin bars approximating the gradient across a ramp (non-steady) step. */
function buildRampBars(wo: Workout, step: Step, stepStart: number, ftp: number | undefined, absValues: boolean): WorkoutGraphPlanBar[] {
    const bars: WorkoutGraphPlanBar[] = []
    const stepSize = step.getDuration() / 10

    for (let i = 0; i < 10; i++) {
        const x0 = stepStart + i * stepSize
        const x = x0 + stepSize

        const limit = wo.getLimits(x0 + 0.01)
        let y = getMaxPower(limit, ftp)
        const zone = getZone(y, ftp)

        if (absValues && ftp)
            y = ftp * y / 100

        if (y !== undefined && !Number.isNaN(y))
            bars.push({ x, x0, y, y0: 0, zone })
    }
    return bars
}

/** One leaf step of a workout, resolved to its absolute (repeat-expanded) position. */
export interface FlattenedStep {
    step: Step        // the originating leaf Step - shared across repeats, so its OWN start/end/duration
                       // are relative to a single repetition; use this entry's start/end/duration instead
    start: number      // absolute elapsed-time start (s), correct across repeats/nesting
    end: number         // absolute elapsed-time end (s)
    duration: number
}

/**
 * Walks a workout's timeline via `Workout.getLimits(ts, true)`, returning one entry per leaf step
 * in play order, with a repeated segment expanded into one entry per repetition (a 3-step segment
 * repeated 5x yields 15 entries, not 1). Nested segments are handled too - `getLimits` already
 * recurses through them polymorphically.
 *
 * `limits.step` (the `CurrentStep.step` field `includeStepInfo:true` populates) is the SAME Step
 * instance on every repetition - only its own `.start`/`.end` (first-repetition-relative) never
 * change, which is why this function tracks the true absolute position itself (`stepStart`,
 * accumulated via `step.getDuration()`) rather than trusting `step.start`/`step.end` - exactly
 * mirroring how `getWorkoutGraphSeries` below already builds one bar per (possibly repeated) step.
 */
export function getFlattenedSteps(workout: Workout): FlattenedStep[] {
    const wo = coerceToWorkout(workout)
    if (!wo)
        return []

    const result: FlattenedStep[] = []
    let stepStart = 0

    for (let limits = wo.getLimits(0, true); limits !== undefined; limits = wo.getLimits(stepStart + 0.01, true)) {
        // includeStepInfo:true guarantees `.step` is the originating Step instance, not just a StepDefinition
        const step = limits.step as Step
        const duration = step.getDuration()

        result.push({ step, start: stepStart, end: stepStart + duration, duration })
        stepStart += duration
    }

    return result
}

/**
 * Builds the zone-colored bars for the whole duration of a workout, one bar per step
 * (ten sub-bars for ramps, to approximate the gradient).
 *
 * With `absValues:true`, y/y0 are resolved against `opts.ftp` into absolute Watts - the shape
 * the live-ride graph needs, since it draws bars on the same absolute-Watt axis as recorded
 * telemetry. Without it (or without an ftp), y/y0 stay in %FTP - the shape a workout-selection
 * preview graph needs, since no FTP may be known yet.
 */
export function getWorkoutGraphSeries(workout: Workout, opts?: WorkoutGraphSeriesOptions): WorkoutGraphPlanBar[] {
    const { ftp, absValues = false } = opts ?? {}

    const wo = coerceToWorkout(workout)
    if (!wo)
        return []

    const bars: WorkoutGraphPlanBar[] = []

    getFlattenedSteps(wo).forEach(({ step, start: stepStart }) => {
        if (step.steady) {
            const bar = buildSteadyBar(step, stepStart, ftp, absValues)
            if (bar)
                bars.push(bar)
        }
        else {
            bars.push(...buildRampBars(wo, step, stepStart, ftp, absValues))
        }
    })

    return bars
}
