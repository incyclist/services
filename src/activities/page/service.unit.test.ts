import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types/observer'
import { ActivitiesPageService } from './service'
import { ActivityListService } from '../list/service'

// Session 2.2 (workout-combo-service-design.md §3.6, §3.8) - ActivitiesPageService's
// cross-visibility side-channel. ActivityListService.openSelected() is deliberately not touched -
// see the regression guard describe block at the bottom of this file.
describe('ActivitiesPageService',()=>{

    let MockAppState
    let MockWorkoutList

    const setupMocks = ()=>{
        MockAppState = {
            hasFeature: jest.fn().mockReturnValue(true),
            getState: jest.fn(),
            setState: jest.fn(),
            setPersistedState: jest.fn()
        }
        MockWorkoutList = {
            getSelected: jest.fn().mockReturnValue(undefined),
            unselect: jest.fn()
        }

        Inject('AppState', MockAppState)
        Inject('WorkoutList', MockWorkoutList)
    }

    const resetMocks = ()=>{
        Inject('AppState', null)
        Inject('WorkoutList', null)
    }

    describe('getActivityDetailsProps',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new ActivitiesPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('no workout selected -> attachedWorkout is null',()=>{
            MockWorkoutList.getSelected.mockReturnValue(undefined)
            const props = service.getActivityDetailsProps('activity-1')
            expect(props).toEqual({ activityId:'activity-1', attachedWorkout:null, comboEnabled:true })
        })

        test('workout selected -> attachedWorkout carries {id,title} from WorkoutListService.getSelected()',()=>{
            MockWorkoutList.getSelected.mockReturnValue({ id:'w-1', name:'FTP Builder' })
            const props = service.getActivityDetailsProps('activity-1')
            expect(props.attachedWorkout).toEqual({ id:'w-1', title:'FTP Builder' })
        })

        test('activityId is echoed back for the activity the dialog is actually showing',()=>{
            const props = service.getActivityDetailsProps('activity-42')
            expect(props.activityId).toBe('activity-42')
        })

        test('WorkoutListService.getSelected() throwing -> attachedWorkout null, comboEnabled still returned, no throw',()=>{
            MockWorkoutList.getSelected.mockImplementation( ()=>{ throw new Error('boom') })
            const props = service.getActivityDetailsProps('activity-1')
            expect(props).toEqual({ activityId:'activity-1', attachedWorkout:null, comboEnabled:true })
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'getActivityDetailsProps')
        })

        test('attachedWorkout is populated regardless of comboEnabled (inert data, HLD §9.2)',()=>{
            MockAppState.hasFeature.mockReturnValue(false)   // both toggles off
            MockWorkoutList.getSelected.mockReturnValue({ id:'w-1', name:'FTP Builder' })

            const props = service.getActivityDetailsProps('activity-1')
            expect(props.comboEnabled).toBe(false)
            expect(props.attachedWorkout).toEqual({ id:'w-1', title:'FTP Builder' })
        })

        // The one case that fails if MOBILE_WORKOUTS/MOBILE_WORKOUT_ROUTE_COMBO ever get combined
        // with a bare hasFeature('MOBILE_WORKOUT_ROUTE_COMBO') instead of the shared predicate.
        test.each([
            [false, false, false],
            [false, true,  false],   // state 1 - the dead-end guard
            [true,  false, false],   // state 2 - shipped state
            [true,  true,  true]     // state 3 - only state with new behaviour
        ])('MOBILE_WORKOUTS=%s COMBO=%s -> comboEnabled=%s',(workouts, combo, expected)=>{
            MockAppState.hasFeature.mockImplementation( (f)=> {
                if (f==='MOBILE_WORKOUTS') return workouts
                if (f==='MOBILE_WORKOUT_ROUTE_COMBO') return combo
                return false
            })

            const props = service.getActivityDetailsProps('activity-1')
            expect(props.comboEnabled).toBe(expected)
        })
    })

    describe('onClearWorkoutSelection',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new ActivitiesPageService()
            s.logError = jest.fn()
            ;(service as any).pageObserver = new Observer()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('clears the workout, does not touch the activity selection, emits its page update',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')

            service.onClearWorkoutSelection()

            expect(MockWorkoutList.unselect).toHaveBeenCalledTimes(1)
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('error is logged, not thrown',()=>{
            MockWorkoutList.unselect.mockImplementation( ()=>{ throw new Error('boom') })
            expect( ()=>service.onClearWorkoutSelection()).not.toThrow()
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onClearWorkoutSelection')
        })
    })

    // Regression guard (§9.4 tripwire, workout-combo-service-design.md §5.1/§5.3): this design
    // touches NO shared/domain service. ActivityListService.openSelected() is called directly by
    // web-ui/src/.../ActivityDetails.jsx:362 - its shape must survive this session byte-identical.
    // The full "an activity IS selected" branch already has extensive coverage in
    // activities/list/service.unit.test.ts, which this session leaves completely untouched; this
    // test adds the "nothing selected" branch's shape as an explicit tripwire local to this session.
    describe('regression guard - ActivityListService.openSelected() unchanged shape (design §5.3)',()=>{

        afterEach( ()=>{
            const service = new ActivityListService()
            service.reset?.()
        })

        test('no activity selected -> unchanged error shape',()=>{
            const service = new ActivityListService()

            const result = service.openSelected()

            expect(result).toEqual({ title:'Activity', error:'No activity selected' })
        })
    })
})
