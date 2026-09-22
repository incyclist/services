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
            expect(props).toEqual({ routeId:'route-1', attachedWorkout:null })
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

        test('WorkoutListService.getSelected() throwing -> attachedWorkout null, no throw',()=>{
            MockWorkoutList.getSelected.mockImplementation( ()=>{ throw new Error('boom') })
            const props = service.getRouteDetailsProps('route-1')
            expect(props).toEqual({ routeId:'route-1', attachedWorkout:null })
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'getRouteDetailsProps')
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

    // Regression guard: RouteCard.openSettings() is called directly by
    // web-ui/src/.../RouteDetails/wrapper.jsx, so its shape is a published contract. Fields may
    // only ever be added here - removing or renaming one breaks that caller silently.
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
                'canStart', 'detailsAvailable', 'hasWorkout', 'settings', 'showLoopOverwrite',
                'showNextOverwrite', 'showWorkoutOption', 'smoothedElevation', 'smoothedGradient',
                'smoothedPoints', 'smoothingAvailable', 'smoothingMaxLevel', 'totalDistance', 'totalElevation',
                'updateMarkers', 'updateStartPos', 'videoChecking', 'videoMissing', 'xScale', 'yScale'
            ].sort())

            expect(typeof props.hasWorkout).toBe('boolean')
            expect(typeof props.showWorkoutOption).toBe('boolean')
            expect(typeof props.canStart).toBe('boolean')

            // no workout selected (WorkoutListService singleton, untouched by this design) ->
            // "Start with Workout" is offered, exactly as shipped today
            expect(props.hasWorkout).toBe(false)
            expect(props.showWorkoutOption).toBe(true)
        })
    })

    // RoutesPageService wiring of FolderAccessService, RouteVideoAvailabilityService,
    // RouteVideoPageActions and PreviewStore. `openPage()`/`closePage()` themselves call
    // `useRouteList()` directly (a pre-existing quirk, not something this work touches), so the
    // sequencing and subscription behavior they trigger is exercised through the extracted
    // protected methods instead of the full page lifecycle.
    describe('iCloud video integration', () => {

        const mockAppState = () => ({
            hasFeature: jest.fn().mockReturnValue(true), getState: jest.fn(), setState: jest.fn(), setPersistedState: jest.fn()
        })

        describe('openPage sequencing: activateAll -> adoptPending -> sweepOrphans', () => {
            let s, service, order: string[]
            let MockFolderAccess, MockPreviewStore

            beforeEach(() => {
                order = []
                MockFolderAccess = {
                    activateAll: jest.fn(() => { order.push('activateAll'); return Promise.resolve() })
                }
                MockPreviewStore = {
                    adoptPending: jest.fn(() => { order.push('adoptPending'); return Promise.resolve() }),
                    sweepOrphans: jest.fn(() => { order.push('sweepOrphans'); return Promise.resolve() })
                }

                Inject('AppState', mockAppState())
                Inject('FolderAccess', MockFolderAccess)
                Inject('PreviewStore', MockPreviewStore)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('FolderAccess', null)
                Inject('PreviewStore', null)
                s.reset()
            })

            test('runs grants, then legacy preview adoption, then the orphan sweep, in that order', async () => {
                ;(service as any).onRouteListLoaded()
                await new Promise(resolve => setTimeout(resolve, 0))

                expect(order).toEqual(['activateAll', 'adoptPending', 'sweepOrphans'])
            })

            test('a failure anywhere in the chain is logged, not thrown', async () => {
                MockFolderAccess.activateAll.mockRejectedValue(new Error('boom'))

                expect(() => (service as any).onRouteListLoaded()).not.toThrow()
                await new Promise(resolve => setTimeout(resolve, 0))

                expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onRouteListLoaded')
            })
        })

        describe('event subscriptions', () => {
            let s, service, MockVideoAvailability, MockFolderAccess

            beforeEach(() => {
                MockVideoAvailability = { on: jest.fn(), off: jest.fn() }
                MockFolderAccess = { on: jest.fn(), off: jest.fn() }

                Inject('AppState', mockAppState())
                Inject('VideoAvailability', MockVideoAvailability)
                Inject('FolderAccess', MockFolderAccess)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('VideoAvailability', null)
                Inject('FolderAccess', null)
                s.reset()
            })

            test('startEventListener subscribes to route-video-update, download-rows-update and access-changed', () => {
                ;(service as any).startEventListener()

                expect(MockVideoAvailability.on).toHaveBeenCalledWith('route-video-update', expect.any(Function))
                expect(MockVideoAvailability.on).toHaveBeenCalledWith('download-rows-update', expect.any(Function))
                expect(MockFolderAccess.on).toHaveBeenCalledWith('access-changed', expect.any(Function))
            })

            test('stopEventListener unsubscribes the same three, even with no active route-list observer', () => {
                ;(service as any).stopEventListener()

                expect(MockVideoAvailability.off).toHaveBeenCalledWith('route-video-update', expect.any(Function))
                expect(MockVideoAvailability.off).toHaveBeenCalledWith('download-rows-update', expect.any(Function))
                expect(MockFolderAccess.off).toHaveBeenCalledWith('access-changed', expect.any(Function))
            })
        })

        describe('resumePage -> onForeground', () => {
            let s, service, MockVideoAvailability

            beforeEach(() => {
                MockVideoAvailability = { on: jest.fn(), off: jest.fn(), onForeground: jest.fn().mockResolvedValue(undefined) }

                Inject('AppState', mockAppState())
                Inject('VideoAvailability', MockVideoAvailability)
                Inject('FolderAccess', { on: jest.fn(), off: jest.fn() })

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('VideoAvailability', null)
                Inject('FolderAccess', null)
                s.reset()
            })

            test('calls RouteVideoAvailabilityService.onForeground()', async () => {
                await service.resumePage()
                expect(MockVideoAvailability.onForeground).toHaveBeenCalledTimes(1)
            })

            test('a rejected onForeground() is logged, not thrown', async () => {
                MockVideoAvailability.onForeground.mockRejectedValue(new Error('boom'))
                await expect(service.resumePage()).resolves.toBeUndefined()
                await new Promise(resolve => setTimeout(resolve, 0))
                expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'resumePage')
            })
        })

        describe('videoPill on route list items', () => {
            let s, service, MockVideoAvailability, MockRouteList, pageObserver

            const mockCard = (setVideoPillReturns = true) => ({
                setVideoPill: jest.fn().mockReturnValue(setVideoPillReturns),
                emitUpdate: jest.fn()
            })

            beforeEach(() => {
                MockVideoAvailability = { getListPill: jest.fn() }
                MockRouteList = {
                    getCard: jest.fn(), getAllRoutes: jest.fn().mockReturnValue([]),
                    search: jest.fn().mockReturnValue({ routes: [] })
                }

                Inject('AppState', mockAppState())
                Inject('VideoAvailability', MockVideoAvailability)
                Inject('RouteList', MockRouteList)
                Inject('RouteLibraryScanner', { done: jest.fn() })

                s = service = new RoutesPageService()
                s.logError = jest.fn()
                s.logEvent = jest.fn()
                pageObserver = new (require('../../base/types/observer').Observer)()
                ;(service as any).pageObserver = pageObserver
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('VideoAvailability', null)
                Inject('RouteList', null)
                Inject('RouteLibraryScanner', null)
                s.reset()
            })

            // videoPill now lives on the card itself (RouteCard.setVideoPill/getDisplayProperties,
            // architecture.md §3.7.1), so getRoutesDisplayProps() is a plain pass-through of
            // whatever the cards already computed - it must not ask the availability service again.
            test('passes each card\'s already-computed videoPill straight through', () => {
                ;(service as any).serviceState = { routes: [{ id: 'r1', videoPill: 'in-icloud' }, { id: 'r2' }] }

                const props = (service as any).getRoutesDisplayProps()

                expect(props[0].videoPill).toBe('in-icloud')
                expect(props[1].videoPill).toBeUndefined()
                expect(MockVideoAvailability.getListPill).not.toHaveBeenCalled()
            })

            test('a route-video-update for a specific route sets the pill on that route\'s own card, not a page-wide render', () => {
                MockVideoAvailability.getListPill.mockReturnValue('in-icloud')
                const card = mockCard()
                MockRouteList.getCard.mockImplementation((id: string) => (id === 'r1' ? card : undefined))
                const emitSpy = jest.spyOn(pageObserver, 'emit')

                ;(service as any).onRouteVideoUpdate('r1')

                expect(MockVideoAvailability.getListPill).toHaveBeenCalledWith('r1')
                expect(card.setVideoPill).toHaveBeenCalledWith('in-icloud')
                expect(card.emitUpdate).toHaveBeenCalledWith()
                expect(emitSpy).not.toHaveBeenCalledWith('page-update')
            })

            test('does not emitUpdate() when the pill did not actually change', () => {
                MockVideoAvailability.getListPill.mockReturnValue('in-icloud')
                const card = mockCard(false)
                MockRouteList.getCard.mockReturnValue(card)

                ;(service as any).onRouteVideoUpdate('r1')

                expect(card.setVideoPill).toHaveBeenCalledWith('in-icloud')
                expect(card.emitUpdate).not.toHaveBeenCalled()
            })

            test('a route-video-update naming a route with no card logs it instead of throwing', () => {
                MockVideoAvailability.getListPill.mockReturnValue('in-icloud')
                MockRouteList.getCard.mockReturnValue(undefined)

                expect(() => (service as any).onRouteVideoUpdate('r1')).not.toThrow()

                expect(s.logEvent).toHaveBeenCalledWith({ message: 'video pill card missing', routeId: 'r1' })
            })

            test('an update with no routeId (a multi-route reconcile) recomputes every route\'s pill', () => {
                MockRouteList.getAllRoutes.mockReturnValue([
                    { description: { id: 'r1' } }, { description: { id: 'r2' } }
                ])
                MockVideoAvailability.getListPill.mockImplementation((id: string) => (id === 'r1' ? 'in-icloud' : undefined))
                const cardR1 = mockCard()
                const cardR2 = mockCard(false)
                MockRouteList.getCard.mockImplementation((id: string) => (id === 'r1' ? cardR1 : cardR2))
                const emitSpy = jest.spyOn(pageObserver, 'emit')

                ;(service as any).onRouteVideoUpdate()

                expect(cardR1.setVideoPill).toHaveBeenCalledWith('in-icloud')
                expect(cardR1.emitUpdate).toHaveBeenCalledWith()
                expect(cardR2.setVideoPill).toHaveBeenCalledWith(undefined)
                expect(cardR2.emitUpdate).not.toHaveBeenCalled()
                expect(emitSpy).not.toHaveBeenCalledWith('page-update')
            })

            test('a route-video-update for the open details dialog also emits route-details-update', () => {
                MockRouteList.getCard.mockReturnValue(mockCard())
                const emitSpy = jest.spyOn(pageObserver, 'emit')
                ;(service as any).detailRouteId = 'r1'

                ;(service as any).onRouteVideoUpdate('r1')

                expect(emitSpy).toHaveBeenCalledWith('route-details-update', 'r1')
            })

            // Regression: a route imported this session gets a brand new card whose videoPill has
            // never been set. Before this, nothing computed it until some unrelated
            // video-availability event happened to reconcile the whole list - so the pill for a
            // route imported (or re-imported) in the current session could stay permanently
            // missing, even though the exact same route showed it correctly after a restart (which
            // does seed every card via openPage()).
            test('onImportClosed() re-seeds every route\'s pill, including one from a card added this session', () => {
                MockRouteList.search.mockReturnValue({ routes: [{ id: 'new-route' }] })
                MockVideoAvailability.getListPill.mockReturnValue('in-icloud')
                const card = mockCard()
                MockRouteList.getCard.mockReturnValue(card)
                MockRouteList.getAllRoutes.mockReturnValue([{ description: { id: 'new-route' } }])

                service.onImportClosed()

                expect(MockVideoAvailability.getListPill).toHaveBeenCalledWith('new-route')
                expect(card.setVideoPill).toHaveBeenCalledWith('in-icloud')
                expect(card.emitUpdate).toHaveBeenCalledWith()
            })
        })

        describe('getRouteDetailsProps - video', () => {
            let s, service, MockVideoPageActions, MockVideoAvailability

            beforeEach(() => {
                MockVideoPageActions = {
                    isSupported: jest.fn().mockReturnValue(true),
                    getDisplayProps: jest.fn().mockReturnValue({ status: { state: 'ready' }, canStart: true, actions: {} })
                }
                MockVideoAvailability = { refresh: jest.fn().mockResolvedValue({}) }

                Inject('AppState', mockAppState())
                Inject('WorkoutList', { getSelected: jest.fn().mockReturnValue(undefined) })
                Inject('VideoPageActions', MockVideoPageActions)
                Inject('VideoAvailability', MockVideoAvailability)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('WorkoutList', null)
                Inject('VideoPageActions', null)
                Inject('VideoAvailability', null)
                s.reset()
            })

            test('refreshes once per newly opened dialog', () => {
                service.getRouteDetailsProps('r1')
                service.getRouteDetailsProps('r1')
                service.getRouteDetailsProps('r1')

                expect(MockVideoAvailability.refresh).toHaveBeenCalledTimes(1)
                expect(MockVideoAvailability.refresh).toHaveBeenCalledWith('r1')
            })

            test('reopening the dialog (onDialogClosed in between) pays for a fresh refresh', () => {
                service.getRouteDetailsProps('r1')
                service.onDialogClosed()
                service.getRouteDetailsProps('r1')

                expect(MockVideoAvailability.refresh).toHaveBeenCalledTimes(2)
            })

            test('a different route triggers its own refresh', () => {
                service.getRouteDetailsProps('r1')
                service.getRouteDetailsProps('r2')

                expect(MockVideoAvailability.refresh).toHaveBeenNthCalledWith(1, 'r1')
                expect(MockVideoAvailability.refresh).toHaveBeenNthCalledWith(2, 'r2')
            })

            test('video props come from RouteVideoPageActions.getDisplayProps', () => {
                const props = service.getRouteDetailsProps('r1')
                expect(props.video).toEqual({ status: { state: 'ready' }, canStart: true, actions: {} })
            })

            test('video is absent, and no refresh happens, when unsupported (inert without the binding)', () => {
                MockVideoPageActions.isSupported.mockReturnValue(false)
                const props = service.getRouteDetailsProps('r1')

                expect(props.video).toBeUndefined()
                expect(MockVideoAvailability.refresh).not.toHaveBeenCalled()
            })
        })

        describe('route video actions -> route-details-update', () => {
            let s, service, MockVideoPageActions, pageObserver

            beforeEach(() => {
                MockVideoPageActions = {
                    onVideoDownloadPressed: jest.fn(),
                    onVideoDownloadConfirmed: jest.fn(),
                    onVideoDownloadDismissed: jest.fn(),
                    onVideoStop: jest.fn(),
                    onVideoRetry: jest.fn(),
                    onVideoKeepInstead: jest.fn(),
                    onVideoRemovePressed: jest.fn(),
                    onVideoRemoveConfirmed: jest.fn().mockResolvedValue(undefined),
                    onVideoRemoveDismissed: jest.fn(),
                    onConfirmAccess: jest.fn().mockResolvedValue(undefined)
                }

                Inject('AppState', mockAppState())
                Inject('VideoPageActions', MockVideoPageActions)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
                pageObserver = new (require('../../base/types/observer').Observer)()
                ;(service as any).pageObserver = pageObserver
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('VideoPageActions', null)
                s.reset()
            })

            test('each action forwards to RouteVideoPageActions and emits route-details-update for that route', () => {
                const emitSpy = jest.spyOn(pageObserver, 'emit')

                service.onVideoDownloadPressed('r1')
                service.onVideoDownloadConfirmed('r1', 'this-ride')
                service.onVideoDownloadDismissed('r1')
                service.onVideoStop('r1')
                service.onVideoRetry('r1')
                service.onVideoKeepInstead('r1')
                service.onVideoRemovePressed('r1')
                service.onVideoRemoveConfirmed('r1')
                service.onVideoRemoveDismissed('r1')

                expect(MockVideoPageActions.onVideoDownloadPressed).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoDownloadConfirmed).toHaveBeenCalledWith('r1', 'this-ride')
                expect(MockVideoPageActions.onVideoDownloadDismissed).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoStop).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoRetry).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoKeepInstead).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoRemovePressed).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoRemoveConfirmed).toHaveBeenCalledWith('r1')
                expect(MockVideoPageActions.onVideoRemoveDismissed).toHaveBeenCalledWith('r1')

                expect(emitSpy.mock.calls.filter(c => c[0] === 'route-details-update' && c[1] === 'r1')).toHaveLength(9)
            })

            test('onConfirmAccess awaits the outcome, then relays route-details-update and page-update', async () => {
                const emitSpy = jest.spyOn(pageObserver, 'emit')

                await service.onConfirmAccess('r1')

                expect(MockVideoPageActions.onConfirmAccess).toHaveBeenCalledWith('r1')
                expect(emitSpy).toHaveBeenCalledWith('route-details-update', 'r1')
                expect(emitSpy).toHaveBeenCalledWith('page-update')
            })

            test('onVideoRemoveConfirmed emits once immediately and again once the outcome settles', async () => {
                const emitSpy = jest.spyOn(pageObserver, 'emit')

                await service.onVideoRemoveConfirmed('r1')

                expect(MockVideoPageActions.onVideoRemoveConfirmed).toHaveBeenCalledWith('r1')
                expect(emitSpy.mock.calls.filter(c => c[0] === 'route-details-update' && c[1] === 'r1')).toHaveLength(2)
            })

            test('a rejected onVideoRemoveConfirmed is logged, not thrown', async () => {
                MockVideoPageActions.onVideoRemoveConfirmed.mockRejectedValue(new Error('remove failed'))
                await expect(service.onVideoRemoveConfirmed('r1')).resolves.toBeUndefined()
                expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onVideoRemoveConfirmed')
            })

            test('a rejected onConfirmAccess is logged, not thrown', async () => {
                MockVideoPageActions.onConfirmAccess.mockRejectedValue(new Error('picker failed'))
                await expect(service.onConfirmAccess('r1')).resolves.toBeUndefined()
                expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onConfirmAccess')
            })
        })

        describe('emitDownloadUpdate - Downloads list merge (golden test)', () => {
            let s, service, MockVideoAvailability, downloadObserver

            const setup = () => {
                MockVideoAvailability = {
                    isSupported: jest.fn().mockReturnValue(false),
                    getDownloadRows: jest.fn().mockReturnValue([])
                }

                Inject('AppState', mockAppState())
                Inject('VideoAvailability', MockVideoAvailability)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
                downloadObserver = (service as any).downloadObserver
            }

            afterEach(() => {
                Inject('AppState', null)
                Inject('VideoAvailability', null)
                s?.reset()
            })

            test('golden: server rows keep exactly their current shape, plus additive source/actions; count unchanged', () => {
                setup()

                ;(service as any).downloadCache.set('r1', { routeId: 'r1', title: 'Alpe du Zwift', status: 'downloading', pct: 42 })
                ;(service as any).downloadCache.set('r2', { routeId: 'r2', title: 'Stelvio', status: 'done' })
                ;(service as any).downloadCache.set('r3', { routeId: 'r3', title: 'Ventoux', status: 'failed' })
                ;(service as any).downloadCache.set('r4', { routeId: 'r4', title: 'Zwift Mountain', status: 'required' })

                let payload: any
                downloadObserver.on('download-update', (p: any) => { payload = p })

                ;(service as any).emitDownloadUpdate()

                const byId = (id: string) => payload.rows.find((r: any) => r.routeId === id)

                expect(byId('r1')).toEqual({
                    routeId: 'r1', title: 'Alpe du Zwift', status: 'downloading', pct: 42,
                    source: 'server', actions: { stop: true, retry: false, delete: false, download: false, keepInstead: false }
                })
                expect(byId('r2')).toEqual({
                    routeId: 'r2', title: 'Stelvio', status: 'done',
                    source: 'server', actions: { stop: false, retry: false, delete: true, download: false, keepInstead: false }
                })
                expect(byId('r3')).toEqual({
                    routeId: 'r3', title: 'Ventoux', status: 'failed',
                    source: 'server', actions: { stop: false, retry: true, delete: false, download: false, keepInstead: false }
                })
                expect(byId('r4')).toEqual({
                    routeId: 'r4', title: 'Zwift Mountain', status: 'required',
                    source: 'server', actions: { stop: false, retry: false, delete: false, download: true, keepInstead: false }
                })

                // count: unchanged from today - only the 'downloading' server row counts (no iCloud activity)
                expect(payload.count).toBe(1)
            })

            test('merges iCloud rows: order by startedAt, count adds downloading+waiting, downloading-external is never listed', () => {
                setup()
                MockVideoAvailability.isSupported.mockReturnValue(true)
                MockVideoAvailability.getDownloadRows.mockReturnValue([
                    { routeId: 'ic1', title: 'iCloud Downloading', state: 'downloading', startedAt: 300, sizeBytes: 100 },
                    { routeId: 'ic2', title: 'iCloud Waiting', state: 'waiting-for-network', startedAt: 100 },
                    { routeId: 'ic3', title: 'iCloud Done Kept', state: 'ready', startedAt: 200, choice: 'keep' },
                    { routeId: 'ic4', title: 'iCloud Done ThisRide', state: 'ready', startedAt: 250, choice: 'this-ride' },
                    { routeId: 'ic5', title: 'iCloud Failed', state: 'download-failed', startedAt: 50 },
                    { routeId: 'ic6', title: 'iCloud Cancelled', state: 'cancelled', startedAt: 60 },
                    { routeId: 'ic7', title: 'iCloud NotEnoughStorage', state: 'not-enough-storage', startedAt: 70 },
                    { routeId: 'ic8', title: 'iCloud External', state: 'downloading-external', startedAt: 10 }
                ])

                ;(service as any).downloadFirstSeen.set('sX', 150)
                ;(service as any).downloadCache.set('sX', { routeId: 'sX', title: 'Server Route', status: 'downloading', pct: 10 })

                let payload: any
                downloadObserver.on('download-update', (p: any) => { payload = p })
                ;(service as any).emitDownloadUpdate()

                expect(payload.rows.find((r: any) => r.routeId === 'ic8')).toBeUndefined()

                const byId = (id: string) => payload.rows.find((r: any) => r.routeId === id)
                expect(byId('ic1')).toMatchObject({ status: 'downloading', source: 'icloud' })
                expect(byId('ic2')).toMatchObject({ status: 'waiting', source: 'icloud' })
                expect(byId('ic3')).toMatchObject({ status: 'done', actions: expect.objectContaining({ keepInstead: false, delete: false }) })
                expect(byId('ic4')).toMatchObject({ status: 'done', actions: expect.objectContaining({ keepInstead: true, delete: false }) })
                expect(byId('ic5')).toMatchObject({ status: 'failed', actions: expect.objectContaining({ retry: true }) })
                expect(byId('ic6')).toMatchObject({ status: 'required', actions: expect.objectContaining({ download: true }) })
                expect(byId('ic7')).toMatchObject({ status: 'not-enough-storage' })

                expect(payload.rows.map((r: any) => r.routeId))
                    .toEqual(['ic5', 'ic6', 'ic7', 'ic2', 'sX', 'ic3', 'ic4', 'ic1'])

                // count: server downloading (sX) + icloud downloading (ic1) + waiting (ic2)
                expect(payload.count).toBe(3)
            })
        })

        describe('onDownloadStop/Retry/Delete/KeepInstead delegation', () => {
            let s, service, MockRouteListSvc, MockCard, MockVideoAvailability

            beforeEach(() => {
                MockCard = { stopDownload: jest.fn(), download: jest.fn(), deleteDownload: jest.fn() }
                MockRouteListSvc = { getCard: jest.fn().mockReturnValue(MockCard) }
                MockVideoAvailability = {
                    stop: jest.fn().mockResolvedValue(undefined),
                    retry: jest.fn().mockResolvedValue(undefined),
                    setChoice: jest.fn().mockResolvedValue(undefined)
                }

                Inject('AppState', mockAppState())
                Inject('RouteList', MockRouteListSvc)
                Inject('VideoAvailability', MockVideoAvailability)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('RouteList', null)
                Inject('VideoAvailability', null)
                s.reset()
            })

            test('a server row calls exactly the RouteCard methods mobile calls today', () => {
                ;(service as any).downloadCache.set('r1', { routeId: 'r1', title: 'x', status: 'downloading' })

                service.onDownloadStop('r1')
                service.onDownloadRetry('r1')
                service.onDownloadDelete('r1')

                expect(MockCard.stopDownload).toHaveBeenCalledTimes(1)
                expect(MockCard.download).toHaveBeenCalledTimes(1)
                expect(MockCard.deleteDownload).toHaveBeenCalledTimes(1)
                expect(MockVideoAvailability.stop).not.toHaveBeenCalled()
                expect(MockVideoAvailability.retry).not.toHaveBeenCalled()
            })

            test('a server row never gets keepInstead', () => {
                ;(service as any).downloadCache.set('r1', { routeId: 'r1', title: 'x', status: 'done' })
                service.onDownloadKeepInstead('r1')
                expect(MockVideoAvailability.setChoice).not.toHaveBeenCalled()
            })

            test('an iCloud row (no matching server entry) delegates to RouteVideoAvailabilityService', () => {
                service.onDownloadStop('ic1')
                service.onDownloadRetry('ic1')
                service.onDownloadKeepInstead('ic1')

                expect(MockVideoAvailability.stop).toHaveBeenCalledWith('ic1')
                expect(MockVideoAvailability.retry).toHaveBeenCalledWith('ic1')
                expect(MockVideoAvailability.setChoice).toHaveBeenCalledWith('ic1', 'keep')
                expect(MockCard.stopDownload).not.toHaveBeenCalled()
            })

            test('an iCloud row has no delete action', () => {
                service.onDownloadDelete('ic1')
                expect(MockCard.deleteDownload).not.toHaveBeenCalled()
            })
        })

        describe('startLibraryScan -> registerGrant', () => {
            let s, service, MockFolderAccess, MockScanner

            beforeEach(() => {
                MockFolderAccess = { registerGrant: jest.fn().mockResolvedValue(undefined) }
                MockScanner = { scan: jest.fn().mockReturnValue({ id: 'observer' }) }

                Inject('AppState', mockAppState())
                Inject('FolderAccess', MockFolderAccess)
                Inject('RouteLibraryScanner', MockScanner)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('FolderAccess', null)
                Inject('RouteLibraryScanner', null)
                s.reset()
            })

            test('registers the grant (fire-and-forget) and scans exactly as today', () => {
                const folderInfo = { uri: '/icloud/Videos', displayName: 'Videos', grant: 'g1', grantError: undefined }

                const result = service.startLibraryScan(folderInfo as any)

                expect(MockFolderAccess.registerGrant).toHaveBeenCalledWith('/icloud/Videos', 'g1', undefined, 'Videos')
                expect(MockScanner.scan).toHaveBeenCalledWith(folderInfo)
                expect(result).toEqual({ id: 'observer' })
            })

            test('a rejected registerGrant never fails the scan', async () => {
                MockFolderAccess.registerGrant.mockRejectedValue(new Error('boom'))
                const folderInfo = { uri: '/icloud/Videos', displayName: 'Videos' }

                expect(() => service.startLibraryScan(folderInfo as any)).not.toThrow()
                expect(MockScanner.scan).toHaveBeenCalledWith(folderInfo)

                await new Promise(resolve => setTimeout(resolve, 0))
                expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'startLibraryScan')
            })
        })

        describe('inert without the fileAccess binding', () => {
            let s, service, MockVideoAvailability, MockVideoPageActions

            beforeEach(() => {
                MockVideoAvailability = {
                    getListPill: jest.fn().mockReturnValue(undefined),
                    isSupported: jest.fn().mockReturnValue(false),
                    getDownloadRows: jest.fn().mockReturnValue([])
                }
                MockVideoPageActions = { isSupported: jest.fn().mockReturnValue(false) }

                Inject('AppState', mockAppState())
                Inject('WorkoutList', { getSelected: jest.fn().mockReturnValue(undefined) })
                Inject('VideoAvailability', MockVideoAvailability)
                Inject('VideoPageActions', MockVideoPageActions)

                s = service = new RoutesPageService()
                s.logError = jest.fn()
            })

            afterEach(() => {
                Inject('AppState', null)
                Inject('WorkoutList', null)
                Inject('VideoAvailability', null)
                Inject('VideoPageActions', null)
                s.reset()
            })

            test('videoPill is absent for every route', () => {
                ;(service as any).serviceState = { routes: [{ id: 'r1' }] }
                const props = (service as any).getRoutesDisplayProps()
                expect(props[0].videoPill).toBeUndefined()
            })

            test('route details has no video prop', () => {
                const props = service.getRouteDetailsProps('r1')
                expect(props.video).toBeUndefined()
            })

            test('the Downloads list is server-rows-only', () => {
                ;(service as any).downloadCache.set('r1', { routeId: 'r1', title: 'x', status: 'done' })
                let payload: any
                ;(service as any).downloadObserver.on('download-update', (p: any) => { payload = p })
                ;(service as any).emitDownloadUpdate()

                expect(payload.rows).toHaveLength(1)
                expect(payload.rows[0].source).toBe('server')
            })
        })
    })

    // RouteDownloadService.downloads used to never prune a completed/failed entry, so
    // subscribeAllActiveDownloads() (re-run on every page open/resume) kept finding it in
    // getActiveDownloads() and re-registering it, resetting downloadCache back to 'downloading'.
    // The actual fix lives in RouteDownloadService - this pins down that RoutesPageService correctly
    // stops re-registering a download once the registry (mocked here) has pruned it.
    describe('subscribeAllActiveDownloads - stale entry pruning', () => {
        let s, service, MockRouteDownload

        beforeEach(() => {
            setupMocks()
            MockRouteDownload = {
                getActiveDownloads: jest.fn().mockReturnValue([]),
                on: jest.fn(),
                off: jest.fn(),
            }

            s = service = new RoutesPageService()
            s.logError = jest.fn()
            ;(service as any).getRouteDownload = () => MockRouteDownload
        })

        afterEach(() => {
            resetMocks()
            s.reset()
        })

        test('a completed download is not resurrected as "downloading" once it is pruned from getActiveDownloads()', () => {
            const route = new Route({ id: 'r1', title: 'Test Route' })
            let doneHandler: () => void

            const observer = {
                on: jest.fn((event: string, cb: any) => { if (event === 'done') doneHandler = cb }),
                off: jest.fn(),
            }

            MockRouteDownload.getActiveDownloads.mockReturnValue([{ route, observer }])
            ;(service as any).subscribeAllActiveDownloads()

            expect((service as any).downloadCache.get('r1')?.status).toBe('downloading')

            doneHandler!()
            expect((service as any).downloadCache.get('r1')?.status).toBe('done')

            // registry now correctly prunes the finished entry once its observer fires 'done' -
            // a later page-open/resume rescan must not resurrect it as an active, 0%-progress
            // "ghost" download
            MockRouteDownload.getActiveDownloads.mockReturnValue([])
            ;(service as any).subscribeAllActiveDownloads()

            expect((service as any).downloadCache.get('r1')?.status).toBe('done')
        })
    })
})
