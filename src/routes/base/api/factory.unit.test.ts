import { Inject } from '../../../base/decorators'
import { IncyclistRoutesApiFactory } from './factory'

const IncyclistRoutesApiMock = jest.fn()

jest.mock('./api', () => ({
    __esModule: true,
    default: class  {
        setSource: jest.Mock<any, any, any>
        constructor(...args) {
            IncyclistRoutesApiMock(...args)
            this.setSource = jest.fn()
        }
    },
}))

describe('IncyclistRoutesApiFactory', () => {
    let factory: IncyclistRoutesApiFactory
    let userSettingsMock

    beforeEach(() => {
        userSettingsMock = {
            getValue: jest.fn(),
        }

        Inject('UserSettings', userSettingsMock)
        factory = new IncyclistRoutesApiFactory()
    })

    afterEach(() => {
        Inject('UserSettings', null);
        (factory as any)?.reset()
        jest.clearAllMocks()
    })

    describe('create', () => {

        test('default key, no ROUTE_API configured: creates api without baseUrl', () => {
            userSettingsMock.getValue.mockReturnValue(undefined)

            const api = factory.create()

            expect(userSettingsMock.getValue).toHaveBeenCalledWith('ROUTE_API', undefined)
            expect(IncyclistRoutesApiMock).toHaveBeenCalledWith()
            expect(api).toBeDefined()
        })

        test('no key given: defaults to \'default\'', () => {
            userSettingsMock.getValue.mockReturnValue(undefined)

            factory.create()

            expect(IncyclistRoutesApiMock).toHaveBeenCalledTimes(1)
        })

        test('default key, ROUTE_API configured: creates api with configured baseUrl', () => {
            userSettingsMock.getValue.mockReturnValue('https://custom.routes.api')

            const api = factory.create('default')

            expect(IncyclistRoutesApiMock).toHaveBeenCalledWith('https://custom.routes.api')
            expect(api).toBeDefined()
        })

        test('non-default key, server url configured in settings: creates api with that baseUrl and sets source', () => {
            userSettingsMock.getValue.mockImplementation((key: string) => {
                if (key === 'routes.servers.myserver')
                    return 'https://myserver.example.com'
                return undefined
            })

            const api = factory.create('myserver')

            expect(userSettingsMock.getValue).toHaveBeenCalledWith('routes.servers.myserver', null)
            expect(IncyclistRoutesApiMock).toHaveBeenCalledWith('https://myserver.example.com')
            expect(api.setSource).toHaveBeenCalledWith('myserver')
        })

        test('non-default key, no server url configured: falls back to using the key as baseUrl', () => {
            userSettingsMock.getValue.mockReturnValue(null)

            const api = factory.create('myserver')

            expect(IncyclistRoutesApiMock).toHaveBeenCalledWith('myserver')
            expect(api.setSource).toHaveBeenCalledWith('myserver')
        })

        test('repeated call with same key: returns cached api instance without creating a new one', () => {
            userSettingsMock.getValue.mockReturnValue(undefined)

            const api1 = factory.create('default')
            const api2 = factory.create('default')

            expect(api1).toBe(api2)
            expect(IncyclistRoutesApiMock).toHaveBeenCalledTimes(1)
        })

        test('repeated call with same non-default key: returns cached api instance without creating a new one', () => {
            // the implementation always caches under the 'default' key, so a
            // second call with a different, non-default key never hits the cache
            userSettingsMock.getValue.mockReturnValue(null)

            const api1 = factory.create('myserver')
            const api2 = factory.create('myserver')
            expect(api2).toBe(api1)

            expect(IncyclistRoutesApiMock).toHaveBeenCalledTimes(1)
        })

        test('call with default key after a non-default key was created: returns two different apis', () => {
            userSettingsMock.getValue.mockReturnValue(null)

            const api1 = factory.create('myserver')
            const api2 = factory.create('default')

            expect(api2).not.toBe(api1)
            expect(IncyclistRoutesApiMock).toHaveBeenCalledTimes(2)
        })
    })
})
