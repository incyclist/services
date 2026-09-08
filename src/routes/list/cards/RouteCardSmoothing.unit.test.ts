import { Inject } from "../../../base/decorators"
import { useUserSettings } from "../../../settings"
import { Route } from "../../base/model/route"
import { RouteInfo, RoutePoint } from "../../base/types"
import { updateSlopes } from "../../base/utils/route"
import { RouteCard } from "./RouteCard"
import { RouteSettings, UIRouteSettings } from "./types"

jest.mock('../../base/utils/smoothing', () => {
    const actual = jest.requireActual('../../base/utils/smoothing')
    return { ...actual, applySmoothing: jest.fn(actual.applySmoothing) }
})

const smoothing = require('../../base/utils/smoothing')

describe('RouteCard - elevation smoothing', () => {

    let store: Record<string, any>
    let settings
    let hasFeature: jest.Mock

    /**
     * A noisy but plausible climb: enough points, real coordinates, varying elevation.
     *
     * Slopes are computed the same way the real parse/load pipeline does (`updateSlopes`), not
     * left absent as a raw fixture would - `getSteepestGradient` reads the slope points already
     * carry rather than deriving its own, precisely so it agrees with what the chart renders.
     */
    const buildPoints = (cnt: number): Array<RoutePoint> => {
        const points: Array<RoutePoint> = []
        for (let i = 0; i < cnt; i++) {
            points.push({
                lat: 50 + i * 0.001,
                lng: 8 + i * 0.001,
                elevation: 100 + i * 2 + (i % 2 === 0 ? 0 : 6),
                routeDistance: i * 100,
                cnt: i
            } as RoutePoint)
        }
        updateSlopes(points)
        return points
    }

    const createCard = (props?: { id?: string, points?: number, info?: Partial<RouteInfo> }) => {
        const { id = 'route-1', points = 24, info = {} } = props ?? {}
        const routePoints = buildPoints(points)

        const description: RouteInfo = {
            id, title: 'Test Route', hasVideo: false, hasGpx: true, elevation: 300,
            ...info
        } as RouteInfo

        const details = { id, title: 'Test Route', points: routePoints } as any

        return new RouteCard(new Route(description, details))
    }

    const settingsKey = (id = 'route-1') => `routeSelection.followRoute.prevSetting.${id}`

    beforeEach(() => {
        store = {}
        settings = useUserSettings()
        settings.get = jest.fn((key: string, defValue?: any) => store[key] ?? defValue)
        settings.set = jest.fn((key: string, value: any) => { store[key] = value })

        hasFeature = jest.fn(() => true)

        Inject('AppState', { hasFeature })
        Inject('Bindings', { appInfo: { getChannel: () => 'desktop' } })
        Inject('OnlineStatusMonitoring', { onlineStatus: true })

        smoothing.applySmoothing.mockClear()
    })

    afterEach(() => {
        Inject('AppState', null)
        Inject('Bindings', null)
        Inject('OnlineStatusMonitoring', null)
    })

    describe('persisting the level', () => {

        test('a level set through the non-UI branch is written to the user settings', () => {
            const card = createCard()

            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 3 } as RouteSettings)

            expect(store[settingsKey()].smoothingLevel).toBe(3)
        })

        test('a level set through the UI branch is written to the user settings', () => {
            const card = createCard()

            card.changeSettings({
                startPos: { value: 0, unit: 'km' }, realityFactor: 100, smoothingLevel: 4
            } as UIRouteSettings)

            expect(store[settingsKey()].smoothingLevel).toBe(4)
        })

        test('a level stored by the non-UI branch is read back by a fresh card', () => {
            createCard().changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 2 } as RouteSettings)

            expect(createCard().openSettings().settings.smoothingLevel).toBe(2)
        })

        test('a level stored by the UI branch is read back by a fresh card', () => {
            createCard().changeSettings({
                startPos: { value: 0, unit: 'km' }, realityFactor: 100, smoothingLevel: 5
            } as UIRouteSettings)

            expect(createCard().openSettings().settings.smoothingLevel).toBe(5)
        })

        test('switching the level back to off is persisted as well', () => {
            const card = createCard()

            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 3 } as RouteSettings)
            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 0 } as RouteSettings)

            expect(store[settingsKey()].smoothingLevel).toBe(0)
        })

        test('the other start settings still round-trip alongside it', () => {
            createCard().changeSettings({
                startPos: 0, realityFactor: 70, showPrev: true, smoothingLevel: 1
            } as RouteSettings)

            const settingsRead = createCard().openSettings().settings
            expect(settingsRead.realityFactor).toBe(70)
            expect(settingsRead.showPrev).toBe(true)
            expect(settingsRead.smoothingLevel).toBe(1)
        })

        // architecture.md §9.7 defect 1: a caller with no opinion on smoothing (e.g. opening the
        // route from the map, not from Ride Again) must not silently reset the level someone
        // already chose - only an explicit value may change it.
        test('a change with no opinion on smoothing does not reset an already-stored level', () => {
            const card = createCard()
            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 3 } as RouteSettings)

            card.changeSettings({ startPos: 0, realityFactor: 100 } as RouteSettings)

            expect(store[settingsKey()].smoothingLevel).toBe(3)
        })

        // §9.6.4: reproducing the ride's conditions is the point of Ride Again - the activity's
        // own stored level must win over whatever the route currently has, in both directions.
        test('an explicit level from Ride Again overrides whatever the route currently has stored', () => {
            const card = createCard()
            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 3 } as RouteSettings)

            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 1 } as RouteSettings)
            expect(store[settingsKey()].smoothingLevel).toBe(1)

            // and an activity ridden unsmoothed (explicit 0) must win too, not be treated as "no
            // opinion" and fall back to the route's currently-stored level
            card.changeSettings({ startPos: 0, realityFactor: 100, smoothingLevel: 0 } as RouteSettings)
            expect(store[settingsKey()].smoothingLevel).toBe(0)
        })
    })

    describe('availability', () => {

        test('is true for an eligible route', () => {
            expect(createCard().openSettings().smoothingAvailable).toBe(true)
        })

        test('is false for a route that is not eligible', () => {
            expect(createCard({ points: 4 }).openSettings().smoothingAvailable).toBe(false)
        })

        test('the maximum level is reported so the UI need not hardcode it', () => {
            expect(createCard().openSettings().smoothingMaxLevel).toBe(smoothing.MAX_SMOOTHING_LEVEL)
        })
    })

    describe('reopening a route with a stored level', () => {

        test('returns the smoothed profile immediately, before the control is touched', () => {
            store[settingsKey()] = { startPos: 0, realityFactor: 100, smoothingLevel: 3 }

            const props = createCard().openSettings()

            expect(props.smoothedPoints).toBeDefined()
            expect(props.smoothedPoints.length).toBe(24)
            expect(props.smoothedElevation).toBeDefined()
            expect(props.smoothedElevation.value).toEqual(expect.any(Number))
        })

        test('returns the steepest gradient before and after alongside the profile', () => {
            store[settingsKey()] = { startPos: 0, realityFactor: 100, smoothingLevel: 3 }

            const props = createCard().openSettings()

            expect(props.smoothedGradient).toBeDefined()
            expect(props.smoothedGradient.routeSteepest).toEqual(expect.any(Number))
            expect(props.smoothedGradient.smoothedSteepest).toEqual(expect.any(Number))
            expect(typeof props.smoothedGradient.hasVisibleEffect).toBe('boolean')
        })

        test('the smoothed profile actually differs from the stored one', () => {
            store[settingsKey()] = { startPos: 0, realityFactor: 100, smoothingLevel: 3 }

            const card = createCard()
            const original = card.getData().points.map(p => p.elevation)
            const smoothed = card.openSettings().smoothedPoints.map(p => p.elevation)

            expect(smoothed).not.toEqual(original)
        })

        test('the route itself is left untouched', () => {
            store[settingsKey()] = { startPos: 0, realityFactor: 100, smoothingLevel: 3 }

            const card = createCard()
            const before = card.getData().points.map(p => p.elevation)
            card.openSettings()

            expect(card.getData().points.map(p => p.elevation)).toEqual(before)
        })

        test('returns no smoothed profile when no level is stored', () => {
            const props = createCard().openSettings()

            expect(props.smoothedPoints).toBeUndefined()
            expect(props.smoothedElevation).toBeUndefined()
            expect(props.smoothedGradient).toBeUndefined()
        })

        test('returns no smoothed profile when the stored level is 0', () => {
            store[settingsKey()] = { startPos: 0, realityFactor: 100, smoothingLevel: 0 }

            expect(createCard().openSettings().smoothedPoints).toBeUndefined()
        })

    })

    describe('getSmoothingPreview', () => {

        test('returns the profile for the requested level', () => {
            const preview = createCard().getSmoothingPreview(2)

            expect(preview.smoothedPoints.length).toBe(24)
            expect(preview.smoothedElevation.value).toEqual(expect.any(Number))
        })

        test('returns the gradient comparison for the requested level', () => {
            const preview = createCard().getSmoothingPreview(3)

            expect(preview.smoothedGradient).toBeDefined()
            expect(preview.smoothedGradient.routeSteepest).toBeGreaterThan(0)
            expect(typeof preview.smoothedGradient.hasVisibleEffect).toBe('boolean')
        })

        test('does not write to the user settings', () => {
            const card = createCard()
            settings.set.mockClear()

            card.getSmoothingPreview(4)

            expect(settings.set).not.toHaveBeenCalled()
        })

        test('does not change the level the card would start with', () => {
            const card = createCard()
            card.getSmoothingPreview(4)

            expect(card.openSettings().settings.smoothingLevel).toBeUndefined()
        })

        test('returns nothing for level 0', () => {
            expect(createCard().getSmoothingPreview(0)).toEqual({})
        })

        test('returns nothing when no level is given at all', () => {
            expect(createCard().getSmoothingPreview()).toEqual({})
        })


        test('returns nothing for a route that is not eligible', () => {
            expect(createCard({ points: 4 }).getSmoothingPreview(3)).toEqual({})
        })

        test('does not throw and returns nothing when the transform fails', () => {
            smoothing.applySmoothing.mockImplementationOnce(() => { throw new Error('boom') })

            const card = createCard()
            let preview
            expect(() => { preview = card.getSmoothingPreview(3) }).not.toThrow()
            expect(preview).toEqual({})
        })

        test('reuses the result when the same level is requested again', () => {
            const card = createCard()

            const first = card.getSmoothingPreview(3)
            const second = card.getSmoothingPreview(3)

            expect(smoothing.applySmoothing).toHaveBeenCalledTimes(1)
            expect(second.smoothedPoints).toBe(first.smoothedPoints)
        })

        test('recomputes when a different level is requested', () => {
            const card = createCard()

            const level3 = card.getSmoothingPreview(3)
            const level5 = card.getSmoothingPreview(5)

            expect(smoothing.applySmoothing).toHaveBeenCalledTimes(2)
            expect(level5.smoothedPoints).not.toBe(level3.smoothedPoints)
        })

        test('the cache is per card, not shared across routes', () => {
            createCard({ id: 'route-1' }).getSmoothingPreview(3)
            createCard({ id: 'route-2' }).getSmoothingPreview(3)

            expect(smoothing.applySmoothing).toHaveBeenCalledTimes(2)
        })
    })
})
