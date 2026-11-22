import crypto from 'node:crypto'
import { getBindings } from '../../api/bindings'
import type { ICryptoBinding } from '../../api/crypto/types'
import { Inject } from '../../base/decorators'
import { RouteSharingService } from './service'

describe('RouteSharingService', () => {
    let service: RouteSharingService
    let publishMedia: jest.Mock
    let savedCrypto: ICryptoBinding
    const bindings = getBindings() as unknown as Record<string, unknown>
    const routes = [
        { description: { id: 'a', isLocal: true, routeHash: 'ha', hasVideo: true, videoUrl: 'video:///d/a.mp4', title: 'A' } },
    ]

    beforeEach(() => {
        publishMedia = jest.fn(async () => ({ ok: true, rejectedHandles: [], rejectedTokens: 0 }))
        bindings.localLink = { publishMedia }
        bindings.fs = { stat: jest.fn(async () => ({ size: 42 })) }
        savedCrypto = getBindings().crypto
        getBindings().crypto = crypto as unknown as ICryptoBinding
        Inject('RouteList', { getAllRoutes: () => routes, isStillLoading: () => false, on: jest.fn(), off: jest.fn() })
        Inject('UserSettings', {
            requestNotifyOnChange: () => ({ on: jest.fn() }), stopNotifyOnChange: jest.fn(),
        })
        service = new RouteSharingService()
    })
    afterEach(() => {
        service.reset()
        Inject('RouteList', null)
        Inject('UserSettings', null)
        getBindings().crypto = savedCrypto
        delete bindings.localLink
        delete bindings.fs
        jest.clearAllMocks()
    })

    test('publishes catalog, handles and the given token digests', async () => {
        await service.setTokens([{ digest: 'D', id: 't1' }])
        await service.start('L1')
        expect(publishMedia).toHaveBeenCalledTimes(1)
        const state = publishMedia.mock.calls[0][0]
        expect(state.tokens).toEqual([{ digest: 'D', id: 't1' }])
        expect(state.handles).toHaveLength(1)
        expect(state.handles[0]).toMatchObject({ path: '/d/a.mp4', contentType: 'video/mp4' })
        expect(state.documents.catalog.body.routes).toMatchObject([{ routeKey: 'ha', size: 42 }])
        expect(state.documents.catalog.body.catalogVersion).toBe(service.getCatalogVersion())
        expect(service.getRouteCount()).toBe(1)
    })

    test('handles are stable across rebuilds', async () => {
        await service.start('L1')
        await service.refresh()
        const [first, second] = publishMedia.mock.calls.map(c => c[0].handles[0].handle)
        expect(first).toBe(second)
        expect(first).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
    })

    test('setTokens republishes the current catalog', async () => {
        await service.start('L1')
        await service.setTokens([])
        expect(publishMedia).toHaveBeenCalledTimes(2)
        expect(publishMedia.mock.calls[1][0].tokens).toEqual([])
    })

    test('emits catalog-changed when the content changes', async () => {
        const changed = jest.fn()
        service.on('catalog-changed', changed)
        await service.start('L1')
        expect(changed).toHaveBeenCalledWith({ catalogVersion: service.getCatalogVersion(), routeCount: 1 })
    })
})
