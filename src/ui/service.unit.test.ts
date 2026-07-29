import { EventLogger } from 'gd-eventlog'
import { UserInterfaceServcie } from './service'
import { IncyclistPlatform } from './types'

describe('UserInterfaceServcie - onSessionStart', () => {

    let service: UserInterfaceServcie

    const setupMocks = (props: { isMobile?: boolean, isOnline?: boolean, sendResult?: boolean } = {}) => {
        (service as any).startQueueWorker = jest.fn()
        ;(service as any).startHeartbeatWorker = jest.fn()
        ;(service as any).getUserSettings = jest.fn().mockReturnValue({ getValue: jest.fn().mockReturnValue({}) })
        ;(service as any).getFeatureToggleSync = jest.fn().mockReturnValue({ start: jest.fn() })
        ;(service as any).getBindings = jest.fn().mockReturnValue({ appInfo: { getOS: () => ({ platform: 'linux' }) } })
        ;(service as any).isMobile = jest.fn().mockReturnValue(props.isMobile ?? false)
        ;(service as any).isOnline = jest.fn().mockReturnValue(props.isOnline ?? false)
        ;(service as any).sendMessage = jest.fn().mockReturnValue(props.sendResult ?? true)
        ;(service as any).queueMessage = jest.fn()
    }

    beforeEach(() => {
        service = new UserInterfaceServcie()
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('when online, sends the message immediately and does not also queue it', () => {
        setupMocks({ isOnline: true, sendResult: true })

        service['onSessionStart']()

        expect((service as any).sendMessage).toHaveBeenCalledTimes(1)
        expect((service as any).queueMessage).not.toHaveBeenCalled()
    })

    test('when mobile, sends the message immediately and does not also queue it', () => {
        setupMocks({ isMobile: true, sendResult: true })

        service['onSessionStart']()

        expect((service as any).sendMessage).toHaveBeenCalledTimes(1)
        expect((service as any).queueMessage).not.toHaveBeenCalled()
    })

    test('when neither mobile nor online, queues the message and does not attempt to send it', () => {
        setupMocks({ isMobile: false, isOnline: false })

        service['onSessionStart']()

        expect((service as any).sendMessage).not.toHaveBeenCalled()
        expect((service as any).queueMessage).toHaveBeenCalledTimes(1)
    })

    test('when the immediate send fails, falls back to queuing the message', () => {
        setupMocks({ isOnline: true, sendResult: false })

        service['onSessionStart']()

        expect((service as any).sendMessage).toHaveBeenCalledTimes(1)
        expect((service as any).queueMessage).toHaveBeenCalledTimes(1)
    })
})

describe('UserInterfaceServcie - initLogging', () => {

    let service: UserInterfaceServcie

    const setupMocks = (platform: IncyclistPlatform) => {
        service['platform'] = platform
        service['version'] = '1.0.0'
        ;(service as any).getBindings = jest.fn().mockReturnValue({
            appInfo: { getAppVersion: jest.fn().mockReturnValue('1.0.0') },
            logging: { createAdapter: jest.fn().mockReturnValue(null) }
        })
        ;(service as any).getUserSettings = jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue('test-uuid-1234'),
            getValue: jest.fn().mockReturnValue('production')
        })
    }

    beforeEach(() => {
        service = new UserInterfaceServcie()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test.each(['desktop', 'mobile', 'web'] as const)('includes app-channel:%s in the permanent log globals', (platform) => {
        setupMocks(platform)
        const setGlobalSpy = jest.spyOn(EventLogger.prototype, 'setGlobal')

        service['initLogging']()

        expect(setGlobalSpy).toHaveBeenCalledWith(expect.objectContaining({
            'app-channel': platform,
            version: '1.0.0',
            appVersion: '1.0.0',
            uuid: 'test-uuid-1234'
        }))
    })
})
