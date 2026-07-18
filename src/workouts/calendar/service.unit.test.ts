import { Inject } from '../../base/decorators'
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
