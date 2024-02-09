import { sleep } from 'incyclist-devices/lib/utils/utils'
import { Observer } from '../../base/types/observer'
import { waitNextTick } from '../../utils'
import { Workout } from '../base/model'
import  {useWorkoutList} from '../list'
import { WorkoutRide } from './service'
import { ActiveWorkoutLimit } from './types'
import { WorkoutSettings } from '../list/cards/types'

let workouts



const init = (workout?:Workout, settings?:WorkoutSettings) => {
    workouts = useWorkoutList()

    workouts.getSelected = jest.fn()
    workouts.getStartSettings = jest.fn().mockReturnValue(settings??{ftp:255,useErgMode:true})
    workouts.setStartSettings = jest.fn()

    if (workout) 
        workouts.getSelected= jest.fn().mockReturnValue(workout)

    return workouts
}

const cleanup = () => {
    const workouts = useWorkoutList()
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _wo = workouts as any

    _wo.reset()
}

describe('WorkoutRide',()=>{



    describe('constructor',()=>{

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

            cleanup()
            jest.resetAllMocks()
        })

        test('normal',async ()=>{
            init(workout)
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
            init()
            const service = new WorkoutRide()
            s = service
            emit = jest.spyOn(s,'emit')
            const observer = service.init()       

            expect(observer).toBeUndefined()
            expect(s.state).toBe('idle')

        })

        test('with FTP',()=>{
            init(workout,{ftp:300})

            const service = new WorkoutRide()
            s = service
            const observer = service.init()       

            expect(observer).toBeDefined()
            expect(s.state).toBe('initialized')
            expect(s.settings.ftp).toBe(300)
            
        })
        test('without FTP',()=>{
            init(workout,{})

            const service = new WorkoutRide()
            s = service
            const observer = service.init()       

            expect(observer).toBeDefined()
            expect(s.state).toBe('initialized')
            expect(s.settings.ftp).toBe(200)
            expect(workouts.setStartSettings).toHaveBeenCalledWith({ftp:200})
            
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
            init(workout)
            s = service = new WorkoutRide()
            s.init()       

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            cleanup()
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
            init(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    


            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            cleanup()
            jest.resetAllMocks()
        })

        test('active',async ()=>{
            service.stop()

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

            expect(emit).toHaveBeenCalledWith('completed')
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
            init(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    


            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            cleanup()
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
            init(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            cleanup()
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
            init(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            cleanup()
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
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({title:'Test Workout: Test Segment(1/10) - Test Relax',current:expect.objectContaining({duration:60,minPower:50,maxPower:50 })}))
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
            s.getTime = jest.fn( ()=>{ throw new Error()})
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
            init(workout)
            s = service = new WorkoutRide()
            s.init()       
            s.start()    

            emit = jest.spyOn(s,'emit')
        })
        afterEach( ()=>{
            s.stopWorker()
            s.reset()       

            cleanup()
            jest.resetAllMocks()
        })

        test('beginning of step, should move to previous step',()=>{
            const time = 181
            s.tsCurrent = Date.now()
            s.tsStart = Date.now()-time*1000
            s.trainingTime = time;
            s.settings.ftp = 100

            service.backward()

            expect(s.manualTimeOffset).toBe(-61)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:60,minPower:50,maxPower:50 }))
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({title:'Test Workout: Test Segment(1/10) - Test Relax',current:expect.objectContaining({duration:60,minPower:50,maxPower:50 })}))
        })

        test('after 15s of step, should move to current step',()=>{
            const time = 195
            s.tsCurrent = Date.now()
            s.tsStart = Date.now()-time*1000
            s.trainingTime = time;
            s.settings.ftp = 100

            service.backward()

            expect(s.manualTimeOffset).toBe(-15)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:120,minPower:100,maxPower:100 }))
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({title:'Test Workout: Test Segment(2/10) - Test Work',current:expect.objectContaining({duration:120,minPower:100,maxPower:100 })}))
        })

        test('at beginning of first step',()=>{
            const time = 5
            s.tsCurrent = Date.now()
            s.tsStart = Date.now()-time*1000
            s.trainingTime = time;
            s.settings.ftp = 100
            s.setCurrentLimits()

            service.backward()

            expect(s.manualTimeOffset).toBe(-5)
            expect( emit).toHaveBeenCalledWith('request-update',expect.objectContaining({duration:120,minPower:100,maxPower:100 }))
            expect( emit).toHaveBeenCalledWith('update', expect.objectContaining({title:'Test Workout: Test Segment(1/10) - Test Work',current:expect.objectContaining({duration:120,minPower:100,maxPower:100 })}))
            
        })

        test('error',()=>{ 
            s.getTime = jest.fn( ()=>{ throw new Error()})
            s.logError = jest.fn()

            service.backward()
            expect(s.logError).toHaveBeenCalled()
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
            init(workout)
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
            cleanup()
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
            service.powerUp(10)

            expect( setStartSettings).not.toHaveBeenCalled()
            expect( s.manualPowerOffset).toBe(10)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.not.objectContaining({ftp:expect.anything()}))

        })

        test('error thrown',()=>{
            s.setCurrentLimits = jest.fn( ()=>{throw new Error('Err')})
            s.logError = jest.fn()

            service.powerUp(10)
            expect(s.logError).toHaveBeenCalled()

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
            init()
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
            cleanup()
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
            service.powerDown(10)

            expect( setStartSettings).not.toHaveBeenCalled()
            expect( s.manualPowerOffset).toBe(-10)
            expect( emit).toHaveBeenCalledWith('request-update',expect.anything())
            expect( emit).toHaveBeenCalledWith('update', expect.not.objectContaining({ftp:expect.anything()}))

        })

        test('error thrown',()=>{
            s.setCurrentLimits = jest.fn( ()=>{throw new Error('Err')})
            s.logError = jest.fn()

            service.powerDown(10)
            expect(s.logError).toHaveBeenCalled()

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


        test('check title - segment with no segment text and no step text',()=>{
            s.trainingTime = 10

            const wo = new Workout({type:'workout',name:'Test Workout'})
            wo.addSegment( {type:'segment', repeat:10, steps: [ 
                {type:'step', steady:true, work:true, duration:120, power:{min:100,max:100,type:'pct of FTP'}},
                {type:'step', steady:true, work:false, duration:60, power:{min:50,max:50,type:'pct of FTP'}} 
            ] })
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