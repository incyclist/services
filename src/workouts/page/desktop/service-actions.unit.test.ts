import { Inject } from '../../../base/decorators'
import { Observer, PromiseObserver } from '../../../base/types/observer'
import { getBindings } from '../../../api'
import { Workout } from '../../base/model/Workout'
import { DesktopWorkoutListPageService } from '../index'

describe('DesktopWorkoutListPageService - actions', () => {

    let MockAppState
    let MockUserSettings
    let MockWorkoutList
    let MockWorkoutCalendar
    let MockRouteList
    let MockDevicePairing
    let MockUI
    let s, service

    const makeWorkout = (id: string) => new Workout({ type: 'workout', id, name: `W${id}`, duration: 1800 })

    const makeCard = (id: string, cardType: string, displayProps: any = {}, extra: any = {}) => ({
        getId: jest.fn().mockReturnValue(id),
        getCardType: jest.fn().mockReturnValue(cardType),
        getDisplayProperties: jest.fn().mockReturnValue({ visible: true, ...displayProps }),
        getTitle: jest.fn().mockReturnValue(`W${id}`),
        getData: jest.fn().mockReturnValue(makeWorkout(id)),
        canDelete: jest.fn().mockReturnValue(true),
        openSettings: jest.fn().mockReturnValue({
            settings: { ftp: 220, useErgMode: true }, ftpRequired: true, canStart: false, canStartWorkoutOnly: true,
            duration: '30min', categories: ['Scheduled Workouts', 'My Workouts'], category: 'My Workouts'
        }),
        select: jest.fn(),
        reset: jest.fn(),
        ...extra
    })

    const makeList = (id: string, title: string, cards: any[]) => ({
        getId: jest.fn().mockReturnValue(id),
        getTitle: jest.fn().mockReturnValue(title),
        getCards: jest.fn().mockReturnValue(cards)
    })

    const load = (lists: any[]) => {
        MockWorkoutList.getLists.mockReturnValue(lists)
        service.getPageDisplayProps()
    }

    beforeEach(() => {
        MockAppState = { hasFeature: jest.fn(), getState: jest.fn(), setState: jest.fn(), setPersistedState: jest.fn() }
        MockUserSettings = { get: jest.fn((_k, def) => def), set: jest.fn() }
        MockWorkoutList = {
            open: jest.fn().mockReturnValue({ observer: new Observer(), lists: [] }),
            close: jest.fn(),
            isStillLoading: jest.fn().mockReturnValue(false),
            getLists: jest.fn().mockReturnValue([]),
            getStartSettings: jest.fn().mockReturnValue({ ftp: 220, useErgMode: true }),
            setStartSettings: jest.fn(),
            import: jest.fn().mockResolvedValue([]),
            deleteWorkout: jest.fn()
        }
        MockWorkoutCalendar = { on: jest.fn(), off: jest.fn(), getScheduledToday: jest.fn() }
        MockRouteList = { getSelected: jest.fn(), unselect: jest.fn() }
        MockDevicePairing = { isReadyToStart: jest.fn().mockReturnValue(true) }
        MockUI = { openPage: jest.fn(), openBrowserWindow: jest.fn() }

        Inject('WorkoutList', MockWorkoutList)
        Inject('WorkoutCalendar', MockWorkoutCalendar)
        Inject('UserSettings', MockUserSettings)
        Inject('AppState', MockAppState)
        Inject('RouteList', MockRouteList)
        Inject('DevicePairing', MockDevicePairing)
        getBindings().ui = MockUI as any

        s = service = new DesktopWorkoutListPageService()
        s.logError = jest.fn()
        s.logEvent = jest.fn()
    })

    afterEach(() => {
        Inject('WorkoutList', null)
        Inject('WorkoutCalendar', null)
        Inject('UserSettings', null)
        Inject('AppState', null)
        Inject('RouteList', null)
        Inject('DevicePairing', null)
        s.reset()
    })

    describe('onCardOK', () => {

        test('Workout and Scheduled cards open the details', () => {
            load([makeList('scheduled', 'S', [makeCard('1', 'ScheduledWorkout')]), makeList('myWorkouts', 'My', [makeCard('2', 'Workout')])])

            service.onCardOK('2')
            expect(service.getPageDisplayProps().detailWorkoutId).toBe('2')
            service.onCardOK('1')
            expect(service.getPageDisplayProps().detailWorkoutId).toBe('1')
        })

        test('unknown id is a quiet no-op (logged as event, not as error)', () => {
            service.onCardOK('nope')
            expect(s.logError).not.toHaveBeenCalled()
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'card not found', id: 'nope', fn: 'onCardOK' })
        })

        test('clicking a real card twice opens the details both times', () => {
            load([makeList('myWorkouts', 'My', [makeCard('2', 'Workout')])])

            service.onCardOK('2')
            service.onCardOK('2')

            expect(service.getPageDisplayProps().detailWorkoutId).toBe('2')
            expect(s.logError).not.toHaveBeenCalled()
        })
    })

    describe('onCreateWorkout', () => {

        test('first time: shows the info overlay instead of opening the link', () => {
            const create = makeCard('Create', 'WorkoutCreate', { link: 'https://x.y', firstTime: true })
            load([makeList('myWorkouts', 'My', [create])])

            service.onCreateWorkout()

            expect(service.getPageDisplayProps().createInfo).toEqual({ markAsSeenDefault: true })
            expect(MockUI.openBrowserWindow).not.toHaveBeenCalled()
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'Overlay shown', overlay: 'Create Workout Info' })
        })

        test('not first time: opens the link', () => {
            load([makeList('myWorkouts', 'My', [makeCard('Create', 'WorkoutCreate', { link: 'https://x.y', firstTime: false })])])

            service.onCreateWorkout()

            expect(MockUI.openBrowserWindow).toHaveBeenCalledWith('https://x.y')
            expect(service.getPageDisplayProps().createInfo).toBeNull()
        })

        test('works without a snapshot (nothing was handed out to the UI yet)', () => {
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My', [makeCard('Create', 'WorkoutCreate', { link: 'https://x.y', firstTime: false })])])

            service.onCreateWorkout()

            expect(MockUI.openBrowserWindow).toHaveBeenCalledWith('https://x.y')
            expect(s.logError).not.toHaveBeenCalled()
        })

        test('works after the page was closed (snapshot cleared)', () => {
            load([makeList('myWorkouts', 'My', [makeCard('Create', 'WorkoutCreate', { link: 'https://x.y', firstTime: false })])])
            service.closePage()

            service.onCreateWorkout()

            expect(MockUI.openBrowserWindow).toHaveBeenCalledWith('https://x.y')
            expect(s.logError).not.toHaveBeenCalled()
        })

        test('missing create card is logged as error', () => {
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My', [])])
            service.onCreateWorkout()
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('onCreateInfoClosed', () => {
        let create

        beforeEach(() => {
            create = makeCard('Create', 'WorkoutCreate', { link: 'https://x.y', firstTime: true }, { markAsSeen: jest.fn() })
            load([makeList('myWorkouts', 'My', [create])])
            service.onCreateWorkout()
        })

        test('with markAsSeen: marks the card, clears the overlay and opens the link', () => {
            service.onCreateInfoClosed(true)

            expect(create.markAsSeen).toHaveBeenCalled()
            expect(service.getPageDisplayProps().createInfo).toBeNull()
            expect(MockUI.openBrowserWindow).toHaveBeenCalledWith('https://x.y')
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'Overlay closed', overlay: 'Create Workout Info', markAsSeen: true })
        })

        test('without markAsSeen: does not mark the card', () => {
            service.onCreateInfoClosed(false)
            expect(create.markAsSeen).not.toHaveBeenCalled()
            expect(MockUI.openBrowserWindow).toHaveBeenCalled()
        })

        test('without an open overlay: nothing happens', () => {
            service.onCreateInfoClosed(false)
            MockUI.openBrowserWindow.mockClear()
            service.onCreateInfoClosed(false)
            expect(MockUI.openBrowserWindow).not.toHaveBeenCalled()
        })
    })

    describe('onDelete', () => {

        test('regular workouts are deleted through the domain and logged (card)', async () => {
            load([makeList('myWorkouts', 'My', [makeCard('1', 'Workout')])])
            MockWorkoutList.deleteWorkout.mockReturnValue(PromiseObserver.alwaysReturning(true))

            const res = await service.onDelete('1')

            expect(res).toBe(true)
            expect(MockWorkoutList.deleteWorkout).toHaveBeenCalledWith('1')
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'workout deleted', workoutId: '1', success: true, surface: 'card' })
        })

        test('delete from the details dialog is logged with surface details; failure returns false', async () => {
            load([makeList('myWorkouts', 'My', [makeCard('1', 'Workout')])])
            MockWorkoutList.deleteWorkout.mockReturnValue(PromiseObserver.alwaysReturning(false))
            service.onOpenDetails('1')

            const res = await service.onDelete('1')

            expect(res).toBe(false)
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'workout deleted', workoutId: '1', success: false, surface: 'details' })
        })

        test('errors resolve to false', async () => {
            MockWorkoutList.deleteWorkout.mockImplementation(() => { throw new Error('boom') })
            expect(await service.onDelete('1')).toBe(false)
        })
    })

    describe('getWorkoutDetailsProps', () => {

        test('adds stepChangeAudioSignal, canAddRoute and removes the scheduled title from the groups', () => {
            const card = makeCard('1', 'Workout')
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'Scheduled Workouts', []), makeList('myWorkouts', 'My Workouts', [card])])

            const props = service.getWorkoutDetailsProps('1')

            expect(props).toMatchObject({ id: '1', stepChangeAudioSignal: true, canAddRoute: true, groups: ['My Workouts'] })
            expect(MockUserSettings.get).toHaveBeenCalledWith('preferences.workouts.stepChangeAudioSignal', true)
        })

        test('canAddRoute is false when a route is attached', () => {
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My Workouts', [makeCard('1', 'Workout')])])
            MockRouteList.getSelected.mockReturnValue({ description: { id: 'r1' }, title: 'Route' })

            expect(service.getWorkoutDetailsProps('1')).toMatchObject({ canAddRoute: false, attachedRoute: { id: 'r1', title: 'Route' } })
        })

        test('unknown workout returns null', () => {
            expect(service.getWorkoutDetailsProps('x')).toBeNull()
        })
    })

    describe('onSetStepChangeAudioSignal', () => {
        test('persists the preference and emits page-update', () => {
            const observer = service.openPage()
            const emitSpy = jest.spyOn(observer, 'emit')

            service.onSetStepChangeAudioSignal(false)

            expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.workouts.stepChangeAudioSignal', false)
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })
    })

    describe('onStartFromDetails', () => {
        let card

        beforeEach(() => {
            card = makeCard('1', 'Workout')
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My', [card])])
        })

        test('without an attached route: starts workout only', () => {
            service.onStartFromDetails('1')

            expect(card.select).toHaveBeenCalledWith({ ftp: 220, useErgMode: true, noRoute: true })
            expect(MockUI.openPage).toHaveBeenCalledWith('/rideOK', { source: '/workouts' })
        })

        test('with an attached route: starts with the route', () => {
            MockRouteList.getSelected.mockReturnValue({ description: { id: 'r1' }, title: 'Route' })
            service.onStartFromDetails('1')

            expect(card.select).toHaveBeenCalledWith({ ftp: 220, useErgMode: true, noRoute: false })
        })

        test('devices not ready: goes to pairing', () => {
            MockDevicePairing.isReadyToStart.mockReturnValue(false)
            service.onStartFromDetails('1')
            expect(MockUI.openPage).toHaveBeenCalledWith('/pairingStart', { source: '/workouts' })
        })
    })

    describe('onAddRoute', () => {

        test('marks the workout for the route and opens the Routes page', () => {
            const card = makeCard('1', 'Workout')
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My', [card])])
            service.onOpenDetails('1')

            service.onAddRoute('1')

            expect(card.select).toHaveBeenCalledWith({ ftp: 220, useErgMode: true, noRoute: false })
            expect(MockUI.openPage).toHaveBeenCalledWith('/routes', { source: '/workouts' })
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'attachment changed', action: 'attach', side: 'workout', surface: 'workout-details', workoutId: '1' })
            expect(service.getPageDisplayProps().detailWorkoutId).toBeNull()
        })

        test('unknown workout does not navigate', () => {
            service.onAddRoute('x')
            expect(MockUI.openPage).not.toHaveBeenCalled()
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('onClearRouteSelection', () => {
        test('clears the route and logs the change', () => {
            MockRouteList.getSelected.mockReturnValue({ description: { id: 'r1' }, title: 'Route' })

            service.onClearRouteSelection()

            expect(MockRouteList.unselect).toHaveBeenCalled()
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'attachment changed', action: 'clear', side: 'route', surface: 'workout-details', routeId: 'r1' })
        })
    })
})
