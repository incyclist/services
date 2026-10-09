import { Route } from './route'
import { RouteInfo } from '../types'
import { RouteApiDetail } from '../api/types'

describe('Route', () => {
    describe('replace', () => {
        it('keeps previously loaded details when the update carries none', () => {
            const details: RouteApiDetail = { points: [{ routeDistance: 0 }, { routeDistance: 100 }] } as RouteApiDetail
            const route = new Route({ id: '1', title: 'existing' } as RouteInfo, details)

            // a route-list sync rebuilds the route from description data only - details are
            // loaded separately, lazily, so the update here legitimately has none
            const update = new Route({ id: '1', title: 'existing (refreshed)' } as RouteInfo)

            route.replace(update)

            expect(route.details).toBe(details)
            expect(route.description.title).toBe('existing (refreshed)')
        })

        it('adopts the update\'s details when it does carry them', () => {
            const oldDetails: RouteApiDetail = { points: [{ routeDistance: 0 }] } as RouteApiDetail
            const newDetails: RouteApiDetail = { points: [{ routeDistance: 0 }, { routeDistance: 200 }] } as RouteApiDetail

            const route = new Route({ id: '1', title: 'existing' } as RouteInfo, oldDetails)
            const update = new Route({ id: '1', title: 'existing' } as RouteInfo, newDetails)

            route.replace(update)

            expect(route.details).toEqual(newDetails)
        })

        it('leaves details undefined when neither side ever had any', () => {
            const route = new Route({ id: '1', title: 'existing' } as RouteInfo)
            const update = new Route({ id: '1', title: 'existing' } as RouteInfo)

            route.replace(update)

            expect(route.details).toBeUndefined()
        })
    })
})
