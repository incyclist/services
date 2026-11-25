import { dedupeCalendarEntries, getContentKey } from './dedupe'
import { WorkoutCalendarEntry } from './types'

describe('dedupeCalendarEntries', () => {

    const step = (duration: number, min: number, max = min) => ({ type: 'step', duration, power: { min, max, type: 'watt' } })

    const entry = (source: string, steps: Array<any>, day = new Date(2026, 10, 25), extra: any = {}): WorkoutCalendarEntry => ({
        day,
        updated: new Date(),
        source,
        workoutId: `${source}-1`,
        workout: { name: `${source} name`, description: `${source} description`, steps, ...extra } as any
    })

    const steps = [step(600, 150), step(300, 250), step(600, 120)]

    test('keeps the entries if there are no duplicates', () => {
        const entries = [entry('trainingpeaks', steps), entry('intervals', [step(1200, 200)])]
        expect(dedupeCalendarEntries(entries)).toEqual(entries)
    })

    test('keeps the entry of the source with the highest priority, independent of the order', () => {
        const tp = entry('trainingpeaks', steps)
        const iv = entry('intervals', steps)

        expect(dedupeCalendarEntries([tp, iv])).toEqual([tp])
        expect(dedupeCalendarEntries([iv, tp])).toEqual([tp])
    })

    test('ignores name and description', () => {
        const tp = entry('trainingpeaks', steps)
        const iv = entry('intervals', steps)
        iv.workout.name = 'something completely different'
        expect(dedupeCalendarEntries([iv, tp])).toEqual([tp])
    })

    test('does not merge the same content on different days', () => {
        const tp = entry('trainingpeaks', steps, new Date(2026, 10, 25))
        const iv = entry('intervals', steps, new Date(2026, 10, 26))
        expect(dedupeCalendarEntries([tp, iv])).toEqual([tp, iv])
    })

    test('does not merge entries of the same source', () => {
        const a = entry('trainingpeaks', steps)
        const b = entry('trainingpeaks', steps)
        expect(dedupeCalendarEntries([a, b])).toEqual([a, b])
    })

    test('sources that are not prioritized lose against prioritized sources', () => {
        const other = entry('other', steps)
        const iv = entry('intervals', steps)
        expect(dedupeCalendarEntries([other, iv])).toEqual([iv])
    })

    test('treats a repeated segment like the same steps listed one after the other', () => {
        const tp = entry('trainingpeaks', [step(300, 100), step(60, 300), step(60, 100), step(60, 300), step(60, 100)])
        const iv = entry('intervals', [step(300, 100), { type: 'segment', repeat: 2, steps: [step(60, 300), step(60, 100)] }])
        expect(dedupeCalendarEntries([iv, tp])).toEqual([tp])
    })

    test('does not modify the input', () => {
        const entries = [entry('intervals', steps), entry('trainingpeaks', steps)]
        dedupeCalendarEntries(entries)
        expect(entries).toHaveLength(2)
    })

    test('entries without steps are never merged', () => {
        const a = entry('trainingpeaks', [])
        const b = entry('intervals', [])
        expect(getContentKey(a)).toBeUndefined()
        expect(dedupeCalendarEntries([a, b])).toEqual([a, b])
    })
})
