import { EventLogger } from 'gd-eventlog'
import { getBindings } from '../../../../api'
import {
    TrainerDayBlockSegment, TrainerDayCalendarWorkout, TrainerDaySegmentNote, TrainerDaySegmentTarget, TrainerDayWorkoutBlock
} from '../../../../apps/base/api/trainerday/types'
import { Workout } from '../../model/Workout'
import { Limit, PowerLimit, SegmentDefinition, StepDefinition } from '../../model/types'
import { PowerResult } from './types'

const logger = new EventLogger('TrainerDayWorkoutConverter')

/** a step with a target of at least this share of the FTP is considered a work (not a rest/recovery) step */
const WORK_THRESHOLD_PCT_FTP = 85

/** segment types that never represent work, no matter what the target is */
const NON_WORK_TYPES = new Set(['rest', 'warm-up', 'cooldown', 'free-ride'])

/** segment types that are executed with a resistance/slope/hr control or "until lap is pressed" and can not be modelled */
const UNSUPPORTED_SEGMENT_TYPES = new Set(['open-ended', 'lap', 'climb', 'slope', 'hr'])

/** Raised if a TrainerDay workout (or a part of it) can not be represented in the Incyclist workout model */
export class UnsupportedTrainerDayWorkoutError extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'UnsupportedTrainerDayWorkoutError'
    }
}

/**
 * Converts a workout of the TrainerDay calendar into an Incyclist workout.
 *
 * Mapping:
 * - the primary target is a power target in % of FTP. A single value (max is null) is a fixed target (min = max).
 *   A range (min != max) on a warm-up/cooldown segment (or with min > max) is a ramp over the duration of the step.
 *   A range on any other segment is a target window (steady step with min and max).
 * - cadence targets are mapped to the cadence limits of the step (a single value is a fixed cadence)
 * - blocks of type `repetition` become a segment that repeats its steps `reps` times, blocks of type `segment`
 *   become plain steps
 * - segments of type `rest`, `warm-up`, `cooldown` and `free-ride` are no work steps. Otherwise a step is a work step
 *   if it is an `active`/`interval` segment or its target is at least 85% FTP (TrainerDay's own `+`/`-` types only mark
 *   the phase of the workout and tell nothing about the intensity)
 * - notes are added to the text of the step (their time offsets are not supported)
 * - heart rate and slope targets of a power controlled segment are ignored (a warning is logged)
 *
 * Not supported - the whole workout is rejected (an {@link UnsupportedTrainerDayWorkoutError} is thrown), as skipping
 * a part would show a different workout than the one planned:
 * - workouts that are not cycling workouts, or not based on % of FTP (`percentOfHr`)
 * - control modes `slope`, `hr` and `resistance`, and the segment types `open-ended`, `lap`, `climb`, `slope` and `hr`
 * - durations in meters, durations that are not positive, segments that wait for a lap button press
 * - blocks of type `set` (nested repetitions, not representable without nesting segments) or unknown block types
 *
 * @param workout the workout as delivered by the TrainerDay calendar
 * @returns the Incyclist workout
 * @throws {UnsupportedTrainerDayWorkoutError} if the workout can not be represented
 */
export const convertTrainerDayWorkout = (workout: TrainerDayCalendarWorkout): Workout => {
    validateWorkout(workout)

    const result = new Workout({ type: 'workout', name: workout.title, description: workout.description || undefined, isLocal: true })

    for (const block of workout.workoutBlocks) {
        addBlock(result, block, workout.title)
    }

    if (result.steps.length === 0)
        throw new UnsupportedTrainerDayWorkoutError('workout has no steps')

    return result
}

/**
 * Calculates a hash of the content of a TrainerDay workout (title, day, description, type and the structure).
 * TrainerDay does not deliver a modification timestamp, so the hash is used to detect changes
 *
 * @param workout the workout as delivered by the TrainerDay calendar
 * @returns the hash as hex string
 */
export const getTrainerDayWorkoutHash = (workout: TrainerDayCalendarWorkout): string => {
    const { title, date, description, workoutType, intensityMetric, workoutBlocks } = workout
    const content = JSON.stringify({ title, date, description, workoutType, intensityMetric, workoutBlocks })

    const crypto = getBindings()?.crypto
    return crypto ? crypto.createHash('md5').update(content).digest('hex') : getStableHash(content)
}

/**
 * Pure JS hash (cyrb53, 53 bit) that is used if the platform does not provide a crypto binding.
 * It is not cryptographic, it only has to be stable and to change whenever the content changes
 *
 * @returns the hash as hex string (14 characters)
 */
const getStableHash = (content: string): string => {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < content.length; i++) {
        const ch = content.codePointAt(i) ?? 0
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0)
    return hash.toString(16).padStart(14, '0')
}

const unsupported = (reason: string): never => {
    throw new UnsupportedTrainerDayWorkoutError(reason)
}

const validateWorkout = (workout: TrainerDayCalendarWorkout) => {
    if (workout.workoutType && workout.workoutType !== 'bike')
        unsupported(`workout type ${workout.workoutType}`)
    if (workout.intensityMetric && workout.intensityMetric !== 'percentOfFtp')
        unsupported(`intensity metric ${workout.intensityMetric}`)
    if (!Array.isArray(workout.workoutBlocks) || workout.workoutBlocks.length === 0)
        unsupported('workout has no blocks')
}

const addBlock = (workout: Workout, block: TrainerDayWorkoutBlock, title?: string) => {
    if (!Array.isArray(block.segments) || block.segments.length === 0)
        unsupported('block without segments')

    const steps = block.segments.map(s => convertSegment(s, title))

    if (block.type === 'segment' || (block.type === 'repetition' && (block.reps ?? 1) <= 1)) {
        steps.forEach(step => { workout.addStep(step) })
    }
    else if (block.type === 'repetition') {
        const segment: SegmentDefinition = { steps, repeat: block.reps as number }
        workout.addSegment(segment)
    }
    else {
        unsupported(`block type ${block.type}`)
    }
}

const validateSegment = (segment: TrainerDayBlockSegment) => {
    if (segment.controlMode && segment.controlMode !== 'erg')
        unsupported(`control mode ${segment.controlMode}`)
    if (segment.durationType && segment.durationType !== 'second')
        unsupported(`duration type ${segment.durationType}`)
    if (segment.pressLapButton)
        unsupported('segment that waits for the lap button')
    if (UNSUPPORTED_SEGMENT_TYPES.has(segment.segmentType as string))
        unsupported(`segment type ${segment.segmentType}`)
    if (!Number.isFinite(segment.durationValue) || segment.durationValue <= 0)
        unsupported(`invalid duration ${segment.durationValue}`)
}

const convertSegment = (segment: TrainerDayBlockSegment, title?: string): StepDefinition => {
    validateSegment(segment)

    const segmentType = segment.segmentType as string | null | undefined
    const targets = segment.targets ?? []
    const isFreeRide = segmentType === 'free-ride'

    const { power, ramp } = isFreeRide ? { power: undefined, ramp: false } : convertPower(targets, segmentType)
    const cadence = convertCadence(targets)
    warnIgnoredTargets(targets, title)

    const cooldown = segmentType === 'cooldown' || (ramp === 'down')
    const text = getText(segment.name, segment.notes)
    const work = isWork(segmentType, power)

    return { duration: segment.durationValue, power, cadence, text, work, steady: !ramp, cooldown }
}

const convertPower = (targets: TrainerDaySegmentTarget[], segmentType?: string | null): PowerResult => {
    const primary = targets.find(t => t.type === 'primary')
    if (primary?.min === undefined || primary.min === null)
        return { ramp: false }

    const max = primary.max ?? primary.min
    const min = Math.min(primary.min, max)
    const high = Math.max(primary.min, max)
    const power: PowerLimit = { type: 'pct of FTP', min, max: high }

    if (primary.min === max)
        return { power, ramp: false }

    const descending = primary.min > max
    const isRamp = descending || segmentType === 'warm-up' || segmentType === 'cooldown'
    if (!isRamp)
        return { power, ramp: false }

    return { power, ramp: descending ? 'down' : 'up' }
}

const convertCadence = (targets: TrainerDaySegmentTarget[]): Limit | undefined => {
    const target = targets.find(t => t.type === 'cadence')
    if (target?.min === undefined || target.min === null)
        return undefined

    const max = target.max ?? target.min
    return { min: Math.min(target.min, max), max: Math.max(target.min, max) }
}

const warnIgnoredTargets = (targets: TrainerDaySegmentTarget[], title?: string) => {
    const ignored = targets.filter(t => t.type === 'heart_rate' || t.type === 'slope').map(t => t.type)
    if (ignored.length > 0)
        logger.logEvent({ message: 'TrainerDay target ignored', targets: ignored.join(','), workout: title, level: 'warning' })
}

const getText = (name?: string, notes?: TrainerDaySegmentNote[]): string => {
    const noteTexts = [...(notes ?? [])].sort((a, b) => a.timeOffset - b.timeOffset).map(n => n.text).filter(Boolean)
    const texts = noteTexts.length > 0 ? noteTexts : [name]
    return texts.filter(Boolean).join(' / ')
}

const isWork = (segmentType?: string | null, power?: PowerLimit): boolean => {
    if (segmentType === 'active' || segmentType === 'interval')
        return true
    if (segmentType && NON_WORK_TYPES.has(segmentType))
        return false
    return (power?.max ?? 0) >= WORK_THRESHOLD_PCT_FTP
}
