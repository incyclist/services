import { isRoundabout, concatPaths } from './utils'
import { IncyclistWay, IncyclistNode } from './types'

describe('MapArea utils', () => {

    describe('concatPaths', () => {

        const createNode = (id: string, lat: number = 0, lng: number = 0): IncyclistNode => ({
            id,
            lat,
            lng,
            ways: []
        })

        const buildNodes = (count: number, prefix: string): IncyclistNode[] =>
            Array.from({ length: count }, (_, i) => createNode(`${prefix}${i}`, i, i))

        test('after: appends path2 (minus its first/shared node) to the end of path, in order', () => {
            const path = [createNode('a0'), createNode('a1'), createNode('shared')]
            const path2 = [createNode('shared'), createNode('b1'), createNode('b2')]

            concatPaths(path, path2, 'after')

            expect(path.map(p => p.id)).toEqual(['a0', 'a1', 'shared', 'b1', 'b2'])
        })

        test('after: sets wayId on the appended nodes when provided', () => {
            const path = [createNode('a0'), createNode('shared')]
            const path2 = [createNode('shared'), createNode('b1')]

            concatPaths(path, path2, 'after', 'way-123')

            expect(path.find(p => p.id === 'b1').wayId).toBe('way-123')
            // node that already existed in `path` is untouched
            expect(path.find(p => p.id === 'a0').wayId).toBeUndefined()
        })

        test('after: does not mutate path2 (copies by value)', () => {
            const path = [createNode('a0'), createNode('shared')]
            const path2 = [createNode('shared'), createNode('b1')]
            const path2Snapshot = path2.map(p => ({ ...p }))

            concatPaths(path, path2, 'after', 'way-123')

            expect(path2).toEqual(path2Snapshot)
        })

        test('before: removes the first node of path and inserts the entirety of path2 ahead of the remainder', () => {
            // position==='before' drops the *first* element of `path` (the shared/duplicate node,
            // expected to be the last element of path2), then prepends ALL of path2 (unlike the
            // 'after' branch, which drops the first element of path2 instead).
            const path = [createNode('shared'), createNode('a1'), createNode('a2')]
            const path2 = [createNode('b0'), createNode('b1'), createNode('shared')]

            concatPaths(path, path2, 'before')

            expect(path.map(p => p.id)).toEqual(['b0', 'b1', 'shared', 'a1', 'a2'])
        })

        test('before: sets wayId on all inserted nodes when provided', () => {
            const path = [createNode('shared'), createNode('a1')]
            const path2 = [createNode('b0'), createNode('shared')]

            concatPaths(path, path2, 'before', 'way-456')

            expect(path.find(p => p.id === 'b0').wayId).toBe('way-456')
            expect(path.filter(p => p.id === 'shared')[0].wayId).toBe('way-456')
            expect(path.find(p => p.id === 'a1').wayId).toBeUndefined()
        })

        test('before: does not mutate path2 (copies by value)', () => {
            const path = [createNode('shared'), createNode('a1')]
            const path2 = [createNode('b0'), createNode('shared')]
            const path2Snapshot = path2.map(p => ({ ...p }))

            concatPaths(path, path2, 'before', 'way-456')

            expect(path2).toEqual(path2Snapshot)
        })

        test('after: handles very large path2 without a RangeError (stack overflow) and preserves order', () => {
            const SIZE = 50000
            const path = [createNode('a0'), createNode('shared')]
            const path2 = [createNode('shared'), ...buildNodes(SIZE, 'b')]

            expect(() => concatPaths(path, path2, 'after')).not.toThrow()

            expect(path.length).toBe(2 + SIZE)
            expect(path[0].id).toBe('a0')
            expect(path[1].id).toBe('shared')
            expect(path[2].id).toBe('b0')
            expect(path[path.length - 1].id).toBe(`b${SIZE - 1}`)
        })

        test('before: handles very large path2 without a RangeError (stack overflow) and preserves order', () => {
            const SIZE = 50000
            const path = [createNode('shared'), createNode('a1')]
            const path2 = [...buildNodes(SIZE, 'b'), createNode('shared')]

            expect(() => concatPaths(path, path2, 'before')).not.toThrow()

            expect(path.length).toBe(SIZE + 1 + 1)
            expect(path[0].id).toBe('b0')
            expect(path[SIZE - 1].id).toBe(`b${SIZE - 1}`)
            expect(path[SIZE].id).toBe('shared')
            expect(path[SIZE + 1].id).toBe('a1')
        })

        test('after: handles very large existing path without a RangeError (stack overflow)', () => {
            const SIZE = 50000
            const path = [...buildNodes(SIZE, 'a'), createNode('shared')]
            const path2 = [createNode('shared'), createNode('b1'), createNode('b2')]

            expect(() => concatPaths(path, path2, 'after')).not.toThrow()

            expect(path.length).toBe(SIZE + 1 + 2)
            expect(path[0].id).toBe('a0')
            expect(path[SIZE - 1].id).toBe(`a${SIZE - 1}`)
            expect(path[SIZE].id).toBe('shared')
            expect(path[SIZE + 1].id).toBe('b1')
            expect(path[SIZE + 2].id).toBe('b2')
        })

        test('before: handles very large existing path without a RangeError (stack overflow)', () => {
            const SIZE = 50000
            const path = [createNode('shared'), ...buildNodes(SIZE, 'a')]
            const path2 = [createNode('b1'), createNode('b2'), createNode('shared')]

            expect(() => concatPaths(path, path2, 'before')).not.toThrow()

            expect(path.length).toBe(3 + SIZE)
            expect(path[0].id).toBe('b1')
            expect(path[1].id).toBe('b2')
            expect(path[2].id).toBe('shared')
            expect(path[3].id).toBe('a0')
            expect(path[path.length - 1].id).toBe(`a${SIZE - 1}`)
        })

    })

    describe('isRoundabout', () => {

        const createNode = (id: string, lat: number = 0, lng: number = 0): IncyclistNode => ({
            id,
            lat,
            lng,
            ways: []
        })

        const createWay = (id: string, tags?: any, path?: IncyclistNode[]): IncyclistWay => ({
            id,
            tags,
            path: path || [],
            type: 'way',
            name: undefined,
            bounds: undefined
        })

        describe('explicit tag checks', () => {

            test('roundabout=true tag', () => {
                const way = createWay('123', { roundabout: true })
                expect(isRoundabout(way)).toBe(true)
            })

            test('junction=roundabout tag', () => {
                const way = createWay('123', { junction: 'roundabout' })
                expect(isRoundabout(way)).toBe(true)
            })

            test('junction=circular tag', () => {
                const way = createWay('123', { junction: 'circular' })
                expect(isRoundabout(way)).toBe(true)
            })

            test('junction=circular with other tags (Paris issue)', () => {
                const way = createWay('85147125', {
                    'cycleway:right': 'no',
                    'highway': 'residential',
                    'junction': 'circular',
                    'lane_markings': 'no',
                    'lit': 'yes',
                    'maxspeed': '30',
                    'noname': 'yes',
                    'note': 'not a roundabout, entering traffic has priority',
                    'oneway': 'yes',
                    'sidewalk': 'separate',
                    'smoothness': 'good',
                    'surface': 'asphalt'
                })
                expect(isRoundabout(way)).toBe(true)
            })

            test('no roundabout tags', () => {
                const way = createWay('123', { highway: 'residential' })
                expect(isRoundabout(way)).toBe(false)
            })

            test('different junction value', () => {
                const way = createWay('123', { junction: 'yes' })
                expect(isRoundabout(way)).toBe(false)
            })

        })

        describe('fallback path-based detection', () => {

            test('closed loop path (first node === last node)', () => {
                const node1 = createNode('1', 0, 0)
                const node2 = createNode('2', 1, 0)
                const node3 = createNode('3', 1, 1)
                const path = [node1, node2, node3, node1] // closed loop
                const way = createWay('123', { highway: 'residential' }, path)
                expect(isRoundabout(way)).toBe(true)
            })

            test('open path (first node !== last node)', () => {
                const node1 = createNode('1', 0, 0)
                const node2 = createNode('2', 1, 0)
                const node3 = createNode('3', 1, 1)
                const path = [node1, node2, node3] // open path
                const way = createWay('123', { highway: 'residential' }, path)
                expect(isRoundabout(way)).toBe(false)
            })

            test('single node path', () => {
                const node1 = createNode('1', 0, 0)
                const way = createWay('123', { highway: 'residential' }, [node1])
                expect(isRoundabout(way)).toBe(false)
            })

            test('empty path', () => {
                const way = createWay('123', { highway: 'residential' }, [])
                expect(isRoundabout(way)).toBe(false)
            })

        })

        describe('strict check mode', () => {

            test('explicit roundabout tag with strictCheck=true', () => {
                const way = createWay('123', { junction: 'roundabout' })
                expect(isRoundabout(way, true)).toBe(true)
            })

            test('closed loop path with strictCheck=true should return false', () => {
                const node1 = createNode('1', 0, 0)
                const node2 = createNode('2', 1, 0)
                const path = [node1, node2, node1]
                const way = createWay('123', { highway: 'residential' }, path)
                expect(isRoundabout(way, true)).toBe(false)
            })

            test('no tags with strictCheck=true should return false', () => {
                const node1 = createNode('1', 0, 0)
                const way = createWay('123', {}, [node1])
                expect(isRoundabout(way, true)).toBe(false)
            })

        })

        describe('edge cases', () => {

            test('undefined way', () => {
                expect(isRoundabout(undefined as any)).toBe(undefined)
            })

            test('null way', () => {
                expect(isRoundabout(null as any)).toBe(undefined)
            })

            test('way with undefined tags', () => {
                const way = createWay('123', undefined, [])
                expect(isRoundabout(way)).toBe(false)
            })

            test('way with undefined path', () => {
                const way = createWay('123', { highway: 'residential' })
                way.path = undefined
                expect(isRoundabout(way)).toBe(false)
            })

            test('multiple roundabout identifiers', () => {
                const node1 = createNode('1', 0, 0)
                const path = [node1, node1]
                const way = createWay('123', { roundabout: true, junction: 'circular' }, path)
                expect(isRoundabout(way)).toBe(true)
            })

        })

    })

})
