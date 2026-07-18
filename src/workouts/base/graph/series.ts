import { Step, Workout } from "../model"
import { StepDefinition, WorkoutDefinition } from "../model/types"
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
    let stepStart = 0

    for (let limits = wo.getLimits(0, true); limits !== undefined; limits = wo.getLimits(stepStart + 0.01, true)) {
        // includeStepInfo:true guarantees `.step` is the originating Step instance, not just a StepDefinition
        const step = limits.step as Step

        if (step.steady) {
            const bar = buildSteadyBar(step, stepStart, ftp, absValues)
            if (bar)
                bars.push(bar)
        }
        else {
            bars.push(...buildRampBars(wo, step, stepStart, ftp, absValues))
        }

        stepStart += step.getDuration()
    }

    return bars
}
