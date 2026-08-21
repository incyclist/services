import { Observer } from '../../base/types/observer'
import { waitNextTick } from '../../utils'
import { Workout } from '../base/model'
import  {useWorkoutList} from '../list'
import { WorkoutRide } from './service'
import { ActiveWorkoutLimit } from './types'
import { WorkoutSettings } from '../list/cards/types'
import { Inject } from '../../base/decorators'
import { sleep } from '../../utils/sleep'

let MockWorkoutList
let MockUserSettings


const setupMocks = (workout?:Workout, settings?:WorkoutSettings, userSettings?:object) => {
    MockUserSettings = {
        get: jest.fn( (key:string, defValue:any) => {
            return userSettings?.[key] ?? defValue
        }),
        set: jest.fn()
    }

    MockWorkoutList = {
        getSelected: jest.fn(),
        getStartSettings: jest.fn().mockReturnValue(settings??{ftp:255,useErgMode:true}),
        setStartSettings: jest.fn()
    }

    if (workout) 
        MockWorkoutList.getSelected= jest.fn().mockReturnValue(workout)

    Inject('WorkoutList', MockWorkoutList)
    Inject('UserSettings', MockUserSettings)
    return MockWorkoutList
}

const resetMocks = () => {

    Inject('WorkoutList', null)
    Inject('UserSettings', null)
}

describe('WorkoutRide',()=>{



    describe('constructor',()=>{

        beforeEach( ()=>{
            setupMocks()
        })

        afterEach( ()=>{
            resetMocks()
        })

        let s;
        test('normal',()=>{
            
            const service = new WorkoutRide()            
            s = service
            expect(s.state).toBe('idle')
        })

    })


    describe('init',()=>{
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        let s
        let  emit;
        beforeEach( ()=>{

        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        test('normal',async ()=>{
            setupMocks(workout)
            const service = new WorkoutRide()
            s = service
            emit = jest.spyOn(s,'emit')
            const observer = service.init()       

            expect(observer).toBeDefined()
            expect(s.state).toBe('initialized')
            expect(s.manualTimeOffset).toBe(0)
            expect(s.manualPowerOffset).toBe(0)
            expect(s.offset).toBe(0)
            expect(s.tsStart).toBeUndefined()
            expect(s.trainingTime).toBe(0)
            
            await waitNextTick()
            expect(emit).toHaveBeenCalledWith('initialized')
        })

        test('no workout',()=>{
            setupMocks()
            const service = new WorkoutRide()
            s = service
            emit = jest.spyOn(s,'emit')
            const observer = service.init()       

            expect(observer).toBeUndefined()
            expect(s.state).toBe('idle')

        })

        test('with FTP',()=>{
            setupMocks(workout,{ftp:300})

            const service = new WorkoutRide()
            s = service
            const observer = service.init()       

            expect(observer).toBeDefined()
            expect(s.state).toBe('initialized')
            expect(s.settings.ftp).toBe(300)
            
        })
        test('without FTP',()=>{
            setupMocks(workout,{})

            const service = new WorkoutRide()
            s = service
            const observer = service.init()       

            expect(observer).toBeDefined()
            expect(s.state).toBe('initialized')
            expect(s.settings.ftp).toBe(200)
            expect(MockWorkoutList.setStartSettings).toHaveBeenCalledWith({ftp:200})
            
        })




    })


    describe('start',()=>{
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        let s,service:WorkoutRide
        let  emit;
        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.init()       

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        test('normal',async ()=>{
            service.start()    
            expect(emit).toHaveBeenCalledWith('started')
            expect(s.state).toBe('active')
            
            await sleep(1100)

            expect(emit).toHaveBeenCalledWith('update',expect.objectContaining({current:expect.objectContaining({time:expect.closeTo(1,0)})}))
        })


        test('paused',()=>{
            service.start(true)    

            expect(emit).toHaveBeenCalledWith('started')
            expect(emit).toHaveBeenCalledWith('paused')
            expect(s.state).toBe('paused')

        })
        test('not initialized',()=>{
            s.state='idle'

            service.start()    
            expect(emit).not.toHaveBeenCalled()
            expect(s.state).toBe('idle')

        })

        test('error',()=>{ 
            s.state = 'initialized'
            service.emit= jest.fn( ()=>{ throw new Error()} )            
            s.logError = jest.fn()

            service.start()
            expect(s.logError).toHaveBeenCalled()
        })


    })


    describe('stop',()=>{

        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        let s,service:WorkoutRide
        let  emit;
        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    


            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        test('active',async ()=>{
            service.stop({completed:true})

            expect(emit).toHaveBeenCalledWith('completed')
            expect(s.state).toBe('completed')

            await waitNextTick()

            expect(s.getObserver()).toBeUndefined()
            expect(s.state).toBe('idle')
            expect(s.updateInterval).toBeUndefined()

        })
        test('paused',async ()=>{
            s.state = 'paused'
            service.stop()

            expect(emit).toHaveBeenCalledWith('stopped')
            expect(s.state).toBe('completed')
            
            await waitNextTick()

            expect(s.getObserver()).toBeUndefined()
            expect(s.state).toBe('idle')

        })

        test('not initialized',()=>{
            s.state = 'idle'
            service.stop()

            expect(emit).not.toHaveBeenCalled()
            expect(s.state).toBe('idle')
            
        })
        test('no workout',()=>{
            s.workout = undefined
            service.stop()

            expect(emit).not.toHaveBeenCalled()
            expect(s.state).toBe('active')

        })

        test('error',()=>{ 
            s.state = 'active'
            service.emit= jest.fn( ()=>{ throw new Error()} )            
            s.logError = jest.fn()

            service.stop()
            expect(s.logError).toHaveBeenCalled()
        })


    })


    describe('pause',()=>{
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        let s,service:WorkoutRide
        let  emit;
        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    


            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        test('active',()=>{
            service.pause()

            expect(emit).toHaveBeenCalledWith('paused')
            expect(s.tsPauseStart).toEqual(s.tsCurrent)
            expect(s.state).toBe('paused')
        })

        test('not yet initialized',()=>{
            s.state='idle'
            service.pause()

            expect(emit).not.toHaveBeenCalled()
            expect(s.tsPauseStart).toBeUndefined()
            expect(s.state).toBe('idle')

        })

        test('completed',()=>{
            s.state='completed'
            service.pause()

            expect(emit).not.toHaveBeenCalled()
            expect(s.tsPauseStart).toBeUndefined()
            expect(s.state).toBe('completed')

        })
        test('already paused',()=>{
            s.state='paused'
            const  ts = Date.now()-1000
            s.tsPauseStart = ts
            service.pause()

            expect(emit).not.toHaveBeenCalled()
            expect(s.tsPauseStart).toBe(ts)
            expect(s.state).toBe('paused')
        })

        test('error',()=>{ 
            s.state = 'active'
            service.emit= jest.fn( ()=>{ throw new Error()} )            
            s.logError = jest.fn()

            service.pause()
            expect(s.logError).toHaveBeenCalled()
        })


    })


    describe('resume',()=>{
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        let s,service:WorkoutRide
        let  emit;
        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        test('in paused state',()=>{
            s.state = 'paused'
            s.tsPauseStart = Date.now()-1000

            service.resume()

            expect(emit).toHaveBeenCalledWith('resumed')
            expect(s.offset).toBeCloseTo(1000,-1)
            expect(s.state).toBe('active')
        })
        test('not yet started',()=>{
            s.state='initialized'
            service.resume()

            expect(emit).toHaveBeenCalledWith('started')
            expect(s.offset).toBe(0)
            expect(s.state).toBe('active')

        })
        test('already completed',()=>{
            s.state='completed'
            service.resume()

            expect(emit).toHaveBeenCalledWith('started')
            expect(s.offset).toBe(0)
            expect(s.state).toBe('active')

        })
        test('not yet initialized',()=>{         
            s.state='idle'
            service.resume()

            expect(emit).not.toHaveBeenCalled()
            expect(s.offset).toBe(0)
            expect(s.state).toBe('idle')

        })

        test('error',()=>{ 
            s.state= 'initialized'
            s.start= jest.fn( ()=>{ throw new Error()} )            
            s.logError = jest.fn()

            service.resume()
            expect(s.logError).toHaveBeenCalled()
        })

    })


    describe('forward',()=>{
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        let s,service:WorkoutRide
        let  emit;
        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        test('beginning of step',()=>{
            // set Time to 1s
            s.tsCurrent = Date.now()
            s.tsStart = Date.now()-1000
            s.trainingTime = 1;
            s.settings.ftp = 100

            service.forward()

            expect(s.manualTimeOffset).toBe(119)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:60,minPower:50,maxPower:50 }))
            expect( emit).toHaveBeenCalledWith('step-changed', expect.objectContaining({title:'Test Workout: Test Segment(1/10) - Test Relax',current:expect.objectContaining({duration:60,minPower:50,maxPower:50 })}))
        })

        test('during last step',()=>{
            // set Time to 1s
            s.tsCurrent = Date.now()
            s.trainingTime = 9*180+130;
            s.tsStart = Date.now()-(s.trainingTime*1000)
            s.settings.ftp = 100

            service.forward()

            expect(s.manualTimeOffset).toBe(50)
            expect( emit).toHaveBeenCalledWith('completed' )
            expect(s.state).toBe('completed')
            
        })

        test('error',()=>{ 
            s.workout.getLimits = jest.fn( ()=>{ throw new Error()})
            s.logError = jest.fn()

            service.forward()
            expect(s.logError).toHaveBeenCalled()
        })

    })


    describe('backward',()=>{
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })


        let s,service:WorkoutRide
        let  emit;
        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            resetMocks()
            jest.resetAllMocks()
        })

        const setTime = (time:number) => {            
            s.tsCurrent = Date.now()
            s.tsStart = Date.now() - time * 1000
            s.trainingTime = time
            s.currentStep = workout.getLimits(time,true)?.step

        }

        test('beginning of step, should move to previous step',()=>{
            setTime(181)
            s.settings.ftp = 100

            service.backward()

            expect(s.manualTimeOffset).toBe(-61)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:60,minPower:50,maxPower:50 }))
            expect( emit).toHaveBeenCalledWith('step-changed', expect.objectContaining({title:'Test Workout: Test Segment(1/10) - Test Relax',current:expect.objectContaining({time:120,duration:60,minPower:50,maxPower:50 })}))

        })

        test('after 15s of step, should move to current step',()=>{
            setTime(195)
            s.settings.ftp = 100

            service.backward()

            expect(s.manualTimeOffset).toBe(-15)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:120,minPower:100,maxPower:100 }))
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({title:'Test Workout: Test Segment(2/10) - Test Work',current:expect.objectContaining({time:180,duration:120,minPower:100,maxPower:100 })}))
        })


        test('at beginning of first step',()=>{
            const time = 5
            s.tsCurrent = Date.now()
            s.tsStart = Date.now()-time*1000
            s.trainingTime = time;
            s.settings.ftp = 100
            s.setCurrentLimits()
            s.currentStep = workout.getLimits(time,true)?.step

            service.backward()

            expect(s.manualTimeOffset).toBe(-5)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:120,minPower:100,maxPower:100 }))
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({title:'Test Workout: Test Segment(1/10) - Test Work',canShowBackward:false,
                current:expect.objectContaining({duration:120,minPower:100,maxPower:100 })}))
            
        })

        test('error',()=>{ 
            s.workout.getLimits = jest.fn( ()=>{ throw new Error()})
            s.logError = jest.fn()

            service.backward()
            expect(s.logError).toHaveBeenCalled()
        })

        test.skip('bugfix: incorect time after backwrd',async ()=>{
            // test is successfull when run individually, but fails when run with other tests
            s.settings.ftp = 100
            const workout = new Workout({type:'workout',name:'Test Workout'})
            workout.addStep( {type:'step', steady:false, work:false, duration:300, power:{min:45,max:55,type:'pct of FTP'}, text:'Warmup'})
            workout.addSegment( {type:'segment', repeat:9, steps: [ 
                {type:'step', steady:true, work:true, duration:120, power:{min:75,max:75,type:'pct of FTP'},text:'FatMax'} ,
                {type:'step', steady:false, work:true, duration:600, power:{min:55,max:70,type:'pct of FTP'},text:'LIT'} ,
                {type:'step', steady:true, work:false, duration:15, power:{min:55,max:55,type:'pct of FTP'},text:'Pause'} ,
            ] })
            s.workout = workout
            s.manualTimeOffset = 300;
            s.offset = 3787
            s.trainingTime = 317.713
            s.tsCurrent = Date.now()
            s.tsStart = s.tsCurrent-3787-17713
            s.currentStep = workout.getLimits(317,true)?.step
            s.setCurrentLimits()
            
            service.backward()

            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining(
                {title:'Test Workout: FatMax(1/9)',current:expect.objectContaining({time:expect.closeTo(300,0)})}))
        })


    })

    describe('powerUp',()=>{
        let s,service:WorkoutRide;
        let setStartSettings, emit;
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.workoutList = useWorkoutList()
            s.resetTimes()            
            s.manualPowerOffset = 0
            s.workout = workout
            s.settings = {ftp:200}
            s.state = 'active'
            s.trainingTime = 0
        
            setStartSettings = s.workoutList.setStartSettings = jest.fn()
            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.reset()                  
            resetMocks()
            jest.resetAllMocks()
        })

        test('normal',()=>{
            s.settings={ftp:200}
            service.powerUp(10)

            expect( setStartSettings).toHaveBeenCalledWith( expect.objectContaining({ftp:expect.closeTo(220,0)}))
            // this swipe scaled FTP (currentStep is undefined here, so isWattFallbackAdjustment() is
            // false) - manualPowerOffset is the Watt-side dial and must stay untouched by an FTP-side
            // adjustment (regression: an FTP-only swipe during a warmup was silently shifting the
            // start of a later, unrelated, unlocked-Watt ramp step the rider never touched)
            expect( s.manualPowerOffset).toBe(0)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({ftp:expect.closeTo(220,0)}))

        })
        // `init()` always guarantees settings.ftp is populated before a ride can reach powerUp(), so
        // this only exercises the defensive DEFAULT_FTP fallback directly.
        test('no FTP set - defaults to DEFAULT_FTP (200)',()=>{
            s.settings={}
            const result = service.powerUp(10)

            expect( setStartSettings).toHaveBeenCalledWith( expect.objectContaining({ftp:expect.closeTo(220,0)}))
            expect( s.manualPowerOffset).toBe(0)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({ftp:expect.closeTo(220,0)}))
            expect(result).toEqual({ type: 'ftp', value: 220 })

        })

        test('error thrown',()=>{
            s.setCurrentLimits = jest.fn( ()=>{throw new Error('Err')})
            s.logError = jest.fn()

            const result = service.powerUp(10)
            expect(s.logError).toHaveBeenCalled()
            expect(result).toBeUndefined()

        })

        // Regression: mobile swipe-up feedback ("+5% (FTP: 220W)") needs to know the Workout FTP
        // was adjusted (not the range-step targetPower) - powerUp() must report both the value and
        // which quantity it is.
        test('returns {type:"ftp"} with the adjusted Workout FTP for a normal (FTP-based) adjustment',()=>{
            s.settings={ftp:200}
            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(result?.value).toBe(Math.round(s.settings.ftp))
        })

        // Regression: mobile swipe-up feedback ("+5% (155W)", no FTP label) for a step that allows
        // a power range (e.g. 120-170W) - powerUp() must report {type:'targetPower'}, not FTP,
        // since FTP isn't touched in this branch at all.
        test('returns {type:"targetPower"} for a range step (minPower!==maxPower), without touching FTP',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:150 }

            const result = service.powerUp(1)

            expect(result).toEqual({ type: 'targetPower', value: 155 })
            expect(s.currentLimits.targetPower).toBe(155)
            expect(setStartSettings).not.toHaveBeenCalled()
        })

        test('caps the range-step targetPower at maxPower',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:280 }

            const result = service.powerUp(2)

            expect(result).toEqual({ type: 'targetPower', value: 300 })
            expect(s.currentLimits.targetPower).toBe(300)
        })

        // The 7-scenario matrix below (type watt/pct-of-FTP x shape fixed/mid-range/at-boundary x
        // lock state, where lock only applies to watt) was worked out with the reporter of the
        // original bug (a fixed-Watt step's targetPower shifting on swipe) after realising the
        // originally-proposed "always frozen" fix would make every absolute-Watt step immovable,
        // which is wrong for a normal ride (only a structured test interval actually needs that).
        // `PowerLimit.locked` (falling back to `Workout.lockedPowerTargets`) makes it opt-in per
        // step/workout, defaulting to unlocked/adjustable.

        // Scenario 1: pct-of-FTP, fixed (minPower===maxPower) - mode-independent, target always
        // recalculates directly from the new FTP since target===min===max by definition. Already
        // exercised by the 'normal' test above; this adds the explicit currentLimits assertion.
        test('pct-of-FTP fixed target recalculates directly from the new FTP',()=>{
            const woPctFixed = new Workout({type:'workout',name:'Pct Fixed Workout'})
            woPctFixed.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Fixed Step'}
            ] })
            s.workout = woPctFixed
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.currentLimits.minPower).toBe(220)
            expect(s.currentLimits.maxPower).toBe(220)
            expect(s.currentLimits.targetPower).toBe(220)
        })

        // Scenario 2b: pct-of-FTP, range, at boundary (no headroom left to nudge) - FTP scales and
        // the target must track it to the new boundary, not freeze at its pre-swipe absolute value.
        test('pct-of-FTP range step at boundary: FTP scales and targetPower follows it',()=>{
            const woPct = new Workout({type:'workout',name:'Pct Range Workout'})
            woPct.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:50,max:100,type:'pct of FTP'}, text:'Range Step'}
            ] })
            s.workout = woPct
            s.settings = {ftp:200}
            s.setCurrentLimits() // range resolves to 100-200W
            s.currentLimits.targetPower = s.currentLimits.maxPower // pin to the upper boundary (200)

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.currentLimits.minPower).toBe(110)
            expect(s.currentLimits.maxPower).toBe(220)
            expect(s.currentLimits.targetPower).toBe(220)
        })

        // Scenario 3, unlocked (default): the original bug report's exact case - a fixed absolute-Watt
        // target (minPower===maxPower, type:'watt', e.g. "ride at exactly 150W"). With the agreed
        // default (unlocked/adjustable), the target itself now moves directly by the swipe's Watt
        // delta and FTP is left untouched, since an absolute-Watt value is independent of FTP.
        test('unlocked (default) fixed absolute-Watt target moves directly by the swipe delta, FTP untouched',()=>{
            const wattWorkout = new Workout({type:'workout',name:'Watt Workout'})
            wattWorkout.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt'}, text:'Fixed Watt Step'}
            ] })
            s.workout = wattWorkout
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'targetPower', value: 160 })
            expect(setStartSettings).not.toHaveBeenCalled()
            expect(s.settings.ftp).toBe(200)
            expect(s.currentLimits.minPower).toBe(160)
            expect(s.currentLimits.maxPower).toBe(160)
            expect(s.currentLimits.targetPower).toBe(160)
        })

        // Scenario 3, locked (step-level `power.locked:true`, e.g. a structured FTP-test interval
        // that must hold an exact wattage): the power target is frozen and FTP is scaled instead -
        // this is the original bug's fix, now opt-in rather than the default.
        test('locked (step-level) fixed absolute-Watt target stays frozen, FTP changes instead',()=>{
            const woWattLocked = new Workout({type:'workout',name:'Watt Locked Workout'})
            woWattLocked.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt',locked:true}, text:'Locked Fixed Step'}
            ] })
            s.workout = woWattLocked
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.currentLimits.minPower).toBe(150)
            expect(s.currentLimits.maxPower).toBe(150)
            expect(s.currentLimits.targetPower).toBe(150)
        })

        // Scenario 4b, unlocked (default): Watt range step at its upper boundary (no headroom left).
        // The window extends past the authored boundary by the swipe delta and the target tracks the
        // new boundary; FTP stays untouched.
        test('unlocked (default) Watt range step at boundary: window extends by the delta, FTP untouched',()=>{
            const woWatt = new Workout({type:'workout',name:'Watt Range Workout'})
            woWatt.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:200,type:'watt'}, text:'Range Step'}
            ] })
            s.workout = woWatt
            s.settings = {ftp:200}
            s.setCurrentLimits()
            s.currentLimits.targetPower = s.currentLimits.maxPower // pin to the upper boundary (200)

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'targetPower', value: 210 })
            expect(s.settings.ftp).toBe(200)
            expect(s.currentLimits.minPower).toBe(110)
            expect(s.currentLimits.maxPower).toBe(210)
            expect(s.currentLimits.targetPower).toBe(210)
        })

        // Scenario 4b, locked (step-level): the exact case the user asked to confirm explicitly -
        // "FTP changes and targetPower does not change (stays at current boundary)".
        test('locked (step-level) Watt range step at boundary: window/target stay put, FTP changes',()=>{
            const woWattRangeLocked = new Workout({type:'workout',name:'Watt Range Locked Workout'})
            woWattRangeLocked.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:200,type:'watt',locked:true}, text:'Locked Range Step'}
            ] })
            s.workout = woWattRangeLocked
            s.settings = {ftp:200}
            s.setCurrentLimits()
            s.currentLimits.targetPower = s.currentLimits.maxPower

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.currentLimits.minPower).toBe(100)
            expect(s.currentLimits.maxPower).toBe(200)
            expect(s.currentLimits.targetPower).toBe(200)
        })

        // Workout-level default: a step with no `locked` flag of its own falls back to the Workout's
        // `lockedPowerTargets`, letting an author lock every absolute-Watt step in a test workout at
        // once instead of annotating each one.
        test('workout-level lockedPowerTargets locks a step with no step-level flag of its own',()=>{
            const woLevel = new Workout({type:'workout',name:'Workout-level Locked', lockedPowerTargets:true})
            woLevel.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt'}, text:'Fixed Step, no step-level flag'}
            ] })
            s.workout = woLevel
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.currentLimits.targetPower).toBe(150)
        })

        // Step-level `locked` always wins over the workout-level default in either direction - here
        // an explicit `locked:false` un-locks a step inside an otherwise-locked workout.
        test('step-level locked:false overrides workout-level lockedPowerTargets:true',()=>{
            const woLevelOverride = new Workout({type:'workout',name:'Workout-level Locked, step override', lockedPowerTargets:true})
            woLevelOverride.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt',locked:false}, text:'Fixed Step, explicit unlock'}
            ] })
            s.workout = woLevelOverride
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'targetPower', value: 160 })
            expect(s.settings.ftp).toBe(200)
            expect(s.currentLimits.targetPower).toBe(160)
        })

        // Regression: a ramp test with a 'pct of FTP' warmup followed by an unlocked absolute-Watt
        // ramp (e.g. 100W->400W) - swiping during the warmup must scale FTP only, and must not leak
        // into the ramp's start value once the ride reaches it, even though the rider never swiped
        // during the ramp itself. Reproduces the real report: the ramp started at 110W instead of
        // 100W purely because of an earlier, unrelated FTP-only swipe.
        test('an FTP-only swipe during a warmup does not shift the start of a later unlocked-Watt ramp',()=>{
            const woRamp = new Workout({type:'workout',name:'Ramp Test'})
            woRamp.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:60, power:{min:50,max:50,type:'pct of FTP'}, text:'Warmup'},
                {type:'step', steady:false, work:true, duration:300, power:{min:100,max:400,type:'watt'}, text:'Ramp'},
            ] })
            s.workout = woRamp
            s.settings = {ftp:200}
            s.setCurrentLimits(0)

            const result = service.powerUp(10) // swipe during the warmup only

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.manualPowerOffset).toBe(0)

            s.setCurrentLimits(60) // ride time advances into the ramp - no swipe here

            expect(s.currentLimits.minPower).toBe(100)
            expect(s.currentLimits.maxPower).toBe(100)
        })

        // Scenario 5: no power limit at all (e.g. a free-ride/rest step) - FTP still updates, nothing
        // else exists to shift, no crash.
        test('no power limit step: FTP still changes, nothing else to shift',()=>{
            const woFree = new Workout({type:'workout',name:'Free Workout'})
            woFree.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, text:'Free Step'}
            ] })
            s.workout = woFree
            s.settings = {ftp:200}
            s.setCurrentLimits()
            expect(s.isFreeRide).toBe(true)

            const result = service.powerUp(10)

            expect(result).toEqual({ type: 'ftp', value: 220 })
            expect(s.currentLimits.minPower).toBeUndefined()
            expect(s.currentLimits.maxPower).toBeUndefined()
            expect(s.currentLimits.targetPower).toBeUndefined()
        })

    })
    describe('powerDown',()=>{

        let s,service:WorkoutRide;
        let setStartSettings, emit;
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutRide()
            s.workoutList = useWorkoutList()
            s.resetTimes()            
            s.manualPowerOffset = 0
            s.workout = workout
            s.settings = {ftp:200}
            s.state = 'active'
            s.trainingTime = 0
        
            setStartSettings = s.workoutList.setStartSettings = jest.fn()
            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.reset()                  
            resetMocks()
            jest.resetAllMocks()
        })

        test('normal',()=>{
            s.settings={ftp:100}
            service.powerDown(10)

            expect( setStartSettings).toHaveBeenCalledWith( expect.objectContaining({ftp:100/1.1}))
            // this swipe scaled FTP (currentStep is undefined here, so isWattFallbackAdjustment() is
            // false) - manualPowerOffset is the Watt-side dial and must stay untouched by an FTP-side
            // adjustment (regression: an FTP-only swipe during a warmup was silently shifting the
            // start of a later, unrelated, unlocked-Watt ramp step the rider never touched)
            expect( s.manualPowerOffset).toBe(0)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({ftp:100/1.1}))

        })
        // `init()` always guarantees settings.ftp is populated before a ride can reach powerDown(),
        // so this only exercises the defensive DEFAULT_FTP fallback directly.
        test('no FTP set - defaults to DEFAULT_FTP (200)',()=>{
            s.settings={}
            const result = service.powerDown(10)

            const ftp = Math.round(200/1.1)
            expect( setStartSettings).toHaveBeenCalledWith( expect.objectContaining({ftp:expect.closeTo(200/1.1,5)}))
            expect( s.manualPowerOffset).toBe(0)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({ftp:expect.closeTo(200/1.1,5)}))
            expect(result).toEqual({ type: 'ftp', value: ftp })

        })

        test('error thrown',()=>{
            s.setCurrentLimits = jest.fn( ()=>{throw new Error('Err')})
            s.logError = jest.fn()

            const result = service.powerDown(10)
            expect(s.logError).toHaveBeenCalled()
            expect(result).toBeUndefined()

        })

        // Regression: mobile swipe-down feedback ("-5% (FTP: 91W)") needs to know the Workout FTP
        // was adjusted (not the range-step targetPower) - powerDown() must report both the value
        // and which quantity it is.
        test('returns {type:"ftp"} with the adjusted Workout FTP for a normal (FTP-based) adjustment',()=>{
            s.settings={ftp:100}
            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'ftp', value: Math.round(100/1.1) })
            expect(result?.value).toBe(Math.round(s.settings.ftp))
        })

        // Regression: mobile swipe-down feedback ("-5% (145W)", no FTP label) for a step that
        // allows a power range (e.g. 120-170W) - powerDown() must report {type:'targetPower'}, not
        // FTP, since FTP isn't touched in this branch at all.
        test('returns {type:"targetPower"} for a range step (minPower!==maxPower), without touching FTP',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:150 }

            const result = service.powerDown(1)

            expect(result).toEqual({ type: 'targetPower', value: 145 })
            expect(s.currentLimits.targetPower).toBe(145)
            expect(setStartSettings).not.toHaveBeenCalled()
        })

        test('floors the range-step targetPower at minPower',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:120 }

            const result = service.powerDown(2)

            expect(result).toEqual({ type: 'targetPower', value: 100 })
            expect(s.currentLimits.targetPower).toBe(100)
        })

        // Mirror of the powerUp() 7-scenario matrix - see the powerUp describe block for the full
        // rationale (locked/unlocked design worked out with the bug reporter; lock only applies to
        // type:'watt', defaults to unlocked/adjustable).

        // Scenario 1: pct-of-FTP, fixed - mode-independent, recalculates directly from the new FTP.
        test('pct-of-FTP fixed target recalculates directly from the new FTP',()=>{
            const woPctFixed = new Workout({type:'workout',name:'Pct Fixed Workout'})
            woPctFixed.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Fixed Step'}
            ] })
            s.workout = woPctFixed
            s.settings = {ftp:100}
            s.setCurrentLimits()

            const result = service.powerDown(10)

            const ftp = Math.round(100/1.1)
            expect(result).toEqual({ type: 'ftp', value: ftp })
            expect(s.currentLimits.minPower).toBe(ftp)
            expect(s.currentLimits.maxPower).toBe(ftp)
            expect(s.currentLimits.targetPower).toBe(ftp)
        })

        // Scenario 2b: pct-of-FTP, range, at (lower) boundary - FTP scales and the target tracks it
        // down to the new lower boundary instead of freezing at its pre-swipe absolute value.
        test('pct-of-FTP range step at boundary: FTP scales and targetPower follows it',()=>{
            const woPct = new Workout({type:'workout',name:'Pct Range Workout'})
            woPct.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:50,max:100,type:'pct of FTP'}, text:'Range Step'}
            ] })
            s.workout = woPct
            s.settings = {ftp:200}
            s.setCurrentLimits() // range resolves to 100-200W
            s.currentLimits.targetPower = s.currentLimits.minPower // pin to the lower boundary (100)

            const result = service.powerDown(10)

            const ftp = Math.round(200/1.1)
            expect(result).toEqual({ type: 'ftp', value: ftp })
            expect(s.currentLimits.minPower).toBe(Math.round(0.5*ftp))
            expect(s.currentLimits.maxPower).toBe(ftp)
            expect(s.currentLimits.targetPower).toBe(Math.round(0.5*ftp))
        })

        // Scenario 3, unlocked (default): the original bug report's exact case - a fixed absolute-Watt
        // target. Target moves directly by the swipe's Watt delta; FTP is left untouched.
        test('unlocked (default) fixed absolute-Watt target moves directly by the swipe delta, FTP untouched',()=>{
            const wattWorkout = new Workout({type:'workout',name:'Watt Workout'})
            wattWorkout.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt'}, text:'Fixed Watt Step'}
            ] })
            s.workout = wattWorkout
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'targetPower', value: 140 })
            expect(setStartSettings).not.toHaveBeenCalled()
            expect(s.settings.ftp).toBe(200)
            expect(s.currentLimits.minPower).toBe(140)
            expect(s.currentLimits.maxPower).toBe(140)
            expect(s.currentLimits.targetPower).toBe(140)
        })

        // Scenario 3, locked (step-level `power.locked:true`): the power target is frozen and FTP is
        // scaled instead - the original bug's fix, now opt-in rather than the default.
        test('locked (step-level) fixed absolute-Watt target stays frozen, FTP changes instead',()=>{
            const woWattLocked = new Workout({type:'workout',name:'Watt Locked Workout'})
            woWattLocked.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt',locked:true}, text:'Locked Fixed Step'}
            ] })
            s.workout = woWattLocked
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'ftp', value: Math.round(200/1.1) })
            expect(s.currentLimits.minPower).toBe(150)
            expect(s.currentLimits.maxPower).toBe(150)
            expect(s.currentLimits.targetPower).toBe(150)
        })

        // Scenario 4b, unlocked (default): Watt range step at its lower boundary. The window extends
        // past the authored boundary by the swipe delta and the target tracks the new boundary; FTP
        // stays untouched.
        test('unlocked (default) Watt range step at boundary: window extends by the delta, FTP untouched',()=>{
            const woWatt = new Workout({type:'workout',name:'Watt Range Workout'})
            woWatt.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:200,type:'watt'}, text:'Range Step'}
            ] })
            s.workout = woWatt
            s.settings = {ftp:200}
            s.setCurrentLimits()
            s.currentLimits.targetPower = s.currentLimits.minPower // pin to the lower boundary (100)

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'targetPower', value: 90 })
            expect(s.settings.ftp).toBe(200)
            expect(s.currentLimits.minPower).toBe(90)
            expect(s.currentLimits.maxPower).toBe(190)
            expect(s.currentLimits.targetPower).toBe(90)
        })

        // Scenario 4b, locked (step-level): "FTP changes and targetPower does not change (stays at
        // current boundary)".
        test('locked (step-level) Watt range step at boundary: window/target stay put, FTP changes',()=>{
            const woWattRangeLocked = new Workout({type:'workout',name:'Watt Range Locked Workout'})
            woWattRangeLocked.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:200,type:'watt',locked:true}, text:'Locked Range Step'}
            ] })
            s.workout = woWattRangeLocked
            s.settings = {ftp:200}
            s.setCurrentLimits()
            s.currentLimits.targetPower = s.currentLimits.minPower

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'ftp', value: Math.round(200/1.1) })
            expect(s.currentLimits.minPower).toBe(100)
            expect(s.currentLimits.maxPower).toBe(200)
            expect(s.currentLimits.targetPower).toBe(100)
        })

        // Workout-level default: a step with no `locked` flag of its own falls back to the Workout's
        // `lockedPowerTargets`.
        test('workout-level lockedPowerTargets locks a step with no step-level flag of its own',()=>{
            const woLevel = new Workout({type:'workout',name:'Workout-level Locked', lockedPowerTargets:true})
            woLevel.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt'}, text:'Fixed Step, no step-level flag'}
            ] })
            s.workout = woLevel
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'ftp', value: Math.round(200/1.1) })
            expect(s.currentLimits.targetPower).toBe(150)
        })

        // Step-level `locked` always wins over the workout-level default.
        test('step-level locked:false overrides workout-level lockedPowerTargets:true',()=>{
            const woLevelOverride = new Workout({type:'workout',name:'Workout-level Locked, step override', lockedPowerTargets:true})
            woLevelOverride.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt',locked:false}, text:'Fixed Step, explicit unlock'}
            ] })
            s.workout = woLevelOverride
            s.settings = {ftp:200}
            s.setCurrentLimits()

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'targetPower', value: 140 })
            expect(s.settings.ftp).toBe(200)
            expect(s.currentLimits.targetPower).toBe(140)
        })

        // Scenario 5: no power limit at all - FTP still updates, nothing else exists to shift, no crash.
        test('no power limit step: FTP still changes, nothing else to shift',()=>{
            const woFree = new Workout({type:'workout',name:'Free Workout'})
            woFree.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, text:'Free Step'}
            ] })
            s.workout = woFree
            s.settings = {ftp:200}
            s.setCurrentLimits()
            expect(s.isFreeRide).toBe(true)

            const result = service.powerDown(10)

            expect(result).toEqual({ type: 'ftp', value: Math.round(200/1.1) })
            expect(s.currentLimits.minPower).toBeUndefined()
            expect(s.currentLimits.maxPower).toBeUndefined()
            expect(s.currentLimits.targetPower).toBeUndefined()
        })

    })

    describe('getDashboardDisplayProperties',()=>{
        let s,service:WorkoutRide
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [ 
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
        ] })

        beforeEach( ()=>{
            s = service = new WorkoutRide
            s.workout = workout           
            s.settings = {ftp:200}
            s.state='active'

        })
        afterEach( ()=>{
            s.reset()      
            jest.resetAllMocks()      
        })

        test('normal',()=>{
            s.trainingTime = 10
            const dp = service.getDashboardDisplayProperties()

            expect(dp.start).toBeUndefined()
            expect(dp.stop).toBeUndefined()
            expect(dp.ftp).toBe(200)
            expect(dp.workout).toBe(workout)
            expect(dp.title).toBe('Test Workout: Test Segment(1/10) - Test Work')
        })

        test('not initialized',()=>{
            s.trainingTime = 10
            s.state='idle'
            const dp = service.getDashboardDisplayProperties()
            expect(dp).toEqual({})
        })
        test('completed',()=>{
            s.trainingTime = 10
            s.state='completed'
            const dp = service.getDashboardDisplayProperties()
            expect(dp).toEqual({})
        })

        test('internal error',()=>{
            s.trainingTime = 10
            s.getZoomParameters = jest.fn( ()=>{throw new Error('Error')})
            s.logError= jest.fn()
            const dp = service.getDashboardDisplayProperties()
            expect(dp).toEqual({})
            expect(s.logError).toHaveBeenCalled()
        })


        test('check title - segmment with no segment text',()=>{
            s.trainingTime = 10
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', repeat:10, steps: [ 
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
                {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'} 
            ] })

            s.workout = wo
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Workout: Test Work(1/10)')

            s.trainingTime = 120
            const dp1 = service.getDashboardDisplayProperties()
            expect(dp1.title).toBe('Test Workout: Test Relax(1/10)')

            s.trainingTime = 180
            const dp2 = service.getDashboardDisplayProperties()
            expect(dp2.title).toBe('Test Workout: Test Work(2/10)')


        })


        // FIXES_BACKLOG #13 follow-up: an untitled segment/step inside a repeating structure used
        // to leak the bare workout name through unstripped (real-world repro: a .zwo IntervalsT
        // block, which has no name attribute at all). Desktop now falls back to a verbal
        // description ("<target> for <duration>") plus the repeat indicator, since there's nothing
        // else descriptive to show and no other numeric display for it.
        test('check title - segment with no segment text and no step text',()=>{
            s.trainingTime = 10

            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', repeat:10, steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}},
                {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'}}
            ] })
            s.workout = wo
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Workout: 200W for 2min(1/10)')
        })

        // Regression: a plain top-level step (not part of any segment at all) with no text of its
        // own has no repeat context either - desktop shows just the bare workout name, unlike the
        // in-a-segment case above (which does get the verbal-description fallback).
        test('check title - individual step with no text, not in a segment',()=>{
            s.trainingTime = 10
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addStep({type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}})
            s.workout = wo
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Workout')
        })

        test('check title - individual step',()=>{
            s.trainingTime = 10
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addStep({type:'step', text:'Test Step', steady:true, work:true, duration:120, power:{min:60,max:60,type:'pct of FTP'}})
            wo.addSegment( {type:'segment', repeat:10, steps: [ 
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}},                
                {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'}} 
            ] })
            s.workout = wo
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Workout: Test Step')
        })

        test('check zoom - beginning ',()=>{
            s.trainingTime = 0
            const dp = service.getDashboardDisplayProperties()
            expect(dp.start).toBeUndefined()
            expect(dp.stop).toBeUndefined()
        })
        test('check zoom - after 30s ',()=>{
            s.trainingTime = 30
            const dp = service.getDashboardDisplayProperties()
            expect(dp.start).toBe(30)
            expect(dp.stop).toBe(1230)
        })
        test('check zoom - after 40s ',()=>{
            s.trainingTime = 40
            const dp = service.getDashboardDisplayProperties()
            expect(dp.start).toBe(30)
            expect(dp.stop).toBe(1230)
        })
        test('check zoom - after 60s',()=>{
            s.trainingTime = 60
            const dp = service.getDashboardDisplayProperties()
            expect(dp.start).toBeUndefined()
            expect(dp.stop).toBeUndefined()
        })
        test('check zoom - less than 20min to go',()=>{
            s.trainingTime = 1230
            const dp = service.getDashboardDisplayProperties()
            expect(dp.start).toBe(600)
            expect(dp.stop).toBe(1800)
        })


        test('check zoom - whole workout less than 20min',()=>{
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', repeat:5, steps: [ 
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}},                
                {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'}} 
            ] })
            s.workout = wo
    
            s.trainingTime = 630
            const dp = service.getDashboardDisplayProperties()
            expect(dp.start).toBe(0)
            expect(dp.stop).toBe(900)
        })



    })

    // FIXES_BACKLOG #35 / services#505: the dashboard's load-adjustment buttons (+5/+1/-1/-5) either
    // nudge targetPower (Watt) within the current step's power range, or scale the Workout FTP (%),
    // depending on the same boundary logic powerUp()/powerDown() use to act - loadButtons surfaces
    // which one each button will actually do, so web-ui doesn't have to re-implement that branching.
    describe('getDashboardDisplayProperties - loadButtons (FIXES_BACKLOG #35 / services#505)',()=>{
        let s,service:WorkoutRide
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'}
        ] })

        beforeEach( ()=>{
            s = service = new WorkoutRide
            s.workout = workout
            s.settings = {ftp:200}
            s.state='active'
            s.trainingTime = 10
        })
        afterEach( ()=>{
            s.reset()
            jest.resetAllMocks()
        })

        test('single fixed-target step (minPower===maxPower): always %, regardless of targetPower',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:150, maxPower:150, targetPower:150 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-1%', dec5:'-5%' })
        })

        // Regression: the fallback that moves an unlocked absolute-Watt step's value directly
        // (isWattFallbackAdjustment()) is a different, older code path than the range-nudge case
        // above - it applies the button's raw magnitude (1W/5W) via manualPowerOffset, not the
        // range-nudge's 5W/50W nominal step, so its label must say +1W/+5W, not +5W/+50W.
        test('unlocked fixed absolute-Watt target: label shows the raw 1W/5W magnitude, not the 5W/50W range-nudge step',()=>{
            const wattWorkout = new Workout({type:'workout',name:'Watt Workout'})
            wattWorkout.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt'}, text:'Fixed Watt Step'}
            ] })
            s.workout = wattWorkout
            s.setCurrentLimits(0)

            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5W', inc1:'+1W', dec1:'-1W', dec5:'-5W' })
        })

        // Locked steps take the FTP-scaling path instead (isWattFallbackAdjustment() is false), so
        // the label reverts to '%' exactly like a 'pct of FTP' fixed step.
        test('locked fixed absolute-Watt target: label reverts to %, matching the FTP-scaling path it actually takes',()=>{
            const wattWorkoutLocked = new Workout({type:'workout',name:'Watt Locked Workout'})
            wattWorkoutLocked.addSegment( {type:'segment', text:'Test Segment', steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:150,max:150,type:'watt',locked:true}, text:'Locked Fixed Step'}
            ] })
            s.workout = wattWorkoutLocked
            s.setCurrentLimits(0)

            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-1%', dec5:'-5%' })
        })

        // With settings.ftp set (the normal case), powerUp()/powerDown()'s nominal Watt step for a
        // range-adjustable click is 5W for the "1" button and 50W for the "5" button (matching
        // mobile's fixed 5W/50W swipe step, see getPowerRangeDeltaVal()) - the label must reflect
        // that actual step, not the button's own "1"/"5" magnitude, whenever there's enough headroom
        // to apply it in full.
        test('explicit Watt-range step: bottom edge (targetPower===minPower) - dec is %, inc is W (actual 5W/50W step)',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:100 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+50W', inc1:'+5W', dec1:'-1%', dec5:'-5%' })
        })

        test('explicit Watt-range step: top edge (targetPower===maxPower) - inc is %, dec is W (actual 5W/50W step)',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:300 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-5W', dec5:'-50W' })
        })

        test('explicit Watt-range step: mid-range - all four buttons are W (actual 5W/50W step)',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+50W', inc1:'+5W', dec1:'-5W', dec5:'-50W' })
        })

        // Regression (reported after #506 merged): near either edge, the nominal 5W/50W step must
        // be clamped to whatever headroom actually remains - the same clamp powerUp()/powerDown()
        // themselves apply (Math.min/Math.max against maxPower/minPower) - otherwise the label
        // promises a bigger move than what will actually happen. Both inc1 and inc5 land on the
        // same clamped value here since both nominal steps (5W, 50W) exceed the 1W of headroom.
        test('near top edge (1W of headroom): both inc1 and inc5 clamp to the same actual +1W',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:299 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+1W', inc1:'+1W', dec1:'-5W', dec5:'-50W' })
        })

        test('near bottom edge (1W of headroom): both dec1 and dec5 clamp to the same actual -1W',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:101 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+50W', inc1:'+5W', dec1:'-1W', dec5:'-1W' })
        })

        test('no FTP configured: nominal step is the literal button magnitude (1W/5W), still clamped to headroom',()=>{
            s.settings = {}
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:299 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+1W', inc1:'+1W', dec1:'-1W', dec5:'-5W' })
        })

        // A percent-of-FTP zone (e.g. 50-60% FTP) resolves into the identical minPower/maxPower
        // Watt range via getPowerVal() before isPowerRangeAdjustable() ever runs - so it must hit
        // the exact same edge-flipping behaviour as an explicit-Watt step, just at different Watt
        // values (100-120W here, for ftp=200: 50%=100W, 60%=120W).
        describe('percent-of-FTP zone (50-60% FTP, ftp=200 => 100-120W)',()=>{
            const zoneWorkout = new Workout({type:'workout',name:'Zone Workout'})
            zoneWorkout.addStep({type:'step', steady:true, work:true, duration:120, power:{min:50,max:60,type:'pct of FTP'}, text:'Zone Step'})

            beforeEach( ()=>{
                s.workout = zoneWorkout
                s.settings = {ftp:200}
                s.setCurrentLimits(0)
            })

            test('resolves to the expected Watt range',()=>{
                expect(s.currentLimits.minPower).toBe(100)
                expect(s.currentLimits.maxPower).toBe(120)
            })

            // Zone is only 20W wide (100-120W), so the nominal 50W ("5" button) step never fits in
            // full here - every "5" button in this describe block clamps to the remaining headroom.
            test('bottom edge (targetPower===minPower=100W) - dec is %, inc is W, clamped to 20W headroom',()=>{
                s.currentLimits.targetPower = 100
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+20W', inc1:'+5W', dec1:'-1%', dec5:'-5%' })
            })

            test('top edge (targetPower===maxPower=120W) - inc is %, dec is W, clamped to 20W headroom',()=>{
                s.currentLimits.targetPower = 120
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-5W', dec5:'-20W' })
            })

            test('mid-zone (targetPower=110W) - all four buttons are W, clamped to 10W headroom on both sides',()=>{
                s.currentLimits.targetPower = 110
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+10W', inc1:'+5W', dec1:'-5W', dec5:'-10W' })
            })

            // Regression: within the zone but 1W off an edge - both the "1" and "5" buttons on that
            // side clamp to the same +/-1W, exactly as in the wider explicit-Watt-range case above.
            test('1W from top edge (targetPower=119W): both inc1 and inc5 clamp to the same actual +1W',()=>{
                s.currentLimits.targetPower = 119
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+1W', inc1:'+1W', dec1:'-5W', dec5:'-19W' })
            })
        })

        test('undefined when workout is not active (idle)',()=>{
            s.state = 'idle'
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toBeUndefined()
        })
    })

    // FIXES_BACKLOG #37: the load buttons keep %/W power semantics only in ERG mode. In
    // SIM/Resistance mode they either mean gear shift (virtual shifting enabled) or are meaningless
    // and must be hidden (virtual shifting disabled) - see getLoadButtonMode()/isVirtualShiftingEnabled()
    // (shared with RideDisplayService, incyclist-devices' ride module).
    describe('loadButtonMode / gear-shift (FIXES_BACKLOG #37)',()=>{

        let s,service:WorkoutRide
        let sendUpdate,getCyclingMode
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'}
        ] })

        const mockMode = (props:{isERG?:boolean, isSIM?:boolean, isResistance?:boolean, virtshift?:string}) => ({
            isERG: jest.fn().mockReturnValue(!!props.isERG),
            isSIM: jest.fn().mockReturnValue(!!props.isSIM),
            isResistance: jest.fn().mockReturnValue(!!props.isResistance),
            getSetting: jest.fn().mockReturnValue(props.virtshift),
        })

        const setDeviceMode = (mode) => {
            sendUpdate = jest.fn()
            getCyclingMode = jest.fn().mockReturnValue(mode)
            Inject('DeviceRide', { sendUpdate, getCyclingMode })
        }

        beforeEach( ()=>{
            setupMocks(workout)
            s = service = new WorkoutRide()
            s.workoutList = useWorkoutList()
            s.workoutList.setStartSettings = jest.fn()
            s.resetTimes()
            s.manualPowerOffset = 0
            s.workout = workout
            s.settings = {ftp:200}
            s.state = 'active'
            s.trainingTime = 0
        })
        afterEach( ()=>{
            s.reset()
            resetMocks()
            Inject('DeviceRide', null)
            jest.resetAllMocks()
        })

        describe('getLoadButtonMode',()=>{
            test('no device/mode active yet => power',()=>{
                setDeviceMode(undefined)
                expect(service.getLoadButtonMode()).toBe('power')
            })

            test('ERG mode => power (unaffected, #35/#506 behaviour)',()=>{
                setDeviceMode(mockMode({isERG:true}))
                expect(service.getLoadButtonMode()).toBe('power')
            })

            test.each(['Mixed','Incyclist','SmartTrainer','Enabled'])(
                'SIM mode with virtshift=%s => gear',
                (virtshift)=>{
                    setDeviceMode(mockMode({isSIM:true, virtshift}))
                    expect(service.getLoadButtonMode()).toBe('gear')
                }
            )

            test('SIM mode with virtshift disabled => hidden',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Disabled'}))
                expect(service.getLoadButtonMode()).toBe('hidden')
            })

            test('SIM mode with no virtshift setting at all => hidden',()=>{
                setDeviceMode(mockMode({isSIM:true}))
                expect(service.getLoadButtonMode()).toBe('hidden')
            })

            test('Resistance mode => gear unconditionally',()=>{
                setDeviceMode(mockMode({isResistance:true}))
                expect(service.getLoadButtonMode()).toBe('gear')
            })

            test('error accessing device/mode => power (fail safe)',()=>{
                Inject('DeviceRide', { getCyclingMode: jest.fn().mockImplementation(()=>{throw new Error('err')}) })
                s.logError = jest.fn()
                expect(service.getLoadButtonMode()).toBe('power')
                expect(s.logError).toHaveBeenCalled()
            })
        })

        describe('getDashboardDisplayProperties - loadButtonMode/loadButtons',()=>{
            test('power mode: loadButtonMode "power", loadButtons keep the existing %/W labels',()=>{
                setDeviceMode(mockMode({isERG:true}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:150, maxPower:150, targetPower:150 }
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtonMode).toBe('power')
                expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-1%', dec5:'-5%' })
            })

            test('gear mode: loadButtonMode "gear", loadButtons are the bare gear-step text (no unit), matching ShiftingControl',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Enabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtonMode).toBe('gear')
                expect(dp.loadButtons).toEqual({ inc5:'+5', inc1:'+1', dec1:'-1', dec5:'-5' })
            })

            test('hidden mode: loadButtonMode "hidden" - web-ui/mobile use this to hide the four load buttons',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Disabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtonMode).toBe('hidden')
            })
        })

        describe('powerUp()/powerDown() route to a gear shift when loadButtonMode==="gear"',()=>{
            test('powerUp(5) performs a +5 gear shift via the same device mechanism as a non-workout ride, untouched targetPower/FTP',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Enabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }

                const result = service.powerUp(5)

                expect(sendUpdate).toHaveBeenCalledWith({gearDelta:5})
                expect(result).toEqual({type:'gear', value:5})
                expect(s.currentLimits.targetPower).toBe(200)
                expect(s.workoutList.setStartSettings).not.toHaveBeenCalled()
            })

            test('powerUp(1) performs a +1 gear shift',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Mixed'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }

                const result = service.powerUp(1)

                expect(sendUpdate).toHaveBeenCalledWith({gearDelta:1})
                expect(result).toEqual({type:'gear', value:1})
            })

            test('powerDown(5) performs a -5 gear shift',()=>{
                setDeviceMode(mockMode({isResistance:true}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }

                const result = service.powerDown(5)

                expect(sendUpdate).toHaveBeenCalledWith({gearDelta:-5})
                expect(result).toEqual({type:'gear', value:-5})
                expect(s.currentLimits.targetPower).toBe(200)
                expect(s.workoutList.setStartSettings).not.toHaveBeenCalled()
            })

            test('powerDown(1) performs a -1 gear shift',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'SmartTrainer'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }

                const result = service.powerDown(1)

                expect(sendUpdate).toHaveBeenCalledWith({gearDelta:-1})
                expect(result).toEqual({type:'gear', value:-1})
            })

            // Crossed with the %/W range-boundary matrix from #506 (FIXES_BACKLOG #37): gear mode
            // must short-circuit before any of that boundary logic runs, regardless of where
            // targetPower currently sits within the step's range.
            test.each([
                ['bottom edge', 100],
                ['top edge', 300],
                ['mid-range', 200],
            ])('gear mode ignores the %%/W range-boundary logic entirely (targetPower at %s)',(_label,targetPower)=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Enabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower }

                const result = service.powerUp(5)

                expect(result).toEqual({type:'gear', value:5})
                expect(s.currentLimits.targetPower).toBe(targetPower)
                expect(s.workoutList.setStartSettings).not.toHaveBeenCalled()
            })

            // Also crossed with the fixed-target (minPower===maxPower, always-% in power mode) case.
            test('gear mode ignores a fixed-target step (minPower===maxPower) the same way',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Enabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:150, maxPower:150, targetPower:150 }

                const result = service.powerDown(1)

                expect(result).toEqual({type:'gear', value:-1})
                expect(s.currentLimits.targetPower).toBe(150)
            })
        })

        describe('powerUp()/powerDown() are no-ops when loadButtonMode==="hidden"',()=>{
            test('powerUp: no device call, no result, currentLimits/FTP untouched',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Disabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }

                const result = service.powerUp(5)

                expect(sendUpdate).not.toHaveBeenCalled()
                expect(result).toBeUndefined()
                expect(s.currentLimits.targetPower).toBe(200)
                expect(s.workoutList.setStartSettings).not.toHaveBeenCalled()
            })

            test('powerDown: no device call, no result, currentLimits/FTP untouched',()=>{
                setDeviceMode(mockMode({isSIM:true, virtshift:'Disabled'}))
                s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }

                const result = service.powerDown(5)

                expect(sendUpdate).not.toHaveBeenCalled()
                expect(result).toBeUndefined()
                expect(s.currentLimits.targetPower).toBe(200)
                expect(s.workoutList.setStartSettings).not.toHaveBeenCalled()
            })
        })
    })

    // FIXES_BACKLOG #13: mobile shows the workout name elsewhere on screen and must never repeat
    // it in getStepTitle()'s output; when neither the segment nor the step has its own text, it
    // must not duplicate the "<target> for <duration>" text WorkoutRidePageService.buildDashboardLine()
    // already shows separately for the dashboard shoutout line.
    describe('getDashboardDisplayProperties - mobile title (FIXES_BACKLOG #13)',()=>{
        let s,service:WorkoutRide
        const workout = new Workout({type:'workout',name:'Test Workout'})
        workout.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [
            {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'},
            {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'},text:'Test Relax'}
        ] })

        beforeEach( ()=>{
            s = service = new WorkoutRide
            s.workout = workout
            s.settings = {ftp:200}
            s.state='active'
            s.getBindings = jest.fn().mockReturnValue({ appInfo: { getChannel: ()=>'mobile' } })
        })
        afterEach( ()=>{
            s.reset()
        })

        test('both segment and step named - workout name never included, separator unchanged',()=>{
            s.trainingTime = 10
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Segment(1/10) - Test Work')
        })

        test('segment named, step nameless - repeat attaches to the segment name',()=>{
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', text:'Test Segment', repeat:10, steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}}
            ] })
            s.workout = wo
            s.trainingTime = 10
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Segment(1/10)')
        })

        test('step named, segment nameless - repeat attaches to the step name',()=>{
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', repeat:10, steps: [
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}, text:'Test Work'}
            ] })
            s.workout = wo
            s.trainingTime = 10
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('Test Work(1/10)')
        })

        // Real-world repro: a .zwo IntervalsT block (Repeat=3, OnPower/OffPower, no name
        // attribute at all) - both segment and step are nameless, but it does repeat. Only the
        // bare repeat suffix is returned - buildDashboardLine() already shows the numeric target
        // separately, so embedding it again here would duplicate it.
        test('both nameless, inside a repeating segment - bare repeat suffix only',()=>{
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', repeat:3, steps: [
                {type:'step', steady:true, work:true, duration:30, power:{min:180,max:180,type:'watt'}},
                {type:'step', steady:true, work:false, duration:90, power:{min:110,max:110,type:'watt'}}
            ] })
            s.workout = wo
            s.trainingTime = 10
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('(1/3)')
        })

        // Not in a segment at all - no repeat context exists either, so fall back to the verbal
        // description instead of an empty title.
        test('both nameless, not in a segment - falls back to the verbal description',()=>{
            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addStep({type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}})
            s.workout = wo
            s.trainingTime = 10
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('200W for 2min')
        })

        test('free (no active limit) - bare "free", no workout name',()=>{
            s.trainingTime = 100000
            const dp = service.getDashboardDisplayProperties()
            expect(dp.title).toBe('free')
        })
    })

    describe('getCurrentLimits',()=>{

        let s,service:WorkoutRide
        const currentLimits:ActiveWorkoutLimit = { time:100,duration:600, remaining:500,minPower:100}

        beforeEach( ()=>{
            s = service = new WorkoutRide
            s.currentLimits = currentLimits
        })
        afterEach( ()=>{
            s.reset()            
        })

        test('normal',()=>{
            s.state ='active'
            expect(service.getCurrentLimits()).toBe(currentLimits)
            s.state ='initialized'
            expect(service.getCurrentLimits()).toBe(currentLimits)
            s.state ='paused'
            expect(service.getCurrentLimits()).toBe(currentLimits)
        })

        test('not initialized',()=>{            
            s.state='idle'
            expect(service.getCurrentLimits()).toBeUndefined()
        })
        test('completed',()=>{
            s.state='completed'
            expect(service.getCurrentLimits()).toBeUndefined()
        })



    })

    describe('isActive',()=>{

        let s,service:WorkoutRide
        beforeEach( ()=>{
            s = service = new WorkoutRide
        })
        afterEach( ()=>{
            s.reset()            
        })

        test('active',()=>{
            s.state ='active'
            expect(service.isActive()).toBe(true)
        })

        test('not active',()=>{            
            s.state='idle'
            expect(service.isActive()).toBe(false)
            s.state='initialized'
            expect(service.isActive()).toBe(false)
            s.state='paused'
            expect(service.isActive()).toBe(false)
            s.state='completed'
            expect(service.isActive()).toBe(false)

        })
    })

    describe('inUse',()=>{

        let s,service:WorkoutRide
        beforeEach( ()=>{
            s = service = new WorkoutRide
        })
        afterEach( ()=>{
            s.reset()            
        })

        test('normal',()=>{
            s.state ='active'
            expect(service.inUse()).toBe(true)
        })

        test('not initialized',()=>{            
            s.state='idle'
            expect(service.inUse()).toBe(false)
        })
        test('completed',()=>{
            s.state='completed'
            expect(service.inUse()).toBe(false)
        })

    })
    describe('getWorkout',()=>{
        const workout = new Workout( {type:'workout',name:'Test',steps:[],})
        let s,service:WorkoutRide
        beforeEach( ()=>{
            s = service = new WorkoutRide
            s.workout = workout
        })
        afterEach( ()=>{
            s.reset()            
        })

        test('normal',()=>{
            s.state = 'active'
            expect(service.getWorkout()).toBe(workout)
        })
        test('not initialized',()=>{
            s.state = 'idle'
            expect(service.getWorkout()).toBeUndefined

        })
        test('completed',()=>{
            s.state = 'completed'
            expect(service.getWorkout()).toBe(workout)

        })
    })


    describe('getObserver',()=>{
        let s,service:WorkoutRide
        const observer = new Observer()

        beforeEach( ()=>{
            s = service = new WorkoutRide
            s.observer = observer
        })
        afterEach( ()=>{
            s.reset()            
        })

        test('normal',()=>{
            s.state ='active'
            expect(service.getObserver()).toBe(observer)
        })

        test('not initialized',()=>{            
            s.state='idle'
            expect(service.getObserver()).toBeUndefined()
        })
        test('completed',()=>{
            s.state='completed'
            expect(service.getObserver()).toBe(observer)
        })


    })


})