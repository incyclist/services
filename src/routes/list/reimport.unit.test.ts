import os from 'os'
import path from 'path'
import { RouteListService } from './service'
import { RouteParser } from '../base/parsers'
import { Route } from '../base/model/route'
import { getBindings } from '../../api'
import { useUserSettings } from '../../settings'
import { RoutesDbLoader } from './loaders/db'
import { useRouteLibraryScanner } from '../library/service'

/**
 * Real list service, real cards and real scanner - only the parser and the bindings are mocked.
 * The card/list unit tests inject fakes for these seams, which is why removing a route and
 * importing it again was never covered.
 */
class TestRouteList extends RouteListService {
    constructor() {
        super()
        this.loadRoutes = jest.fn() as any
        this.routes = []
        this.initialized = true
    }
}

const flush = () => new Promise(r => setTimeout(r, 50))

const file = { type: 'url', url: 'file:///routes/ride.gpx', name: 'ride.gpx', filename: 'ride.gpx', dir: '/routes', ext: 'gpx', delimiter: '/' } as any

describe('removing a route and importing it again', () => {
    let service: any
    let cards: () => string[]

    beforeEach(() => {
        const access = { read: jest.fn(), write: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true), list: jest.fn().mockResolvedValue(null) }
        getBindings().path = path as any
        getBindings().fs = { ensureDir: jest.fn(), existsFile: jest.fn().mockResolvedValue(true), readdir: jest.fn().mockResolvedValue(['ride.gpx']) } as any
        getBindings().db = { create: jest.fn().mockResolvedValue(access), get: jest.fn().mockResolvedValue(access), release: jest.fn(), getPath: jest.fn() } as any
        getBindings().appInfo = { getAppDir: jest.fn().mockReturnValue(os.tmpdir()), getChannel: jest.fn().mockReturnValue('desktop') } as any
        const settings = useUserSettings() as any
        settings.get = jest.fn().mockReturnValue({})
        settings.set = jest.fn()

        const db = new RoutesDbLoader() as any
        db.routesRepo = access
        db.videosRepo = access

        RouteParser.parse = jest.fn().mockImplementation(async () => ({
            data: { id: 'r1', title: 'Ride', isLocal: true, hasGpx: true, hasVideo: false },
            details: { id: 'r1', title: 'Ride', points: [] },
        })) as any

        service = new TestRouteList()
        // the list service is a singleton - start every test from an empty list
        service.routes = []
        service.cardLookup = {}
        service.myRoutes.getCards().slice().forEach((c: any) => service.myRoutes.remove(c))
        cards = () => service.myRoutes.getCards().filter((c: any) => c.getCardType() === 'Route').map((c: any) => c.getId())
    })

    const importAndRemove = async () => {
        service.import(file)
        await flush()
        expect(cards()).toEqual(['r1'])

        await service.getCard('r1').delete().wait()
        await flush()
        expect(cards()).toEqual([])
    }

    test('a removed local route is forgotten by the list', async () => {
        await importAndRemove()

        expect(service.getRoute('r1')).toBeUndefined()
        expect(service.findCard('r1')).toBeUndefined()
        expect(service.routes).toHaveLength(0)
    })

    test('a file dropped on the list again shows up as a new card', async () => {
        await importAndRemove()

        service.import(file)
        await flush()

        expect(cards()).toEqual(['r1'])
        expect(service.routes).toHaveLength(1)
    })

    test('a file imported again through the import dialog shows up as a new card', async () => {
        await importAndRemove()

        const scanner = useRouteLibraryScanner() as any
        jest.spyOn(scanner, 'getRouteList').mockReturnValue(service)
        await scanner.importRouteFile(file, { list: service })

        expect(cards()).toEqual(['r1'])
        expect(service.routes).toHaveLength(1)
    })

    describe('a route that was only hidden (server / third-party route)', () => {
        const hiddenRoute = () => new Route({ id: 'srv1', title: 'Server Route', isLocal: false, isDeleted: true } as any, { id: 'srv1', title: 'Server Route', points: [] } as any)

        test('stays hidden when the system (sync, API refresh) adds it again', () => {
            service.addRoute(hiddenRoute(), 'system')
            service.addRoute(new Route({ id: 'srv1', title: 'Server Route', isLocal: false } as any, { id: 'srv1', title: 'Server Route', points: [] } as any), 'system')

            expect(service.myRoutes.getCards().filter((c: any) => c.getId() === 'srv1')).toHaveLength(0)
        })

        test('comes back when the user imports it explicitly', () => {
            service.addRoute(hiddenRoute(), 'system')
            service.addRoute(new Route({ id: 'srv1', title: 'Server Route', isLocal: false } as any, { id: 'srv1', title: 'Server Route', points: [] } as any), 'import')

            expect(service.routes.filter((r: any) => r.description.id === 'srv1')).toHaveLength(1)
            expect(service.getRoute('srv1')?.description?.isDeleted).toBeFalsy()
        })
    })
})
