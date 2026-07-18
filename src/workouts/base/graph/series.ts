import { Workout } from "../model"
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
    if (step === undefined || step.power === undefined)
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
    if (step === undefined || step.power === undefined)
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
 * Formats a step's power target for display, e.g. "260W", "95% (250W)", "Ramp 200-260W (77-100%)".
 * Returns '' if the step has no power limit defined.
 */
export function getStepPower(step: StepDefinition, ftp?: number): string {
    let stepText: string

    if (step.power === undefined)
        return ''

    const unit = step.power.type === 'watt' ? 'W' : '%'

    if (step.steady || step.cooldown === false) {
        if (step.power.min !== undefined && step.power.max !== undefined && step.power.min < step.power.max)
            stepText = `${step.steady ? '' : 'Ramp '}${Math.round(step.power.min)}-${Math.round(step.power.max)}${unit}`
        else if (step.power.max !== undefined)
            stepText = `${Math.round(step.power.max)}${unit}`
        else
            stepText = ''

        if (stepText !== '' && ftp !== undefined && unit === '%') {
            if (step.power.min !== undefined && step.power.max !== undefined && step.power.min < step.power.max)
                stepText += ` (${Math.round(step.power.min / 100 * ftp)}-${Math.round(step.power.max / 100 * ftp)}W)`
            else
                stepText += ` (${Math.round(step.power.max / 100 * ftp)}W)`
        }
        if (stepText !== '' && ftp !== undefined && unit === 'W') {
            if (step.power.min !== undefined && step.power.max !== undefined && step.power.min < step.power.max)
                stepText += ` (${Math.round(step.power.min * 100 / ftp)}-${Math.round(step.power.max * 100 / ftp)}%)`
            else
                stepText += ` (${Math.round(step.power.max * 100 / ftp)}%)`
        }
    }
    else {
        if (step.power.min !== undefined && step.power.max !== undefined && step.power.min < step.power.max)
            stepText = `Ramp ${Math.round(step.power.max)}-${Math.round(step.power.min)}${unit}`
        else if (step.power.max !== undefined)
            stepText = `${Math.round(step.power.max)}${unit}`
        else
            stepText = ''

        if (stepText !== '' && ftp !== undefined && unit === '%') {
            if (step.power.min !== undefined && step.power.max !== undefined && step.power.min < step.power.max)
                stepText += ` (${Math.round(step.power.max / 100 * ftp)}-${Math.round(step.power.min / 100 * ftp)}W)`
            else
                stepText += ` (${Math.round(step.power.max / 100 * ftp)}W)`
        }
        if (stepText !== '' && ftp !== undefined && unit === 'W') {
            if (step.power.min !== undefined && step.power.max !== undefined && step.power.min < step.power.max)
                stepText += ` (${Math.round(step.power.max * 100 / ftp)}-${Math.round(step.power.min * 100 / ftp)}%)`
            else
                stepText += ` (${Math.round(step.power.max * 100 / ftp)}%)`
        }
    }
    return stepText
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

    let wo = workout
    if (!(wo instanceof Workout)) {
        try {
            wo = new Workout(wo as unknown as WorkoutDefinition)
        }
        catch {
            return []
        }
    }
    if (wo === undefined)
        return []

    const bars: WorkoutGraphPlanBar[] = []

    let done = false
    let step
    let stepStart = 0

    while (!done) {
        let limits
        if (step === undefined) {
            limits = wo.getLimits(0, true)
        }
        else {
            stepStart += step.getDuration()
            limits = wo.getLimits(stepStart + 0.01, true)
        }
        done = limits === undefined

        if (!done) {
            step = limits.step

            if (step.steady) {
                const x0 = stepStart
                const x = stepStart + step.getDuration()
                let y = getMaxPower(step, ftp)
                let y0 = getMinPower(step, ftp)
                const zone = getZone(y, ftp)

                if (absValues && ftp) {
                    y = ftp * y / 100
                    y0 = ftp * y0 / 100
                }

                if (y !== undefined && !isNaN(y) && y0 !== undefined && !isNaN(y0)) {
                    bars.push({ x, x0, y, y0, zone })
                }
                else if (y !== undefined && !isNaN(y) && y0 === undefined) {
                    bars.push({ x, x0, y, y0: 0, zone })
                }
            }
            else {
                const stepSize = step.getDuration() / 10

                for (let i = 0; i < 10; i++) {
                    const x0 = stepStart + i * stepSize
                    const x = x0 + stepSize

                    const limit = wo.getLimits(x0 + 0.01)
                    let y = getMaxPower(limit, ftp)
                    const zone = getZone(y, ftp)

                    if (absValues && ftp) {
                        y = ftp * y / 100
                    }
                    if (y !== undefined && !isNaN(y))
                        bars.push({ x, x0, y, y0: 0, zone })
                }
            }
        }
    }

    return bars
}
