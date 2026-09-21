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

    // Ride Again pre-check (video availability): RouteVideoPageActions/RouteVideoAvailabilityService/
    // FolderAccessService are reused, not reimplemented - these tests mock them at the page-service
    // boundary. `MockDevicePairing`/`MockBindings` from setupMocks() are reused so the eventual
    // navigation path is exercised exactly as the existing 'onRideAgain' tests above exercise it.
    describe('onRideAgain (video pre-check)',()=>{
        let s,service
        let MockFolderAccess, MockAvailability, MockVideoActions

        const statusOf = (state, over = {}) => ({
            routeId: 'route-1', state, isICloud: true, fileCount: 1, notDownloadedCount: state === 'ready' ? 0 : 1,
            confirmedThisSession: false, ...over
        })

        const videoProps = (over = {}) => ({
            status: statusOf('not-downloaded'),
            canStart: false,
            actions: { download: true, downloadEnabled: true, stop: false, retry: false, keepInstead: false, remove: false, confirmAccess: false },
            ...over
        })

        const setup = (opts: { supported?: boolean } = { supported: true }) => {
            setupMocks()

            MockFolderAccess = { activateAll: jest.fn().mockResolvedValue(undefined) }
            MockAvailability = {
                refresh: jest.fn().mockResolvedValue(statusOf('not-downloaded')),
                getStatus: jest.fn().mockReturnValue(statusOf('not-downloaded')),
                onForeground: jest.fn().mockResolvedValue(undefined),
                on: jest.fn(), off: jest.fn()
            }
            MockVideoActions = {
                isSupported: jest.fn().mockReturnValue(opts.supported ?? true),
                getDisplayProps: jest.fn().mockReturnValue(videoProps()),
                on: jest.fn(), off: jest.fn()
            }

            Inject('FolderAccess', MockFolderAccess)
            Inject('Availability', MockAvailability)
            Inject('VideoActions', MockVideoActions)

            s = service = new ActivitiesPageService()
            s.logError = jest.fn()
            ;(service as any).listState = { loading:false, activities:[] }
        }

        afterEach( ()=>{
            Inject('FolderAccess', null)
            Inject('Availability', null)
            Inject('VideoActions', null)
            resetMocks()
            s.reset()
        })

        test('unsupported (no fileAccess binding) -> started, synchronously, no activateAll/refresh call',()=>{
            setup({ supported: false })
            MockDevicePairing.isReadyToStart.mockReturnValue(true)

            // deliberately not awaited: on an unsupported platform navigation must happen inline,
            // with no await in between, so callers that ignore the returned promise keep working
            service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/rideDeviceOK')
            expect(MockFolderAccess.activateAll).not.toHaveBeenCalled()
            expect(MockAvailability.refresh).not.toHaveBeenCalled()
        })

        test('no route id -> started, synchronously, no pre-check',()=>{
            setup({ supported: true })
            MockDevicePairing.isReadyToStart.mockReturnValue(false)

            service.onRideAgain({ title:'Untitled' })

            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/pairingStart')
            expect(MockAvailability.refresh).not.toHaveBeenCalled()
        })

        test('supported, refresh resolves ready -> activateAll + refresh called, navigates, resolves started, no rideAgainCheck',async ()=>{
            setup({ supported: true })
            MockAvailability.refresh.mockResolvedValue(statusOf('ready'))
            MockDevicePairing.isReadyToStart.mockReturnValue(true)

            const result = await service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(MockFolderAccess.activateAll).toHaveBeenCalledTimes(1)
            expect(MockAvailability.refresh).toHaveBeenCalledWith('route-1')
            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/rideDeviceOK')
            expect(result).toBe('started')
            expect(service.getPageDisplayProps().rideAgainCheck).toBeNull()
        })

        test('supported, refresh resolves unknown -> navigates, resolves started',async ()=>{
            setup({ supported: true })
            MockAvailability.refresh.mockResolvedValue(statusOf('unknown'))

            const result = await service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(result).toBe('started')
            expect(MockBindings.ui.openPage).toHaveBeenCalled()
        })

        test('supported, refresh resolves not-downloaded -> does not navigate, sets rideAgainCheck, resolves blocked',async ()=>{
            setup({ supported: true })
            MockAvailability.refresh.mockResolvedValue(statusOf('not-downloaded'))

            const result = await service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(result).toBe('blocked')
            expect(MockBindings.ui.openPage).not.toHaveBeenCalled()

            const props = service.getPageDisplayProps().rideAgainCheck
            expect(props).toEqual({
                routeId: 'route-1',
                routeTitle: 'Route 1',
                video: videoProps(),
                downloadedWhileOpen: false
            })
        })

        test('activateAll rejects -> error logged, fails open (navigates, resolves started)',async ()=>{
            setup({ supported: true })
            MockFolderAccess.activateAll.mockRejectedValue(new Error('boom'))
            MockDevicePairing.isReadyToStart.mockReturnValue(true)

            const result = await service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(result).toBe('started')
            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/rideDeviceOK')
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onRideAgain')
        })

        test('refresh rejects -> error logged, fails open (navigates, resolves started)',async ()=>{
            setup({ supported: true })
            MockAvailability.refresh.mockRejectedValue(new Error('boom'))

            const result = await service.onRideAgain({ id:'route-1', title:'Route 1' })

            expect(result).toBe('started')
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onRideAgain')
        })

        test('blocked check subscribes to live video updates; closed check unsubscribes',async ()=>{
            setup({ supported: true })

            await service.onRideAgain({ id:'route-1', title:'Route 1' })
            expect(MockAvailability.on).toHaveBeenCalledWith('route-video-update', expect.any(Function))
            expect(MockVideoActions.on).toHaveBeenCalledWith('route-video-actions-update', expect.any(Function))

            service.onRideAgainCheckClosed()
            expect(MockAvailability.off).toHaveBeenCalledWith('route-video-update', expect.any(Function))
            expect(MockVideoActions.off).toHaveBeenCalledWith('route-video-actions-update', expect.any(Function))
            expect(service.getPageDisplayProps().rideAgainCheck).toBeNull()
        })

        test('a live update while blocked with the video now ready sets downloadedWhileOpen and refreshes props',async ()=>{
            setup({ supported: true })
            await service.onRideAgain({ id:'route-1', title:'Route 1' })

            const handler = MockAvailability.on.mock.calls.find(c => c[0] === 'route-video-update')[1]
            MockAvailability.getStatus.mockReturnValue(statusOf('ready'))
            MockVideoActions.getDisplayProps.mockReturnValue(videoProps({ canStart:true, status: statusOf('ready') }))

            handler('route-1')

            const props = service.getPageDisplayProps().rideAgainCheck
            expect(props.downloadedWhileOpen).toBe(true)
            expect(props.video.canStart).toBe(true)
        })

        test('a live update for a different route is ignored',async ()=>{
            setup({ supported: true })
            await service.onRideAgain({ id:'route-1', title:'Route 1' })

            const handler = MockAvailability.on.mock.calls.find(c => c[0] === 'route-video-update')[1]
            MockAvailability.getStatus.mockReturnValue(statusOf('ready'))

            handler('some-other-route')

            expect(service.getPageDisplayProps().rideAgainCheck.downloadedWhileOpen).toBe(false)
        })

        test('onRideAgainCheckStart with no pending check is a safe no-op, resolves blocked',async ()=>{
            setup({ supported: true })

            const result = await service.onRideAgainCheckStart()

            expect(result).toBe('blocked')
            expect(MockAvailability.refresh).not.toHaveBeenCalled()
        })

        test('onRideAgainCheckStart re-runs the check for the pending route: still not ready -> stays blocked with refreshed props',async ()=>{
            setup({ supported: true })
            await service.onRideAgain({ id:'route-1', title:'Route 1' })
            MockAvailability.refresh.mockClear()
            MockAvailability.refresh.mockResolvedValue(statusOf('downloading'))

            const result = await service.onRideAgainCheckStart()

            expect(MockAvailability.refresh).toHaveBeenCalledWith('route-1')
            expect(result).toBe('blocked')
            expect(service.getPageDisplayProps().rideAgainCheck).not.toBeNull()
        })

        test('onRideAgainCheckStart re-runs the check for the pending route: now ready -> navigates, clears the check, resolves started',async ()=>{
            setup({ supported: true })
            await service.onRideAgain({ id:'route-1', title:'Route 1' })
            MockAvailability.refresh.mockResolvedValue(statusOf('ready'))
            MockDevicePairing.isReadyToStart.mockReturnValue(true)

            const result = await service.onRideAgainCheckStart()

            expect(result).toBe('started')
            expect(MockBindings.ui.openPage).toHaveBeenCalledWith('/rideDeviceOK')
            expect(service.getPageDisplayProps().rideAgainCheck).toBeNull()
        })

        test('closePage clears an open rideAgainCheck and unsubscribes',async ()=>{
            setup({ supported: true })
            await service.onRideAgain({ id:'route-1', title:'Route 1' })
            expect(service.getPageDisplayProps().rideAgainCheck).not.toBeNull()

            service.closePage()

            expect(service.getPageDisplayProps().rideAgainCheck).toBeNull()
            expect(MockAvailability.off).toHaveBeenCalledWith('route-video-update', expect.any(Function))
        })

        test('resumePage calls RouteVideoAvailabilityService.onForeground() (C9 reconciliation)',()=>{
            setup({ supported: true })

            service.resumePage()

            expect(MockAvailability.onForeground).toHaveBeenCalledTimes(1)
        })

        test('resumePage: onForeground() rejecting is logged, not thrown',async ()=>{
            setup({ supported: true })
            MockAvailability.onForeground.mockRejectedValue(new Error('boom'))

            expect( ()=>service.resumePage()).not.toThrow()
            // allow the rejected promise's .catch() handler to run
            await Promise.resolve().then(()=>Promise.resolve())

            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'resumePage')
        })
    })

    describe('video actions delegation (RouteVideoPageActions)',()=>{
        let s,service
        let MockVideoActions

        beforeEach( ()=>{
            setupMocks()
            MockVideoActions = {
                onVideoDownloadPressed: jest.fn(),
                onVideoDownloadConfirmed: jest.fn(),
                onVideoDownloadDismissed: jest.fn(),
                onVideoStop: jest.fn(),
                onVideoRetry: jest.fn(),
                onVideoKeepInstead: jest.fn(),
                onVideoRemovePressed: jest.fn(),
                onVideoRemoveConfirmed: jest.fn(),
                onVideoRemoveDismissed: jest.fn(),
                onConfirmAccess: jest.fn().mockResolvedValue(undefined)
            }
            Inject('VideoActions', MockVideoActions)

            s = service = new ActivitiesPageService()
            s.logError = jest.fn()
        })

        afterEach( ()=>{
            Inject('VideoActions', null)
            resetMocks()
            s.reset()
        })

        test('every onVideo*/onConfirmAccess call delegates to RouteVideoPageActions unchanged',async ()=>{
            service.onVideoDownloadPressed('route-1')
            service.onVideoDownloadConfirmed('route-1', 'keep')
            service.onVideoDownloadDismissed('route-1')
            service.onVideoStop('route-1')
            service.onVideoRetry('route-1')
            service.onVideoKeepInstead('route-1')
            service.onVideoRemovePressed('route-1')
            service.onVideoRemoveConfirmed('route-1')
            service.onVideoRemoveDismissed('route-1')
            await service.onConfirmAccess('route-1')

            expect(MockVideoActions.onVideoDownloadPressed).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoDownloadConfirmed).toHaveBeenCalledWith('route-1', 'keep')
            expect(MockVideoActions.onVideoDownloadDismissed).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoStop).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoRetry).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoKeepInstead).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoRemovePressed).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoRemoveConfirmed).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onVideoRemoveDismissed).toHaveBeenCalledWith('route-1')
            expect(MockVideoActions.onConfirmAccess).toHaveBeenCalledWith('route-1')
        })

        // Inertness: without the fileAccess binding RouteVideoPageActions' own handlers are already
        // no-ops (see pageActions.unit.test.ts) - this proves the delegation layer itself never
        // throws even if the shared actions service does, on every one of the new call sites.
        test('a throwing RouteVideoPageActions handler is caught and logged, never thrown, for every action',async ()=>{
            Object.keys(MockVideoActions).forEach(key => {
                if (key === 'onConfirmAccess')
                    MockVideoActions[key] = jest.fn().mockRejectedValue(new Error('boom'))
                else
                    MockVideoActions[key] = jest.fn(() => { throw new Error('boom') })
            })

            expect( ()=>service.onVideoDownloadPressed('route-1')).not.toThrow()
            expect( ()=>service.onVideoDownloadConfirmed('route-1','keep')).not.toThrow()
            expect( ()=>service.onVideoDownloadDismissed('route-1')).not.toThrow()
            expect( ()=>service.onVideoStop('route-1')).not.toThrow()
            expect( ()=>service.onVideoRetry('route-1')).not.toThrow()
            expect( ()=>service.onVideoKeepInstead('route-1')).not.toThrow()
            expect( ()=>service.onVideoRemovePressed('route-1')).not.toThrow()
            expect( ()=>service.onVideoRemoveConfirmed('route-1')).not.toThrow()
            expect( ()=>service.onVideoRemoveDismissed('route-1')).not.toThrow()
            await expect(service.onConfirmAccess('route-1')).resolves.toBeUndefined()

            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onConfirmAccess')
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
