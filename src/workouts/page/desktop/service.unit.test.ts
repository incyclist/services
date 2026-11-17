import { Inject } from '../../../base/decorators'
import { Observer } from '../../../base/types/observer'
import { Workout } from '../../base/model/Workout'
import { DesktopWorkoutListPageService } from '../index'

describe('DesktopWorkoutListPageService - display props', () => {

    let MockAppState
    let MockUserSettings
    let MockWorkoutList
    let MockWorkoutCalendar
    let MockRouteList
    let s, service

    const makeWorkout = (id: string, name: string) => new Workout({ type: 'workout', id, name, duration: 1800 })

    const makeCard = (id: string, cardType: string, displayProps: any = {}, extra: any = {}) => ({
        getId: jest.fn().mockReturnValue(id),
        getCardType: jest.fn().mockReturnValue(cardType),
        getDisplayProperties: jest.fn().mockReturnValue({ visible: true, ...displayProps }),
        reset: jest.fn(),
        setVisible: jest.fn(),
        ...extra
    })

    const makeList = (id: string, title: string, cards: any[], observer?: Observer) => ({
        getId: jest.fn().mockReturnValue(id),
        getTitle: jest.fn().mockReturnValue(title),
        getCards: jest.fn().mockReturnValue(cards),
        observer
    })

    const workoutCard = (id: string, selected = false) => {
        const observer = new Observer()
        const workout = makeWorkout(id, `W${id}`)
        return makeCard(id, 'Workout', { title: `W${id}`, workout, ftp: 200, duration: '30min', canDelete: true, selected, observer }, { observer })
    }

    beforeEach(() => {
        MockAppState = { hasFeature: jest.fn().mockReturnValue(true), getState: jest.fn(), setState: jest.fn(), setPersistedState: jest.fn() }
        MockUserSettings = { get: jest.fn((_k, def) => def), set: jest.fn() }
        MockWorkoutList = {
            open: jest.fn().mockReturnValue({ observer: new Observer(), lists: [] }),
            close: jest.fn(),
            isStillLoading: jest.fn().mockReturnValue(false),
            getLists: jest.fn().mockReturnValue([]),
            getScreenProps: jest.fn(),
            setScreenProps: jest.fn(),
            onResize: jest.fn(),
            onCarouselInitialized: jest.fn(),
            onCarouselUpdated: jest.fn()
        }
        MockWorkoutCalendar = { on: jest.fn(), off: jest.fn(), getScheduledToday: jest.fn().mockReturnValue(undefined) }
        MockRouteList = { getSelected: jest.fn(), unselect: jest.fn() }

        Inject('WorkoutList', MockWorkoutList)
        Inject('WorkoutCalendar', MockWorkoutCalendar)
        Inject('UserSettings', MockUserSettings)
        Inject('AppState', MockAppState)
        Inject('RouteList', MockRouteList)

        s = service = new DesktopWorkoutListPageService()
        s.logError = jest.fn()
    })

    afterEach(() => {
        Inject('WorkoutList', null)
        Inject('WorkoutCalendar', null)
        Inject('UserSettings', null)
        Inject('AppState', null)
        Inject('RouteList', null)
        s.reset()
    })

    describe('getPageDisplayProps', () => {

        test('loading while the domain is still loading', () => {
            MockWorkoutList.isStillLoading.mockReturnValue(true)
            MockWorkoutList.getLists.mockReturnValue(null)

            expect(service.getPageDisplayProps()).toEqual({ loading: true, lists: [], upcoming: null, displayType: 'tiles', detailWorkoutId: null, createInfo: null })
        })

        test('loading when the lists are null', () => {
            MockWorkoutList.getLists.mockReturnValue(null)
            expect(service.getPageDisplayProps().loading).toBe(true)
        })

        test('maps lists and cards, strips selected and observer from props', () => {
            const card = workoutCard('1', true)
            const importCard = makeCard('Import', 'WorkoutImport', { title: 'Import Workout', filters: [] })
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My Workouts', [importCard, card])])

            const props = service.getPageDisplayProps()

            expect(props.loading).toBe(false)
            expect(props.lists).toHaveLength(1)
            const list = props.lists[0]
            expect(list).toMatchObject({ id: 'myWorkouts', title: 'My Workouts' })
            expect(list.observer).toBeDefined()
            expect(list.cards.map(c => c.id)).toEqual(['1'])

            const c = list.cards[0]
            expect(c.cardType).toBe('Workout')
            expect(c.props).not.toHaveProperty('selected')
            expect(c.props).not.toHaveProperty('observer')
            expect(c.props).toMatchObject({ title: 'W1', canDelete: true })
            expect(c.observer).toBe(card.observer)
        })

        test('Import and ActiveImport cards are not part of the display props', () => {
            const failed = makeCard('a.zwo', 'ActiveWorkoutImport', { name: 'a.zwo', error: new Error('x') })
            const importCard = makeCard('Import', 'WorkoutImport', {})
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My Workouts', [importCard, failed, workoutCard('1')])])

            expect(service.getPageDisplayProps().lists[0].cards.map(c => c.id)).toEqual(['1'])
        })

        test('scheduled cards: isToday set from the scheduled-today workout', () => {
            const today = makeCard('1', 'ScheduledWorkout', { date: new Date(), selected: false })
            const other = makeCard('2', 'ScheduledWorkout', { date: new Date() })
            MockWorkoutCalendar.getScheduledToday.mockReturnValue({ id: 'src:1', workoutId: '1', workout: { id: '1' } })
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'Scheduled Workouts', [today, other])])

            const props = service.getPageDisplayProps()
            const cards = props.upcoming.cards
            expect((cards[0].props as any).isToday).toBe(true)
            expect((cards[1].props as any).isToday).toBe(false)
            expect(props.upcoming.todayId).toBe('1')
        })

        test('upcoming is split from the regular lists', () => {
            const sched = makeList('scheduled', 'Scheduled Workouts', [makeCard('1', 'ScheduledWorkout', {})])
            const mine = makeList('myWorkouts', 'My Workouts', [workoutCard('2')])
            MockWorkoutList.getLists.mockReturnValue([sched, mine])

            const props = service.getPageDisplayProps()

            expect(props.lists.map(l => l.id)).toEqual(['myWorkouts'])
            expect(props.upcoming).toMatchObject({ id: 'scheduled', title: 'Scheduled Workouts', todayId: null })
            expect(props.upcoming.observer).toBeDefined()
            expect(props.upcoming.cards.map(c => c.id)).toEqual(['1'])
        })

        test('upcoming is null without scheduled workouts', () => {
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My', [])])
            expect(service.getPageDisplayProps().upcoming).toBeNull()

            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'S', []), makeList('myWorkouts', 'My', [])])
            expect(service.getPageDisplayProps().upcoming).toBeNull()
        })

        test('upcoming is null while loading', () => {
            MockWorkoutList.isStillLoading.mockReturnValue(true)
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'S', [makeCard('1', 'ScheduledWorkout', {})])])
            expect(service.getPageDisplayProps().upcoming).toBeNull()
        })

        test('snapshot still resolves scheduled cards', () => {
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'S', [makeCard('1', 'ScheduledWorkout', {})])])
            service.getPageDisplayProps()
            const openDetails = jest.spyOn(service, 'onOpenDetails').mockImplementation(() => undefined)

            service.onCardOK('1')

            expect(openDetails).toHaveBeenCalledWith('1')
        })

        test('observers are stable per list id across calls', () => {
            MockWorkoutList.getLists.mockImplementation(() => [makeList('myWorkouts', 'My Workouts', [])])

            const first = service.getPageDisplayProps().lists[0].observer
            const second = service.getPageDisplayProps().lists[0].observer
            expect(second).toBe(first)
        })

        test('getPageDisplayProperties is an alias', () => {
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My Workouts', [])])
            expect(service.getPageDisplayProperties()).toEqual(service.getPageDisplayProps())
        })

        test('errors are logged, not thrown', () => {
            MockWorkoutList.getLists.mockImplementation(() => { throw new Error('boom') })
            expect(service.getPageDisplayProps().loading).toBe(true)
            expect(s.logError).toHaveBeenCalled()
        })
    })

    describe('display type', () => {
        let pageObserver, emitSpy

        beforeEach(() => {
            pageObserver = service.openPage()
            emitSpy = jest.spyOn(pageObserver, 'emit')
        })

        test('defaults to tiles and is part of the display props', () => {
            expect(service.getDisplayType()).toBe('tiles')
            expect(MockUserSettings.get).toHaveBeenCalledWith('preferences.workoutListDisplayType', 'tiles')
            expect(service.getPageDisplayProps().displayType).toBe('tiles')
        })

        test('reads the persisted value', () => {
            MockUserSettings.get.mockReturnValue('list')
            expect(service.getDisplayType()).toBe('list')
            expect(service.getPageDisplayProps().displayType).toBe('list')
        })

        test('an invalid persisted value falls back to tiles', () => {
            MockUserSettings.get.mockReturnValue('grid')
            expect(service.getDisplayType()).toBe('tiles')
        })

        test('persists a valid selection, logs and emits page-update', () => {
            s.logEvent = jest.fn()
            service.onDisplayTypeSelected('list')

            expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.workoutListDisplayType', 'list')
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'display type changed', displayType: 'list' })
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('ignores invalid input', () => {
            emitSpy.mockClear()
            service.onDisplayTypeSelected('grid')
            service.onDisplayTypeSelected(undefined)

            expect(MockUserSettings.set).not.toHaveBeenCalled()
            expect(emitSpy).not.toHaveBeenCalled()
        })

        test('errors are logged, not thrown', () => {
            MockUserSettings.set.mockImplementation(() => { throw new Error('boom') })
            expect(() => service.onDisplayTypeSelected('list')).not.toThrow()
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'onDisplayTypeSelected')

            MockUserSettings.get.mockImplementation(() => { throw new Error('boom') })
            expect(service.getDisplayType()).toBe('tiles')
            expect(s.logError).toHaveBeenCalledWith(expect.any(Error), 'getDisplayType')
        })
    })

    describe('list events', () => {
        let pageObserver, listObserver, emitSpy

        beforeEach(() => {
            listObserver = new Observer()
            MockWorkoutList.open.mockReturnValue({ observer: listObserver, lists: [] })
            pageObserver = service.openPage()
            emitSpy = jest.spyOn(pageObserver, 'emit')
        })

        test('loaded with a changed hash resets the cards and emits page-update', () => {
            const card = workoutCard('1')
            const lists = [makeList('myWorkouts', 'My Workouts', [card])]

            listObserver.emit('loaded', lists, '1')

            expect(card.reset).toHaveBeenCalled()
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('updated with an unchanged hash is ignored', () => {
            const card = workoutCard('1')
            const lists = [makeList('myWorkouts', 'My Workouts', [card])]
            listObserver.emit('updated', lists, '1')
            emitSpy.mockClear()
            card.reset.mockClear()

            listObserver.emit('updated', lists, '1')

            expect(card.reset).not.toHaveBeenCalled()
            expect(emitSpy).not.toHaveBeenCalled()

            listObserver.emit('updated', lists, '1,2')
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('started and loading emit page-update', () => {
            emitSpy.mockClear()
            listObserver.emit('loading')
            expect(emitSpy).toHaveBeenCalledWith('page-update')
        })

        test('updated without lists is ignored', () => {
            emitSpy.mockClear()
            listObserver.emit('updated', null, '')
            expect(emitSpy).not.toHaveBeenCalled()
        })

        test('the scheduled list "update" is re-emitted on that list\'s observer with mapped cards', () => {
            const domainObserver = new Observer()
            const sched = makeList('scheduled', 'Scheduled Workouts', [makeCard('1', 'ScheduledWorkout', {})], domainObserver)
            MockWorkoutList.getLists.mockReturnValue([sched])
            const props = service.getPageDisplayProps()
            const received = jest.fn()
            props.upcoming.observer.on('update', received)

            const updated = makeList('scheduled', 'Scheduled Workouts', [makeCard('1', 'ScheduledWorkout', {}), makeCard('2', 'ScheduledWorkout', {})], domainObserver)
            domainObserver.emit('update', updated)

            expect(received).toHaveBeenCalledTimes(1)
            expect(received.mock.calls[0][0].map(c => c.id)).toEqual(['1', '2'])
        })

        test('Import cards are filtered from the cards re-emitted on a list "update"', () => {
            const domainObserver = new Observer()
            MockWorkoutList.getLists.mockReturnValue([makeList('myWorkouts', 'My', [workoutCard('1')], domainObserver)])
            const received = jest.fn()
            service.getPageDisplayProps().lists[0].observer.on('update', received)

            domainObserver.emit('update', makeList('myWorkouts', 'My', [makeCard('Import', 'WorkoutImport'), makeCard('a.zwo', 'ActiveWorkoutImport'), workoutCard('1')]))

            expect(received.mock.calls[0][0].map(c => c.id)).toEqual(['1'])
        })

        test('the domain subscription is added once, even if getPageDisplayProps is called repeatedly', () => {
            const domainObserver = new Observer()
            MockWorkoutList.getLists.mockImplementation(() => [makeList('scheduled', 'S', [makeCard('1', 'ScheduledWorkout', {})], domainObserver)])
            service.getPageDisplayProps()
            service.getPageDisplayProps()
            const received = jest.fn()
            service.getPageDisplayProps().upcoming.observer.on('update', received)

            domainObserver.emit('update', makeList('scheduled', 'S', []))
            expect(received).toHaveBeenCalledTimes(1)
        })

        test('closePage removes all subscriptions and resets the list observers', () => {
            const domainObserver = new Observer()
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'S', [makeCard('1', 'ScheduledWorkout', {})], domainObserver)])
            const props = service.getPageDisplayProps()
            const received = jest.fn()
            props.upcoming.observer.on('update', received)

            service.closePage()
            domainObserver.emit('update', makeList('scheduled', 'S', []))

            expect(received).not.toHaveBeenCalled()
            expect(MockWorkoutCalendar.off).toHaveBeenCalledWith('updated', expect.any(Function))
        })
    })

    describe('pass-throughs', () => {

        test('getScreenProps / setScreenProps / onResize delegate to the domain', () => {
            MockWorkoutList.getScreenProps.mockReturnValue({ itemsFit: 3 })

            expect(service.getScreenProps()).toEqual({ itemsFit: 3 })
            service.setScreenProps({ itemsFit: 4 })
            service.onResize({ width: 1 }, { width: 2 })

            expect(MockWorkoutList.setScreenProps).toHaveBeenCalledWith({ itemsFit: 4 })
            expect(MockWorkoutList.onResize).toHaveBeenCalled()
        })

        test('onCarouselInitialized resolves the list via the snapshot, not via a fresh getLists()', () => {
            const firstCards = [workoutCard('1'), workoutCard('2')]
            const first = makeList('scheduled', 'S', firstCards)
            MockWorkoutList.getLists.mockReturnValue([first])
            service.getPageDisplayProps()

            // the domain rebuilds the scheduled list on every call
            MockWorkoutList.getLists.mockReturnValue([makeList('scheduled', 'S', [workoutCard('1'), workoutCard('2')])])
            MockWorkoutList.onCarouselInitialized.mockImplementation((list, item, n) => {
                list.getCards().forEach((c, idx) => { if (idx < item + n) c.setVisible(true) })
            })

            service.onCarouselInitialized('scheduled', 0, 2)

            expect(MockWorkoutList.onCarouselInitialized).toHaveBeenCalledWith(first, 0, 2)
            firstCards.forEach(c => expect(c.setVisible).toHaveBeenCalledWith(true))
        })

        test('carousel indexes are translated to the domain list, which still holds the Import card', () => {
            const list = makeList('myWorkouts', 'My', [makeCard('Import', 'WorkoutImport'), makeCard('Create', 'WorkoutCreate'), workoutCard('1'), workoutCard('2')])
            MockWorkoutList.getLists.mockReturnValue([list])
            service.getPageDisplayProps()

            service.onCarouselInitialized('myWorkouts', 1, 1)
            service.onCarouselUpdated('myWorkouts', 0, 2)

            expect(MockWorkoutList.onCarouselInitialized).toHaveBeenCalledWith(list, 2, 1)
            expect(MockWorkoutList.onCarouselUpdated).toHaveBeenCalledWith(list, 1, 2)
        })

        test('onCarouselUpdated resolves the list via the snapshot', () => {
            const first = makeList('myWorkouts', 'My', [])
            MockWorkoutList.getLists.mockReturnValue([first])
            service.getPageDisplayProps()

            service.onCarouselUpdated('myWorkouts', 1, 3)

            expect(MockWorkoutList.onCarouselUpdated).toHaveBeenCalledWith(first, 1, 3)
        })

        test('unknown list id is a no-op that is logged', () => {
            service.onCarouselInitialized('nope', 0, 2)
            service.onCarouselUpdated('nope', 0, 2)

            expect(MockWorkoutList.onCarouselInitialized).not.toHaveBeenCalled()
            expect(MockWorkoutList.onCarouselUpdated).not.toHaveBeenCalled()
            expect(s.logError).toHaveBeenCalledTimes(2)
        })
    })
})
