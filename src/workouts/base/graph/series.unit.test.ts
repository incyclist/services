import { Workout } from "../model"
import { getStepDuration, getStepPower, getWorkoutGraphSeries, WORKOUT_ZONE_COLORS } from "./series"

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
