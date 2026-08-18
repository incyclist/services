import { Inject } from "../../base/decorators"
import { ActivityDetails, ActivitySummary } from "../base"
import { createUIActivityDetails, createUIActivitySummary, _createUIActivityDetails } from "./utils"

// See FIXES_BACKLOG.md item #54: createUIActivitySummary/createUIActivityDetails used to build
// `{ value: undefined, unit }` whenever the raw distance/elevation was missing or NaN
// (UnitConverterService.convert() returns undefined by design in that case). That shape passes
// mobile's presence-only `'value' in x` checks but crashes on `.value.toFixed(...)`. The fix:
// the `distance`/`totalElevation` field is omitted (left undefined) instead, never a
// FormattedNumber with an unusable `value`.

const MockUserSettings = () => ({
    getValue: (key: string, defValue: any) => {
        if (key === 'preferences.units') return 'metric'
        return defValue
    }
})

const MockActivitySummary = (overrides: Partial<ActivitySummary> = {}): ActivitySummary => ({
    id: 'id1',
    title: 'Incyclist Ride',
    name: 'Incyclist Ride-20240524151947',
    routeId: 'route1',
    startTime: 1716556878000,
    rideTime: 3600,
    distance: 10000,
    startPos: 0,
    realityFactor: 100,
    uploadStatus: [],
    routeHash: 'route1',
    totalElevation: 100,
    ...overrides,
} as ActivitySummary)

const MockActivityDetails = (overrides: Partial<ActivityDetails> = {}): ActivityDetails => ({
    title: 'Incyclist Ride',
    id: 'id1',
    user: {} as ActivityDetails['user'],
    route: {} as ActivityDetails['route'],
    startTime: '2024-05-24T15:19:47.000Z',
    time: 3600,
    timeTotal: 3600,
    timePause: 0,
    startPos: 0,
    logs: [],
    realityFactor: 100,
    distance: 10000,
    totalElevation: 100,
    ...overrides,
} as unknown as ActivityDetails)

describe('activities/list/utils', () => {

    beforeEach(() => {
        Inject('UserSettings', MockUserSettings())
    })

    afterEach(() => {
        Inject('UserSettings', null)
    })

    describe('createUIActivitySummary', () => {

        test('valid distance/elevation are converted to a FormattedNumber', () => {
            const ui = createUIActivitySummary(MockActivitySummary({ distance: 10000, totalElevation: 100 }))
            expect(ui.distance).toEqual({ value: 10, unit: 'km' })
            expect(ui.totalElevation).toEqual({ value: 100, unit: 'm' })
        })

        test('distance:undefined does not produce a { value: undefined } object', () => {
            const ui = createUIActivitySummary(MockActivitySummary({ distance: undefined as unknown as number }))
            expect(ui.distance).toBeUndefined()
        })

        test('distance:NaN does not produce a { value: undefined } object', () => {
            const ui = createUIActivitySummary(MockActivitySummary({ distance: NaN }))
            expect(ui.distance).toBeUndefined()
        })

        test('totalElevation:undefined does not produce a { value: undefined } object', () => {
            const ui = createUIActivitySummary(MockActivitySummary({ totalElevation: undefined as unknown as number }))
            expect(ui.totalElevation).toBeUndefined()
        })

        test('totalElevation:NaN does not produce a { value: undefined } object', () => {
            const ui = createUIActivitySummary(MockActivitySummary({ totalElevation: NaN }))
            expect(ui.totalElevation).toBeUndefined()
        })
    })

    describe('createUIActivityDetails', () => {

        test('valid distance/elevation are converted to a FormattedNumber', () => {
            const ui = createUIActivityDetails(MockActivityDetails({ distance: 10000, totalElevation: 100 }))
            expect(ui.distance).toEqual({ value: 10, unit: 'km' })
            expect(ui.totalElevation).toEqual({ value: 100, unit: 'm' })
        })

        test('distance:undefined does not produce a { value: undefined } object', () => {
            const ui = createUIActivityDetails(MockActivityDetails({ distance: undefined as unknown as number }))
            expect(ui.distance).toBeUndefined()
        })

        test('distance:NaN does not produce a { value: undefined } object', () => {
            const ui = createUIActivityDetails(MockActivityDetails({ distance: NaN }))
            expect(ui.distance).toBeUndefined()
        })

        test('totalElevation:undefined does not produce a { value: undefined } object', () => {
            const ui = createUIActivityDetails(MockActivityDetails({ totalElevation: undefined as unknown as number }))
            expect(ui.totalElevation).toBeUndefined()
        })

        test('totalElevation:NaN does not produce a { value: undefined } object', () => {
            const ui = createUIActivityDetails(MockActivityDetails({ totalElevation: NaN }))
            expect(ui.totalElevation).toBeUndefined()
        })
    })

    // _createUIActivityDetails has no live caller (in services or mobile) as of this fix, but is
    // exported and kept in sync with createUIActivityDetails - covered here for the same reason.
    describe('_createUIActivityDetails', () => {

        test('distance:undefined does not produce a { value: undefined } object', () => {
            const ui = _createUIActivityDetails(MockActivityDetails({ distance: undefined as unknown as number }))
            expect(ui.distance).toBeUndefined()
        })

        test('distance:NaN does not produce a { value: undefined } object', () => {
            const ui = _createUIActivityDetails(MockActivityDetails({ distance: NaN }))
            expect(ui.distance).toBeUndefined()
        })
    })
})
