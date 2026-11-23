import { Route } from '../../base/model/route'
import type { RouteInfo } from '../../base/types'
import type { SharedRouteEntry } from '../types'
import { RouteLinkMarker } from './markers'

const row = (linkId: string, routeKey: string, missCount = 0): SharedRouteEntry => ({
    linkId, routeKey, routeIdOnComputer: routeKey, videoHandle: `h-${linkId}-${routeKey}`, videoFormat: 'mp4', size: 1, mtime: 1, lastConfirmedAt: 1, missCount,
})

describe('RouteLinkMarker', () => {
    let routes: Route[]
    let rows: SharedRouteEntry[]
    let loading: boolean
    let updateLinkSources: jest.Mock
    let getRows: jest.Mock
    let marker: RouteLinkMarker
    const logError = jest.fn()

    beforeEach(() => {
        routes = []
        rows = []
        loading = false
        updateLinkSources = jest.fn((updates: Array<{ id: string, linkSources: string[] }>) => updates.length)
        getRows = jest.fn(() => rows)
        marker = new RouteLinkMarker({
            getList: () => ({ getAllRoutes: () => routes, isStillLoading: () => loading, updateLinkSources }),
            getRows, log: jest.fn(), logError,
        })
    })

    const add = (d: RouteInfo) => routes.push(new Route(d))

    test('matches by id and by routeHash; the computers are sorted and counted once', () => {
        add({ id: 'a', title: 'A' })
        add({ id: 'b', routeHash: 'hash-b', title: 'B' })
        rows = [row('L2', 'a'), row('L1', 'a'), row('L1', 'hash-b'), row('L2', 'b'), row('L2', 'hash-b')]

        expect(marker.reconcile()).toBe(2)
        expect(updateLinkSources).toHaveBeenCalledWith([{ id: 'a', linkSources: ['L1', 'L2'] }, { id: 'b', linkSources: ['L1', 'L2'] }])
    })

    test('unchanged markers cause no update at all', () => {
        add({ id: 'a', title: 'A', linkSources: ['L1', 'L2'] })
        rows = [row('L1', 'a'), row('L2', 'a')]
        expect(marker.reconcile()).toBe(0)
        expect(updateLinkSources).not.toHaveBeenCalled()
    })

    test('a route the computers do not offer any more is cleared; a missed row does not count', () => {
        add({ id: 'a', title: 'A', linkSources: ['L1'] })
        add({ id: 'b', title: 'B', linkSources: ['L1'] })
        rows = [row('L1', 'b', 1)]
        marker.reconcile()
        expect(updateLinkSources).toHaveBeenCalledWith([{ id: 'a', linkSources: [] }, { id: 'b', linkSources: [] }])
    })

    test('routes that exist only because of a computer are never marked', () => {
        add({ id: 'a', title: 'A', linkShared: true })
        rows = [row('L1', 'a')]
        expect(marker.reconcile()).toBe(0)
        expect(updateLinkSources).not.toHaveBeenCalled()
    })

    test('the route list is not loaded: nothing is done, undefined tells to try again', () => {
        loading = true
        rows = [row('L1', 'a')]
        add({ id: 'a', title: 'A' })
        expect(marker.reconcile()).toBeUndefined()
        expect(updateLinkSources).not.toHaveBeenCalled()
    })

    test('never throws', () => {
        getRows.mockImplementation(() => { throw new Error('boom') })
        expect(marker.reconcile()).toBeUndefined()
        expect(logError).toHaveBeenCalled()
    })

    test('2000 routes: the rows are read once and one update is made', () => {
        for (let i = 0; i < 2000; i++)
            add({ id: `r${i}`, routeHash: `h${i}`, title: `R${i}` })
        for (let i = 0; i < 2000; i += 2)
            rows.push(row('L1', `r${i}`), row('L2', `h${i}`))

        const started = Date.now()
        expect(marker.reconcile()).toBe(1000)
        expect(Date.now() - started).toBeLessThan(1000)
        expect(getRows).toHaveBeenCalledTimes(1)
        expect(updateLinkSources).toHaveBeenCalledTimes(1)
    })
})
