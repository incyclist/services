import { Inject } from '../../base/decorators'
import { GoogleMapsService } from './service'

describe('GoogleMapsService', () => {

    let service: GoogleMapsService
    let settingsValues: Record<string, unknown>
    let channel: string

    const UserSettingsMock = {
        getValue: jest.fn((key: string, def: unknown) => settingsValues[key] ?? def),
        get: jest.fn((key: string, def: unknown) => settingsValues[key] ?? def),
        requestNotifyOnChange: jest.fn(),
    }
    const BindingsMock = {
        appInfo: { getChannel: jest.fn(() => channel) }
    }

    const create = () => {
        service = new GoogleMapsService()
    }

    beforeEach(() => {
        settingsValues = {}
        channel = 'electron'
        Inject('UserSettings', UserSettingsMock)
        Inject('Bindings', BindingsMock)
    })

    afterEach(() => {
        // @Singleton: drop the cached instance so every test starts with a fresh latch
        (service as unknown as { reset: () => void }).reset()
        Inject('UserSettings', null)
        Inject('Bindings', null)
        jest.clearAllMocks()
    })

    describe('hasActivePersonalApiKey', () => {
        test('no key configured', () => {
            create()
            expect(service.hasActivePersonalApiKey()).toBe(false)
        })

        test('key configured before first getApiKey', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            await service.getApiKey()
            expect(service.hasActivePersonalApiKey()).toBe(true)
        })

        test('blank key counts as no key', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = '  '
            create()
            await service.getApiKey()
            expect(service.hasActivePersonalApiKey()).toBe(false)
        })

        test('key saved after the first getApiKey is not active', async () => {
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            expect(service.hasActivePersonalApiKey()).toBe(false)
        })

        test('key cleared after the first getApiKey stays active', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = ''
            expect(service.hasActivePersonalApiKey()).toBe(true)
        })

        test('latches from settings when called before getApiKey', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            expect(service.hasActivePersonalApiKey()).toBe(true)
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'Other'
            await service.getApiKey()
            expect(service.hasActivePersonalApiKey()).toBe(true)
        })

        test('always false on mobile', async () => {
            channel = 'mobile'
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            await service.getApiKey()
            expect(service.hasActivePersonalApiKey()).toBe(false)
        })

        test('development mode does not count as a personal key', async () => {
            settingsValues['mode'] = 'development'
            create()
            await service.getApiKey()
            expect(service.hasActivePersonalApiKey()).toBe(false)
        })

        test('fails closed if settings cannot be read', () => {
            UserSettingsMock.getValue.mockImplementationOnce(() => { throw new Error('not ready') })
            create()
            expect(service.hasActivePersonalApiKey()).toBe(false)
        })
    })

    describe('isPersonalApiKeyPendingRestart', () => {
        test('false if nothing changed', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            await service.getApiKey()
            expect(service.isPersonalApiKeyPendingRestart()).toBe(false)
        })

        test('true if a key was saved after launch', async () => {
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            expect(service.isPersonalApiKeyPendingRestart()).toBe(true)
        })

        test('true if the key was replaced after launch', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaOther'
            expect(service.isPersonalApiKeyPendingRestart()).toBe(true)
        })

        test('false if the key was cleared', async () => {
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = ''
            expect(service.isPersonalApiKeyPendingRestart()).toBe(false)
        })

        test('false for a blank key', async () => {
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = ' '
            expect(service.isPersonalApiKeyPendingRestart()).toBe(false)
        })

        test('always false on mobile', async () => {
            channel = 'mobile'
            create()
            await service.getApiKey()
            settingsValues['GOOGLE_MAPS_API_KEY'] = 'AIzaKey'
            expect(service.isPersonalApiKeyPendingRestart()).toBe(false)
        })
    })

    describe('onPersonalApiKeySet', () => {
        test('emits reload while the API is not loaded', () => {
            create()
            const onReload = jest.fn()
            service.on('reload', onReload)
            service.onPersonalApiKeySet()
            expect(onReload).toHaveBeenCalledTimes(1)
        })

        test('does not emit reload once the API is loaded', () => {
            create()
            service.setApi({})
            const onReload = jest.fn()
            service.on('reload', onReload)
            service.onPersonalApiKeySet()
            expect(onReload).not.toHaveBeenCalled()
        })
    })
})
