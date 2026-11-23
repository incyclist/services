import { DeviceAccessService } from '../../devices/access/service'
import { Route } from '../base/model/route'
import { RouteCard } from './cards/RouteCard'
import { RouteListService } from './service'

const boom = () => { throw new Error('boom') }
const boomAsync = async () => { throw new Error('boom') }

describe('branch-added route list, card and device access methods never throw', () => {
    afterEach(() => jest.restoreAllMocks())

    test('RouteListService.addRoute/addRoutes/saveRoute/removeSharedRoute', async () => {
        const service = new RouteListService()
        const internals = service as unknown as Record<string, unknown>
        const logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        const route = new Route({ id: 'k' } as never)
        internals.addRouteToLists = boom
        expect(() => service.addRoute(route)).not.toThrow()
        expect(() => service.addRoutes([route])).not.toThrow()
        internals.db = { save: boomAsync, delete: boomAsync }
        await expect(service.saveRoute(route)).resolves.toBeUndefined()
        internals.findCard = () => undefined
        await expect(service.removeSharedRoute(route)).resolves.toBe(false)
        expect(logError.mock.calls.map(c => c[1])).toEqual(['addRoute', 'addRoutes', 'saveRoute', 'removeSharedRoute'])
    })

    test('RouteCard linkShared helpers', async () => {
        const card = new RouteCard(new Route({ id: 'k', linkShared: true } as never))
        const internals = card as unknown as Record<string, unknown>
        const logError = jest.spyOn(card as unknown as { logError: () => void }, 'logError').mockImplementation(() => undefined)
        internals.getVideoResolver = boom
        internals.hasLocalCopy = boom
        expect(card.canDelete()).toBe(false)
        expect(card.getAvailability()).toMatchObject({ canStart: false, availability: 'unavailable' })
        internals.onDownloadCompleted = boomAsync
        await expect(card.onCopiedToDevice('video:///x')).resolves.toBeUndefined()
        delete internals.hasLocalCopy
        Object.defineProperty(card, 'route', { get: boom })
        expect(card.hasLocalCopy()).toBe(false)
        expect(logError).toHaveBeenCalled()
    })

    test('DeviceAccessService pause owners', async () => {
        const service = new DeviceAccessService()
        const logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        ;(service as unknown as Record<string, unknown>).interfaces = { get x(): never { return boom() } }
        ;(service as unknown as Record<string, unknown>).getInterface = boom
        ;(service as unknown as Record<string, unknown>).interfaces = { a: {} }
        await expect(service.pauseBackgroundActivity('o')).resolves.toBeUndefined()
        await expect(service.resumeBackgroundActivity('o')).resolves.toBeUndefined()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['pauseBackgroundActivity', 'resumeBackgroundActivity'])
    })
})
