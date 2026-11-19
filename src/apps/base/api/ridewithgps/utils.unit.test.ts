import { RideWithGpsRoute, RideWithGpsTimeDataMissingError } from './types'
import { getUploadResult, isOwnActiveRoute, isRoadCyclingRoute, isSyncedCollection } from './utils'

const route = (props: Partial<RideWithGpsRoute> = {}): RideWithGpsRoute => ({ id: 1, user_id: 42, name: 'Forest Park loop', archived: false, ...props })

describe('RideWithGPS utils', () => {

    describe('isRoadCyclingRoute', () => {
        test.each([
            ['road', ['cycling:road']],
            ['generic', ['cycling:generic']],
            ['commute', ['cycling:commute']],
            ['road and gravel', ['cycling:gravel', 'cycling:road']],
        ])('%s: included', (_name, types) => {
            expect(isRoadCyclingRoute(route({ activity_types: types }))).toBe(true)
        })

        test.each([
            ['running', ['running:generic']],
            ['walking', ['walking:hiking', 'walking:generic']],
            ['mountain', ['cycling:mountain']],
            ['gravel', ['cycling:gravel']],
            ['motorcycling', ['motorcycling:generic']],
        ])('%s: excluded', (_name, types) => {
            expect(isRoadCyclingRoute(route({ activity_types: types }))).toBe(false)
        })

        test('unknown activity type: included', () => {
            expect(isRoadCyclingRoute(route({ activity_types: ['hovercraft:generic'] }))).toBe(true)
        })

        test('unknown type (missing or empty): included', () => {
            expect(isRoadCyclingRoute(route())).toBe(true)
            expect(isRoadCyclingRoute(route({ activity_types: [] }))).toBe(true)
            expect(isRoadCyclingRoute(route({ unpaved_pct: null, surface: null }))).toBe(true)
        })

        test('without type: mostly unpaved is excluded, mostly paved included', () => {
            expect(isRoadCyclingRoute(route({ unpaved_pct: 80, surface: 'mostly_unpaved' }))).toBe(false)
            expect(isRoadCyclingRoute(route({ unpaved_pct: 12, surface: 'mostly_paved' }))).toBe(true)
        })

        test('the type wins over the surface', () => {
            expect(isRoadCyclingRoute(route({ activity_types: ['cycling:road'], unpaved_pct: 90 }))).toBe(true)
        })
    })

    describe('isSyncedCollection', () => {
        test.each(['pinned', 'Pinned', '{{bucket_list}}', 'bucket_list', 'Bucket List'])('%s: synced', name => {
            expect(isSyncedCollection({ name })).toBe(true)
        })

        test.each(['Favorites', 'My pinned routes', '', undefined])('%s: not synced', name => {
            expect(isSyncedCollection({ name })).toBe(false)
        })
    })

    describe('isOwnActiveRoute', () => {
        test('active route', () => {
            expect(isOwnActiveRoute(route())).toBe(true)
            expect(isOwnActiveRoute(route({ archived: undefined }))).toBe(true)
        })

        test('archived, or not owned (archived is null)', () => {
            expect(isOwnActiveRoute(route({ archived: true }))).toBe(false)
            expect(isOwnActiveRoute(route({ archived: null }))).toBe(false)
        })

        // regression: a user id that differs from the one of the list must not hide the routes of the user
        test('the owner is not compared with the user id', () => {
            expect(isOwnActiveRoute(route({ user_id: 7 }))).toBe(true)
        })
    })

    describe('getUploadResult', () => {
        test('created trip', () => {
            expect(getUploadResult({ id: 1, status: 'completed', items: [{ item_type: 'trip', item_id: 123, item_url: 'https://ridewithgps.com/api/v1/trips/123.json' }], errors: [] }))
                .toEqual({ tripId: '123' })
        })

        test('duplicate with the id of the existing trip', () => {
            const task = { id: 1, status: 'completed', items: [], errors: [{ code: 'duplicate', message: 'This trip already exists', item_type: 'trip', item_id: 55 }] }
            expect(getUploadResult(task)).toEqual({ tripId: '55', duplicate: true })
        })

        test('duplicate without id', () => {
            expect(getUploadResult({ id: 1, status: 'completed', items: [], errors: [{ code: 'duplicate' }] })).toEqual({ tripId: undefined, duplicate: true })
        })

        test('time data missing', () => {
            const task = { id: 1, status: 'completed', items: [], errors: [{ code: 'time_data_missing', message: 'no times' }] }
            expect(() => getUploadResult(task)).toThrow(RideWithGpsTimeDataMissingError)
        })

        test('other error', () => {
            const task = { id: 1, status: 'completed', items: [], errors: [{ code: 'parse_failed', message: 'bad file' }] }
            expect(() => getUploadResult(task)).toThrow('Upload rejected by RideWithGPS: parse_failed (bad file)')
        })

        test('nothing created and no error', () => {
            expect(() => getUploadResult({ id: 1, status: 'completed' })).toThrow('did not create a trip')
        })
    })
})
