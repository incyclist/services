import { Inject } from '../../../../base/decorators'
import { Observer } from '../../../../base/types'
import { IntervalsCalendarEvent } from '../../../../apps/base/api/intervals/types'
import { IntervalsJsonParser } from '../../../base/parsers/intervals/parser'
import { ZwoParser } from '../../../base/parsers/zwo/zwo'
import { waitNextTick } from '../../../../utils'
import { IntervalsCalendarSyncProvider } from './provider'

jest.mock('../../../base/parsers/intervals/parser')
jest.mock('../../../base/parsers/zwo/zwo')
jest.mock('../../../../utils', () => ({
    ...jest.requireActual('../../../../utils'),
    getFirstDayOfCurrentWeek: jest.fn().mockReturnValue(new Date('2024-01-01')),
}))

const MockJsonParser = IntervalsJsonParser as jest.MockedClass<typeof IntervalsJsonParser>
const MockZwoParser = ZwoParser as jest.MockedClass<typeof ZwoParser>

const mockWorkout = { name: 'Test', steps: [] }

const makeEvent = (overrides: Partial<IntervalsCalendarEvent> = {}): IntervalsCalendarEvent => ({
    id: 1,
    plan_name: 'Plan',
    name: 'Test Workout',
    icu_training_load: 100,
    start_date_local: '2024-01-15T00:00:00',
    end_date_local: '2024-01-15T01:00:00',
    type: 'Ride',
    calendar_id: 1,
    uid: 'uid-1',
    athlete_id: 'athlete-1',
    description: '',
    indoor: true,
    moving_time: 3600,
    icu_ftp: 200,
    atl_days: 7,
    ctl_days: 42,
    updated: '2024-01-10T10:00:00Z',
    for_week: false,
    workout_doc: {} as any,
    workout_filename: 'test.zwo',
    workout_file_base64: Buffer.from('<workout_file/>').toString('base64'),
    ...overrides,
})

/**
 * Registers a one-time listener and returns a promise that resolves with the
 * event arguments when the event fires.
 *
 * NOTE: only use this helper for events that fire **after** an `await` point
 * inside `loadWorkouts` (i.e. after `getCalendarWorkouts` or `waitNextTick`),
 * otherwise the event fires synchronously inside `sync()` before this listener
 * can be registered.
 */
const waitForEvent = (observer: Observer, event: string): Promise<any[]> =>
    new Promise(resolve => observer.once(event, (...args) => resolve(args)))

describe('IntervalsCalendarSyncProvider', () => {
    let provider: IntervalsCalendarSyncProvider

    const mockApi = {
        isAuthenticated: jest.fn(),
        getCalendarWorkouts: jest.fn(),
    }

    const mockConnection = {
        isConnected: jest.fn(),
        getApi: jest.fn().mockReturnValue(mockApi),
    }

    const mockAppsService = {
        isEnabled: jest.fn(),
    }

    const setupMocks = () => {
        Inject('IntervalsApi', mockApi)
        Inject('IntervalsAppConnection', mockConnection)
        Inject('AppsService', mockAppsService)
    }

    const resetMocks = () => {
        Inject('IntervalsApi', null)
        Inject('IntervalsAppConnection', null)
        Inject('AppsService', null)
    }

    /** Shared setup for tests that go through the full async API path. */
    const setupConnectedEnabled = () => {
        mockApi.isAuthenticated.mockReturnValue(true)
        mockAppsService.isEnabled.mockReturnValue(true)
        mockApi.getCalendarWorkouts.mockResolvedValue([])
    }

    beforeEach(() => {
        provider = new IntervalsCalendarSyncProvider()
        setupMocks()

        MockJsonParser.prototype.fromJSON = jest.fn().mockReturnValue(mockWorkout)
        MockZwoParser.prototype.fromStr = jest.fn().mockResolvedValue(mockWorkout)

        mockApi.isAuthenticated.mockReturnValue(false)
        mockConnection.isConnected.mockReturnValue(false)
        mockAppsService.isEnabled.mockReturnValue(true)
        mockApi.getCalendarWorkouts.mockResolvedValue([])
    })

    afterEach(() => {
        resetMocks()
        jest.clearAllMocks()
    })

    // ─── sync() ────────────────────────────────────────────────────────────────

    describe('sync()', () => {
        test('returns an Observer instance', () => {
            const obs = provider.sync()
            expect(obs).toBeInstanceOf(Observer)
        })

        test('returns the same observer when a sync is already in progress', () => {
            // Use a never-resolving promise so loadWorkouts never finishes
            mockApi.isAuthenticated.mockReturnValue(true)
            mockAppsService.isEnabled.mockReturnValue(true)
            mockApi.getCalendarWorkouts.mockReturnValue(new Promise(() => { /* pending */ }))

            const obs1 = provider.sync()
            const obs2 = provider.sync()

            expect(obs1).toBe(obs2)
        })

        test('clears the active observer after completion so a new sync can start', async () => {
            setupConnectedEnabled()

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()   // let onDone's cleanup tick fire

            const obs2 = provider.sync()
            expect(obs2).not.toBe(obs1)
            await waitForEvent(obs2, 'done')
        })

        test('emitting stop on the returned observer sets stopRequested', () => {
            // Use a never-resolving promise to keep the sync in-flight
            mockApi.isAuthenticated.mockReturnValue(true)
            mockAppsService.isEnabled.mockReturnValue(true)
            mockApi.getCalendarWorkouts.mockReturnValue(new Promise(() => { /* pending */ }))

            const obs = provider.sync()
            obs.emit('stop')

            expect((provider as any).stopRequested).toBe(true)
        })

        test('emits loaded/done after the API call resolves when stop was requested mid-flight', async () => {
            // Verifies that the factory's stopSync can resolve: loadWorkouts must
            // emit loaded/done after each await point when stopRequested is true,
            // otherwise factory.stopSync would wait forever for a completion event.
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([])

            const obs = provider.sync()
            obs.emit('stop')

            // Despite stop being requested, the provider must still emit
            // the completion event once the in-flight await resolves.
            const [workouts, source] = await waitForEvent(obs, 'loaded')
            expect(workouts).toEqual([])
            expect(source).toBe('intervals')
        })
    })

    // ─── isConnected() ─────────────────────────────────────────────────────────

    describe('isConnected()', () => {
        test('returns true when the API token is valid', () => {
            mockApi.isAuthenticated.mockReturnValue(true)

            expect(provider.isConnected()).toBe(true)
        })

        test('returns true when the app-connection reports connected', () => {
            mockApi.isAuthenticated.mockReturnValue(false)
            mockConnection.isConnected.mockReturnValue(true)

            expect(provider.isConnected()).toBe(true)
        })

        test('returns false when neither authenticated nor connected', () => {
            mockApi.isAuthenticated.mockReturnValue(false)
            mockConnection.isConnected.mockReturnValue(false)

            expect(provider.isConnected()).toBe(false)
        })

        test('returns false when an internal error is thrown', () => {
            mockApi.isAuthenticated.mockImplementation(() => { throw new Error('auth error') })

            expect(provider.isConnected()).toBe(false)
        })
    })

    // ─── reset() ───────────────────────────────────────────────────────────────

    describe('reset()', () => {
        test('clears workouts and resets lastSyncTS to zero', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent()])

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect((provider as any).workouts).toHaveLength(1)
            expect((provider as any).lastSyncTS).toBeGreaterThan(0)

            provider.reset()

            expect((provider as any).lastSyncTS).toBe(0)
            expect((provider as any).workouts).toEqual([])
        })

        test('can be called on a fresh provider without throwing', () => {
            expect(() => provider.reset()).not.toThrow()
            expect((provider as any).lastSyncTS).toBe(0)
            expect((provider as any).workouts).toEqual([])
        })
    })

    // ─── loadWorkouts() ────────────────────────────────────────────────────────
    //
    // The "not connected" path emits the event synchronously (no await before
    // the emit), so we spy on Observer.prototype.emit before calling sync()
    // to capture the call.  All other paths have an await before emitting, so
    // waitForEvent is safe to use.

    describe('loadWorkouts() — via sync()', () => {
        test('emits loaded with empty array when not connected', () => {
            mockApi.isAuthenticated.mockReturnValue(false)
            mockConnection.isConnected.mockReturnValue(false)

            // Spy before sync() so we capture the synchronous emit
            const emitSpy = jest.spyOn(Observer.prototype, 'emit')
            provider.sync()

            expect(emitSpy).toHaveBeenCalledWith('loaded', [], 'intervals')
            emitSpy.mockRestore()
        })

        test('does not call getCalendarWorkouts when not connected', () => {
            mockApi.isAuthenticated.mockReturnValue(false)
            mockConnection.isConnected.mockReturnValue(false)

            provider.sync()

            expect(mockApi.getCalendarWorkouts).not.toHaveBeenCalled()
        })

        test('emits loaded with empty array when WorkoutDownload is disabled', async () => {
            // isConnected must be true so we reach the isEnabled check
            mockApi.isAuthenticated.mockReturnValue(true)
            mockAppsService.isEnabled.mockReturnValue(false)

            // This path does "await waitNextTick()" before emitting, so waitForEvent is safe
            const obs = provider.sync()
            const [workouts, source] = await waitForEvent(obs, 'loaded')

            expect(workouts).toEqual([])
            expect(source).toBe('intervals')
            expect(mockAppsService.isEnabled).toHaveBeenCalledWith('intervals', 'WorkoutDownload')
        })

        test('does not call getCalendarWorkouts when WorkoutDownload is disabled', async () => {
            mockApi.isAuthenticated.mockReturnValue(true)
            mockAppsService.isEnabled.mockReturnValue(false)

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect(mockApi.getCalendarWorkouts).not.toHaveBeenCalled()
        })

        test('uses getFirstDayOfCurrentWeek as the oldest query date', async () => {
            setupConnectedEnabled()

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect(mockApi.getCalendarWorkouts).toHaveBeenCalledWith({
                oldest: new Date('2024-01-01'),
                days: 30,
                ext: 'zwo',
            })
        })

        test('emits loaded with parsed Ride workouts on the first sync', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ type: 'Ride' })])

            const obs = provider.sync()
            const [workouts, source] = await waitForEvent(obs, 'loaded')

            expect(workouts).toHaveLength(1)
            expect(source).toBe('intervals')
        })

        test('filters out non-Ride events', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([
                makeEvent({ id: 1, type: 'Ride' }),
                makeEvent({ id: 2, type: 'Run' }),
                makeEvent({ id: 3, type: 'Swim' }),
            ])

            const obs = provider.sync()
            const [workouts] = await waitForEvent(obs, 'loaded')

            expect(workouts).toHaveLength(1)
        })

        test('handles null return from getCalendarWorkouts gracefully', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue(null)

            const obs = provider.sync()
            const [workouts] = await waitForEvent(obs, 'loaded')

            expect(workouts).toEqual([])
        })

        test('emits done instead of loaded on subsequent syncs', async () => {
            setupConnectedEnabled()

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            const obs2 = provider.sync()
            const loadedFired = jest.fn()
            obs2.once('loaded', loadedFired)
            await waitForEvent(obs2, 'done')

            expect(loadedFired).not.toHaveBeenCalled()
        })

        test('emits loaded with empty array on API error', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockRejectedValue(new Error('network error'))

            const obs = provider.sync()
            // The rejected await creates an async boundary — waitForEvent is safe here
            const [workouts, source] = await waitForEvent(obs, 'loaded')

            expect(workouts).toEqual([])
            expect(source).toBe('intervals')
        })

        test('updates lastSyncTS after a successful sync', async () => {
            setupConnectedEnabled()

            const before = Date.now()
            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect((provider as any).lastSyncTS).toBeGreaterThanOrEqual(before)
        })
    })

    // ─── parseWorkouts() ───────────────────────────────────────────────────────

    describe('parseWorkouts() — via sync()', () => {
        test('parses events using the JSON parser', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent()])

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect(MockJsonParser.prototype.fromJSON).toHaveBeenCalledWith(
                expect.anything(),
                'Test Workout',
            )
        })

        test('falls back to ZWO parser when JSON parsing throws', async () => {
            MockJsonParser.prototype.fromJSON = jest.fn().mockImplementation(() => {
                throw new Error('json parse error')
            })
            MockZwoParser.prototype.fromStr = jest.fn().mockResolvedValue(mockWorkout)

            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent()])

            const obs = provider.sync()
            const [workouts] = await waitForEvent(obs, 'loaded')

            expect(MockZwoParser.prototype.fromStr).toHaveBeenCalled()
            expect(workouts).toHaveLength(1)
        })

        test('skips a workout when both parsers fail', async () => {
            MockJsonParser.prototype.fromJSON = jest.fn().mockImplementation(() => {
                throw new Error('json error')
            })
            MockZwoParser.prototype.fromStr = jest.fn().mockRejectedValue(new Error('zwo error'))

            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent()])

            const obs = provider.sync()
            const [workouts] = await waitForEvent(obs, 'loaded')

            expect(workouts).toHaveLength(0)
        })

        test('stores workoutId as the event id converted to a string', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 42 })])

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect((provider as any).workouts[0].workoutId).toBe('42')
        })

        test('sets the day field from start_date_local', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([
                makeEvent({ start_date_local: '2024-03-15T00:00:00' }),
            ])

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect((provider as any).workouts[0].day).toEqual(new Date('2024-03-15T00:00:00'))
        })

        test('emits added for new workouts on a subsequent sync', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1 })])

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            mockApi.getCalendarWorkouts.mockResolvedValue([
                makeEvent({ id: 1 }),
                makeEvent({ id: 99, name: 'Brand New' }),
            ])

            const obs2 = provider.sync()
            const addedEvents: any[][] = []
            obs2.on('added', (...args: any[]) => addedEvents.push(args))
            await waitForEvent(obs2, 'done')

            expect(addedEvents).toHaveLength(1)
            expect(addedEvents[0][0].workoutId).toBe('99')
            expect(addedEvents[0][1]).toBe('intervals')
        })

        test('emits updated for workouts modified after the last sync', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1 })])

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            const futureDate = new Date(Date.now() + 3_600_000).toISOString()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1, updated: futureDate })])

            const obs2 = provider.sync()
            const updatedEvents: any[][] = []
            obs2.on('updated', (...args: any[]) => updatedEvents.push(args))
            await waitForEvent(obs2, 'done')

            expect(updatedEvents).toHaveLength(1)
            expect(updatedEvents[0][0].workoutId).toBe('1')
            expect(updatedEvents[0][1]).toBe('intervals')
        })

        test('does not emit updated when the workout timestamp has not changed', async () => {
            setupConnectedEnabled()
            const PAST = '2020-01-01T00:00:00Z'
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1, updated: PAST })])

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1, updated: PAST })])

            const obs2 = provider.sync()
            const updatedFired = jest.fn()
            obs2.on('updated', updatedFired)
            await waitForEvent(obs2, 'done')

            expect(updatedFired).not.toHaveBeenCalled()
        })

        test('emits deleted for workouts absent from a subsequent sync', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([
                makeEvent({ id: 1 }),
                makeEvent({ id: 2, name: 'To Be Deleted' }),
            ])

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1 })])

            const obs2 = provider.sync()
            const deletedEvents: any[][] = []
            obs2.on('deleted', (...args: any[]) => deletedEvents.push(args))
            await waitForEvent(obs2, 'done')

            expect(deletedEvents).toHaveLength(1)
            expect(deletedEvents[0][0].workoutId).toBe('2')
            expect(deletedEvents[0][1]).toBe('intervals')
        })

        test('removes deleted workouts from the internal cache', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([
                makeEvent({ id: 1 }),
                makeEvent({ id: 2, name: 'Temp' }),
            ])

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            expect((provider as any).workouts).toHaveLength(2)

            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1 })])

            const obs2 = provider.sync()
            await waitForEvent(obs2, 'done')

            expect((provider as any).workouts).toHaveLength(1)
            expect((provider as any).workouts[0].workoutId).toBe('1')
        })

        test('replaces an existing workout in cache rather than duplicating it', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1 })])

            const obs1 = provider.sync()
            await waitForEvent(obs1, 'loaded')
            await waitNextTick()

            const futureDate = new Date(Date.now() + 3_600_000).toISOString()
            mockApi.getCalendarWorkouts.mockResolvedValue([makeEvent({ id: 1, updated: futureDate })])

            const obs2 = provider.sync()
            await waitForEvent(obs2, 'done')

            expect((provider as any).workouts).toHaveLength(1)
        })

        test('processes multiple events concurrently', async () => {
            setupConnectedEnabled()
            mockApi.getCalendarWorkouts.mockResolvedValue([
                makeEvent({ id: 1 }),
                makeEvent({ id: 2, name: 'Second' }),
                makeEvent({ id: 3, name: 'Third' }),
            ])

            const obs = provider.sync()
            await waitForEvent(obs, 'loaded')

            expect((provider as any).workouts).toHaveLength(3)
        })
    })
})
