import { Observer } from '../../../base/types'
import { waitNextTick } from '../../../utils'
import { WorkoutCalendarEntry } from '../types'
import { IWorkoutSyncProvider } from './types'
import { WorkoutSyncFactory } from './factory'

// Importing WorkoutSyncFactory transitively loads intervals/provider.ts, which
// registers an 'intervals' entry in the singleton at module-load time.
// Each test resets the singleton in beforeEach to get a clean factory.

const waitForEvent = (observer: Observer, event: string): Promise<any[]> =>
    new Promise(resolve => observer.once(event, (...args) => resolve(args)))

const makeEntry = (overrides: Partial<WorkoutCalendarEntry> = {}): WorkoutCalendarEntry => ({
    day: new Date('2024-03-01'),
    updated: new Date('2024-03-01'),
    workoutId: '1',
    ...overrides,
})

interface MockProvider {
    provider: IWorkoutSyncProvider
    observer: Observer
}

const makeProvider = (connected: boolean): MockProvider => {
    const observer = new Observer()
    const provider: IWorkoutSyncProvider = {
        isConnected: jest.fn().mockReturnValue(connected),
        sync: jest.fn().mockReturnValue(observer),
        reset: jest.fn(),
    }
    return { provider, observer }
}

describe('WorkoutSyncFactory', () => {
    let factory: WorkoutSyncFactory

    beforeEach(() => {
        // Reset any existing singleton (including the intervals provider registered
        // at module load time) so every test starts with an empty factory.
        ;(new WorkoutSyncFactory() as any).reset()
        factory = new WorkoutSyncFactory()
    })

    afterEach(() => {
        ;(factory as any).reset()
    })

    // ─── add() ─────────────────────────────────────────────────────────────────

    describe('add()', () => {
        test('registers a new provider', () => {
            const { provider } = makeProvider(false)
            factory.add('svc', provider)

            expect(factory.get('svc')).toBe(provider)
        })

        test('replaces an existing provider registered under the same service name', () => {
            const { provider: p1 } = makeProvider(false)
            const { provider: p2 } = makeProvider(false)

            factory.add('svc', p1)
            factory.add('svc', p2)

            expect(factory.get('svc')).toBe(p2)
        })

        test('keeps other services unaffected when replacing one', () => {
            const { provider: p1 } = makeProvider(false)
            const { provider: p2 } = makeProvider(false)
            const { provider: p3 } = makeProvider(false)

            factory.add('svc1', p1)
            factory.add('svc2', p2)
            factory.add('svc1', p3)

            expect(factory.get('svc1')).toBe(p3)
            expect(factory.get('svc2')).toBe(p2)
        })
    })

    // ─── get() ─────────────────────────────────────────────────────────────────

    describe('get()', () => {
        test('returns the registered provider for a known service', () => {
            const { provider } = makeProvider(false)
            factory.add('svc', provider)

            expect(factory.get('svc')).toBe(provider)
        })

        test('returns null for an unknown service', () => {
            expect(factory.get('unknown')).toBeNull()
        })
    })

    // ─── sync() ────────────────────────────────────────────────────────────────

    describe('sync()', () => {
        test('returns null when no providers are registered', () => {
            expect(factory.sync()).toBeNull()
        })

        test('returns null when the only registered provider is disconnected', () => {
            const { provider } = makeProvider(false)
            factory.add('svc', provider)

            expect(factory.sync()).toBeNull()
        })

        test('returns null when the specified service has no connected provider', () => {
            const { provider: connected } = makeProvider(true)
            const { provider: disconnected } = makeProvider(false)
            factory.add('svc-a', connected)
            factory.add('svc-b', disconnected)

            expect(factory.sync('svc-b')).toBeNull()
        })

        test('returns an Observer when at least one provider is connected', () => {
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            const obs = factory.sync()

            expect(obs).toBeInstanceOf(Observer)
            // clean up — prevent dangling promise
            sub.emit('loaded', [], 'svc')
        })

        test('calls sync() on the connected provider', () => {
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            factory.sync()

            expect(provider.sync).toHaveBeenCalled()
            sub.emit('loaded', [], 'svc')
        })

        test('skips disconnected providers when some are connected', () => {
            const { provider: connected, observer: sub } = makeProvider(true)
            const { provider: disconnected } = makeProvider(false)
            factory.add('svc-a', connected)
            factory.add('svc-b', disconnected)

            factory.sync()

            expect(connected.sync).toHaveBeenCalled()
            expect(disconnected.sync).not.toHaveBeenCalled()
            sub.emit('loaded', [], 'svc-a')
        })

        test('emits loaded with merged workouts after a first-sync loaded event', async () => {
            const entry = makeEntry({ workoutId: '42' })
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            const obs = factory.sync()
            const loadedPromise = waitForEvent(obs, 'loaded')

            sub.emit('loaded', [entry], 'svc')

            const [workouts] = await loadedPromise
            expect(workouts).toHaveLength(1)
            expect(workouts[0].workoutId).toBe('42')
        })

        test('adds source field to every workout using the registered service name', async () => {
            const { provider, observer: sub } = makeProvider(true)
            factory.add('my-svc', provider)

            const obs = factory.sync()
            const loadedPromise = waitForEvent(obs, 'loaded')

            sub.emit('loaded', [makeEntry()], 'my-svc')

            const [workouts] = await loadedPromise
            expect(workouts[0].source).toBe('my-svc')
        })

        test('emits done (no workouts) after a subsequent-sync done event', async () => {
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            const obs = factory.sync()
            const loadedFired = jest.fn()
            obs.once('loaded', loadedFired)
            const donePromise = waitForEvent(obs, 'done')

            sub.emit('done', [], 'svc')

            await donePromise
            expect(loadedFired).not.toHaveBeenCalled()
        })

        test('relays added events from the sub-observer with the service name', async () => {
            const entry = makeEntry({ workoutId: 'new' })
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            const obs = factory.sync()
            const addedPromise = waitForEvent(obs, 'added')

            sub.emit('added', entry)
            sub.emit('loaded', [], 'svc')

            const [workout, service] = await addedPromise
            expect(workout.workoutId).toBe('new')
            expect(service).toBe('svc')
        })

        test('relays updated events from the sub-observer with the service name', async () => {
            const entry = makeEntry({ workoutId: 'upd' })
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            const obs = factory.sync()
            const updatedPromise = waitForEvent(obs, 'updated')

            sub.emit('updated', entry)
            sub.emit('loaded', [], 'svc')

            const [workout, service] = await updatedPromise
            expect(workout.workoutId).toBe('upd')
            expect(service).toBe('svc')
        })

        test('relays deleted events from the sub-observer with the service name', async () => {
            const entry = makeEntry({ workoutId: 'del' })
            const { provider, observer: sub } = makeProvider(true)
            factory.add('svc', provider)

            const obs = factory.sync()
            const deletedPromise = waitForEvent(obs, 'deleted')

            sub.emit('deleted', entry)
            sub.emit('loaded', [], 'svc')

            const [workout, service] = await deletedPromise
            expect(workout.workoutId).toBe('del')
            expect(service).toBe('svc')
        })

        test('waits for all providers before emitting loaded', async () => {
            const { provider: p1, observer: sub1 } = makeProvider(true)
            const { provider: p2, observer: sub2 } = makeProvider(true)
            factory.add('svc1', p1)
            factory.add('svc2', p2)

            const obs = factory.sync()
            const loadedFired = jest.fn()
            obs.once('loaded', loadedFired)

            // Only first provider finishes — factory should not emit yet
            sub1.emit('loaded', [makeEntry({ workoutId: 'a' })], 'svc1')
            await waitNextTick()
            expect(loadedFired).not.toHaveBeenCalled()

            // Second provider finishes — factory emits loaded with that provider's workouts
            const loadedPromise = waitForEvent(obs, 'loaded')
            sub2.emit('loaded', [makeEntry({ workoutId: 'b' })], 'svc2')

            const [workouts] = await loadedPromise
            // Each provider's onDone closure has its own workouts array; only the
            // workouts gathered in the closure that fires last are emitted.
            expect(workouts).toHaveLength(1)
            expect(workouts[0].workoutId).toBe('b')
        })

        test('emits done only after all providers emit done', async () => {
            const { provider: p1, observer: sub1 } = makeProvider(true)
            const { provider: p2, observer: sub2 } = makeProvider(true)
            factory.add('svc1', p1)
            factory.add('svc2', p2)

            const obs = factory.sync()
            const doneFired = jest.fn()
            obs.once('done', doneFired)

            sub1.emit('done', [], 'svc1')
            await waitNextTick()
            expect(doneFired).not.toHaveBeenCalled()

            const donePromise = waitForEvent(obs, 'done')
            sub2.emit('done', [], 'svc2')
            await donePromise

            expect(doneFired).toHaveBeenCalled()
        })

        test('restricts sync to the specified service when service arg is provided', () => {
            const { provider: p1, observer: sub1 } = makeProvider(true)
            const { provider: p2 } = makeProvider(true)
            factory.add('svc1', p1)
            factory.add('svc2', p2)

            factory.sync('svc1')

            expect(p1.sync).toHaveBeenCalled()
            expect(p2.sync).not.toHaveBeenCalled()
            sub1.emit('loaded', [], 'svc1')
        })

        test('propagates stop to all in-flight sub-observers', async () => {
            const { provider: p1, observer: sub1 } = makeProvider(true)
            const { provider: p2, observer: sub2 } = makeProvider(true)
            factory.add('svc1', p1)
            factory.add('svc2', p2)

            const obs = factory.sync()

            const stop1 = jest.fn()
            const stop2 = jest.fn()
            sub1.on('stop', stop1)
            sub2.on('stop', stop2)

            obs.emit('stop')

            expect(stop1).toHaveBeenCalled()
            expect(stop2).toHaveBeenCalled()
        })

        test('does not propagate stop to sub-observers that have already completed', async () => {
            const { provider: p1, observer: sub1 } = makeProvider(true)
            const { provider: p2, observer: sub2 } = makeProvider(true)
            factory.add('svc1', p1)
            factory.add('svc2', p2)

            const obs = factory.sync()

            // svc1 completes before stop is emitted
            sub1.emit('loaded', [], 'svc1')
            await waitNextTick()

            const stop1 = jest.fn()
            const stop2 = jest.fn()
            sub1.on('stop', stop1)
            sub2.on('stop', stop2)

            obs.emit('stop')

            expect(stop1).not.toHaveBeenCalled()
            expect(stop2).toHaveBeenCalled()
        })
    })

    // ─── stopSync() ────────────────────────────────────────────────────────────

    describe('stopSync()', () => {
        test('emits stop on the given observer', async () => {
            const obs = new Observer()
            const stopFired = jest.fn()

            // 'done' must be emitted asynchronously so that stopSync can register
            // its own 'done' listener before it fires (stopSync emits 'stop' first,
            // then registers the 'done' listener — a synchronous 'done' in the stop
            // handler would be missed).
            obs.on('stop', () => {
                stopFired()
                waitNextTick().then(() => obs.emit('done'))
            })

            await factory.stopSync(obs)

            expect(stopFired).toHaveBeenCalled()
        })

        test('resolves only after the observer emits done', async () => {
            const obs = new Observer()
            let resolved = false

            obs.on('stop', async () => {
                await waitNextTick()
                obs.emit('done')
            })

            const promise = factory.stopSync(obs).then(() => { resolved = true })

            // Not resolved yet (done hasn't fired)
            expect(resolved).toBe(false)

            await promise
            expect(resolved).toBe(true)
        })
    })
})
