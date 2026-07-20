import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types/observer'
import { Workout } from '../base/model/Workout'
import { WorkoutListPageService } from './service'

describe('WorkoutListPageService', ()=>{

    let MockAppState
    let MockUserSettings
    let MockWorkoutList
    let MockWorkoutCalendar

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

        Inject('WorkoutList', MockWorkoutList)
        Inject('WorkoutCalendar', MockWorkoutCalendar)
        Inject('UserSettings', MockUserSettings)
        Inject('AppState', MockAppState)
    }

    const resetMocks = ()=>{
        Inject('WorkoutList', null)
        Inject('WorkoutCalendar', null)
        Inject('UserSettings', null)
        Inject('AppState', null)
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

            const today = props.upcoming.items.find(i=>i.id==='source:1')
            const tomorrow = props.upcoming.items.find(i=>i.id==='source:2')

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

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListPageService()
            s.logError = jest.fn()
            service.openPage()

            card = makeCard({id:'1', title:'Alpha', workout:makeWorkout('1','Alpha')})
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts','My Workouts',[card])])
            MockWorkoutList.getStartSettings.mockReturnValue({ ftp:220, useErgMode:true })
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('onStart selects the workout with the effective settings and emits start-ride',()=>{
            const emitSpy = jest.spyOn(service.getPageObserver(),'emit')

            service.onStart('1', { noRoute:true })

            expect(card.select).toHaveBeenCalledWith({ ftp:220, useErgMode:true, noRoute:true })
            expect(emitSpy).toHaveBeenCalledWith('start-ride', { id:'1', noRoute:true })
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

        test('successful import lands on result phase with a suggested (not applied) group',async ()=>{
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

        test('import calls WorkoutListService.import with showImportCards:false (mobile owns progress via the dialog)',()=>{
            MockWorkoutList.import.mockResolvedValue([card])
            service.onImportOpen()
            const fileInfo = { type:'file', name:'test.zwo' } as any
            service.onImportFile(fileInfo)

            expect(MockWorkoutList.import).toHaveBeenCalledWith(fileInfo, { showImportCards:false })
        })
    })
})
