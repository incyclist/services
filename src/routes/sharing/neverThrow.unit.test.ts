import { Inject } from '../../base/decorators'
import { Route } from '../base/model/route'
import { RouteCopyService } from './copy/service'
import { RouteVideoResolver } from './client/resolver'
import { RouteSharingClientService } from './client/service'
import { RouteSharingService } from './service'
import { RouteThumbnailCacheService } from '../thumbnails/service'

const boom = () => { throw new Error('boom') }
const boomAsync = async () => { throw new Error('boom') }
const throwing = { isSupported: boom, getDisplayProps: boom, getSession: boom, getMedia: boomAsync, request: boomAsync, check: boomAsync, setCatalogVersion: boomAsync, on: boom, off: boom }

type Internals = Record<string, unknown>

describe('RouteSharingService never throws', () => {
    let service: RouteSharingService
    let internals: Internals
    let logError: jest.SpyInstance

    beforeEach(() => {
        service = new RouteSharingService()
        internals = service as unknown as Internals
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
    })
    afterEach(() => {
        jest.restoreAllMocks()
        service.reset()
        Inject('RouteList', null)
    })

    test('start resolves', async () => {
        Inject('RouteList', { on: boom, off: boom, getAllRoutes: boom, isStillLoading: boom })
        await expect(service.start('link')).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'start')
    })

    test('setTokens resolves with false', async () => {
        internals.started = true
        internals.publish = boomAsync
        await expect(service.setTokens([])).resolves.toBe(false)
    })

    test('refresh resolves', async () => {
        internals.runRefresh = boomAsync
        await expect(service.refresh()).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'refresh')
    })

    test('getDescriptor resolves with an error body', async () => {
        internals.doGetDescriptor = boomAsync
        await expect(service.getDescriptor('k', 'c')).resolves.toEqual({ routeKey: 'k', error: 'no-details' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'getDescriptor')
    })

    test('stop and reset do not throw if an unsubscribe throws', () => {
        internals.unsubscribers = [boom]
        expect(() => service.stop()).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'unsubscribe')
        expect(() => service.reset()).not.toThrow()
    })

    test('getCatalogVersion and getRouteCount return their fallbacks', () => {
        internals.catalog = { get document(): never { return boom() } }
        expect(service.getCatalogVersion()).toBe('')
        expect(service.getRouteCount()).toBe(0)
    })

    test('timer and listener callbacks do not throw', () => {
        internals.dropExpiredDescriptors = boom
        expect(() => (internals.onDescriptorExpiry as () => void).call(service)).not.toThrow()
        jest.spyOn(globalThis, 'clearTimeout').mockImplementation(boom)
        expect(() => (internals.scheduleRefresh as () => void).call(service)).not.toThrow()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['descriptorExpiry', 'scheduleRefresh'])
    })
})

describe('RouteSharingClientService never throws', () => {
    let service: RouteSharingClientService
    let internals: Internals
    let logError: jest.SpyInstance

    beforeEach(() => {
        service = new RouteSharingClientService()
        internals = service as unknown as Internals
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        Inject('LocalLinkClient', throwing)
        Inject('RouteList', { on: boom, off: boom })
    })
    afterEach(() => {
        jest.restoreAllMocks()
        Inject('LocalLinkClient', null)
        Inject('RouteList', null)
        service.reset()
    })

    test('isActive is false', () => {
        expect(service.isActive()).toBe(false)
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'isActive')
    })

    test('start resolves', async () => {
        internals.isActive = boom
        await expect(service.start()).resolves.toBeUndefined()
    })

    test('getSyncState returns idle', () => {
        internals.syncStates = { get: boom }
        expect(service.getSyncState('A')).toEqual({ linkId: 'A', state: 'idle' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'getSyncState')
    })

    test('a sync whose state handling fails still resolves', async () => {
        internals.isActive = () => true
        internals.doSync = async () => ({ linkId: 'A', status: 'synced' })
        internals.setSyncState = boom
        await expect(service.syncLink('A')).resolves.toEqual({ linkId: 'A', status: 'synced' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'beginSync')
    })

    test('getRowsForRoute returns []', () => {
        internals.repo = { getByRouteKey: boom }
        expect(service.getRowsForRoute('k')).toEqual([])
    })

    test('syncAll and checkAgain resolve with []', async () => {
        internals.isActive = () => true
        internals.repo = { load: boomAsync }
        await expect(service.syncAll()).resolves.toEqual([])
        await expect(service.checkAgain()).resolves.toEqual([])
        expect(logError.mock.calls.map(c => c[1])).toEqual(['syncAll', 'checkAgain'])
    })

    test('syncLink resolves with a failed result', async () => {
        internals.running = { get: boom }
        await expect(service.syncLink('a')).resolves.toEqual({ linkId: 'a', status: 'failed' })
    })

    test('onStaleHandle and onGone resolve', async () => {
        await expect(service.onStaleHandle('a', 'k')).resolves.toBeUndefined()
        internals.repo = { recordGone: boomAsync }
        await expect(service.onGone('a', 'k')).resolves.toBeUndefined()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['onStaleHandle', 'onGone'])
    })

    test('loadDescriptor resolves with the route, details absent', async () => {
        const route = new Route({ id: 'k', linkShared: true } as never)
        internals.doLoadDescriptor = boomAsync
        await expect(service.loadDescriptor(route, 'details')).resolves.toBe(route)
        expect(route.details).toBeUndefined()
        internals.descriptorLoads = { get: boom }
        await expect(service.loadDescriptor(route, 'details')).resolves.toBe(route)
    })

    test('a failing sync emitter listener is contained', async () => {
        service.on('synced', boom)
        internals.doSync = async () => ({ linkId: 'a', status: 'unchanged' })
        await expect((internals.runSync as (l: string, o: unknown) => Promise<unknown>).call(service, 'a', {})).resolves.toEqual({ linkId: 'a', status: 'unchanged' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'emitSynced')
    })

    test('event callbacks do not throw', () => {
        internals.unreachableAt = { delete: boom }
        expect(() => (internals.onSessionChanged as (e: unknown) => void).call(service, { linkId: 'a', session: {} })).not.toThrow()
        expect(() => (internals.onLinkForgotten as (l: string) => void).call(service, 'a')).not.toThrow()
        expect(() => (internals.onPush as (e: unknown) => void).call(service, { linkId: 'a', message: { t: 'catalog-changed', b: {} } })).not.toThrow()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['onSessionChanged', 'onLinkForgotten', 'onPush'])
    })

    test('reset does not throw if an unsubscribe throws', () => {
        internals.unsubscribers = [boom]
        expect(() => service.reset()).not.toThrow()
    })
})

describe('RouteVideoResolver never throws', () => {
    let service: RouteVideoResolver
    let logError: jest.SpyInstance

    beforeEach(() => {
        service = new RouteVideoResolver()
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        Inject('LocalLinkClient', throwing)
        Inject('SharingClient', { getRowsForRoute: boom })
    })
    afterEach(() => {
        jest.restoreAllMocks()
        Inject('LocalLinkClient', null)
        Inject('SharingClient', null)
    })

    test('availability helpers return their fallbacks', () => {
        expect(service.isAvailable()).toBe(false)
        expect(service.getLinkSnapshot().size).toBe(0)
        expect(service.getThumbnailLink('k')).toBeUndefined()
        expect(service.hasLinkSource({ id: 'k', linkShared: true } as never)).toBe(false)
        expect(service.getAvailability({ id: 'k', linkShared: true } as never)).toMatchObject({ canStart: false })
        expect(service.getRouteAvailability({ id: 'k', linkShared: true } as never)).toMatchObject({ canStart: false, availability: 'unavailable' })
        expect(service.isEligible(undefined as never)).toBe(false)
        expect(logError).toHaveBeenCalled()
    })

    test('resolve and openRow resolve with a failure value', async () => {
        await expect(service.resolve({ id: 'k', linkShared: true } as never)).resolves.toEqual({ source: 'unavailable' })
        await expect(service.openRow({ linkId: 'a', routeKey: 'k', videoHandle: 'h' } as never)).resolves.toEqual({ failure: 'unreachable' })
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'openRow')
    })
})

describe('RouteCopyService never throws', () => {
    let service: RouteCopyService
    let internals: Internals
    let logError: jest.SpyInstance

    beforeEach(() => {
        service = new RouteCopyService()
        internals = service as unknown as Internals
        logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        Inject('SharingClient', { isActive: boom })
    })
    afterEach(() => {
        jest.restoreAllMocks()
        Inject('SharingClient', null)
        service.reset()
    })

    test('isActive, getState, cancel, clear do not throw', () => {
        expect(service.isActive()).toBe(false)
        internals.states = { get: boom }
        expect(service.getState('k')).toEqual({ status: 'idle' })
        internals.copies = { get: boom, has: boom }
        expect(() => service.cancel('k')).not.toThrow()
        expect(() => service.clear('k')).not.toThrow()
        expect(logError.mock.calls.map(c => c[1])).toEqual(['isActive', 'getState', 'cancel', 'clear'])
    })

    test('copyToDevice resolves with a failed state', async () => {
        internals.copies = { get: boom }
        await expect(service.copyToDevice('k')).resolves.toEqual({ status: 'failed', reason: 'unknown' })
    })

    test('copyToDevice resolves with a failed state if the copy itself throws', async () => {
        internals.run = boomAsync
        await expect(service.copyToDevice('k')).resolves.toEqual({ status: 'failed', reason: 'unknown' })
    })

    test('a throwing state listener does not break the copy state', () => {
        service.on('state-changed', boom)
        expect(() => (internals.setState as (k: string, s: unknown) => void).call(service, 'k', { status: 'copying', progress: 1 })).not.toThrow()
        expect(service.getState('k')).toEqual({ status: 'copying', progress: 1 })
        expect(() => (internals.onProgress as (k: string, p: number) => void).call(service, 'k', 5)).not.toThrow()
    })

    test('reset does not throw', () => {
        internals.copies = new Map([['k', { cancelled: false, stop: boom }]])
        expect(() => service.reset()).not.toThrow()
    })
})

describe('RouteThumbnailCacheService never throws', () => {
    test('cache and resolve resolve with undefined', async () => {
        const service = new RouteThumbnailCacheService()
        const logError = jest.spyOn(service, 'logError').mockImplementation(() => undefined)
        const request = { get url(): string { return boom() } }
        await expect(service.cache(request as never)).resolves.toBeUndefined()
        await expect(service.resolve(request as never)).resolves.toBeUndefined()
        await expect(service.getCached(request as never)).resolves.toBeUndefined()
        await expect(service.invalidate(request as never)).resolves.toBeUndefined()
        expect(logError).toHaveBeenCalled()
        jest.restoreAllMocks()
    })
})
