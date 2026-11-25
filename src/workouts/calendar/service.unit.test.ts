import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { Workout } from '../base/model/Workout'
import { WorkoutCalendarService } from './service'

describe('WorkoutCalendarService', ()=>{

    const MockAppsService = {
        on: jest.fn(),
        off: jest.fn(),
        getConnectedServices: jest.fn().mockReturnValue([]),
        isEnabled: jest.fn().mockReturnValue(false)
    }

    const MockOnlineStatusMonitoring = {
        reset: jest.fn(),
        onlineStatus: true
    }

    const setupMocks = ()=>{
        Inject('AppsService', MockAppsService)
        Inject('OnlineStatusMonitoring', MockOnlineStatusMonitoring)
    }

    const resetMocks = ()=>{
        Inject('AppsService', null)
        Inject('OnlineStatusMonitoring', null)
    }

    describe('performSync with several apps',()=>{
        let s

        const entry = (source:string, id:string, day:Date=new Date()) => ({
            day, updated:new Date(), workoutId:id, source,
            workout:new Workout({type:'workout',id,name:id})
        })

        const sync = async (loaded:Array<any>, services?:Array<string>)=> {
            const observer = new Observer()
            Inject('WorkoutSyncFactory', { sync: jest.fn().mockReturnValue(observer), get: jest.fn() })
            MockAppsService.getConnectedServices.mockReturnValue([{key:'trainingpeaks'}])
            MockAppsService.isEnabled.mockReturnValue(true)

            const p = s.performSync('trainingpeaks')
            await new Promise( r => setTimeout(r,0))
            observer.emit('loaded', loaded, services)
            await p
        }

        beforeEach( ()=>{
            setupMocks()
            s = new WorkoutCalendarService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            Inject('WorkoutSyncFactory', null)
            MockAppsService.getConnectedServices.mockReturnValue([])
            MockAppsService.isEnabled.mockReturnValue(false)
            s.reset()
        })

        test('loading one app does not remove the workouts of other apps',async ()=>{
            s.workouts = [ entry('trainerday','td1'), entry('trainingpeaks','old') ]

            await sync([ entry('trainingpeaks','tp1') ], ['trainingpeaks'])

            expect(s.workouts.map(w=>w.workoutId).sort()).toEqual(['td1','tp1'])
        })

        test('shows a workout that is delivered by two apps only once',async ()=>{
            await sync([ entry('trainingpeaks','tp1'), entry('intervals','iv1') ], ['trainingpeaks','intervals'])
            // entries need steps to be comparable
            s.workouts.forEach( w => { w.workout = new Workout({type:'workout',id:w.workoutId,name:w.workoutId,steps:[{type:'step',duration:600,power:{min:150,max:150,type:'watt'}}]}) })

            const res = s.getScheduledWorkouts()
            expect(s.workouts).toHaveLength(2)
            expect(res.map(w=>w.workoutId)).toEqual(['tp1'])
        })
    })

    describe('getScheduledToday (RC-6)',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutCalendarService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('returns undefined when nothing has been loaded yet',()=>{
            expect(service.getScheduledToday()).toBeUndefined()
        })

        test('returns undefined when no entry is scheduled for today',()=>{
            s.workouts = [
                { day:new Date('2020-01-01'), workoutId:'1', workout:new Workout({type:'workout',id:'1',name:'Old'}), updated:new Date(), source:'intervals' }
            ]
            expect(service.getScheduledToday()).toBeUndefined()
        })

        test('returns the composite-id wrapped entry scheduled for today (matches getScheduledWorkouts id scheme)',()=>{
            const today = new Date()
            s.workouts = [
                { day: today, workoutId:'1', workout:new Workout({type:'workout',id:'1',name:'Today'}), updated:new Date(), source:'intervals' }
            ]

            const result = service.getScheduledToday()
            expect(result).toMatchObject({ id:'intervals:1', name:'Today', workoutId:'1' })

            // sanity: same id scheme as getScheduledWorkouts(), so a page service can match todayId against items[].id
            const [scheduledToday] = service.getScheduledWorkouts()
            expect(result.id).toEqual(scheduledToday.id)
        })

        test('error',()=>{
            s.workouts = [{ day:{ toLocaleDateString: ()=>{ throw new Error('boom') } } }]
            const result = service.getScheduledToday()
            expect(result).toBeUndefined()
            expect(s.logError).toHaveBeenCalled()
        })
    })
})
