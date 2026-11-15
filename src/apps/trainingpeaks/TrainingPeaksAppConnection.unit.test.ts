import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { UserSettingsService } from '../../settings'
import { waitNextTick } from '../../utils'
import { TrainingPeaksApi, TrainingPeaksConfig } from '../base/api'
import { TrainingPeaksAppConnection } from './TrainingPeaksAppConnection'
import { TrainingPeaksCredentials } from './types'

const SETTINGS_KEY = 'user.auth.trainingpeaks'

const UserSettingsMock = (initialized: boolean, credentials: TrainingPeaksCredentials | null): Partial<UserSettingsService> => ({
    isInitialized: initialized,
    get: jest.fn(() => credentials),
    set: jest.fn()
})

const ApiMock = (props: { tokenUpdate?: TrainingPeaksConfig, initError?: boolean }): Partial<TrainingPeaksApi> => {
    const observer = new Observer()
    const result: Partial<TrainingPeaksApi> = {
        init: jest.fn().mockReturnValue(observer),
        update: jest.fn(),
        isAuthenticated: jest.fn()
    }

    if (props.tokenUpdate) {
        result.init = jest.fn(() => {
            waitNextTick().then(() => observer.emit('token.updated', props.tokenUpdate))
            return observer
        })
    }
    if (props.initError) {
        result.init = jest.fn(() => { throw new Error('ERROR') })
    }

    return result
}

type MockDefinition = {
    api?: Partial<TrainingPeaksApi>
    userSettings?: Partial<UserSettingsService>
}

describe('TrainingPeaksAppConnection', () => {

    let service: TrainingPeaksAppConnection

    const validCredentials = (): TrainingPeaksCredentials => ({
        id: '42',
        accesstoken: '1',
        refreshtoken: '2',
        expiration: new Date(Date.now() + 1000).toISOString()
    })

    const setupMocks = (mocks: MockDefinition) => {
        Inject('UserSettings', mocks.userSettings)
        service.getApi = jest.fn().mockReturnValue(mocks.api)
    }
    const cleanupMocks = () => {
        Inject('UserSettings', null)
    }

    describe('init', () => {
        const logSpy = jest.fn()

        beforeEach(() => {
            service = new TrainingPeaksAppConnection()
            service.on('log', logSpy)
        })

        afterEach(() => {
            cleanupMocks()
            service.reset()
            jest.clearAllMocks()
        })

        test('normal positive flow', () => {
            setupMocks({ userSettings: UserSettingsMock(true, validCredentials()), api: ApiMock({}) })

            const success = service.init()

            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks init done', hasCredentials: true })
            expect(service.isConnected()).toBe(true)
            expect(service.isConnecting()).toBe(false)
        })

        test('passes the parsed credentials to the api', () => {
            const api = ApiMock({})
            const expiration = new Date('2026-01-01T10:00:00.000Z')
            setupMocks({
                userSettings: UserSettingsMock(true, { id: 42, accesstoken: 'at', refreshtoken: 'rt', expiration: expiration.toISOString() }),
                api
            })

            service.init()

            expect(api.init).toHaveBeenCalledWith({ id: '42', accessToken: 'at', refreshToken: 'rt', expiration })
        })

        test('already initialized', () => {
            const userSettings = UserSettingsMock(true, validCredentials())
            setupMocks({ userSettings, api: ApiMock({}) })

            service.init()
            jest.clearAllMocks()

            const success = service.init()

            expect(success).toBe(true)
            expect(userSettings.get).not.toHaveBeenCalled()
            expect(logSpy).not.toHaveBeenCalled()
            expect(service.isConnected()).toBe(true)
        })

        test('userSettings not yet initialized', () => {
            setupMocks({ userSettings: UserSettingsMock(false, null) })

            const success = service.init()

            expect(success).toBe(false)
            expect(logSpy).not.toHaveBeenCalled()
            expect(service.isConnected()).toBe(false)
        })

        test('not yet configured in user settings', () => {
            setupMocks({ userSettings: UserSettingsMock(true, null) })

            const success = service.init()

            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks init done', hasCredentials: false })
            expect(service.isConnected()).toBe(false)
        })

        test('reading the credentials fails', () => {
            const userSettings = UserSettingsMock(true, null)
            userSettings.get = jest.fn(() => { throw new Error('ERROR') })
            setupMocks({ userSettings })

            const success = service.init()

            expect(success).toBe(true)
            expect(service.isConnected()).toBe(false)
        })

        test('persists tokens after the api refreshed them', async () => {
            const refresh: TrainingPeaksConfig = { id: '42', accessToken: 'new-at', refreshToken: 'new-rt', expiration: new Date('2026-01-01T00:00:00Z') }
            const userSettings = UserSettingsMock(true, validCredentials())
            setupMocks({ userSettings, api: ApiMock({ tokenUpdate: refresh }) })

            service.init()
            await waitNextTick()

            expect(logSpy).toHaveBeenCalledWith({ message: 'TrainingPeaks Save Credentials' })
            expect(userSettings.set).toHaveBeenCalledWith(SETTINGS_KEY, {
                id: '42',
                accesstoken: 'new-at',
                refreshtoken: 'new-rt',
                expiration: '2026-01-01T00:00:00.000Z'
            })
        })

        test('error in Api.init', () => {
            setupMocks({ userSettings: UserSettingsMock(true, validCredentials()), api: ApiMock({ initError: true }) })

            const success = service.init()

            expect(success).toBe(false)
            expect(service.isConnected()).toBe(false)
        })
    })

    describe('connect', () => {
        const logSpy = jest.fn()

        beforeEach(() => {
            service = new TrainingPeaksAppConnection()
            service.on('log', logSpy)
        })

        afterEach(() => {
            cleanupMocks()
            service.reset()
            jest.clearAllMocks()
        })

        test('new connection', async () => {
            const mocks: MockDefinition = { userSettings: UserSettingsMock(true, null), api: ApiMock({}) }
            setupMocks(mocks)

            const success = await service.connect({ id: '42', accesstoken: 'test', refreshtoken: 'test2', expiration: new Date('2024-01-01').toISOString() })

            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({ message: 'Connect with TrainingPeaks' })
            expect(logSpy).toHaveBeenCalledWith({ message: 'Connect with TrainingPeaks success' })
            expect(mocks.api?.init).toHaveBeenCalled()
            expect(mocks.userSettings?.set).toHaveBeenCalledWith(SETTINGS_KEY, {
                id: '42',
                accesstoken: 'test',
                refreshtoken: 'test2',
                expiration: '2024-01-01T00:00:00.000Z'
            })
            expect(service.isConnected()).toBe(true)
        })

        test('expiration delivered by the auth-server as epoch milliseconds', async () => {
            const mocks: MockDefinition = { userSettings: UserSettingsMock(true, null), api: ApiMock({}) }
            setupMocks(mocks)

            await service.connect({ id: '42', accesstoken: 'a', refreshtoken: 'r', expiration: String(Date.UTC(2026, 0, 1, 10)) })

            expect(mocks.userSettings?.set).toHaveBeenCalledWith(SETTINGS_KEY, expect.objectContaining({
                expiration: '2026-01-01T10:00:00.000Z'
            }))
        })

        test('unparsable expiration is treated as expired', async () => {
            const mocks: MockDefinition = { userSettings: UserSettingsMock(true, null), api: ApiMock({}) }
            setupMocks(mocks)

            await service.connect({ accesstoken: 'a', refreshtoken: 'r', expiration: 'garbage' })

            expect(mocks.userSettings?.set).toHaveBeenCalledWith(SETTINGS_KEY, expect.objectContaining({ expiration: undefined }))
        })

        test('already connected: updates the api and persists the new credentials', async () => {
            const mocks: MockDefinition = { userSettings: UserSettingsMock(true, validCredentials()), api: ApiMock({}) }
            setupMocks(mocks)

            const success = await service.connect({ id: '42', accesstoken: 'new', refreshtoken: 'new2', expiration: new Date('2024-01-01').toISOString() })

            expect(success).toBe(true)
            expect(mocks.api?.update).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new', refreshToken: 'new2' }))
            expect(mocks.userSettings?.set).toHaveBeenCalledWith(SETTINGS_KEY, expect.objectContaining({ accesstoken: 'new', refreshtoken: 'new2' }))
            expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'error' }))
        })

        test('saving the credentials fails: logs the error', async () => {
            const userSettings = UserSettingsMock(true, null)
            userSettings.set = jest.fn(() => { throw new Error('disk full') })
            setupMocks({ userSettings, api: ApiMock({}) })

            await service.connect({ accesstoken: 'a', refreshtoken: 'r' })

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'error', fn: 'saveCredentials', error: 'disk full' }))
        })
    })

    describe('disconnect', () => {
        beforeEach(() => {
            service = new TrainingPeaksAppConnection()
        })

        afterEach(() => {
            cleanupMocks()
            service.reset()
            jest.clearAllMocks()
        })

        test('removes the credentials', () => {
            const mocks: MockDefinition = { userSettings: UserSettingsMock(true, null), api: ApiMock({}) }
            setupMocks(mocks)

            service.disconnect()

            expect(service.isConnected()).toBe(false)
            expect(mocks.api?.init).toHaveBeenCalledWith(undefined)
            expect(mocks.userSettings?.set).toHaveBeenCalledWith(SETTINGS_KEY, null)
        })

        test('after a connect', async () => {
            const mocks: MockDefinition = { userSettings: UserSettingsMock(true, null), api: ApiMock({}) }
            setupMocks(mocks)
            await service.connect({ accesstoken: 'a', refreshtoken: 'r' })
            expect(service.isConnected()).toBe(true)

            service.disconnect()

            expect(service.isConnected()).toBe(false)
            expect(mocks.userSettings?.set).toHaveBeenLastCalledWith(SETTINGS_KEY, null)
        })
    })

    describe('getApi', () => {
        test('creates the api once', () => {
            service = new TrainingPeaksAppConnection()
            const api = service.getApi()
            expect(api).toBeInstanceOf(TrainingPeaksApi)
            expect(service.getApi()).toBe(api)
            service.reset()
        })
    })

    describe('getSupportedOperations / getDefaultOperations', () => {
        test('none until upload and sync are implemented', () => {
            service = new TrainingPeaksAppConnection()
            expect(service.getSupportedOperations()).toEqual(['ActivityUpload','WorkoutDownload'])
            expect(service.getDefaultOperations()).toEqual(['ActivityUpload','WorkoutDownload'])
            service.reset()
        })

        test('app key', () => {
            service = new TrainingPeaksAppConnection()
            expect(service.getAppKey()).toBe('trainingpeaks')
            service.reset()
        })
    })
})
