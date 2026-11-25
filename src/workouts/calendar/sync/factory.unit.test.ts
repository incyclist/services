import { Observer } from '../../../base/types'
import { WorkoutSyncFactory } from './factory'

describe('WorkoutSyncFactory', () => {

    const entry = (id: string) => ({ day: new Date(), updated: new Date(), workoutId: id })

    /** provider that emits the given event asynchronously, after the given delay */
    const createProvider = (event: string, entries: Array<any>, service: string, delay: number) => ({
        isConnected: () => true,
        reset: jest.fn(),
        sync: () => {
            const so = new Observer()
            setTimeout(() => { so.emit(event, entries, service) }, delay)
            return so
        }
    })

    const run = (factory: WorkoutSyncFactory) => new Promise<{ event: string, args: Array<any> }>(done => {
        const observer = factory.sync()
        observer.once('loaded', (...args) => done({ event: 'loaded', args }))
        observer.once('done', (...args) => done({ event: 'done', args }))
    })

    const setup = (providers: Record<string, any>) => {
        const factory = new WorkoutSyncFactory()
        Object.keys(providers).forEach(s => factory.add(s, providers[s]))
        return factory
    }

    afterEach(() => {
        const factory = new WorkoutSyncFactory() as any
        factory.syncProviders = []
    })

    test('delivers the entries of all providers that finished their first sync', async () => {
        const factory = setup({
            first: createProvider('loaded', [entry('a')], 'first', 5),
            last: createProvider('loaded', [entry('b'), entry('c')], 'last', 30)
        })

        const res = await run(factory)

        expect(res.event).toBe('loaded')
        const [entries, services] = res.args
        expect(entries.map(e => `${e.source}:${e.workoutId}`).sort()).toEqual(['first:a', 'last:b', 'last:c'])
        expect(services.sort()).toEqual(['first', 'last'])
    })

    test('does not lose the first sync of a provider if another provider finishes later with an incremental sync', async () => {
        const factory = setup({
            first: createProvider('loaded', [entry('a')], 'first', 5),
            last: createProvider('done', [], 'last', 30)
        })

        const res = await run(factory)

        expect(res.event).toBe('loaded')
        const [entries, services] = res.args
        expect(entries.map(e => e.workoutId)).toEqual(['a'])
        expect(services).toEqual(['first'])
    })

    test('emits done if no provider delivered a full list', async () => {
        const factory = setup({
            first: createProvider('done', [], 'first', 5),
            last: createProvider('done', [], 'last', 10)
        })

        const res = await run(factory)
        expect(res.event).toBe('done')
    })
})
