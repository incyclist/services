import { Workout } from "../model"
import { getFlattenedSteps, getStepDuration, getStepPower, getStepTargetText, getWorkoutGraphSeries, WORKOUT_ZONE_COLORS } from "./series"

describe('workouts/base/graph/series', () => {

    describe('WORKOUT_ZONE_COLORS', () => {
        test('has one color per zone (0..7)', () => {
            expect(WORKOUT_ZONE_COLORS).toHaveLength(8)
        })
    })

    describe('getStepDuration', () => {
        test('seconds', () => {
            expect(getStepDuration({ duration: 45 })).toBe('45s')
        })
        test('minutes', () => {
            expect(getStepDuration({ duration: 120 })).toBe('2min')
        })
        test('hours', () => {
            expect(getStepDuration({ duration: 7200 })).toBe('2h')
        })
    })

    describe('getStepPower', () => {
        test('no power defined -> empty string', () => {
            expect(getStepPower({ duration: 60 })).toBe('')
        })

        test('steady, watt, single value, no ftp', () => {
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, max: 200 } }
            expect(getStepPower(step)).toBe('200W')
        })

        test('steady, watt range, no ftp', () => {
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepPower(step)).toBe('100-200W')
        })

        test('steady, watt range, with ftp -> appends %FTP', () => {
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepPower(step, 250)).toBe('100-200W (40-80%)')
        })

        test('steady, pct of FTP range, with ftp -> appends Watts', () => {
            const step = { duration: 60, steady: true, power: { type: 'pct of FTP' as const, min: 80, max: 100 } }
            expect(getStepPower(step, 250)).toBe('80-100% (200-250W)')
        })

        test('ramp (steady:false, cooldown:false) -> ascending, "Ramp " prefix', () => {
            const step = { duration: 60, steady: false, cooldown: false, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepPower(step)).toBe('Ramp 100-200W')
        })

        test('cooldown ramp (steady:false, cooldown:true) -> descending max-min', () => {
            const step = { duration: 60, steady: false, cooldown: true, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepPower(step)).toBe('Ramp 200-100W')
        })
    })

    describe('getStepTargetText', () => {
        test('no power/hrm/cadence at all -> "free"', () => {
            expect(getStepTargetText({ duration: 60 })).toBe('free')
        })

        test('fixed watt target, no ftp needed', () => {
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, max: 260 } }
            expect(getStepTargetText(step)).toBe('260W')
        })

        test('steady watt range', () => {
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepTargetText(step)).toBe('100-200W')
        })

        test('pct-of-FTP target resolves to absolute Watts, no parenthetical suffix', () => {
            const step = { duration: 60, steady: true, power: { type: 'pct of FTP' as const, max: 100 } }
            expect(getStepTargetText(step, 250)).toBe('250W')
        })

        test('pct-of-FTP target with no ftp available -> power omitted', () => {
            const step = { duration: 60, steady: true, power: { type: 'pct of FTP' as const, max: 100 }, hrm: { min: 140, max: 150 } }
            expect(getStepTargetText(step)).toBe('140-150HR')
        })

        test('ramp (steady:false, cooldown:false) -> ascending, "Ramp " prefix, matches getStepPower direction', () => {
            const step = { duration: 60, steady: false, cooldown: false, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepTargetText(step)).toBe('Ramp 100-200W')
        })

        test('cooldown ramp (steady:false, cooldown:true) -> descending max-min', () => {
            const step = { duration: 60, steady: false, cooldown: true, power: { type: 'watt' as const, min: 100, max: 200 } }
            expect(getStepTargetText(step)).toBe('Ramp 200-100W')
        })

        test('power + heartrate range, joined with " at "', () => {
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, max: 260 }, hrm: { min: 100, max: 120 } }
            expect(getStepTargetText(step)).toBe('260W at 100-120HR')
        })

        test('cadence-only target, no power -> " rpm" unit, space before unit', () => {
            const step = { duration: 60, steady: true, cadence: { min: 100, max: 120 } }
            expect(getStepTargetText(step)).toBe('100-120 rpm')
        })

        test('power + heartrate + cadence, all joined with " at "', () => {
            const step = {
                duration: 60, steady: true,
                power: { type: 'watt' as const, max: 260 },
                hrm: { min: 140, max: 150 },
                cadence: { min: 90, max: 100 }
            }
            expect(getStepTargetText(step)).toBe('260W at 140-150HR at 90-100 rpm')
        })

        test('fixed (non-range) heartrate value, no dash', () => {
            const step = { duration: 60, steady: true, hrm: { max: 145 } }
            expect(getStepTargetText(step)).toBe('145HR')
        })

        test('powerOverrideWatts replaces the step-derived Watts (live manual-power offset)', () => {
            // step says 200W, but the rider swiped up +20W -> WorkoutRide.getCurrentLimits() already
            // reflects 220W; the override must win over the raw step definition.
            const step = { duration: 60, steady: true, power: { type: 'watt' as const, max: 200 } }
            expect(getStepTargetText(step, undefined, { max: 220 })).toBe('220W')
        })
    })

    describe('getFlattenedSteps', () => {
        test('undefined workout -> empty array', () => {
            expect(getFlattenedSteps(undefined)).toEqual([])
        })

        test('plain (non-repeated) steps -> one entry per step, laid out back to back', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [
                    { type: 'step', duration: 60, steady: true, power: { type: 'watt', min: 200, max: 200 } },
                    { type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 100, max: 100 } }
                ]
            })

            const flat = getFlattenedSteps(workout)
            expect(flat.map(f => [f.start, f.end, f.duration])).toEqual([[0, 60, 60], [60, 90, 30]])
        })

        test('a repeated segment expands into one entry per repetition, not one blob', () => {
            // 2-step segment (40s work / 20s rest) repeated 3x -> 6 flattened entries, not 1
            const workout = new Workout({ type: 'workout', name: 'T' })
            workout.addSegment({
                type: 'segment', repeat: 3, steps: [
                    { type: 'step', duration: 40, steady: true, work: true, power: { type: 'watt', min: 200, max: 200 } },
                    { type: 'step', duration: 20, steady: true, work: false, power: { type: 'watt', min: 100, max: 100 } }
                ]
            })

            const flat = getFlattenedSteps(workout)
            expect(flat).toHaveLength(6)
            expect(flat.map(f => [f.start, f.end])).toEqual([
                [0, 40], [40, 60],
                [60, 100], [100, 120],
                [120, 160], [160, 180]
            ])
            // every "work" entry resolves to the same underlying 200W step, every "rest" to 100W
            expect(flat.map(f => f.step.power?.max)).toEqual([200, 100, 200, 100, 200, 100])
        })

        test('a segment mixed with plain steps before/after -> correct absolute offsets throughout', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [{ type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 150, max: 150 } }]
            })
            workout.addSegment({ type: 'segment', repeat: 2, steps: [{ type: 'step', duration: 10, steady: true, power: { type: 'watt', min: 250, max: 250 } }] })
            workout.addStep({ type: 'step', duration: 15, steady: true, power: { type: 'watt', min: 120, max: 120 } })

            const flat = getFlattenedSteps(workout)
            expect(flat.map(f => [f.start, f.end])).toEqual([[0, 30], [30, 40], [40, 50], [50, 65]])
        })
    })

    describe('getWorkoutGraphSeries', () => {

        test('undefined workout -> empty array', () => {
            expect(getWorkoutGraphSeries(undefined)).toEqual([])
        })

        test('single steady step, single-value watt power, no ftp -> one uncolored bar', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [{ type: 'step', duration: 60, steady: true, power: { type: 'watt', min: 200, max: 200 } }]
            })

            const bars = getWorkoutGraphSeries(workout)
            expect(bars).toEqual([{ x0: 0, x: 60, y: 200, y0: 0, zone: 0 }])
        })

        test('single steady step, single-value watt power, absValues with ftp -> resolved zone, roundtrips to same Watts', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [{ type: 'step', duration: 60, steady: true, power: { type: 'watt', min: 200, max: 200 } }]
            })

            const bars = getWorkoutGraphSeries(workout, { ftp: 250, absValues: true })
            expect(bars).toEqual([{ x0: 0, x: 60, y: 200, y0: 0, zone: 3 }])
        })

        test('steady step with a min/max band -> single bar spanning the whole step, y0 = min', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [{ type: 'step', duration: 120, steady: true, power: { type: 'pct of FTP', min: 80, max: 100 } }]
            })

            const bars = getWorkoutGraphSeries(workout, { ftp: 250, absValues: true })
            expect(bars).toEqual([{ x0: 0, x: 120, y: 250, y0: 200, zone: 4 }])
        })

        test('multiple steps are laid out back to back on the time axis', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [
                    { type: 'step', duration: 60, steady: true, power: { type: 'watt', min: 200, max: 200 } },
                    { type: 'step', duration: 30, steady: true, power: { type: 'watt', min: 100, max: 100 } }
                ]
            })

            const bars = getWorkoutGraphSeries(workout)
            expect(bars.map(b => [b.x0, b.x])).toEqual([[0, 60], [60, 90]])
        })

        test('ramp (non-steady) step -> ten sub-bars spanning the step, ramping between min and max', () => {
            const workout = new Workout({
                type: 'workout', name: 'T',
                steps: [{ type: 'step', duration: 30, steady: false, cooldown: false, power: { type: 'watt', min: 100, max: 200 } }]
            })

            const bars = getWorkoutGraphSeries(workout, { ftp: 250, absValues: true })
            expect(bars).toHaveLength(10)
            expect(bars[0].x0).toBe(0)
            expect(bars.at(-1).x).toBe(30)
            bars.forEach(b => expect(b.y0).toBe(0))

            // ramping up from ~100W towards ~200W
            expect(bars[0].y).toBeGreaterThanOrEqual(95)
            expect(bars[0].y).toBeLessThanOrEqual(115)
            expect(bars.at(-1).y).toBeGreaterThanOrEqual(190)
            expect(bars.at(-1).y).toBeLessThanOrEqual(200)
        })

        test('a plain (non-Workout) object is coerced into a Workout', () => {
            const plain = {
                type: 'workout', name: 'Plain',
                steps: [{ type: 'step', duration: 10, steady: true, power: { type: 'watt', min: 150, max: 150 } }]
            }

            const bars = getWorkoutGraphSeries(plain as any)
            expect(bars).toEqual([{ x0: 0, x: 10, y: 150, y0: 0, zone: 0 }])
        })

        test('an object that cannot be coerced into a Workout -> empty array', () => {
            expect(getWorkoutGraphSeries({ not: 'a workout' } as any)).toEqual([])
        })
    })
})
