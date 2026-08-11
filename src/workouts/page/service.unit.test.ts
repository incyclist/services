import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types/observer'
import { Workout } from '../base/model/Workout'
import { WorkoutListPageService } from './service'
import { WorkoutListService } from '../list/service'
import { getBindings } from '../../api'

describe('WorkoutListPageService', ()=>{

    let MockAppState
    let MockUserSettings
    let MockWorkoutList
    let MockWorkoutCalendar
    let MockRouteList

    // ---- test helpers -------------------------------------------------------

    const makeWorkout = (id:string, name:string, duration=1800) => new Workout({type:'workout', id, name, duration})

    const makeCard = (props:{
        id:string, title:string, workout:Workout, selected?:boolean, canDelete?:boolean,
        cardType?:string, duration?:string, category?:string, categories?:string[],
        isScheduled?:boolean, date?:Date
    }) => {
        const { id, title, workout, selected=false, canDelete=true, cardType='Workout',
                duration='30min', category='My Workouts', categories=['My Workouts'],
                isScheduled=false, date } = props

        const card:any = {
            getId: jest.fn().mockReturnValue(id),
            getTitle: jest.fn().mockReturnValue(title),
            getData: jest.fn().mockReturnValue(workout),
            getCardType: jest.fn().mockReturnValue(cardType),
            canDelete: jest.fn().mockReturnValue(canDelete),
            select: jest.fn(),
            unselect: jest.fn(),
            move: jest.fn(),
            delete: jest.fn(),
            getDisplayProperties: jest.fn().mockReturnValue({
                title, workout, duration, canDelete, selected, visible:true, observer:new Observer()
            }),
            openSettings: jest.fn().mockReturnValue({
                settings: { ftp:220, useErgMode:true },
                ftpRequired: true,
                canStart: false,
                canStartWorkoutOnly: true,
                duration,
                categories,
                category,
                ...(isScheduled ? { date } : {})
            })
        }
        return card
    }

    const makeList = (id:string, title:string, cards:any[]) => ({
        getId: jest.fn().mockReturnValue(id),
        getTitle: jest.fn().mockReturnValue(title),
        getCards: jest.fn().mockReturnValue(cards)
    })

    const setupMocks = ()=>{
        MockAppState = {
            hasFeature: jest.fn().mockReturnValue(true),
            getState: jest.fn(),
            setState: jest.fn(),
            setPersistedState: jest.fn()
        }
        MockUserSettings = {
            get: jest.fn( (key,def)=>def),
            set: jest.fn()
        }
        MockWorkoutList = {
            open: jest.fn().mockReturnValue({ observer: new Observer(), lists: [] }),
            close: jest.fn(),
            isStillLoading: jest.fn().mockReturnValue(false),
            getLists: jest.fn().mockReturnValue([]),
            getSelected: jest.fn().mockReturnValue(undefined),
            getStartSettings: jest.fn().mockReturnValue({ ftp:220, useErgMode:true }),
            setStartSettings: jest.fn(),
            unselect: jest.fn(),
            deleteWorkout: jest.fn(),
            import: jest.fn()
        }
        MockWorkoutCalendar = {
            on: jest.fn(),
            off: jest.fn(),
            getScheduledWorkouts: jest.fn().mockReturnValue([]),
            getScheduledToday: jest.fn().mockReturnValue(undefined)
        }
        MockRouteList = {
            getSelected: jest.fn().mockReturnValue(undefined),
            unselect: jest.fn()
        }

        Inject('WorkoutList', MockWorkoutList)
        Inject('WorkoutCalendar', MockWorkoutCalendar)
        Inject('UserSettings', MockUserSettings)
        Inject('AppState', MockAppState)
        Inject('RouteList', MockRouteList)
    }

    const resetMocks = ()=>{
        Inject('WorkoutList', null)
        Inject('WorkoutCalendar', null)
        Inject('UserSettings', null)
        Inject('AppState', null)
        Inject('RouteList', null)
    }

    describe('getPageDisplayProps',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('MOBILE_WORKOUTS off -> placeholder, nothing else computed',()=>{
            MockAppState.hasFeature.mockReturnValue(false)

            const props = service.getPageDisplayProps()
            expect(props).toEqual({ pageType:'placeholder' })
            expect(MockWorkoutList.getLists).not.toHaveBeenCalled()
        })

        test('empty list -> isEmpty true, upcoming null, groups from My Workouts',()=>{
            const list = makeList('myWorkouts','My Workouts',[])
            MockWorkoutList.getLists.mockReturnValue([list])

            const props = service.getPageDisplayProps()
            expect(props).toMatchObject({
                pageType:'list', loading:false, upcoming:null, isEmpty:true,
                groups:{ available:['My Workouts'], selected:null },
                workouts:[], selectedId:null
            })
        })

        test('flattens workout cards across lists, skips import/create/scheduled cards',()=>{
            const w1 = makeWorkout('1','Alpha')
            const w2 = makeWorkout('2','Beta')
            const importCard = { getCardType: jest.fn().mockReturnValue('WorkoutImport') }
            const myWorkouts = makeList('myWorkouts','My Workouts', [importCard, makeCard({id:'1', title:'Alpha', workout:w1})])
            const custom = makeList('1:Custom','Custom', [makeCard({id:'2', title:'Beta', workout:w2, category:'Custom'})])
            const scheduled = makeList('scheduled','Scheduled Workouts', [makeCard({id:'3', title:'Sched', workout:makeWorkout('3','Sched'), cardType:'ScheduledWorkout'})])

            MockWorkoutList.getLists.mockReturnValue([scheduled, myWorkouts, custom])

            const props:any = service.getPageDisplayProps()
            expect(props.workouts.map(w=>w.id)).toEqual(['1','2'])
            expect(props.groups.available).toEqual(['My Workouts','Custom'])
            expect(props.isEmpty).toBe(false)
        })

        test('workouts[] is filtered by the selected group, groups.available is not',()=>{
            const myWorkouts = makeList('myWorkouts','My Workouts', [makeCard({id:'1', title:'Alpha', workout:makeWorkout('1','Alpha')})])
            const custom = makeList('1:Custom','Custom', [makeCard({id:'2', title:'Beta', workout:makeWorkout('2','Beta'), category:'Custom'})])
            MockWorkoutList.getLists.mockReturnValue([myWorkouts, custom])

            service.onSelectGroup('Custom')
            const props:any = service.getPageDisplayProps()

            expect(props.groups).toEqual({ available:['My Workouts','Custom'], selected:'Custom' })
            expect(props.workouts.map(w=>w.id)).toEqual(['2'])
        })

        test('selectedId reflects WorkoutListService.getSelected()',()=>{
            MockWorkoutList.getSelected.mockReturnValue(makeWorkout('1','Alpha'))
            const props:any = service.getPageDisplayProps()
            expect(props.selectedId).toBe('1')
        })

        test('upcoming: maps scheduled workouts, isToday from getScheduledToday(), selected from getSelected()',()=>{
            const todayWorkout = makeWorkout('1','Today', 2700)
            const otherWorkout = makeWorkout('2','Tomorrow', 1800)

            MockWorkoutCalendar.getScheduledWorkouts.mockReturnValue([
                { id:'source:1', name:'Today', day:new Date('2026-01-01'), workoutId:'1', workout:todayWorkout, updated:new Date() },
                { id:'source:2', name:'Tomorrow', day:new Date('2026-01-02'), workoutId:'2', workout:otherWorkout, updated:new Date() }
            ])
            MockWorkoutCalendar.getScheduledToday.mockReturnValue({ id:'source:1', name:'Today', day:new Date(), workoutId:'1', workout:todayWorkout, updated:new Date() })
            MockWorkoutList.getSelected.mockReturnValue(otherWorkout)

            const props:any = service.getPageDisplayProps()

            expect(props.upcoming.todayId).toBe('source:1')
            expect(props.upcoming.items).toHaveLength(2)

            // row id is the workout content's id ('1'/'2'), not the calendar entry's own id
            // ('source:1'/'source:2') - see 5.16, findWorkoutCard()/ScheduledWorkoutCard.getId()
            // look up by the workout's id, not the calendar/sync entry's id
            const today = props.upcoming.items.find(i=>i.id==='1')
            const tomorrow = props.upcoming.items.find(i=>i.id==='2')

            // isToday (highlight) and selected (ride-selection) are independent (§3.1)
            expect(today.isToday).toBe(true)
            expect(today.selected).toBe(false)
            expect(tomorrow.isToday).toBe(false)
            expect(tomorrow.selected).toBe(true)
        })

        test('upcoming is null when nothing is scheduled',()=>{
            MockWorkoutCalendar.getScheduledWorkouts.mockReturnValue([])
            const props:any = service.getPageDisplayProps()
            expect(props.upcoming).toBeNull()
        })

        test('viewing the page never selects a workout (RC-5 highlight-only, opt-out demonstrated at page-service level)',()=>{
            const todayWorkout = makeWorkout('1','Today')
            const scheduledCard = makeCard({id:'1', title:'Today', workout:todayWorkout, cardType:'ScheduledWorkout'})
            const scheduledList = makeList('scheduled','Scheduled Workouts', [scheduledCard])
            const myWorkouts = makeList('myWorkouts','My Workouts', [])

            MockWorkoutList.getLists.mockReturnValue([scheduledList, myWorkouts])
            MockWorkoutCalendar.getScheduledWorkouts.mockReturnValue([
                { id:'source:1', name:'Today', day:new Date(), workoutId:'1', workout:todayWorkout, updated:new Date() }
            ])
            MockWorkoutCalendar.getScheduledToday.mockReturnValue({ id:'source:1', name:'Today', day:new Date(), workoutId:'1', workout:todayWorkout, updated:new Date() })

            // simulate the platform flag: desktop/web would still auto-select inside WorkoutListService itself (tested
            // separately in service.unit.test.ts) - here we confirm the page service's OWN read path never calls select()
            service.getPageDisplayProps()

            expect(scheduledCard.select).not.toHaveBeenCalled()
        })

        test('error -> logs and returns an empty object',()=>{
            MockAppState.hasFeature.mockImplementation( ()=>{ throw new Error('boom') })
            const props = service.getPageDisplayProps()
            expect(s.logError).toHaveBeenCalled()
            expect(props).toEqual({})
        })
    })

    describe('getWorkoutDetailsProps',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('unknown id -> null',()=>{
            MockWorkoutList.getLists.mockReturnValue([])
            expect(service.getWorkoutDetailsProps('unknown')).toBeNull()
        })

        test('regular workout card',()=>{
            const workout = makeWorkout('1','Alpha')
            const card = makeCard({id:'1', title:'Alpha', workout})
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[card])])

            const props = service.getWorkoutDetailsProps('1')
            expect(props).toMatchObject({
                id:'1', title:'Alpha', workout, ftp:220, useErgMode:true,
                ftpRequired:true, canStart:false, canStartWorkoutOnly:true,
                groups:['My Workouts'], group:'My Workouts', canDelete:true,
                isScheduled:false, date:undefined
            })
        })

        test('scheduled workout card exposes date and isScheduled',()=>{
            const workout = makeWorkout('1','Today')
            const date = new Date('2026-01-01')
            const card = makeCard({id:'1', title:'Today', workout, cardType:'ScheduledWorkout', isScheduled:true, date, category:'scheduled'})
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled','Scheduled Workouts',[card])])

            const props = service.getWorkoutDetailsProps('1')
            expect(props.isScheduled).toBe(true)
            expect(props.date).toBe(date)
            expect(props.group).toBe('scheduled')
        })

        test('error -> logs and returns null',()=>{
            MockWorkoutList.getLists.mockImplementation( ()=>{ throw new Error('boom') })
            expect(service.getWorkoutDetailsProps('1')).toBeNull()
            expect(s.logError).toHaveBeenCalled()
        })

        // Regression test for 5.16: getUpcomingTrainingProps() used to build each row's `id`
        // from the calendar/sync entry's own id (w.id, e.g. 'source:1') instead of the
        // workout content's id (w.workout.id, e.g. '1') - the latter being what
        // ScheduledWorkoutCard.getId() (inherited from WorkoutCard.getId()) actually returns,
        // and what findWorkoutCard()/getWorkoutDetailsProps() look up by. This mismatch meant
        // tapping a scheduled row's id (from getUpcomingTrainingProps output) never resolved
        // to a card, so the details dialog silently rendered nothing.
        test('scheduled row id (from getUpcomingTrainingProps) resolves via getWorkoutDetailsProps',()=>{
            const workout = makeWorkout('1','Today')
            const card = makeCard({id:'1', title:'Today', workout, cardType:'ScheduledWorkout', isScheduled:true, date:new Date('2026-01-01'), category:'scheduled'})
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled','Scheduled Workouts',[card])])
            // calendar/sync entry id ('source:1') deliberately differs from the workout content's id ('1')
            MockWorkoutCalendar.getScheduledWorkouts.mockReturnValue([
                { id:'source:1', name:'Today', day:new Date('2026-01-01'), workoutId:'1', workout, updated:new Date() }
            ])

            const pageProps:any = service.getPageDisplayProps()
            const rowId = pageProps.upcoming.items[0].id

            expect(service.getWorkoutDetailsProps(rowId)).not.toBeNull()
        })

        // Regression test for 5.19: Workout.id is a content hash, not scoped to a particular list -
        // a regular, user-imported card can share an id with a read-only, synced ScheduledWorkoutCard
        // when their content matches (e.g. a workout imported from the same source it's also
        // scheduled from). getWorkoutList().getLists(false) always returns the scheduled list first,
        // so a naive id lookup used to resolve such a collision to the scheduled card - even though
        // findWorkoutCard() falls back to the scheduled list here (this is the one caller that
        // legitimately needs to resolve a scheduled-only workout), the regular card must still win
        // whenever both exist.
        test('prefers the regular card over a same-id scheduled card when both share an id',()=>{
            const workout = makeWorkout('1','Sweet Spot')
            const scheduledCard = makeCard({id:'1', title:'Sweet Spot', workout, cardType:'ScheduledWorkout', isScheduled:true, date:new Date('2026-01-01'), category:'scheduled'})
            const regularCard = makeCard({id:'1', title:'Sweet Spot', workout, category:'My Workouts'})

            MockWorkoutList.getLists.mockReturnValue([
                makeList('scheduled','Scheduled Workouts',[scheduledCard]),
                makeList('myWorkouts','My Workouts',[regularCard])
            ])

            const props = service.getWorkoutDetailsProps('1')

            expect(props.isScheduled).toBe(false)
            expect(props.group).toBe('My Workouts')
        })
    })

    // Session 2.2 - cross-visibility (workout-combo-service-design.md §3.4, §3.8)
    describe('cross-visibility - attachedRoute / comboEnabled',()=>{
        let s,service
        let card

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()

            card = makeCard({id:'1', title:'Alpha', workout:makeWorkout('1','Alpha')})
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[card])])
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('no route selected -> attachedRoute is null',()=>{
            MockRouteList.getSelected.mockReturnValue(undefined)
            const props = service.getWorkoutDetailsProps('1')
            expect(props.attachedRoute).toBeNull()
        })

        test('route selected -> attachedRoute carries {id,title} from RouteListService.getSelected()',()=>{
            MockRouteList.getSelected.mockReturnValue({ description:{ id:'r-1' }, title:'Alpe du Zwift' })
            const props = service.getWorkoutDetailsProps('1')
            expect(props.attachedRoute).toEqual({ id:'r-1', title:'Alpe du Zwift' })
        })

        // design §2/§3.4.1 (D4): an activity is never a third attachment slot - whatever an
        // Activity's "ride again" selects is a route, so the result must be identical whether or
        // not an activity also happens to be selected somewhere. There is no activity read to stub.
        test('route selected while an activity also happens to be selected -> identical result (no activity read)',()=>{
            MockRouteList.getSelected.mockReturnValue({ description:{ id:'r-1' }, title:'Alpe du Zwift' })
            const withoutActivity = service.getWorkoutDetailsProps('1')

            // re-run - nothing about an activity selection could be represented here since
            // getAttachedRouteProps() never reads ActivityListService at all (§2)
            const withActivityContext = service.getWorkoutDetailsProps('1')
            expect(withActivityContext.attachedRoute).toEqual(withoutActivity.attachedRoute)
        })

        test('RouteListService.getSelected() throwing -> attachedRoute is null, no throw',()=>{
            MockRouteList.getSelected.mockImplementation( ()=>{ throw new Error('boom') })
            const props = service.getWorkoutDetailsProps('1')
            expect(props.attachedRoute).toBeNull()
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'getAttachedRouteProps')
        })

        test('attachedRoute is populated regardless of comboEnabled (inert data, HLD §9.2)',()=>{
            MockAppState.hasFeature.mockReturnValue(false)   // both toggles off
            MockRouteList.getSelected.mockReturnValue({ description:{ id:'r-1' }, title:'Alpe du Zwift' })

            const props = service.getWorkoutDetailsProps('1')
            expect(props.comboEnabled).toBe(false)
            expect(props.attachedRoute).toEqual({ id:'r-1', title:'Alpe du Zwift' })
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

            const props = service.getWorkoutDetailsProps('1')
            expect(props.comboEnabled).toBe(expected)
        })

        test('onClearRouteSelection unselects the route, leaves the workout selection intact, and emits page-update',()=>{
            service.openPage()
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')

            service.onClearRouteSelection()

            expect(MockRouteList.unselect).toHaveBeenCalledTimes(1)
            expect(MockWorkoutList.unselect).not.toHaveBeenCalled()
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('onClearRouteSelection error is logged, not thrown',()=>{
            MockRouteList.unselect.mockImplementation( ()=>{ throw new Error('boom') })
            expect( ()=>service.onClearRouteSelection()).not.toThrow()
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onClearRouteSelection')
        })
    })

    describe('getImportDisplayProps',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[])])
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('default (never opened) -> landing phase, no group field yet',()=>{
            const props = service.getImportDisplayProps()
            expect(props).toEqual({ phase:'landing', knownGroups:['My Workouts'] })
        })

        test('onImportOpen resets to landing phase, clearing any prior result/error',()=>{
            service.onImportOpen()
            expect(service.getImportDisplayProps()).toMatchObject({ phase:'landing' })
        })
    })

    describe('openPage / closePage',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('openPage opens the domain service and subscribes to list + calendar updates',()=>{
            const observer = service.openPage()
            const emitSpy = jest.spyOn(observer,'emit')

            expect(MockWorkoutList.open).toHaveBeenCalled()
            expect(MockWorkoutCalendar.on).toHaveBeenCalledWith('updated', expect.any(Function))

            // simulate a calendar update -> page-update should be emitted
            const [, calendarHandler] = MockWorkoutCalendar.on.mock.calls.find( c=>c[0]==='updated')
            calendarHandler()
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('closePage closes the domain service and unsubscribes',()=>{
            service.openPage()
            service.closePage()

            expect(MockWorkoutList.close).toHaveBeenCalled()
            expect(MockWorkoutCalendar.off).toHaveBeenCalledWith('updated', expect.any(Function))
        })

        test('openPage error is logged, not thrown',()=>{
            MockWorkoutList.open.mockImplementation( ()=>{ throw new Error('boom') })
            expect( ()=>service.openPage()).not.toThrow()
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('list-screen & details callbacks',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
            service.openPage()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('onSelectGroup updates the filter and emits page-update',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')
            service.onSelectGroup('Custom')
            expect(emitSpy).toHaveBeenCalledWith('page-update')
            expect(service.getPageDisplayProps().groups.selected).toBe('Custom')
        })

        test('onSetFtp merges with current settings (does not blow away useErgMode)',()=>{
            MockWorkoutList.getStartSettings.mockReturnValue({ ftp:200, useErgMode:false })
            service.onSetFtp(250)
            expect(MockWorkoutList.setStartSettings).toHaveBeenCalledWith({ ftp:250, useErgMode:false })
        })

        test('onSetErgMode merges with current settings (does not blow away ftp) - RC-3',()=>{
            MockWorkoutList.getStartSettings.mockReturnValue({ ftp:200, useErgMode:false })
            service.onSetErgMode(true)
            expect(MockWorkoutList.setStartSettings).toHaveBeenCalledWith({ ftp:200, useErgMode:true })
        })

        test('onChangeGroup moves the card into the target group',()=>{
            const card = makeCard({id:'1', title:'Alpha', workout:makeWorkout('1','Alpha')})
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[card])])

            service.onChangeGroup('1','Custom')
            expect(card.move).toHaveBeenCalledWith('Custom')
        })

        // Regression test for 5.19: onChangeGroup() is a management operation on the user's own
        // regular card - it must never resolve to (and therefore never call .move() on) a same-id
        // ScheduledWorkoutCard, which is a read-only, synced representation.
        test('onChangeGroup moves the regular card, never a same-id scheduled card (5.19)',()=>{
            const workout = makeWorkout('1','Sweet Spot')
            const scheduledCard = makeCard({id:'1', title:'Sweet Spot', workout, cardType:'ScheduledWorkout'})
            const regularCard = makeCard({id:'1', title:'Sweet Spot', workout})

            MockWorkoutList.getLists.mockReturnValue([
                makeList('scheduled','Scheduled Workouts',[scheduledCard]),
                makeList('myWorkouts','My Workouts',[regularCard])
            ])

            service.onChangeGroup('1','Custom')

            expect(regularCard.move).toHaveBeenCalledWith('Custom')
            expect(scheduledCard.move).not.toHaveBeenCalled()
        })

        test('onDelete resolves the delete observer result',async ()=>{
            MockWorkoutList.deleteWorkout.mockReturnValue({ wait: jest.fn().mockResolvedValue(true) })
            const result = await service.onDelete('1')
            expect(result).toBe(true)
        })

        test('onDelete resolves false on failure, does not throw',async ()=>{
            MockWorkoutList.deleteWorkout.mockReturnValue({ wait: jest.fn().mockResolvedValue(false) })
            const result = await service.onDelete('1')
            expect(result).toBe(false)
        })

        test('onClearSelection unselects and emits page-update',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')
            service.onClearSelection()
            expect(MockWorkoutList.unselect).toHaveBeenCalled()
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        // Mirrors RoutesPageService.onSelect/detailRouteId and ActivitiesPageService.onOpenActivity/
        // detailActivityId (session 5.1 correction, 2026-07-20) - the page must be able to react to
        // a row tap without a component-level callback contract.
        test('onOpenDetails sets detailWorkoutId and emits page-update',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')
            service.onOpenDetails('w-1')
            expect(service.getPageDisplayProps().detailWorkoutId).toBe('w-1')
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('onCloseDetails clears detailWorkoutId and emits page-update',()=>{
            service.onOpenDetails('w-1')
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')
            service.onCloseDetails()
            expect(service.getPageDisplayProps().detailWorkoutId).toBeNull()
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('detailWorkoutId defaults to null before any onOpenDetails call',()=>{
            expect(service.getPageDisplayProps().detailWorkoutId).toBeNull()
        })
    })

    describe('ride hand-off (§3) - onStart / onMarkForRoute',()=>{
        let s,service
        let card
        let MockDevicePairing
        let MockUIBinding

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
            service.openPage()

            card = makeCard({id:'1', title:'Alpha', workout:makeWorkout('1','Alpha')})
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[card])])
            MockWorkoutList.getStartSettings.mockReturnValue({ ftp:220, useErgMode:true })

            MockDevicePairing = { isReadyToStart: jest.fn().mockReturnValue(true) }
            Inject('DevicePairing', MockDevicePairing)

            MockUIBinding = { openPage: jest.fn() }
            getBindings().ui = MockUIBinding as any
        })

        afterEach( ()=>{
            resetMocks()
            Inject('DevicePairing', null)
            s.reset()
        })

        test('onStart selects the workout with the effective settings, closes the list, clears detailWorkoutId and moves to the ride-ready page when devices are paired',()=>{
            service.onOpenDetails('1')

            service.onStart('1', { noRoute:true })

            expect(card.select).toHaveBeenCalledWith({ ftp:220, useErgMode:true, noRoute:true })
            expect(MockWorkoutList.close).toHaveBeenCalled()
            expect(service.getPageDisplayProps().detailWorkoutId).toBeNull()
            expect(MockUIBinding.openPage).toHaveBeenCalledWith('/rideDeviceOK')
        })

        test('onStart moves to the pairing page when no device is ready',()=>{
            MockDevicePairing.isReadyToStart.mockReturnValue(false)

            service.onStart('1', { noRoute:true })

            expect(MockUIBinding.openPage).toHaveBeenCalledWith('/pairingStart')
        })

        test('onStart on an unknown id is a safe no-op',()=>{
            expect( ()=>service.onStart('unknown', { noRoute:true })).not.toThrow()
        })

        test('onMarkForRoute selects for later (noRoute:false), does not emit start-ride',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')
            emitSpy.mockClear()

            service.onMarkForRoute('1')

            expect(card.select).toHaveBeenCalledWith({ ftp:220, useErgMode:true, noRoute:false })
            expect(emitSpy).not.toHaveBeenCalledWith('start-ride', expect.anything())
        })
    })

    describe('import flow (§6)',()=>{
        let s,service
        let card

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
            service.openPage()

            card = { getId: jest.fn().mockReturnValue('imported-1'), getTitle: jest.fn().mockReturnValue('Imported Workout'), move: jest.fn() }
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('successful import lands on result phase with the suggested group (already the default, so no move needed)',async ()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            MockUserSettings.get.mockReturnValue('My Workouts')
            service.onImportOpen()

            const observer = service.onImportFile({ type:'file', name:'test.zwo' } as any)
            const successHandler = jest.fn()
            observer.on('success', successHandler)

            await new Promise(process.nextTick)

            expect(card.move).not.toHaveBeenCalled()
            expect(MockUserSettings.set).not.toHaveBeenCalled()
            expect(successHandler).toHaveBeenCalled()
            expect(service.getImportDisplayProps()).toMatchObject({
                phase:'result',
                result:{ id:'imported-1', workoutName:'Imported Workout', group:'My Workouts' }
            })
        })

        // Regression test for bug 5.18 (real-device testing of the import flow, 2026-07-21):
        // the suggested last-used group was only ever a display value in importResult.group -
        // it was never actually applied to the card unless the user touched the GroupPicker and
        // triggered onImportSetGroup. If the suggestion already showed the right value, the user
        // had no reason to touch it, so the card silently stayed in DEFAULT_IMPORT_GROUP. This
        // asserts the card ends up in the suggested (non-default) group from onImportFile() alone,
        // with onImportSetGroup never called.
        test('suggested last-used group is applied to the card at import time, without onImportSetGroup being called',async ()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            MockUserSettings.get.mockReturnValue('XYZ')
            service.onImportOpen()

            const observer = service.onImportFile({ type:'file', name:'test.zwo' } as any)
            const successHandler = jest.fn()
            observer.on('success', successHandler)

            await new Promise(process.nextTick)

            expect(card.move).toHaveBeenCalledWith('XYZ')
            expect(successHandler).toHaveBeenCalled()
            expect(service.getImportDisplayProps()).toMatchObject({
                phase:'result',
                result:{ id:'imported-1', workoutName:'Imported Workout', group:'XYZ' }
            })
        })

        test('onImportSetGroup relocates the card, persists as last-used, and updates the result group',async ()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            service.onImportOpen()

            service.onImportFile({ type:'file', name:'test.zwo' } as any)
            await new Promise(process.nextTick)

            // onImportSetGroup relocates via findWorkoutCard(id), which walks the current lists -
            // make the just-imported card discoverable there, same as it would be after import() lands it.
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[card])])

            service.onImportSetGroup('imported-1','Brand New Group')

            expect(card.move).toHaveBeenCalledWith('Brand New Group')
            expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.workouts.lastImportGroup','Brand New Group')
            expect(service.getImportDisplayProps().result).toMatchObject({ id:'imported-1', group:'Brand New Group' })
        })

        test('onImportSetGroup on an unknown id is a safe no-op',()=>{
            expect( ()=>service.onImportSetGroup('unknown','Custom')).not.toThrow()
        })

        // Regression test for 5.19: if the just-imported workout's content happens to match an
        // existing scheduled/synced workout (same content hash -> same id), onImportSetGroup() must
        // still relocate the user's own regular card, not the same-id read-only ScheduledWorkoutCard.
        test('onImportSetGroup relocates the regular card, never a same-id scheduled card (5.19)',async ()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            service.onImportOpen()

            service.onImportFile({ type:'file', name:'test.zwo' } as any)
            await new Promise(process.nextTick)

            const scheduledCard = { getId: jest.fn().mockReturnValue('imported-1'), getTitle: jest.fn().mockReturnValue('Imported Workout'), move: jest.fn() }
            MockWorkoutList.getLists.mockReturnValue([
                makeList('scheduled','Scheduled Workouts',[scheduledCard]),
                makeList('myWorkouts','My Workouts',[card])
            ])

            service.onImportSetGroup('imported-1','Brand New Group')

            expect(card.move).toHaveBeenCalledWith('Brand New Group')
            expect(scheduledCard.move).not.toHaveBeenCalled()
        })

        test('failed import sets the error phase and observer emits error',async ()=>{
            const error = new Error('parse failed')
            MockWorkoutList.import.mockRejectedValue(error)
            service.onImportOpen()

            const observer = service.onImportFile({ type:'file', name:'bad.zwo' } as any)
            const errorHandler = jest.fn()
            observer.on('error', errorHandler)

            await new Promise(process.nextTick)

            expect(errorHandler).toHaveBeenCalledWith(error)
            expect(service.getImportDisplayProps()).toMatchObject({ phase:'error', error:'parse failed' })
        })

        test('onImportClose resets the dialog state',async ()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            service.onImportOpen()
            service.onImportFile({ type:'file', name:'test.zwo' } as any)
            await new Promise(process.nextTick)

            service.onImportClose()
            expect(service.getImportDisplayProps().phase).toBe('landing')
        })

        // Cancel-button addition (5.12 follow-up): there's no real abort for the single-file
        // import chain (parse -> build -> save is one promise chain with no checkpoint to
        // interrupt), so "Cancel" means the dialog stops listening and closes while the promise
        // keeps running in the background. These tests guard against that background result
        // resurrecting stale dialog state once it finally settles.
        //
        // importGeneration is stamped from Date.now() (not a plain incrementing counter) at each
        // of its two call sites (onImportFile(), onImportClose()). Left to the real clock, two
        // of those call sites firing back-to-back within the same test (zero real time elapsed)
        // land on the same millisecond far more often than not - measured empirically at
        // ~99,995/100,000 collisions for consecutive synchronous Date.now() calls in Node - which
        // would silently defeat the `!==` staleness check these tests exist to prove. Stub
        // Date.now() with a strictly-incrementing sequence so every call site gets a distinct
        // value, deterministically.
        describe('cancel-safety: a background import settling after onImportClose', ()=>{
            let dateNowSpy: jest.SpyInstance
            let fakeNow: number

            beforeEach(()=>{
                fakeNow = 1_700_000_000_000
                dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow++)
            })

            afterEach(()=>{
                dateNowSpy.mockRestore()
            })

            test('a success that arrives after onImportClose does not resurrect the dialog',async ()=>{
                let resolveImport:(v:any)=>void
                MockWorkoutList.import.mockReturnValue(new Promise(resolve => { resolveImport = resolve }))
                service.onImportOpen()

                service.onImportFile({ type:'file', name:'test.zwo' } as any)
                expect(service.getImportDisplayProps().phase).toBe('importing')

                // user hits Cancel while the import is still in flight
                service.onImportClose()
                expect(service.getImportDisplayProps().phase).toBe('landing')

                resolveImport([card])
                await new Promise(process.nextTick)

                expect(service.getImportDisplayProps().phase).toBe('landing')
                expect(service.getImportDisplayProps().result).toBeUndefined()
            })

            test('an error that arrives after onImportClose does not resurrect the dialog',async ()=>{
                let rejectImport:(e:Error)=>void
                MockWorkoutList.import.mockReturnValue(new Promise((_resolve,reject) => { rejectImport = reject }))
                service.onImportOpen()

                const observer = service.onImportFile({ type:'file', name:'bad.zwo' } as any)
                const errorHandler = jest.fn()
                observer.on('error', errorHandler)

                service.onImportClose()

                rejectImport(new Error('parse failed'))
                await new Promise(process.nextTick)

                // the observer itself still fires - a caller holding its own reference still
                // learns the outcome - but the page-level dialog state must not flip to 'error'
                expect(errorHandler).toHaveBeenCalled()
                expect(service.getImportDisplayProps().phase).toBe('landing')
            })

            test('cancelling and starting a new import makes the older, still-pending result stale too',async ()=>{
                let resolveFirst:(v:any)=>void
                MockWorkoutList.import.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
                service.onImportOpen()
                service.onImportFile({ type:'file', name:'first.zwo' } as any)

                service.onImportClose()
                service.onImportOpen()

                const secondCard = { getId: jest.fn().mockReturnValue('imported-2'), getTitle: jest.fn().mockReturnValue('Second'), move: jest.fn() }
                MockWorkoutList.import.mockResolvedValueOnce([secondCard])
                service.onImportFile({ type:'file', name:'second.zwo' } as any)
                await new Promise(process.nextTick)

                expect(service.getImportDisplayProps()).toMatchObject({
                    phase:'result',
                    result:{ id:'imported-2' }
                })

                // the first import (still pending all along) now resolves too - must not
                // overwrite the second import's result
                resolveFirst([card])
                await new Promise(process.nextTick)

                expect(service.getImportDisplayProps()).toMatchObject({
                    phase:'result',
                    result:{ id:'imported-2' }
                })
            })

            // Review-flagged bug: card.move(group) used to run unconditionally, ahead of the
            // importGeneration staleness check that already guarded importPhase/importResult.
            // Only reachable now that Cancel lets a user escape 'importing' and start a second,
            // live import (e.g. re-importing the same file) while the first (cancelled) one is
            // still resolving in the background - completion order isn't guaranteed to match
            // start order, so the stale import can resolve *after* the live one and silently
            // re-move the card to its own (stale) suggested group, clobbering the live import's
            // choice with no error and no dialog update to reveal it.
            test('an older, cancelled import resolving after a newer live one does not overwrite the newer import\'s group',async ()=>{
                let resolveFirst:(v:any)=>void
                let resolveSecond:(v:any)=>void

                // same underlying card both times - mirrors WorkoutListService's own de-dup
                // (session 5.13): re-importing the same file resolves to the same card, not a
                // fresh one. Only the card.move() side effect here is under test.
                const sharedCard = { getId: jest.fn().mockReturnValue('same-1'), getTitle: jest.fn().mockReturnValue('Same File'), move: jest.fn() }

                MockWorkoutList.import.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
                service.onImportOpen()
                service.onImportFile({ type:'file', name:'same.zwo' } as any)   // import #1 - will be cancelled

                service.onImportClose()   // user cancels import #1 while it's still in flight
                service.onImportOpen()

                MockWorkoutList.import.mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve }))
                service.onImportFile({ type:'file', name:'same.zwo' } as any)   // import #2 - live

                // the suggested-group lookup is consumed in actual .then() execution order, not
                // start order: whichever settles first (import #2, below) consumes 'Group B';
                // the stale import #1 consumes 'Group A' second. 'Group A' is deliberately a
                // non-default group - if it equalled DEFAULT_IMPORT_GROUP, the existing
                // `group !== DEFAULT_IMPORT_GROUP` guard would suppress card.move() as a no-op
                // regardless of the ordering bug, making this test pass for the wrong reason.
                MockUserSettings.get.mockReturnValueOnce('Group B')
                MockUserSettings.get.mockReturnValueOnce('Group A')

                // import #2 (the newer, live one) resolves FIRST
                resolveSecond([sharedCard])
                await new Promise(process.nextTick)

                expect(sharedCard.move).toHaveBeenCalledWith('Group B')
                expect(service.getImportDisplayProps()).toMatchObject({ phase:'result', result:{ group:'Group B' } })
                sharedCard.move.mockClear()

                // import #1 (the older, cancelled one) resolves SECOND - inverted completion order
                resolveFirst([sharedCard])
                await new Promise(process.nextTick)

                // must not re-move the card to its own (stale, discarded) suggested group 'Group A'
                // - that would silently clobber the live import's 'Group B' - and the dialog must
                // still show import #2's result untouched (there was no onImportClose() after
                // import #2 started, so the dialog is legitimately still on 'result' / 'Group B',
                // not 'landing')
                expect(sharedCard.move).not.toHaveBeenCalled()
                expect(service.getImportDisplayProps()).toMatchObject({ phase:'result', result:{ group:'Group B' } })
            })
        })

        test('import calls WorkoutListService.import with showImportCards:false (mobile owns progress via the dialog)',()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            service.onImportOpen()
            const fileInfo = { type:'file', name:'test.zwo' } as any
            service.onImportFile(fileInfo)

            expect(MockWorkoutList.import).toHaveBeenCalledWith(fileInfo, { showImportCards:false })
        })

        // Regression test for bug 5.12 (dialog stuck on "Importing..." forever, real-device
        // 2026-07-21). Root cause: emitImportUpdate() called this.getPageObserver()?.emit(...)
        // with no try/catch. Observer.emit() wraps a plain node EventEmitter, whose emit()
        // invokes every registered listener SYNCHRONOUSLY, in the caller's own call stack - if
        // a listener throws, the exception propagates straight back through emit() to whoever
        // called it. onImportFile() calls emitImportUpdate() synchronously (phase='importing')
        // *before* the real getWorkoutList().import(...) call even runs, both inside the same
        // outer try/catch - so a throwing 'import-update' listener (e.g. a dialog re-render
        // failure) used to abort onImportFile() before the real import ever started, swallowed
        // via logError() only, leaving the phase stuck at 'importing' forever with no error
        // ever surfaced. The fix wraps emitImportUpdate()'s emit() call in its own try/catch,
        // so a throwing listener can no longer break the service's own control flow: the real
        // import still runs and can still complete normally.
        test('a throwing import-update listener no longer prevents the real import from running',async ()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            service.onImportOpen()
            const pageObserver = service.getPageObserver()

            const throwingListener = jest.fn(() => { throw new Error('listener boom (e.g. dialog re-render failure)') })
            pageObserver.on('import-update', throwingListener)

            const fileInfo = { type:'file', name:'test.zwo' } as any
            const observer = service.onImportFile(fileInfo)
            const successHandler = jest.fn()
            observer.on('success', successHandler)

            await new Promise(process.nextTick)

            // the throwing listener must not have prevented the real import call
            expect(MockWorkoutList.import).toHaveBeenCalledWith(fileInfo, { showImportCards:false })
            // ... and the import must still be able to complete normally afterwards
            expect(successHandler).toHaveBeenCalled()
            expect(service.getImportDisplayProps()).toMatchObject({ phase:'result' })
            // the listener's own exception is caught and logged, not left to bubble up
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'emitImportUpdate')
        })
    })

    describe('import flow (§6) - end-to-end with the real WorkoutListService and parser',()=>{
        // Everything above this block mocks WorkoutListService entirely, which can hide bugs
        // in the real import()->parser->error-propagation chain (5.12: a real device reported
        // WorkoutImportDialog getting stuck on 'importing' for a file that fails to parse).
        // This composes the real WorkoutListService + real WorkoutParser/IntervalsJsonParser,
        // exactly as mobile's onImportFile() does (showImportCards:false), so a genuine parse
        // failure has to propagate through both services, not just be asserted at a mock boundary.
        let s,service

        const malformedWorkoutJson = {
            // no top-level "type":"workout" - this makes Incyclist's own JsonParser reject it
            // (supportsContent requires that field), but IntervalsJsonParser's own content check
            // is much weaker (just `json.type !== 'workout'`) and wrongly claims it anyway.
            name: 'Malformed workout',
            steps: [
                // no "units" on power (IntervalsJsonParser expects {units,start,end}) - every
                // branch in convertPower() falls through, leaving power:{} with no min/max, which
                // Step's own validation rejects with "power: no values specified".
                { type:'step', duration:60, power:{} }
            ]
        }

        const fileInfo = { type:'file', name:'malformed.json', ext:'json', filename:'/tmp/malformed.json', delimiter:'/', dir:'/tmp', url:undefined } as any

        beforeEach( ()=>{
            Inject('WorkoutList', null)
            const workoutList = new WorkoutListService()
            ;(workoutList as any).initialized = true

            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
            ;(service as any).pageObserver = new Observer()

            getBindings().loader = { open: jest.fn().mockResolvedValue({ data: JSON.stringify(malformedWorkoutJson) }) } as any
        })

        afterEach( ()=>{
            Inject('WorkoutList', null)
        })

        test('a genuinely malformed file reaches the error phase, not stuck on importing',async ()=>{
            const observer = service.onImportFile(fileInfo)
            const errorHandler = jest.fn()
            observer.on('error', errorHandler)

            await new Promise<void>((resolve) => { observer.once('error', () => resolve()) })

            expect(errorHandler).toHaveBeenCalled()
            expect(service.getImportDisplayProps()).toMatchObject({
                phase:'error',
                error: expect.stringContaining('power: no values specified')
            })
        })
    })
})
