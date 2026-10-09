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

        test('correctly handles segments', async ()=> {
            const wo = {
                type: "workout",
                id: "default-30-anaerobic-sprints",
                hash: "default-30-anaerobic-sprints",
                name: "30' Anaerobic Sprints",
                description: "Ten short, maximal efforts with generous recovery build raw sprint power and neuromuscular sharpness - this is about peak wattage, not endurance. Go genuinely all-out on each sprint; if you're not fully recovered by the next one, the quality (not the quantity) is what suffers.",
                category: { name: "30 min" },
                steps: [
                    { type: "step", duration: 600, power: { type: "pct of FTP", min: 50, max: 70 }, text: "Warmup", work: false, steady: false, cooldown: false },
                    { type: "segment", repeat: 10, steps: [
                        { type: "step", duration: 25, power: { type: "pct of FTP", min: 135, max: 135 }, text: "Sprint", work: true, steady: true, "cooldown": false },
                        { type: "step", duration: 35, power: { type: "pct of FTP", min: 50, max: 50 }, text: "Recovery", work: true, steady: true, "cooldown": false }
                    ]},
                    { type: "step", duration: 600,start:600,power: { type: "pct of FTP", min: 40, max: 60 }, text: "Cooldown", work: false, steady: false, cooldown: true }
                ]
            }

            const parser = new JsonParser()
            const data = JSON.stringify(wo)
            const workout = await parser.import({filename:'test.json'} as any, data)

            expect(workout.steps[2].start===1100)

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
