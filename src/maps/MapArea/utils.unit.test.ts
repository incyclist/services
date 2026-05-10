import { isRoundabout } from './utils'
import { IncyclistWay, IncyclistNode } from './types'

describe('MapArea utils', () => {

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
