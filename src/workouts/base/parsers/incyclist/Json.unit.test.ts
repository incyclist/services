import { JsonParser } from './Json'

describe('JsonParser', () => {
    describe('import', () => {

        test('parses name, category and steps',async () => {
            const parser = new JsonParser()
            const data = JSON.stringify({
                type:'workout', name:'Test Workout', category:{name:'FTP Test'},
                steps: [
                    {type:'step', steady:true, work:true, duration:60, power:{min:100,max:100,type:'watt'}, text:'Step 1'},
                ]
            })

            const workout = await parser.import({filename:'test.json'} as any, data)

            expect(workout.name).toBe('Test Workout')
            expect(workout.category).toEqual({name:'FTP Test'})
            expect(workout.isLocal).toBe(true)
        })

        // Regression: `lockedPowerTargets` was missing from the destructure/constructor call, so a
        // ramp/FTP-test workout authored with a workout-level lock (rather than annotating every
        // individual step) silently imported as fully adjustable.
        test('preserves the workout-level lockedPowerTargets flag',async () => {
            const parser = new JsonParser()
            const data = JSON.stringify({
                type:'workout', name:'Locked Workout', lockedPowerTargets:true,
                steps: [
                    {type:'step', steady:true, work:true, duration:30, power:{min:100,max:100,type:'watt'}, text:''},
                ]
            })

            const workout = await parser.import({filename:'test.json'} as any, data)

            expect(workout.lockedPowerTargets).toBe(true)
        })

        test('defaults lockedPowerTargets to undefined when not present in the file',async () => {
            const parser = new JsonParser()
            const data = JSON.stringify({
                type:'workout', name:'Unlocked Workout',
                steps: [
                    {type:'step', steady:true, work:true, duration:30, power:{min:100,max:100,type:'watt'}, text:''},
                ]
            })

            const workout = await parser.import({filename:'test.json'} as any, data)

            expect(workout.lockedPowerTargets).toBeUndefined()
        })

    })

    describe('supportsContent', () => {
        test('true for a valid workout JSON string',() => {
            const parser = new JsonParser()
            const data = JSON.stringify({type:'workout', name:'Test', steps:[]})

            expect(parser.supportsContent(data)).toBe(true)
        })

        test('false for non-JSON content',() => {
            const parser = new JsonParser()

            expect(parser.supportsContent('not json')).toBe(false)
        })

        test('false for JSON that is not a workout',() => {
            const parser = new JsonParser()

            expect(parser.supportsContent(JSON.stringify({type:'segment', name:'Test'}))).toBe(false)
        })
    })

    describe('supportsExtension', () => {
        test('true for "json" (case-insensitive)',() => {
            const parser = new JsonParser()

            expect(parser.supportsExtension('json')).toBe(true)
            expect(parser.supportsExtension('JSON')).toBe(true)
        })

        test('false for other extensions',() => {
            const parser = new JsonParser()

            expect(parser.supportsExtension('zwo')).toBe(false)
        })
    })
})
