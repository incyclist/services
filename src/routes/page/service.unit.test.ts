import { Inject } from '../../base/decorators'
import { RoutesPageService } from './service'
import { RouteCard } from '../list/cards/RouteCard'
import { Route } from '../base/model/route'
import { WorkoutListPageService } from '../../workouts/page/service'

// Session 2.2 (workout-combo-service-design.md §3.5, §3.8) - RoutesPageService's cross-visibility
// side-channel. RouteCard.openSettings() is deliberately not touched - see the regression guard
// describe block at the bottom of this file.
describe('RoutesPageService',()=>{

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

    describe('getRouteDetailsProps',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new RoutesPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('no workout selected -> attachedWorkout is null',()=>{
            MockWorkoutList.getSelected.mockReturnValue(undefined)
            const props = service.getRouteDetailsProps('route-1')
            expect(props).toEqual({ routeId:'route-1', attachedWorkout:null, comboEnabled:true })
        })

        test('workout selected -> attachedWorkout carries {id,title} from WorkoutListService.getSelected()',()=>{
            MockWorkoutList.getSelected.mockReturnValue({ id:'w-1', name:'FTP Builder' })
            const props = service.getRouteDetailsProps('route-1')
            expect(props.attachedWorkout).toEqual({ id:'w-1', title:'FTP Builder' })
        })

        test('routeId is echoed back for the route the dialog is actually showing',()=>{
            const props = service.getRouteDetailsProps('route-42')
            expect(props.routeId).toBe('route-42')
        })

        test('WorkoutListService.getSelected() throwing -> attachedWorkout null, comboEnabled still returned, no throw',()=>{
            MockWorkoutList.getSelected.mockImplementation( ()=>{ throw new Error('boom') })
            const props = service.getRouteDetailsProps('route-1')
            expect(props).toEqual({ routeId:'route-1', attachedWorkout:null, comboEnabled:true })
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'getRouteDetailsProps')
        })

        test('attachedWorkout is populated regardless of comboEnabled (inert data, HLD §9.2)',()=>{
            MockAppState.hasFeature.mockReturnValue(false)   // both toggles off
            MockWorkoutList.getSelected.mockReturnValue({ id:'w-1', name:'FTP Builder' })

            const props = service.getRouteDetailsProps('route-1')
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

            const props = service.getRouteDetailsProps('route-1')
            expect(props.comboEnabled).toBe(expected)
        })
    })

    describe('onClearWorkoutSelection',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new RoutesPageService()
            s.logError = jest.fn()
            ;(service as any).pageObserver = new (require('../../base/types/observer').Observer)()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('clears the workout, does not touch the route selection, emits its page update',()=>{
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

    // Symmetry guard (workout-combo-service-design.md §6, session 2.2 test list): with a route AND
    // a workout attached, WorkoutDetailsProps.attachedRoute and RouteDetailsProps.attachedWorkout
    // must both be non-null and each carry the other side's {id,title} - the two directions are
    // mirror images (D4/§2 - a single route slot, a single workout slot) and must not drift apart.
    describe('symmetry with WorkoutListPageService.getWorkoutDetailsProps() (cross-visibility mirror)',()=>{
        let workoutPageService, routesPageService
        let MockWorkoutListShared, MockRouteListShared

        const makeWorkoutCard = (id:string, name:string) => ({
            getId: jest.fn().mockReturnValue(id),
            getTitle: jest.fn().mockReturnValue(name),
            getData: jest.fn().mockReturnValue({ id, name }),
            getCardType: jest.fn().mockReturnValue('Workout'),
            canDelete: jest.fn().mockReturnValue(true),
            openSettings: jest.fn().mockReturnValue({
                settings:{ ftp:220, useErgMode:true }, ftpRequired:true,
                canStart:true, canStartWorkoutOnly:false, duration:'30min',
                categories:['My Workouts'], category:'My Workouts'
            })
        })

        const makeWorkoutList = (id:string, title:string, cards:any[]) => ({
            getId: jest.fn().mockReturnValue(id),
            getTitle: jest.fn().mockReturnValue(title),
            getCards: jest.fn().mockReturnValue(cards)
        })

        beforeEach( ()=>{
            const selectedWorkout = { id:'w-1', name:'FTP Builder' }
            const selectedRoute = { description:{ id:'r-1' }, title:'Alpe du Zwift' }

            MockWorkoutListShared = {
                getSelected: jest.fn().mockReturnValue(selectedWorkout),
                getLists: jest.fn().mockReturnValue([ makeWorkoutList('myWorkouts','My Workouts',[makeWorkoutCard('w-1','FTP Builder')]) ])
            }
            MockRouteListShared = {
                getSelected: jest.fn().mockReturnValue(selectedRoute)
            }

            Inject('AppState', { hasFeature: jest.fn().mockReturnValue(true), getState: jest.fn(), setState: jest.fn(), setPersistedState: jest.fn() })
            Inject('WorkoutList', MockWorkoutListShared)
            Inject('RouteList', MockRouteListShared)

            workoutPageService = new WorkoutListPageService()
            workoutPageService.logError = jest.fn()
            routesPageService = new RoutesPageService()
            routesPageService.logError = jest.fn()
        })

        afterEach( ()=>{
            Inject('AppState', null)
            Inject('WorkoutList', null)
            Inject('RouteList', null)
            workoutPageService.reset()
            routesPageService.reset()
        })

        test('both directions are populated and mirror each other',()=>{
            const workoutDetails = workoutPageService.getWorkoutDetailsProps('w-1')
            const routeDetails = routesPageService.getRouteDetailsProps('r-1')

            expect(workoutDetails.attachedRoute).toEqual({ id:'r-1', title:'Alpe du Zwift' })
            expect(routeDetails.attachedWorkout).toEqual({ id:'w-1', title:'FTP Builder' })

            // mirror check: the route side's id/title is exactly what the workout dialog shows,
            // and vice versa
            expect(workoutDetails.attachedRoute.id).toBe(routeDetails.routeId)
            expect(routeDetails.attachedWorkout.id).toBe(workoutDetails.id)
        })
    })

    // Regression guard (§9.4 tripwire, workout-combo-service-design.md §5.1/§5.3): this design
    // touches NO shared/domain service. RouteCard.openSettings() is called directly by
    // web-ui/src/.../RouteDetails/wrapper.jsx - its shape must survive this session byte-identical.
    // Session 2.2 does not modify RouteCard at all; this test exists to keep it that way.
    describe('regression guard - RouteCard.openSettings() unchanged shape (design §5.3)',()=>{

        afterEach( ()=>{
            Inject('AppState', null)
            Inject('OnlineStatusMonitoring', null)
        })

        test('returns the same top-level shape, including hasWorkout/showWorkoutOption/canStart',()=>{
            Inject('AppState', { hasFeature: jest.fn().mockReturnValue(true), getState: jest.fn().mockReturnValue(false), setState: jest.fn() })
            Inject('OnlineStatusMonitoring', { onlineStatus: true })

            const route = new Route({ id:'r-1', title:'Alpe du Zwift', hasVideo:false, isLoop:false })
            const card = new RouteCard(route)

            const props = card.openSettings()

            expect(Object.keys(props).sort()).toEqual([
                'canStart', 'hasWorkout', 'settings', 'showLoopOverwrite', 'showNextOverwrite',
                'showWorkoutOption', 'totalDistance', 'totalElevation', 'updateMarkers', 'updateStartPos',
                'videoChecking', 'videoMissing', 'xScale', 'yScale'
            ].sort())

            expect(typeof props.hasWorkout).toBe('boolean')
            expect(typeof props.showWorkoutOption).toBe('boolean')
            expect(typeof props.canStart).toBe('boolean')

            // no workout selected (WorkoutListService singleton, untouched by this design) and
            // MOBILE_WORKOUTS on -> "Start with Workout" is offered, exactly as shipped today
            expect(props.hasWorkout).toBe(false)
            expect(props.showWorkoutOption).toBe(true)
        })
    })
})
