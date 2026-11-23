import type { CatalogEntry } from '../types'
import { MAX_MISS_COUNT } from './consts'
import { SharedRouteRepo, toRowKey } from './repo'
import type { SharedRouteJsonRepo } from './repo'

const entry = (routeKey: string, videoHandle = `h-${routeKey}`): CatalogEntry => ({
    routeKey, routeIdOnComputer: `id-${routeKey}`, title: routeKey, videoHandle, videoFormat: 'mp4', size: 10, mtime: 5,
})

describe('SharedRouteRepo', () => {
    let files: Map<string, unknown>
    let json: SharedRouteJsonRepo
    let repo: SharedRouteRepo

    beforeEach(() => {
        files = new Map()
        json = {
            read: jest.fn(async (name: string) => files.get(name) as never),
            write: jest.fn(async (name: string, data: unknown) => { files.set(name, JSON.parse(JSON.stringify(data))); return true }),
            delete: jest.fn(async (name: string) => files.delete(name)),
            list: jest.fn(async () => [...files.keys()]),
        }
        repo = new SharedRouteRepo(json)
    })

    describe('toRowKey', () => {
        test('keeps the key readable and escapes what is not file name safe', () => {
            expect(toRowKey('L1', 'abc-1')).toBe('L1:abc-1')
            expect(toRowKey('L1', 'a/b*c')).toBe('L1:a%2fb%2ac')
        })
    })

    describe('replaceForLink', () => {
        test('keeps the rows of official entries (they are a video source, never a route of the list)', async () => {
            await repo.replaceForLink('A', [{ ...entry('srv-1'), origin: 'official' }], 100)
            expect(repo.getByRouteKey('srv-1')).toHaveLength(1)
        })

        test('writes one row per entry, keyed by link and route', async () => {
            const res = await repo.replaceForLink('A', [entry('x'), entry('y')], 100)
            expect(res).toEqual({ added: 2, removed: 0, kept: 0 })
            expect([...files.keys()].sort()).toEqual(['A:x', 'A:y'])
            expect(repo.getRow('A', 'x')).toMatchObject({ linkId: 'A', routeKey: 'x', lastConfirmedAt: 100, missCount: 0 })
        })

        test('only touches the rows of that computer', async () => {
            await repo.replaceForLink('A', [entry('x')])
            await repo.replaceForLink('B', [entry('y')])
            expect(repo.getForLink('A').map(r => r.routeKey)).toEqual(['x'])
            expect(repo.getForLink('B').map(r => r.routeKey)).toEqual(['y'])
        })

        test('a route missing from the answer counts a miss and survives', async () => {
            await repo.replaceForLink('A', [entry('x')])
            await repo.replaceForLink('A', [])
            expect(repo.getRow('A', 'x')?.missCount).toBe(1)
            expect(files.has('A:x')).toBe(true)
        })

        test('a route is pruned after more than the allowed misses', async () => {
            await repo.replaceForLink('A', [entry('x')])
            for (let i = 0; i < MAX_MISS_COUNT; i++)
                await repo.replaceForLink('A', [])
            expect(repo.getRow('A', 'x')).toBeDefined()
            const res = await repo.replaceForLink('A', [])
            expect(res.removed).toBe(1)
            expect(repo.getRow('A', 'x')).toBeUndefined()
            expect(files.has('A:x')).toBe(false)
        })

        test('a route that comes back resets its misses', async () => {
            await repo.replaceForLink('A', [entry('x')])
            await repo.replaceForLink('A', [])
            await repo.replaceForLink('A', [entry('x', 'new-handle')])
            expect(repo.getRow('A', 'x')).toMatchObject({ missCount: 0, videoHandle: 'new-handle' })
        })
    })

    describe('recordGone', () => {
        test('counts a miss and never deletes', async () => {
            await repo.replaceForLink('A', [entry('x')])
            for (let i = 0; i < MAX_MISS_COUNT + 2; i++)
                await repo.recordGone('A', 'x')
            expect(repo.getRow('A', 'x')?.missCount).toBe(MAX_MISS_COUNT + 2)
            expect(files.has('A:x')).toBe(true)
        })
    })

    describe('forgetLink', () => {
        test('deletes exactly the rows of that computer', async () => {
            await repo.replaceForLink('A', [entry('x')])
            await repo.replaceForLink('B', [entry('x')])
            await repo.forgetLink('A')
            expect(repo.getForLink('A')).toEqual([])
            expect(repo.getForLink('B')).toHaveLength(1)
            expect([...files.keys()]).toEqual(['B:x'])
        })
    })

    describe('load', () => {
        test('restores rows and skips malformed objects', async () => {
            await repo.replaceForLink('A', [entry('x')])
            files.set('junk', { hello: 1 })
            const fresh = new SharedRouteRepo(json)
            await fresh.load()
            expect(fresh.getAll().map(r => `${r.linkId}:${r.routeKey}`)).toEqual(['A:x'])
        })
    })

    describe('getByRouteKey', () => {
        test('returns the rows of every computer that has the route', async () => {
            await repo.replaceForLink('A', [entry('x')])
            await repo.replaceForLink('B', [entry('x'), entry('y')])
            expect(repo.getByRouteKey('x').map(r => r.linkId).sort()).toEqual(['A', 'B'])
        })
    })

    test('the API has no way to write entries without a linkId', () => {
        const names = Object.getOwnPropertyNames(SharedRouteRepo.prototype)
        expect(names).not.toContain('replaceAll')
        expect(names).not.toContain('reconcile')
    })
})
