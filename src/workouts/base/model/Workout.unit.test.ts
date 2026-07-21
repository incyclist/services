import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo } from '../../../api'
import { ZwoParser } from '../parsers/zwo/zwo'
import { Workout, Plan } from './Workout'

describe('Workout', ()=>{

    describe('id/hash computation', ()=>{

        test('two workouts with the same name but different steps get different ids (real parser)', async ()=>{
            const parser = new ZwoParser()

            const fileA = './__tests__/data/workouts/SameName_ShortVariant.zwo'
            const xmlA = await loadFile('utf-8',fileA) as string
            const fileInfoA:FileInfo = {type:'file', name:'SameName_ShortVariant.zwo',filename:fileA, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
            const workoutA = await parser.import(fileInfoA, xmlA)

            const fileB = './__tests__/data/workouts/SameName_LongVariant.zwo'
            const xmlB = await loadFile('utf-8',fileB) as string
            const fileInfoB:FileInfo = {type:'file', name:'SameName_LongVariant.zwo',filename:fileB, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
            const workoutB = await parser.import(fileInfoB, xmlB)

            expect(workoutA.name).toBe(workoutB.name)
            expect(workoutA.steps.length).not.toBe(workoutB.steps.length)
            expect(workoutA.id).not.toBe(workoutB.id)
        })

        test('hash reflects steps added after construction via addStep', ()=>{
            const w1 = new Workout({type:'workout', name:'Same Name'})
            w1.addStep({type:'step', duration:60, power:{min:100,max:100}})

            const w2 = new Workout({type:'workout', name:'Same Name'})
            w2.addStep({type:'step', duration:120, power:{min:200,max:200}})

            expect(w1.id).not.toBe(w2.id)
        })

        test('hash reflects steps added after construction via addSegment', ()=>{
            const w1 = new Workout({type:'workout', name:'Same Name'})
            w1.addSegment({type:'segment', repeat:2, steps:[{type:'step',duration:60,power:{min:100,max:100}}]})

            const w2 = new Workout({type:'workout', name:'Same Name'})
            w2.addSegment({type:'segment', repeat:3, steps:[{type:'step',duration:60,power:{min:100,max:100}}]})

            expect(w1.id).not.toBe(w2.id)
        })

        test('steps provided directly in constructor opts also produce different ids', ()=>{
            const w1 = new Workout({type:'workout', name:'Same Name', steps:[{type:'step', duration:60, power:{min:100,max:100}}]})
            const w2 = new Workout({type:'workout', name:'Same Name', steps:[{type:'step', duration:120, power:{min:200,max:200}}]})

            expect(w1.id).not.toBe(w2.id)
        })

        test('identical name and identical steps still produce the same id (hash is deterministic)', ()=>{
            const w1 = new Workout({type:'workout', name:'Same Name'})
            w1.addStep({type:'step', duration:60, power:{min:100,max:100}})

            const w2 = new Workout({type:'workout', name:'Same Name'})
            w2.addStep({type:'step', duration:60, power:{min:100,max:100}})

            expect(w1.id).toBe(w2.id)
        })

        test('explicit opts.id always wins over computed hash', ()=>{
            const w = new Workout({type:'workout', name:'Same Name', id:'explicit-id'})
            w.addStep({type:'step', duration:60, power:{min:100,max:100}})

            expect(w.id).toBe('explicit-id')
        })

        test('explicit opts.hash always wins over computed hash', ()=>{
            const w = new Workout({type:'workout', name:'Same Name', hash:'explicit-hash'})
            w.addStep({type:'step', duration:60, power:{min:100,max:100}})

            expect(w.id).toBe('explicit-hash')
            expect(w.hash).toBe('explicit-hash')
        })
    })
})

describe('Plan', ()=>{

    describe('id/hash computation', ()=>{

        test('two plans with the same name but different workouts get different ids', ()=>{
            const p1 = new Plan({name:'Same Plan', workouts:[{week:1,day:1,workoutId:'w1'}]})
            const p2 = new Plan({name:'Same Plan', workouts:[{week:1,day:1,workoutId:'w2'},{week:1,day:2,workoutId:'w3'}]})

            expect(p1.id).not.toBe(p2.id)
        })

        test('identical name and identical workouts still produce the same id', ()=>{
            const p1 = new Plan({name:'Same Plan', workouts:[{week:1,day:1,workoutId:'w1'}]})
            const p2 = new Plan({name:'Same Plan', workouts:[{week:1,day:1,workoutId:'w1'}]})

            expect(p1.id).toBe(p2.id)
        })

        test('explicit opts.id always wins over computed hash', ()=>{
            const p = new Plan({name:'Same Plan', id:'explicit-id', workouts:[{week:1,day:1,workoutId:'w1'}]})

            expect(p.id).toBe('explicit-id')
        })
    })
})
