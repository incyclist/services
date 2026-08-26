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
    let MockDevicePairing
    let MockBindings

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
        MockDevicePairing = {
            isReadyToStart: jest.fn().mockReturnValue(false)
        }
        MockBindings = {
            ui: { openPage: jest.fn() }
        }

        Inject('AppState', MockAppState)
        Inject('WorkoutList', MockWorkoutList)
        Inject('DevicePairing', MockDevicePairing)
        Inject('Bindings', MockBindings)
    }

    const resetMocks = ()=>{
        Inject('AppState', null)
        Inject('WorkoutList', null)
        Inject('DevicePairing', null)
        Inject('Bindings', null)
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
            expect(props).toEqual({ activityId:'activity-1', attachedWorkout:null })
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

        test('WorkoutListService.getSelected() throwing -> attachedWorkout null, no throw',()=>{
            MockWorkoutList.getSelected.mockImplementation( ()=>{ throw new Error('boom') })
            const props = service.getActivityDetailsProps('activity-1')
            expect(props).toEqual({ activityId:'activity-1', attachedWorkout:null })
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'getActivityDetailsProps')
        })
    })

    describe('onRideAgain',()=>{
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

        test('devices are ready to start -> navigates straight to the ride, skipping pairing',()=>{
            MockDevicePairing.isReadyToStart.mockReturnValue(true)

            service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/rideDeviceOK')
        })

        test('devices are not ready to start -> navigates to pairing',()=>{
            MockDevicePairing.isReadyToStart.mockReturnValue(false)

            service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/pairingStart')
        })

        test('no route passed -> still navigates based on device readiness, no throw',()=>{
            MockDevicePairing.isReadyToStart.mockReturnValue(true)

            expect( ()=>service.onRideAgain()).not.toThrow()
            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/rideDeviceOK')
        })

        test('error is logged, not thrown',()=>{
            MockDevicePairing.isReadyToStart.mockImplementation( ()=>{ throw new Error('boom') })

            expect( ()=>service.onRideAgain({ id:'route-1' })).not.toThrow()
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onRideAgain')
        })
    })

    describe('onDeleteActivity',()=>{
        let s,service
        let MockActivityList

        beforeEach( ()=>{
            setupMocks()
            MockActivityList = {
                delete: jest.fn().mockResolvedValue(true)
            }
            Inject('ActivityList', MockActivityList)

            s = service = new ActivitiesPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            Inject('ActivityList', null)
            resetMocks()
            s.reset()
        })

        test('deletes via ActivityListService.delete() and resolves true',async ()=>{
            const result = await service.onDeleteActivity('activity-1')

            expect(MockActivityList.delete).toHaveBeenCalledWith('activity-1')
            expect(result).toBe(true)
        })

        test('ActivityListService.delete() resolving false is passed through',async ()=>{
            MockActivityList.delete.mockResolvedValue(false)

            const result = await service.onDeleteActivity('activity-1')

            expect(result).toBe(false)
        })

        test('ActivityListService.delete() throwing -> error logged, resolves false',async ()=>{
            MockActivityList.delete.mockRejectedValue(new Error('boom'))

            const result = await service.onDeleteActivity('activity-1')

            expect(result).toBe(false)
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onDeleteActivity')
        })
    })

    // Regression test: the 'updated'/'loaded' handler used to discard the event payload and only
    // re-emit a page update, leaving `listState` permanently pinned to the snapshot taken in
    // openPage() - so a real deletion never reached the UI until the page was closed/reopened.
    describe('onStateUpdate',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new ActivitiesPageService()
            s.logError = jest.fn()
            ;(service as any).pageObserver = new Observer()
            ;(service as any).listState = { loading:false, activities:[{id:'activity-1'}] }
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('refreshes listState from the emitted display properties before emitting the page update',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')
            const newState = { loading:false, activities:[] }

            ;(service as any).onStateUpdate(newState)

            expect(service.getPageDisplayProps().activities).toEqual([])
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('no payload -> keeps the existing listState, still emits the page update',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')

            ;(service as any).onStateUpdate()

            expect(service.getPageDisplayProps().activities).toEqual([{id:'activity-1'}])
            expect(emitSpy).toHaveBeenCalledWith('page-update')
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
