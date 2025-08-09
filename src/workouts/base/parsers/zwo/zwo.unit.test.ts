import { loadFile } from "../../../../../__tests__/utils/loadFile"
import { FileInfo } from "../../../../api"
import { Workout} from "../../model/Workout"
import { SegmentDefinition, StepDefinition } from "../../model/types"
import {ZwoParser} from './zwo'


describe('ZwoParser',()=>{

    describe('import',()=>{
        test('valid file',async ()=>{
            const parser = new ZwoParser()
            const file = './__tests__/data/workouts/Mayfield.zwo'
            const xml = await loadFile('utf-8',file) as string
            const fileInfo:FileInfo = {type:'file', name:'Mayfield.zwo',filename:file, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
            const workout = await parser.import(fileInfo, xml)
    
            expect(workout.name).toBe('Jon\'s Short Mix')
            expect(workout.description).toBe('This is the short workout often used at Zwift during the development of the workout feature. If you want to get a solid hour of effort in 30 minutes or less, this is a fun one to do.')
        })
    
    
        test ( 'simple file' ,async ()=>  {
            const parser = new ZwoParser();
            const file = './__tests__/data/workouts/Test.zwo'
            const xml = await loadFile('utf-8',file) as string        
            const fileInfo:FileInfo = {type:'file', name:'Test.zwo',filename:file, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
    
            const w = await parser.import(fileInfo, xml)
            
            expect(w).toMatchSnapshot();
        })
    
        test('invalid file',async ()=>{
            const parser = new ZwoParser()
            const file = './__tests__/data/workouts/test.zwo'
            const xml = "<xml/>"
            const fileInfo:FileInfo = {type:'file', name:'test',filename:file, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
            await expect( async ()=> {await parser.import(fileInfo,xml)}).rejects.toThrow('cannot parse <xml>')
        })
    
        test('name empty',async ()=>{
            const parser = new ZwoParser()
            const file = './__tests__/data/workouts/test.zwo'
            const xml = "<workout_file><name/><description/><workout/></workout_file>"
            const fileInfo:FileInfo = {type:'file', name:'test.zwo',filename:file, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
            const workout = await parser.import(fileInfo, xml)
    
            expect(workout.name).toBe('test.zwo')
            
        })
    
    })

    describe ( 'tags' , ()=> {

        class P extends ZwoParser {
            parse(data) {
                const w = new Workout({type:'workout',name:''})
                return super.parse(data,w)
            }
        }

        test ( 'Warmup' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200" PowerLow="0.3" PowerHigh="0.7"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(false)
            expect(w.steps[0].steady).toBe(false)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'Warmup only PowerHigh' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200"  PowerHigh="0.7"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].power).toEqual({max:70, type:'pct of FTP'})
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Warmup only Power' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200"  Power="0.7"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].power).toEqual({max:70,min:70, type:'pct of FTP'})
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Warmup only Power + PowerLow + PowerHigh ( Power is ignored)' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200" Power="0.5" PowerLow="0.3" PowerHigh="0.7"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].steady).toBe(false)
        })
    
        test ( 'Warmup only Power + PowerHigh' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200" Power="0.3"  PowerHigh="0.7"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].steady).toBe(false)
        })
    
        test ( 'Warmup only Power + PowerLow' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200" Power="0.7"  PowerLow="0.6"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].power).toEqual({min:60, max:70, type:'pct of FTP'})
            expect(w.steps[0].steady).toBe(false)
        })
    
    
        test ( 'Warmup only PowerLow' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200"  PowerLow="0.7"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].power).toEqual({min:70, type:'pct of FTP'})
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Warmup only CadenceHigh' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200"  CadenceHigh="70"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].cadence).toEqual({max:70 })
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Warmup only Cadence + CadenceHigh' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200" Cadence="30"  CadenceHigh="70"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].cadence).toEqual({min:30, max:70 })
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Warmup only CadenceLow' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200"  CadenceLow="70"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].cadence).toEqual({min:70 })
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Warmup only Cadence + CadenceLow' ,async ()=>  {
            const data = '<workout_file><workout><Warmup Duration="1200" Cadence="90"  CadenceLow="70"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps[0].cadence).toEqual({min:70, max:90 })
            expect(w.steps[0].steady).toBe(true)
        })
    
        test ( 'Cooldown' ,async ()=>  {
            const data = '<workout_file><workout><Cooldown Duration="1200" CadenceLow="90" CadenceHigh="70" PowerLow="0.7" PowerHigh="0.3"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].cadence).toEqual({min:70, max:90})
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(false)
            expect(w.steps[0].steady).toBe(false)
            expect(w.steps[0].cooldown).toBe(true)
        })
    
        test ( 'Ramp Up' ,async ()=>  {
            const data = '<workout_file><workout><Ramp Duration="200"  PowerLow="0.3" PowerHigh="0.7" CadenceLow="90" CadenceHigh="120"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].cadence).toEqual({min:90, max:120})
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].duration).toBe(200)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'Ramp Down' ,async ()=>  {
            const data = '<workout_file><workout><Ramp Duration="200"  PowerLow="0.7" PowerHigh="0.3" CadenceLow="120" CadenceHigh="90"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].cadence).toEqual({min:90, max:120})
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].duration).toBe(200)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].cooldown).toBe(true)
        })
    
        test ( 'SteadyState' ,async ()=>  {
            const data = '<workout_file><workout><SteadyState Duration="1200" Text="Hello" PowerLow="0.3" PowerHigh="0.7" Cadence="90"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toEqual({min:30, max:70, type:'pct of FTP'})
            expect(w.steps[0].cadence).toEqual({min:90, max:90})
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].steady).toBe(true)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].text).toBe('Hello')
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'SteadyState only Power' ,async ()=>  {
            const data = '<workout_file><workout><SteadyState Duration="1200" Text="Hello" Power="0.5"/></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toEqual({min:50, max:50, type:'pct of FTP'})
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].steady).toBe(true)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].text).toBe('Hello')
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'Freeride easy' ,async ()=>  {
            const data = '<workout_file><workout><Freeride Duration="1200" /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toBeUndefined()
            expect(w.steps[0].cadence).toBeUndefined()
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(false)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'Freeride FTP Test' ,async ()=>  {
            const data = '<workout_file><workout><Freeride Duration="1200" ftptest="1" /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toBeUndefined()
            expect(w.steps[0].cadence).toBeUndefined()
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'FreeRide easy' ,async ()=>  {
            const data = '<workout_file><workout><FreeRide Duration="1200" /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toBeUndefined()
            expect(w.steps[0].cadence).toBeUndefined()
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(false)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'FreeRide FTP Test' ,async ()=>  {
            const data = '<workout_file><workout><FreeRide Duration="1200" ftptest="1" /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toBeUndefined()
            expect(w.steps[0].cadence).toBeUndefined()
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'MaxEffort' ,async ()=>  {
            const data = '<workout_file><workout><MaxEffort Duration="1200"  /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].power).toBeUndefined()
            expect(w.steps[0].cadence).toBeUndefined()
            expect(w.steps[0].duration).toBe(1200)
            expect(w.steps[0].work).toBe(true)
            expect(w.steps[0].cooldown).toBe(false)
        })
    
        test ( 'IntervalsT Cadence' ,async ()=>  {
            const data = '<workout_file><workout><IntervalsT Repeat="3" OnDuration="40" OffDuration="20" CadenceHigh="120" CadenceLow="90" CadenceResting="70" /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(1);
            expect(w.steps[0].type).toBe('segment');
    
            const s = w.steps[0] as SegmentDefinition
            expect(s.repeat).toBe(3);
            expect(s.steps?.length).toBe(2);
    
            const steps = s.steps||[]
            const step0 = steps[0] as StepDefinition

            expect(step0).toBeDefined()
            expect(step0.power).toBeUndefined()
            expect(step0.cadence).toEqual({min:90, max:120})
            expect(step0.duration).toBe(40)
            expect(step0.work).toBe(true)
            expect(step0.cooldown).toBe(false)
    
            const step1 = steps[1] as StepDefinition
            expect(step1.power).toBeUndefined()
            expect(step1.cadence).toEqual({min:70, max:70})
            expect(step1.duration).toBe(20)
            expect(step1.work).toBe(false)
            expect(step1.cooldown).toBe(false)
        })
    
        test ( 'IntervalsT without Repeat -> defaults to 1' ,async ()=>  {
            const data = '<workout_file><workout><IntervalsT OnDuration="40" OffDuration="20" CadenceHigh="120" CadenceLow="90" CadenceResting="70" /></workout></workout_file>'
            const parser = new P();
            const w = await parser.parse(data)
            const s = w.steps[0] as SegmentDefinition
            expect(s.repeat).toBe(1);
        })
    
    
    
        test ( 'Unknown Tag' ,async ()=>  {
            const data = '<workout_file><workout><__Unknown Duration="1200"  /></workout></workout_file>'
            const parser = new P();
            parser['logger'].logEvent = jest.fn();
    
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(0);
            expect(parser['logger'].logEvent).toHaveBeenCalledWith( expect.objectContaining( {message:'unknown tag',level:'warning'}))
        })
    
    
        test ( 'Combination of know and Unknown Tag' ,async ()=>  {
            const data = '<workout_file><workout><MaxEffort Duration="1200"/><__Unknown Duration="100"/><Freeride Duration="1200"/></workout></workout_file>'
            const parser = new P();
            parser['logger'].logEvent = jest.fn();
    
            const w = await parser.parse(data)
            expect(w.steps.length).toBe(2);
            expect(w.steps[1].getStart()).toBe(1200);
            expect(parser['logger'].logEvent).toHaveBeenCalledWith( expect.objectContaining( {message:'unknown tag',level:'warning'}))
        })
    
        test ( 'Parsing error' ,async ()=>  {
            const data = '<workout_file><workout><MaxEffort Duration="1200"</workout></workout_file>'
            const parser = new P();
            
            expect.assertions(1);
    
            try {
                await parser.parse(data);            
            }
            catch (e) {
                expect(e).toBeDefined()        
            }
        })
    
        test ( 'Tag parser throws error' ,async ()=>  {
            const data = '<workout_file><workout><MaxEffort Duration="1200"/></workout></workout_file>'
            const parser = new P();
            parser['tagHandlers'].MaxEffort = jest.fn( () => {throw new Error('test error')})
            
            
            let err:Error|undefined = undefined
            try {
                await parser.parse(data);            
            }
            catch (e) {
                err = e;
            }
        
            expect(err?.message).toBe('parsing error: test error');
        })

        
        test('ftpOverride ',async ()=>{
            const parser = new ZwoParser()
            const file = './__tests__/data/workouts/Ramp_Test.zwo'
            const xml = await loadFile('utf-8',file) as string
            const fileInfo:FileInfo = {type:'file', name:'Ramp_Test.zwo',filename:file, ext:'zwo',dir:'./__tests__/data/workouts',url:undefined, delimiter:'/'}
            const workout = await parser.import(fileInfo, xml)
    
            //console.log( JSON.stringify(workout,undefined,2) )
        })

    
    })    

})