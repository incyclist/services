import { FeatureToggleSyncService, useFeatureToggleSync } from './toggle-sync'

describe('FeatureToggleSyncService', () => {

    const UUID = '11111111-2222-3333-4444-555555555555'

    let service: FeatureToggleSyncService
    let mq: any
    let settings: any

    const setupMocks = (s: any, props?) => {
        mq = props?.mq ?? {
            enabled: jest.fn().mockReturnValue(true),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            publish: jest.fn(),
            on: jest.fn(),
            off: jest.fn(),
        }
        settings = props?.settings ?? {
            set: jest.fn(),
        }

        s.getMessageQueue = jest.fn().mockReturnValue(mq)
        s.getUserSettings = jest.fn().mockReturnValue(settings)
    }

    const cleanupMocks = (s: FeatureToggleSyncService) => {
        s.reset()
        jest.clearAllMocks()
    }

    beforeEach(() => {
        service = useFeatureToggleSync()
        setupMocks(service)
    })

    afterEach(() => {
        cleanupMocks(service)
    })

    describe('start', () => {

        test('subscribes to features/<uuid>/+ and registers a mq-message listener', () => {
            service.start(UUID)

            expect(mq.subscribe).toHaveBeenCalledWith(`features/${UUID}/+`)
            expect(mq.on).toHaveBeenCalledWith('mq-message', expect.any(Function))
        })

        test('does nothing if uuid is not (yet) known', () => {
            service.start(undefined)

            expect(mq.subscribe).not.toHaveBeenCalled()
            expect(mq.on).not.toHaveBeenCalled()
        })

        test('does nothing if the mq binding is not enabled', () => {
            mq.enabled.mockReturnValue(false)

            service.start(UUID)

            expect(mq.subscribe).not.toHaveBeenCalled()
        })

        test('is idempotent when called again with the same uuid', () => {
            service.start(UUID)
            service.start(UUID)

            expect(mq.subscribe).toHaveBeenCalledTimes(1)
            expect(mq.on).toHaveBeenCalledTimes(1)
        })

        test('re-subscribes when called with a different uuid', () => {
            const OTHER_UUID = '99999999-8888-7777-6666-555555555555'

            service.start(UUID)
            service.start(OTHER_UUID)

            expect(mq.unsubscribe).toHaveBeenCalledWith(`features/${UUID}/+`)
            expect(mq.subscribe).toHaveBeenCalledWith(`features/${OTHER_UUID}/+`)
            expect(mq.subscribe).toHaveBeenCalledTimes(2)
        })

    })

    describe('stop', () => {

        test('unsubscribes and removes the listener', () => {
            service.start(UUID)
            service.stop()

            expect(mq.off).toHaveBeenCalledWith('mq-message', expect.any(Function))
            expect(mq.unsubscribe).toHaveBeenCalledWith(`features/${UUID}/+`)
        })

        test('is a no-op when not subscribed', () => {
            service.stop()

            expect(mq.off).not.toHaveBeenCalled()
            expect(mq.unsubscribe).not.toHaveBeenCalled()
        })

    })

    describe('onMessage (incoming mq-message)', () => {

        const emit = (topic: string, message: string | Uint8Array) => {
            service.start(UUID)
            const handler = mq.on.mock.calls.find(([event]) => event === 'mq-message')[1]
            handler(topic, message)
        }

        test('applies a valid toggle-change message to user settings', () => {
            emit(`features/${UUID}/NEW_SEARCH_UI`, JSON.stringify({ value: true }))

            expect(settings.set).toHaveBeenCalledWith('NEW_SEARCH_UI', true)
        })

        test('applies a valid toggle-change message with value:false', () => {
            emit(`features/${UUID}/CONTROLLERS`, JSON.stringify({ value: false }))

            expect(settings.set).toHaveBeenCalledWith('CONTROLLERS', false)
        })

        test('accepts a Uint8Array payload (as delivered by some mq bindings)', () => {
            const payload = Buffer.from(JSON.stringify({ value: true }))
            emit(`features/${UUID}/MOBILE_WORKOUTS`, new Uint8Array(payload))

            expect(settings.set).toHaveBeenCalledWith('MOBILE_WORKOUTS', true)
        })

        test('ignores a message on an unrelated topic', () => {
            emit(`incyclist/session/abc/start`, JSON.stringify({ value: true }))

            expect(settings.set).not.toHaveBeenCalled()
        })

        test('ignores a message for a different uuid', () => {
            emit(`features/some-other-uuid/NEW_SEARCH_UI`, JSON.stringify({ value: true }))

            expect(settings.set).not.toHaveBeenCalled()
        })

        test('ignores a message with an extra topic segment (malformed topic)', () => {
            emit(`features/${UUID}/NEW_SEARCH_UI/extra`, JSON.stringify({ value: true }))

            expect(settings.set).not.toHaveBeenCalled()
        })

        test('ignores a message with no toggle name segment', () => {
            emit(`features/${UUID}/`, JSON.stringify({ value: true }))

            expect(settings.set).not.toHaveBeenCalled()
        })

        test('ignores a message with malformed (non-JSON) payload, without throwing', () => {
            expect(() => emit(`features/${UUID}/NEW_SEARCH_UI`, 'not-json')).not.toThrow()
            expect(settings.set).not.toHaveBeenCalled()
        })

        test('ignores a message whose payload has no boolean value field, without throwing', () => {
            expect(() => emit(`features/${UUID}/NEW_SEARCH_UI`, JSON.stringify({ value: 'yes' }))).not.toThrow()
            expect(settings.set).not.toHaveBeenCalled()

            expect(() => emit(`features/${UUID}/NEW_SEARCH_UI`, JSON.stringify({}))).not.toThrow()
            expect(settings.set).not.toHaveBeenCalled()
        })

        test('does not throw if settings.set itself throws', () => {
            settings.set.mockImplementation(() => { throw new Error('settings unavailable') })

            expect(() => emit(`features/${UUID}/NEW_SEARCH_UI`, JSON.stringify({ value: true }))).not.toThrow()
        })

    })

})
