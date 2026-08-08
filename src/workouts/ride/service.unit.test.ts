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
            expect( s.manualPowerOffset).toBe(10)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({ftp:expect.closeTo(220,0)}))

        })
        test('no FTP set',()=>{
            s.settings={}
            const result = service.powerUp(10)

            expect( setStartSettings).not.toHaveBeenCalled()
            expect( s.manualPowerOffset).toBe(10)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.not.objectContaining({ftp:expect.anything()}))
            expect(result).toBeUndefined()

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
            expect( s.manualPowerOffset).toBe(-10)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({ftp:100/1.1}))

        })
        test('no FTP set',()=>{
            s.settings={}
            const result = service.powerDown(10)

            expect( setStartSettings).not.toHaveBeenCalled()
            expect( s.manualPowerOffset).toBe(-10)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.not.objectContaining({ftp:expect.anything()}))
            expect(result).toBeUndefined()

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

        test('explicit Watt-range step: bottom edge (targetPower===minPower) - dec is %, inc is W',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:100 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5W', inc1:'+1W', dec1:'-1%', dec5:'-5%' })
        })

        test('explicit Watt-range step: top edge (targetPower===maxPower) - inc is %, dec is W',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:300 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-1W', dec5:'-5W' })
        })

        test('explicit Watt-range step: mid-range - all four buttons are W',()=>{
            s.currentLimits = { time:0, duration:0, remaining:0, minPower:100, maxPower:300, targetPower:200 }
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toEqual({ inc5:'+5W', inc1:'+1W', dec1:'-1W', dec5:'-5W' })
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

            test('bottom edge (targetPower===minPower=100W) - dec is %, inc is W',()=>{
                s.currentLimits.targetPower = 100
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+5W', inc1:'+1W', dec1:'-1%', dec5:'-5%' })
            })

            test('top edge (targetPower===maxPower=120W) - inc is %, dec is W',()=>{
                s.currentLimits.targetPower = 120
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+5%', inc1:'+1%', dec1:'-1W', dec5:'-5W' })
            })

            test('mid-zone (targetPower=110W) - all four buttons are W',()=>{
                s.currentLimits.targetPower = 110
                const dp = service.getDashboardDisplayProperties()

                expect(dp.loadButtons).toEqual({ inc5:'+5W', inc1:'+1W', dec1:'-1W', dec5:'-5W' })
            })
        })

        test('undefined when workout is not active (idle)',()=>{
            s.state = 'idle'
            const dp = service.getDashboardDisplayProperties()

            expect(dp.loadButtons).toBeUndefined()
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