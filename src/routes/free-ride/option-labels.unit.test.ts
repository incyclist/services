import { buildOptionLabels, deriveManeuvers, getCompassWord, getLayoutOrder, getRoadLabel, normalizeAngle } from './option-labels'

describe('option-labels', () => {

    describe('normalizeAngle', () => {
        test.each([
            [0, 0], [90, 90], [180, 180], [-180, 180], [181, -179], [-181, 179], [-270, 90], [270, -90], [540, 180], [-0.23, -0.23]
        ])('%d -> %d', (angle, expected) => {
            expect(normalizeAngle(angle)).toBeCloseTo(expected)
        })

        test('leaves non-finite values alone', () => {
            expect(normalizeAngle(NaN)).toBeNaN()
            expect(normalizeAngle(undefined as unknown as number)).toBeUndefined()
        })
    })

    describe('getCompassWord', () => {
        test.each([[0, 'North'], [44, 'Northeast'], [90, 'East'], [180, 'South'], [271, 'West'], [359, 'North'], [-90, 'West']])(
            '%d -> %s', (heading, expected) => { expect(getCompassWord(heading)).toBe(expected) })

        test('unknown heading', () => { expect(getCompassWord(NaN)).toBeUndefined() })
    })

    describe('deriveManeuvers', () => {
        test('buckets by angle', () => {
            const res = deriveManeuvers([{ direction: 5 }, { direction: -40 }, { direction: 90 }, { direction: -150 }, { direction: 180 }])
            expect(res).toEqual(['straight', 'slight-left', 'right', 'sharp-left', 'u-turn'])
        })

        test('two options in the same bucket become keep-left / keep-right', () => {
            expect(deriveManeuvers([{ direction: 12 }, { direction: -8 }])).toEqual(['keep-right', 'keep-left'])
        })

        test('roundabout and missing angle', () => {
            expect(deriveManeuvers([{ roundabout: true, direction: 10 }, { direction: undefined }])).toEqual(['roundabout', 'unknown'])
        })
    })

    describe('getRoadLabel', () => {
        test('name before ref', () => { expect(getRoadLabel({ name: 'Main St', ref: 'A1A' })).toEqual({ roadName: 'Main St', roadLabel: 'Main St' }) })
        test('ref', () => { expect(getRoadLabel({ ref: 'A1A' }).roadLabel).toBe('A1A') })
        test('roundabout', () => { expect(getRoadLabel({ junction: 'roundabout' })).toEqual({ roadLabel: 'Roundabout' }) })
        test('slip road', () => { expect(getRoadLabel({ highway: 'primary_link' }).roadLabel).toBe('Slip road') })
        test.each([undefined, {}, { highway: 'residential' }])('unnamed (%j)', (tags) => {
            expect(getRoadLabel(tags as Record<string, string>)).toEqual({ roadLabel: 'Unnamed road' })
        })
    })

    describe('getLayoutOrder', () => {
        test('left to right, missing angle last', () => {
            expect(getLayoutOrder([{ direction: 10 }, { direction: undefined }, { direction: -60 }])).toEqual([2, 0, 1])
        })
        test('roundabout keeps the given order', () => {
            expect(getLayoutOrder([{ roundabout: true, direction: 10 }, { roundabout: true, direction: -60 }])).toEqual([0, 1])
        })
    })

    describe('buildOptionLabels', () => {
        test('both directions of one road read differently by turn word', () => {
            const res = buildOptionLabels([
                { id: 'a', direction: -90, tags: { name: 'Via del Mar' } },
                { id: 'b', direction: 90, tags: { name: 'Via del Mar' } }])
            expect(res.map(l => `${l.maneuverText}|${l.roadLabel}`)).toEqual(['Left|Via del Mar', 'Right|Via del Mar'])
        })

        test('same word and label get the compass word', () => {
            const res = buildOptionLabels([
                { id: 'a', roundabout: true, compass: 'West', tags: { junction: 'roundabout' } },
                { id: 'b', roundabout: true, compass: 'North', tags: { junction: 'roundabout' } }])
            expect(res.map(l => l.roadLabel)).toEqual(['Roundabout, west', 'Roundabout, north'])
        })

        test('same compass falls back to the fork side', () => {
            const res = buildOptionLabels([
                { id: 'a', roundabout: true, direction: -10, compass: 'West', tags: { name: 'Lake Avenue' } },
                { id: 'b', roundabout: true, direction: 10, compass: 'West', tags: { name: 'Lake Avenue' } }])
            expect(res.map(l => l.roadLabel)).toEqual(['Lake Avenue, left fork', 'Lake Avenue, right fork'])
        })

        test('degraded options are labelled, never empty', () => {
            const withCompass = buildOptionLabels([{ id: 'a', compass: 'North', tags: { name: 'South Ocean Boulevard' } }])
            expect(withCompass[0]).toMatchObject({ degraded: true, maneuverText: 'Heading north', roadLabel: 'South Ocean Boulevard' })

            const without = buildOptionLabels([{ id: 'a' }, { id: 'b' }])
            expect(without.map(l => l.maneuverText)).toEqual(['Road 1', 'Road 2'])
            expect(without.every(l => l.roadLabel.length > 0)).toBe(true)
        })
    })
})
