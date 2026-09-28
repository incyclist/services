import { RouteDetailsQueue } from './detailsQueue'

const deferred = () => {
    let resolve: (v:any)=>void
    let reject: (e:any)=>void
    const promise = new Promise<any>((res,rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

const makeLoader = () => {
    const calls: string[] = []
    const deferredsById = new Map<string, ReturnType<typeof deferred>>()
    return {
        calls,
        load: jest.fn((id:string) => {
            calls.push(id)
            const d = deferred()
            deferredsById.set(id, d)
            return d.promise
        }),
        resolve: (id:string, details:any) => deferredsById.get(id)?.resolve(details),
        reject: (id:string) => deferredsById.get(id)?.reject(new Error('failed')),
    }
}

const settle = async () => { for (let i=0;i<4;i++) await Promise.resolve() }

describe('RouteDetailsQueue', () => {

    let loader: ReturnType<typeof makeLoader>
    let queue: RouteDetailsQueue<any>

    beforeEach(() => {
        loader = makeLoader()
        queue = new RouteDetailsQueue(loader.load, 2)
    })

    test('two requests for the same id share one load and both get the result', async () => {
        const first = jest.fn()
        const second = jest.fn()

        queue.request('route-1', first)
        queue.request('route-1', second)

        expect(loader.load).toHaveBeenCalledTimes(1)
        expect(loader.load).toHaveBeenCalledWith('route-1')

        loader.resolve('route-1', { points: [1] })
        await settle()

        expect(first).toHaveBeenCalledWith({ points: [1] })
        expect(second).toHaveBeenCalledWith({ points: [1] })
    })

    test('does not start more than the concurrency cap at once', () => {
        ;['a','b','c','d','e'].forEach( id => queue.request(id, jest.fn()))

        expect(loader.load).toHaveBeenCalledTimes(2)
        expect(loader.calls).toEqual(['a', 'b'])
    })

    test('a slot freed by a completed job is picked up by the next queued request', async () => {
        queue.request('a', jest.fn())
        queue.request('b', jest.fn())
        queue.request('c', jest.fn())

        expect(loader.calls).toEqual(['a', 'b'])

        loader.resolve('a', { points: [] })
        await settle()

        expect(loader.calls).toEqual(['a', 'b', 'c'])
    })

    test('cancelling a still-queued request removes it from the queue - it never starts', async () => {
        queue.request('a', jest.fn())
        queue.request('b', jest.fn())
        const cancelC = queue.request('c', jest.fn())

        cancelC()

        loader.resolve('a', { points: [] })
        await settle()

        // 'c' was dequeued while waiting - the freed slot is not spent on it
        expect(loader.calls).toEqual(['a', 'b'])
    })

    test('cancelling one of several listeners for the same id leaves the others unaffected', async () => {
        const first = jest.fn()
        const second = jest.fn()

        const cancelFirst = queue.request('route-1', first)
        queue.request('route-1', second)

        cancelFirst()

        loader.resolve('route-1', { points: [1] })
        await settle()

        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledWith({ points: [1] })
    })

    test('cancelling after the job has started does not free a slot early / does not throw', async () => {
        const cancelA = queue.request('a', jest.fn())
        queue.request('b', jest.fn())
        queue.request('c', jest.fn())

        cancelA() // 'a' is already running - cancelling it must not remove it from "active"

        expect(loader.calls).toEqual(['a', 'b'])

        loader.resolve('a', { points: [] })
        await settle()

        expect(loader.calls).toEqual(['a', 'b', 'c'])
    })

    test('an id with no listeners left when its turn comes is skipped without consuming a slot', async () => {
        // cap of 1 so 'b' and 'c' are genuinely still queued (not started) behind 'a'
        const single = new RouteDetailsQueue(loader.load, 1)

        single.request('a', jest.fn())
        const cancelB = single.request('b', jest.fn())
        single.request('c', jest.fn())

        expect(loader.calls).toEqual(['a'])

        cancelB()

        loader.resolve('a', { points: [] })
        await settle()

        expect(loader.calls).toEqual(['a', 'c'])
    })

    test('a failing load reports undefined to its listeners and frees the slot', async () => {
        const listener = jest.fn()
        queue.request('a', listener)
        queue.request('b', jest.fn())
        queue.request('c', jest.fn())

        loader.reject('a')
        await settle()

        expect(listener).toHaveBeenCalledWith(undefined)
        expect(loader.calls).toEqual(['a', 'b', 'c'])
    })

    test('a listener that throws does not stop the others or the queue', async () => {
        const bad = jest.fn(() => { throw new Error('boom') })
        const good = jest.fn()
        queue.request('a', bad)
        queue.request('a', good)

        loader.resolve('a', { points: [1] })
        await settle()

        expect(good).toHaveBeenCalledWith({ points: [1] })
    })

    test('ignores calls with no id, no callback or no loader', () => {
        expect(() => queue.request(undefined, jest.fn())).not.toThrow()
        expect(() => queue.request('x', undefined)).not.toThrow()
        expect(() => new RouteDetailsQueue(undefined).request('x', jest.fn())).not.toThrow()
        expect(loader.load).not.toHaveBeenCalled()
    })
})
