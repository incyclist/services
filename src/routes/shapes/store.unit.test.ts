import type { Route } from '../base/model/route'
import type { RoutePoint } from '../base/types'
import { RouteShapeStore, ROUTE_SHAPE_VERSION } from './store'

const points = (n: number): Array<RoutePoint> =>
    Array.from({ length: n }, (_, i) => ({
        lat: 46 + i * 0.001, lng: 7 + i * 0.001, routeDistance: i * 10, elevation: 500 + i
    }))

const route = (id: string | undefined, over: Partial<Route> = {}): Route =>
    ({ description: id === undefined ? undefined : { id }, points: points(500), ...over }) as unknown as Route

describe('RouteShapeStore', () => {

    let store: RouteShapeStore
    let repo: { read: jest.Mock, write: jest.Mock, delete: jest.Mock }
    let logged: Array<Error>

    beforeEach(() => {
        repo = {
            read: jest.fn().mockResolvedValue(undefined),
            write: jest.fn().mockResolvedValue(true),
            delete: jest.fn().mockResolvedValue(true)
        }
        logged = []
        store = new RouteShapeStore()
        store.inject('Repo', repo)
        store.logError = (err: Error) => { logged.push(err) }
    })

    afterEach(() => {
        store.reset()
    })

    // ---------------------------------------------------------------- get

    describe('get', () => {
        test('returns undefined for a route with no resident shape', () => {
            expect(store.get('1')).toBeUndefined()
        })

        test('returns undefined for a falsy id', () => {
            expect(store.get('')).toBeUndefined()
        })

        test('never touches the repository', () => {
            store.get('1')
            expect(repo.read).not.toHaveBeenCalled()
        })
    })

    // ---------------------------------------------------------------- saveOnImport

    describe('saveOnImport', () => {
        test('is resident synchronously, before the write to the repository resolves', () => {
            const promise = store.saveOnImport(route('1'))

            expect(store.get('1')).toBeDefined()
            expect(store.get('1')?.[0]).toEqual(expect.objectContaining({ routeDistance: 0 }))
            return promise
        })

        test('writes a versioned record to the repository', async () => {
            await store.saveOnImport(route('1'))

            expect(repo.write).toHaveBeenCalledWith('1', expect.objectContaining({
                id: '1', version: ROUTE_SHAPE_VERSION, points: store.get('1')
            }))
        })

        test('a route without an id is a no-op', async () => {
            await store.saveOnImport(route(undefined))

            expect(repo.write).not.toHaveBeenCalled()
        })

        test('a route without usable points produces no shape and does not write', async () => {
            await store.saveOnImport(route('1', { points: [] } as unknown as Partial<Route>))

            expect(store.get('1')).toBeUndefined()
            expect(repo.write).not.toHaveBeenCalled()
        })

        test('re-importing the same route overwrites its shape', async () => {
            await store.saveOnImport(route('1', { points: points(10) } as unknown as Partial<Route>))
            const first = store.get('1')

            await store.saveOnImport(route('1', { points: points(20) } as unknown as Partial<Route>))
            const second = store.get('1')

            expect(second).not.toBe(first)
            expect(repo.write).toHaveBeenCalledTimes(2)
        })

        test('never rejects, even when the repository write fails', async () => {
            repo.write.mockRejectedValue(new Error('disk full'))

            await expect(store.saveOnImport(route('1'))).resolves.toBeUndefined()

            // the shape is still resident in memory - only the persisted copy is missing
            expect(store.get('1')).toBeDefined()
            expect(logged).toHaveLength(1)
        })
    })

    // ---------------------------------------------------------------- load

    describe('load', () => {
        test('returns undefined for a falsy id without touching the repository', async () => {
            expect(await store.load('')).toBeUndefined()
            expect(repo.read).not.toHaveBeenCalled()
        })

        test('returns the resident shape without reading the repository', async () => {
            await store.saveOnImport(route('1'))
            repo.read.mockClear()

            const shape = await store.load('1')

            expect(shape).toBe(store.get('1'))
            expect(repo.read).not.toHaveBeenCalled()
        })

        test('reads a valid record from the repository and makes it resident', async () => {
            const record = { id: '1', version: ROUTE_SHAPE_VERSION, points: [{ routeDistance: 0, lat: 1, lng: 2 }] }
            repo.read.mockResolvedValue(record)

            const shape = await store.load('1')

            expect(shape).toEqual(record.points)
            expect(store.get('1')).toEqual(record.points)
        })

        test('ignores a record of another decimation version', async () => {
            repo.read.mockResolvedValue({ id: '1', version: ROUTE_SHAPE_VERSION + 1, points: [{ routeDistance: 0 }] })

            expect(await store.load('1')).toBeUndefined()
            expect(store.get('1')).toBeUndefined()
        })

        test('ignores a record with no points', async () => {
            repo.read.mockResolvedValue({ id: '1', version: ROUTE_SHAPE_VERSION, points: [] })

            expect(await store.load('1')).toBeUndefined()
        })

        test('returns undefined when no record exists', async () => {
            expect(await store.load('1')).toBeUndefined()
        })

        test('concurrent calls for the same id share one repository read', async () => {
            let resolveRead: (value: unknown) => void
            repo.read.mockReturnValue(new Promise(resolve => { resolveRead = resolve }))

            const first = store.load('1')
            const second = store.load('1')
            resolveRead!({ id: '1', version: ROUTE_SHAPE_VERSION, points: [{ routeDistance: 0 }] })
            await Promise.all([first, second])

            expect(repo.read).toHaveBeenCalledTimes(1)
        })

        test('a shape that becomes resident while a read is in flight is kept', async () => {
            let resolveRead: (value: unknown) => void
            repo.read.mockReturnValue(new Promise(resolve => { resolveRead = resolve }))

            const pending = store.load('1')
            await store.saveOnImport(route('1', { points: points(3) } as unknown as Partial<Route>))
            const fresher = store.get('1')
            resolveRead!({ id: '1', version: ROUTE_SHAPE_VERSION, points: [{ routeDistance: 999 }] })
            await pending

            expect(store.get('1')).toBe(fresher)
        })

        test('never throws when the repository read fails', async () => {
            repo.read.mockRejectedValue(new Error('offline'))

            await expect(store.load('1')).resolves.toBeUndefined()
            expect(logged).toHaveLength(1)
        })
    })

    // ---------------------------------------------------------------- backfill

    describe('backfill', () => {
        test('a route without an id returns false', async () => {
            expect(await store.backfill(route(undefined))).toBe(false)
            expect(repo.read).not.toHaveBeenCalled()
        })

        test('an already-resident shape returns false without touching the repository', async () => {
            await store.saveOnImport(route('1'))
            repo.read.mockClear()

            expect(await store.backfill(route('1'))).toBe(false)
            expect(repo.read).not.toHaveBeenCalled()
            expect(repo.write).toHaveBeenCalledTimes(1) // only the earlier saveOnImport write
        })

        test('an existing repository record is adopted without recomputing or rewriting', async () => {
            const record = { id: '1', version: ROUTE_SHAPE_VERSION, points: [{ routeDistance: 0 }] }
            repo.read.mockResolvedValue(record)

            expect(await store.backfill(route('1'))).toBe(true)
            expect(store.get('1')).toEqual(record.points)
            expect(repo.write).not.toHaveBeenCalled()
        })

        test('computes and writes a shape when none is stored yet', async () => {
            expect(await store.backfill(route('1'))).toBe(true)

            expect(store.get('1')).toBeDefined()
            expect(repo.write).toHaveBeenCalledWith('1', expect.objectContaining({ id: '1' }))
        })

        test('returns false when the route has no usable points', async () => {
            expect(await store.backfill(route('1', { points: [] } as unknown as Partial<Route>))).toBe(false)
            expect(store.get('1')).toBeUndefined()
        })

        test('a failing repository read falls back to computing from the route\'s own points', async () => {
            repo.read.mockRejectedValue(new Error('offline'))

            expect(await store.backfill(route('1'))).toBe(true)
            expect(store.get('1')).toBeDefined()
            expect(logged).toHaveLength(1) // the failed read is still logged
        })

        test('never throws, and returns false, when neither the repository nor the route has anything to offer', async () => {
            repo.read.mockRejectedValue(new Error('offline'))

            await expect(store.backfill(route('1', { points: [] } as unknown as Partial<Route>))).resolves.toBe(false)
        })
    })

    // ---------------------------------------------------------------- delete

    describe('delete', () => {
        test('removes the shape from memory and the repository', async () => {
            await store.saveOnImport(route('1'))

            await store.delete('1')

            expect(store.get('1')).toBeUndefined()
            expect(repo.delete).toHaveBeenCalledWith('1')
        })

        test('a falsy id is a no-op', async () => {
            await store.delete('')
            expect(repo.delete).not.toHaveBeenCalled()
        })

        test('never throws when the repository delete fails', async () => {
            repo.delete.mockRejectedValue(new Error('locked'))

            await expect(store.delete('1')).resolves.toBeUndefined()
            expect(logged).toHaveLength(1)
        })
    })
})
