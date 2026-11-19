import { Coach } from './coach'
import { CoachEditProps, CoachSettings } from './types'

class TestCoach extends Coach {
    protected getUnitConversionShortcuts() {
        const C = jest.fn((v: number) => v)
        const U = jest.fn((d: string) => d === 'speed' ? 'km/h' : 'm')
        return [C, U] as never
    }
}

describe('Coach', () => {

    describe('update', () => {
        const create = (settings: CoachSettings) => new TestCoach(settings)

        describe('power coach', () => {
            test('empty name and power present: auto-names the coach', () => {
                const coach = create({ name: 'old', type: 'power', target: 100 })
                coach.update({ name: '', type: 'power', power: 200 } as CoachEditProps)
                expect(coach.settings.name).toBe('200W Coach')
                expect(coach.settings.target).toBe(200)
            })

            test('undefined name and power present: auto-names the coach', () => {
                const coach = create({ name: 'old', type: 'power', target: 100 })
                coach.update({ name: undefined, type: 'power', power: 200 } as CoachEditProps)
                expect(coach.settings.name).toBe('200W Coach')
            })

            test('empty name and power undefined: does not throw and keeps the existing name', () => {
                const coach = create({ name: 'old', type: 'power', target: 100 })
                expect(() => {
                    coach.update({ name: '', type: 'power', power: undefined } as CoachEditProps)
                }).not.toThrow()
                expect(coach.settings.name).toBe('old')
            })

            test('non-empty name: keeps the name', () => {
                const coach = create({ name: 'old', type: 'power', target: 100 })
                coach.update({ name: 'Fred', type: 'power', power: 200 } as CoachEditProps)
                expect(coach.settings.name).toBe('Fred')
            })
        })

        describe('speed coach', () => {
            test('empty name and speed present: auto-names the coach', () => {
                const coach = create({ name: 'old', type: 'power', target: 100 })
                coach.update({ name: '', type: 'speed', speed: { value: 30, unit: 'km/h' } } as CoachEditProps)
                expect(coach.settings.name).toBe('30km/h Coach')
                expect(coach.settings.target).toBe(30)
            })

            test('empty name and speed value undefined: does not throw and keeps the existing name', () => {
                const coach = create({ name: 'old', type: 'speed', target: 30 })
                expect(() => {
                    coach.update({ name: '', type: 'speed', speed: { value: undefined, unit: 'km/h' } } as CoachEditProps)
                }).not.toThrow()
                expect(coach.settings.name).toBe('old')
            })

            test('non-empty name: keeps the name', () => {
                const coach = create({ name: 'old', type: 'speed', target: 30 })
                coach.update({ name: 'Fred', type: 'speed', speed: { value: 30, unit: 'km/h' } } as CoachEditProps)
                expect(coach.settings.name).toBe('Fred')
            })
        })
    })
})
