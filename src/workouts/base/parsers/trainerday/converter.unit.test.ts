import { TrainerDayBlockSegment, TrainerDayCalendarWorkout, TrainerDayWorkoutBlock } from '../../../../apps/base/api/trainerday/types'
import { getBindings } from '../../../../api'
import { Segment } from '../../model/Segment'
import { Step } from '../../model/Step'
import { convertTrainerDayWorkout, getTrainerDayWorkoutHash, UnsupportedTrainerDayWorkoutError } from './converter'
import synthetic from '../../../../../__tests__/data/workouts/trainerday-calendar.json'
import real from '../../../../../__tests__/data/workouts/trainerday-calendar-real.json'

const seg = (durationValue: number, min?: number | null, props: Partial<TrainerDayBlockSegment> & { max?: number | null } = {}): TrainerDayBlockSegment => {
    const { max, ...rest } = props
    return {
        durationType: 'second', durationValue, controlMode: null, segmentType: null, pressLapButton: false, notes: [],
        targets: min === undefined || min === null ? [] : [{ type: 'primary', min, max: max ?? null }],
        ...rest
    }
}

const block = (segments: TrainerDayBlockSegment[], type: TrainerDayWorkoutBlock['type'] = 'segment', reps: number | null = null): TrainerDayWorkoutBlock =>
    ({ type, reps, segments })

const workout = (blocks: TrainerDayWorkoutBlock[], props: Partial<TrainerDayCalendarWorkout> = {}): TrainerDayCalendarWorkout => ({
    eventId: 'e1', workoutId: 1, date: '2026-11-20', title: 'Test', workoutType: 'bike', intensityMetric: 'percentOfFtp',
    workoutBlocks: blocks, ...props
})

const convertSingle = (s: TrainerDayBlockSegment): Step => convertTrainerDayWorkout(workout([block([s])])).steps[0]

describe('convertTrainerDayWorkout', () => {

    describe('basic', () => {
        test('name, description and duration', () => {
            const w = convertTrainerDayWorkout(workout([block([seg(600, 50), seg(300, 60)])], { title: 'My workout', description: 'Some text' }))
            expect(w.name).toBe('My workout')
            expect(w.description).toBe('Some text')
            expect(w.duration).toBe(900)
            expect(w.steps).toHaveLength(2)
        })

        test('empty description is dropped', () => {
            expect(convertTrainerDayWorkout(workout([block([seg(60, 50)])], { description: '' })).description).toBeUndefined()
        })

        test('workoutType and intensityMetric default to bike/percentOfFtp', () => {
            const w = convertTrainerDayWorkout(workout([block([seg(60, 50)])], { workoutType: undefined, intensityMetric: undefined }))
            expect(w.steps).toHaveLength(1)
        })
    })

    describe('power', () => {
        test('single value is a fixed target in % FTP', () => {
            const step = convertSingle(seg(60, 65))
            expect(step.power).toEqual({ type: 'pct of FTP', min: 65, max: 65 })
            expect(step.steady).toBe(true)
        })

        test('range on a regular segment is a steady target window', () => {
            const step = convertSingle(seg(60, 55, { max: 60, segmentType: '-' as never }))
            expect(step.power).toEqual({ type: 'pct of FTP', min: 55, max: 60 })
            expect(step.steady).toBe(true)
            expect(step.cooldown).toBe(false)
        })

        test('range on a warm-up is a ramp up', () => {
            const step = convertSingle(seg(600, 50, { max: 70, segmentType: 'warm-up' }))
            expect(step.power).toEqual({ type: 'pct of FTP', min: 50, max: 70 })
            expect(step.steady).toBe(false)
            expect(step.cooldown).toBe(false)
        })

        test('min > max is a ramp down', () => {
            const step = convertSingle(seg(480, 60, { max: 40, segmentType: 'cooldown' }))
            expect(step.power).toEqual({ type: 'pct of FTP', min: 40, max: 60 })
            expect(step.steady).toBe(false)
            expect(step.cooldown).toBe(true)
        })

        test('min > max on a regular segment is also a ramp down', () => {
            const step = convertSingle(seg(480, 90, { max: 70 }))
            expect(step.steady).toBe(false)
            expect(step.cooldown).toBe(true)
        })

        test('cooldown with a single value is steady, but marked as cooldown', () => {
            const step = convertSingle(seg(300, 40, { segmentType: 'cooldown' }))
            expect(step.steady).toBe(true)
            expect(step.cooldown).toBe(true)
        })

        test('no primary target: no power limit', () => {
            expect(convertSingle(seg(300)).power).toBeUndefined()
        })

        test('free-ride ignores the power target', () => {
            expect(convertSingle(seg(300, 60, { segmentType: 'free-ride' })).power).toBeUndefined()
        })
    })

    describe('cadence', () => {
        test('range', () => {
            const s = seg(60, 60)
            s.targets?.push({ type: 'cadence', min: 93, max: 103 })
            expect(convertSingle(s).cadence).toEqual({ min: 93, max: 103 })
        })

        test('single value', () => {
            const s = seg(60, 60)
            s.targets?.push({ type: 'cadence', min: 90, max: null })
            expect(convertSingle(s).cadence).toEqual({ min: 90, max: 90 })
        })

        test('no cadence target', () => {
            expect(convertSingle(seg(60, 60)).cadence).toBeUndefined()
        })
    })

    describe('work flag', () => {
        test.each([
            ['active', 50, true], ['interval', 50, true], ['rest', 120, false], ['warm-up', 100, false], ['cooldown', 90, false],
            [null, 120, true], [null, 40, false], [null, 84, false], [null, 85, true], ['+', 140, true], ['+', 40, false], ['-', 60, false]
        ])('segmentType %s with %i%% FTP: work=%s', (type, power, work) => {
            expect(convertSingle(seg(60, power, { segmentType: type as never })).work).toBe(work)
        })

        test('no power target and not typed: no work', () => {
            expect(convertSingle(seg(60)).work).toBe(false)
        })
    })

    describe('text and notes', () => {
        test('name is used if there are no notes', () => {
            expect(convertSingle(seg(60, 60, { name: 'Easy' })).text).toBe('Easy')
        })

        test('notes replace the name, sorted by offset', () => {
            const step = convertSingle(seg(60, 60, { name: 'Easy', notes: [{ timeOffset: 30, text: 'second' }, { timeOffset: 0, text: 'first' }] }))
            expect(step.text).toBe('first / second')
        })

        test('empty text', () => {
            expect(convertSingle(seg(60, 60, { name: '' })).text).toBe('')
        })
    })

    describe('blocks', () => {
        test('repetition becomes a segment with repeat', () => {
            const w = convertTrainerDayWorkout(workout([
                block([seg(60, 50)]),
                block([seg(240, 120), seg(240, 40, { segmentType: 'rest' })], 'repetition', 8)
            ]))
            expect(w.steps).toHaveLength(2)
            const s = w.steps[1] as Segment
            expect(s.type).toBe('segment')
            expect(s.repeat).toBe(8)
            expect(s.steps).toHaveLength(2)
            expect(s.steps[0].work).toBe(true)
            expect(s.steps[1].work).toBe(false)
            expect(w.duration).toBe(60 + 8 * 480)
        })

        test.each([null, 0, 1])('repetition with reps=%s is flattened to steps', (reps) => {
            const w = convertTrainerDayWorkout(workout([block([seg(60, 50), seg(60, 60)], 'repetition', reps)]))
            expect(w.steps).toHaveLength(2)
            expect(w.steps[0].type).toBe('step')
        })

        test('segment block with several segments gives several steps', () => {
            const w = convertTrainerDayWorkout(workout([block([seg(60, 50), seg(60, 60)])]))
            expect(w.steps).toHaveLength(2)
        })
    })

    describe('unsupported content', () => {
        test.each([
            ['swim workout', workout([block([seg(60, 50)])], { workoutType: 'swim' })],
            ['run workout', workout([block([seg(60, 50)])], { workoutType: 'run' })],
            ['percentOfHr', workout([block([seg(60, 50)])], { intensityMetric: 'percentOfHr' })],
            ['no blocks', workout([])],
            ['blocks missing', workout(undefined as never)],
            ['no segments', workout([block([])])],
            ['set block', workout([block([seg(60, 50)], 'set', 3)])],
            ['unknown block type', workout([block([seg(60, 50)], 'foo' as never)])],
            ['slope control', workout([block([seg(60, 50, { controlMode: 'slope' })])])],
            ['hr control', workout([block([seg(60, 50, { controlMode: 'hr' })])])],
            ['resistance control', workout([block([seg(60, 50, { controlMode: 'resistance' })])])],
            ['meter duration', workout([block([seg(1000, 50, { durationType: 'meter' })])])],
            ['lap button', workout([block([seg(60, 50, { pressLapButton: true })])])],
            ['open-ended', workout([block([seg(60, 50, { segmentType: 'open-ended' })])])],
            ['climb', workout([block([seg(60, 50, { segmentType: 'climb' })])])],
            ['zero duration', workout([block([seg(0, 50)])])],
            ['negative duration', workout([block([seg(-5, 50)])])],
            ['missing duration', workout([block([seg(undefined as never, 50)])])],
            ['unsupported segment in a repetition', workout([block([seg(60, 50), seg(60, 50, { controlMode: 'slope' })], 'repetition', 3)])],
        ])('%s is rejected', (_name, w) => {
            expect(() => convertTrainerDayWorkout(w)).toThrow(UnsupportedTrainerDayWorkoutError)
        })

        test('invalid power (negative) is rejected by the model', () => {
            expect(() => convertTrainerDayWorkout(workout([block([seg(60, -5)])]))).toThrow()
        })

        test('heart rate and slope targets are ignored', () => {
            const s = seg(60, 60)
            s.targets?.push({ type: 'heart_rate', min: 140, max: 150 }, { type: 'slope', min: 3, max: null })
            const step = convertSingle(s)
            expect(step.power).toEqual({ type: 'pct of FTP', min: 60, max: 60 })
            expect(step.hrm).toBeUndefined()
        })

        test('erg control mode is supported', () => {
            expect(convertSingle(seg(60, 50, { controlMode: 'erg' })).power?.min).toBe(50)
        })
    })

    describe('synthetic fixture', () => {
        const calendar = synthetic as unknown as TrainerDayCalendarWorkout[]

        test('intervals workout', () => {
            const w = convertTrainerDayWorkout(calendar[0])
            expect(w.name).toBe('Synthetic Intervals 3x(4+2)')
            expect(w.duration).toBe(600 + 3 * 360 + 480)
            expect(w.steps).toHaveLength(3)

            const warmup = w.steps[0]
            expect(warmup.power).toEqual({ type: 'pct of FTP', min: 50, max: 70 })
            expect(warmup.steady).toBe(false)

            const reps = w.steps[1] as Segment
            expect(reps.repeat).toBe(3)
            expect(reps.steps[0].power).toEqual({ type: 'pct of FTP', min: 105, max: 105 })
            expect(reps.steps[0].cadence).toEqual({ min: 90, max: 100 })
            expect(reps.steps[0].text).toBe('Synthetic note: go')
            expect(reps.steps[0].work).toBe(true)
            expect(reps.steps[1].work).toBe(false)

            const cooldown = w.steps[2]
            expect(cooldown.power).toEqual({ type: 'pct of FTP', min: 40, max: 60 })
            expect(cooldown.cooldown).toBe(true)
            expect(cooldown.steady).toBe(false)
        })

        test('steady state workout', () => {
            const w = convertTrainerDayWorkout(calendar[1])
            expect(w.duration).toBe(3600)
            expect(w.steps[0].power).toEqual({ type: 'pct of FTP', min: 65, max: 65 })
        })

        test('distance based workout is rejected', () => {
            expect(() => convertTrainerDayWorkout(calendar[2])).toThrow(/duration type meter/)
        })
    })

    describe('real fixture', () => {
        const calendar = real as unknown as TrainerDayCalendarWorkout[]
        const find = (title: string) => calendar.find(w => w.title === title) as TrainerDayCalendarWorkout

        test.each(calendar.map(w => [w.title, w.durationMinutes]))('%s: converts with the planned duration', (title, minutes) => {
            const w = convertTrainerDayWorkout(find(title as string))
            // durationMinutes is rounded
            expect(Math.abs(w.duration - (minutes as number) * 60)).toBeLessThan(60)
            expect(w.steps.length).toBeGreaterThan(0)
        })

        test('VO2 Max: staircase warm-up and 8 repetitions at 120%', () => {
            const w = convertTrainerDayWorkout(find('VO2 Max (8x4min@120%)'))
            const reps = w.steps.find(s => s.type === 'segment') as Segment
            expect(reps.repeat).toBe(8)
            expect(reps.steps.map(s => s.power?.min)).toEqual([120, 40])
            expect(reps.steps.map(s => s.work)).toEqual([true, false])
            expect(w.steps[0].power?.min).toBe(40)
            expect(w.steps[1].power?.min).toBe(50)
        })

        test('Kerfuffle: cadence ranges on some steps', () => {
            const w = convertTrainerDayWorkout(find('Kerfuffle 105 + CAD'))
            const withCadence = w.steps.filter(s => s.cadence)
            expect(withCadence.length).toBeGreaterThan(0)
            expect(withCadence[0].cadence).toEqual({ min: 93, max: 103 })
            expect(w.steps.at(-1)?.cooldown).toBe(true)
        })

        test('Collywobbles + CAD: power windows', () => {
            const w = convertTrainerDayWorkout(find('Collywobbles 75 + CAD'))
            const windows = w.steps.filter(s => s.power && s.power.min !== s.power.max)
            expect(windows.length).toBeGreaterThan(0)
            expect(windows.every(s => s.steady)).toBe(true)
        })

        test('Collywobbles + Sprints: notes become the step text', () => {
            const w = convertTrainerDayWorkout(find('Collywobbles 75 + Sprints'))
            const texts = w.steps.flatMap(s => (s as Segment).steps ? (s as Segment).steps.map(x => x.text) : [s.text])
            expect(texts).toContain('sprint 5s')
            expect(texts).toContain('sprint 15s')
        })
    })
})

describe('getTrainerDayWorkoutHash', () => {
    const base = () => workout([block([seg(60, 50)])])

    describe('without crypto binding', () => {
        let bindings
        let saved

        beforeEach(() => {
            bindings = getBindings()
            saved = bindings.crypto
            bindings.crypto = undefined
        })
        afterEach(() => {
            bindings.crypto = saved
        })

        test('yields a stable hash instead of failing', () => {
            const hash = getTrainerDayWorkoutHash(base())
            expect(hash).toMatch(/^[0-9a-f]{14}$/)
            expect(getTrainerDayWorkoutHash(base())).toBe(hash)
        })

        test('changed content yields a different hash', () => {
            expect(getTrainerDayWorkoutHash({ ...base(), title: 'Other' })).not.toBe(getTrainerDayWorkoutHash(base()))
            expect(getTrainerDayWorkoutHash({ ...base(), workoutBlocks: [block([seg(60, 55)])] })).not.toBe(getTrainerDayWorkoutHash(base()))
        })

        test('ignores fields that are no content', () => {
            expect(getTrainerDayWorkoutHash({ ...base(), eventId: 'x', bikeStress: 99 })).toBe(getTrainerDayWorkoutHash(base()))
        })
    })

    test('uses the crypto binding if available', () => {
        const bindings = getBindings()
        const saved = bindings.crypto
        const digest = jest.fn().mockReturnValue('abc')
        const update = jest.fn().mockReturnValue({ digest })
        bindings.crypto = { createHash: jest.fn().mockReturnValue({ update }) } as never
        try {
            expect(getTrainerDayWorkoutHash(base())).toBe('abc')
            expect(bindings.crypto.createHash).toHaveBeenCalledWith('md5')
        }
        finally {
            bindings.crypto = saved
        }
    })

    test('is stable for equal content', () => {
        expect(getTrainerDayWorkoutHash(base())).toBe(getTrainerDayWorkoutHash(base()))
    })

    test.each([
        ['title', { title: 'Other' }],
        ['date', { date: '2026-11-21' }],
        ['description', { description: 'changed' }],
        ['blocks', { workoutBlocks: [block([seg(60, 55)])] }],
    ])('changes if the %s changes', (_name, props) => {
        expect(getTrainerDayWorkoutHash({ ...base(), ...props })).not.toBe(getTrainerDayWorkoutHash(base()))
    })

    test('ignores fields that are no content (ids, stress, intensity)', () => {
        expect(getTrainerDayWorkoutHash({ ...base(), eventId: 'x', bikeStress: 99, intensity: 1 })).toBe(getTrainerDayWorkoutHash(base()))
    })
})
