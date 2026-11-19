import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { RideWithGpsApi } from '../base/api'
import { RideWithGpsAppConnection } from './RideWithGpsAppConnection'

const KEY = 'user.auth.ridewithgps'

describe('RideWithGpsAppConnection', () => {
    let service: RideWithGpsAppConnection
    let observer: Observer
    let api: Partial<RideWithGpsApi>
    let settings: { isInitialized: boolean, get: jest.Mock, set: jest.Mock }

    const setup = (stored: unknown = null) => {
        observer = new Observer()
        api = { init: jest.fn().mockReturnValue(observer), update: jest.fn(), isAuthenticated: jest.fn() }
        settings = { isInitialized: true, get: jest.fn(() => stored), set: jest.fn() }
        service = new RideWithGpsAppConnection()
        Inject('UserSettings', settings)
        service.getApi = jest.fn().mockReturnValue(api)
    }

    afterEach(() => {
        Inject('UserSettings', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('init', () => {
        test('stored credentials without refresh token and expiration', () => {
            setup({ id: 42, accesstoken: 'at' })

            expect(service.init()).toBe(true)

            expect(service.isConnected()).toBe(true)
            expect(api.init).toHaveBeenCalledWith({ id: '42', accessToken: 'at' })
        })

        test('no credentials', () => {
            setup(null)

            service.init()

            expect(service.isConnected()).toBe(false)
            expect(api.init).not.toHaveBeenCalled()
        })
    })

    describe('connect', () => {
        test('persists only the id and the access token', async () => {
            setup()

            const success = await service.connect({ id: 42, accesstoken: 'at' })

            expect(success).toBe(true)
            expect(service.isConnected()).toBe(true)
            expect(settings.set).toHaveBeenCalledWith(KEY, { id: '42', accesstoken: 'at' })
        })

        test('reconnect while connected: updates the api and persists the new token', async () => {
            setup()
            await service.connect({ id: 42, accesstoken: 'at' })

            await service.connect({ id: 42, accesstoken: 'new' })

            expect(api.update).toHaveBeenCalledWith({ id: '42', accessToken: 'new' })
            expect(settings.set).toHaveBeenLastCalledWith(KEY, { id: '42', accesstoken: 'new' })
        })
    })

    describe('authentication failure (revoked token)', () => {
        test('removes the credentials, so that the user has to connect again', async () => {
            setup()
            await service.connect({ id: 42, accesstoken: 'at' })

            observer.emit('auth.failed')

            expect(service.isConnected()).toBe(false)
            expect(settings.set).toHaveBeenLastCalledWith(KEY, null)
        })
    })

    describe('disconnect', () => {
        test('removes the credentials', async () => {
            setup()
            await service.connect({ accesstoken: 'at' })

            service.disconnect()

            expect(service.isConnected()).toBe(false)
            expect(api.init).toHaveBeenLastCalledWith(undefined)
        })
    })

    describe('operations', () => {
        test('activity upload and route download, enabled by default', () => {
            setup()
            expect(service.getSupportedOperations()).toEqual(['ActivityUpload', 'RouteDownload'])
            expect(service.getDefaultOperations()).toEqual(['ActivityUpload', 'RouteDownload'])
            expect(service.getAppKey()).toBe('ridewithgps')
        })

        test('creates the api once', () => {
            service = new RideWithGpsAppConnection()
            expect(service.getApi()).toBeInstanceOf(RideWithGpsApi)
            expect(service.getApi()).toBe(service.getApi())
        })
    })
})
