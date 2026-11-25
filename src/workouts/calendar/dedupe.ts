import { WorkoutCalendarEntry } from "./types"

/**
 * Order in which the sources are preferred if the same workout is delivered by more than one source
 * (e.g. TrainingPeaks directly and via Intervals.icu). Sources that are not listed come last.
 */
export const SOURCE_PRIORITY = ['trainingpeaks', 'trainerday', 'intervals']

type FlatStep = [duration: number, powerMin: number | undefined, powerMax: number | undefined, powerType: string | undefined]

interface StepLike {
    type?: string
    duration?: number
    start?: number
    end?: number
    power?: { min?: number, max?: number, type?: string }
    steps?: Array<StepLike>
    repeat?: number
}

const getDuration = (step: StepLike): number => {
    const duration = step.duration ?? ((step.end ?? 0) - (step.start ?? 0))
    return Math.round(duration)
}

const flattenStep = (step: StepLike): Array<FlatStep> => {
    if (step.steps) {
        const inner = step.steps.flatMap(flattenStep)
        const repeat = step.repeat && step.repeat > 0 ? step.repeat : 1
        return Array.from({ length: repeat }).flatMap(() => inner)
    }

    const { min, max, type } = step.power ?? {}
    return [[getDuration(step), min === undefined ? undefined : Math.round(min), max === undefined ? undefined : Math.round(max), type]]
}

/**
 * Describes the content of a workout independent of its name, description, ids and the way repeated blocks are
 * represented (a repeated segment and the same steps listed one after the other result in the same value).
 *
 * @returns the content description or `undefined` if the workout has no steps (which can't be compared)
 */
export const getContentKey = (entry: WorkoutCalendarEntry): string | undefined => {
    const steps = (entry.workout as unknown as StepLike)?.steps
    if (!steps?.length)
        return undefined

    const flat = flattenStep({ steps, repeat: 1 })
    return flat.length > 0 ? JSON.stringify(flat) : undefined
}

const getPriority = (entry: WorkoutCalendarEntry): number => {
    const idx = SOURCE_PRIORITY.indexOf(entry.source ?? '')
    return idx === -1 ? SOURCE_PRIORITY.length : idx
}

const getDayKey = (entry: WorkoutCalendarEntry): string => {
    const day = entry.day instanceof Date ? entry.day : new Date(entry.day)
    return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

/**
 * Removes workouts that are delivered by more than one source (same day, same content).
 *
 * The entry of the source with the highest priority is kept (see {@link SOURCE_PRIORITY}), so the result does not
 * depend on the order in which the sources finished their sync. Entries from the same source are never merged, and
 * the input is not modified, so removed entries are available again as soon as the preferred source drops its entry.
 *
 * @param entries all entries of the calendar
 * @returns the entries to show, in the order of the input
 */
export const dedupeCalendarEntries = (entries: Array<WorkoutCalendarEntry>): Array<WorkoutCalendarEntry> => {
    const winners = new Map<string, WorkoutCalendarEntry>()

    for (const entry of entries) {
        const content = getContentKey(entry)
        if (content === undefined)
            continue

        const key = `${getDayKey(entry)}|${content}`
        const current = winners.get(key)
        if (!current || (current.source !== entry.source && getPriority(entry) < getPriority(current)))
            winners.set(key, entry)
    }

    return entries.filter(entry => {
        const content = getContentKey(entry)
        if (content === undefined)
            return true

        const winner = winners.get(`${getDayKey(entry)}|${content}`)
        return winner === entry || winner?.source === entry.source
    })
}
