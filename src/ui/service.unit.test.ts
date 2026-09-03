import { EventLogger } from 'gd-eventlog'
import { UserInterfaceServcie } from './service'
import { IncyclistPlatform } from './types'
import { IncyclistPageService } from '../base/pages'
import * as devices from '../devices'

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

jest.mock('../devices', () => ({
    ...jest.requireActual('../devices'),
    useDevicePairing: jest.fn(),
    useDeviceAccess: jest.fn(),
}))

describe('UserInterfaceServcie - onAppExit', () => {

    let service: UserInterfaceServcie

    const setupMocks = (props: { pairingExit?: () => Promise<unknown> } = {}) => {
        service['isTerminating'] = false
        service['isTerminated'] = false
        ;(service as any).stopHeartbeatWorker = jest.fn()
        ;(service as any).sendAppExitMessage = jest.fn()

        jest.spyOn(IncyclistPageService, 'closePage').mockImplementation(() => undefined)
        ;(devices.useDevicePairing as jest.Mock).mockReturnValue({
            exit: props.pairingExit ?? jest.fn().mockResolvedValue(true)
        })
        ;(devices.useDeviceAccess as jest.Mock).mockReturnValue({
            terminate: jest.fn().mockResolvedValue(undefined)
        })
    }

    beforeEach(() => {
        service = new UserInterfaceServcie()
        jest.useFakeTimers({ doNotFake: ['nextTick'] })
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    test('resolves once device teardown finishes, well within the exit timeout', async () => {
        setupMocks()

        const result = await service.onAppExit()

        expect(result).toBe(true)
        expect(service['isTerminated']).toBe(true)
    })

    // Guards against a slow/hung device disconnect (e.g. a BLE adapter mid-connect)
    // preventing the app from ever exiting - enforced inside onAppExit() itself so
    // every caller (desktop, mobile) gets the guarantee without its own timeout logic.
    test('resolves anyway if device teardown does not finish before the exit timeout', async () => {
        const neverResolves = new Promise<boolean>(() => { /* intentionally never settles */ })
        setupMocks({ pairingExit: jest.fn().mockReturnValue(neverResolves) })

        const pending = service.onAppExit()
        await jest.advanceTimersByTimeAsync(5000)
        const result = await pending

        expect(result).toBe(true)
        expect(service['isTerminated']).toBe(true)
    })
})

describe('UserInterfaceServcie - pause', () => {

    let service: UserInterfaceServcie
    let disconnect: jest.Mock
    let mqDisconnect: jest.Mock

    const setupMocks = () => {
        disconnect = jest.fn().mockResolvedValue(true)
        mqDisconnect = jest.fn()
        jest.spyOn(IncyclistPageService, 'pausePage').mockResolvedValue(undefined as never)
        jest.spyOn(devices, 'useDeviceAccess').mockReturnValue({ disconnect } as never)
        ;(service as any).getMessageQueue = jest.fn().mockReturnValue({ disconnect: mqDisconnect })
        ;(service as any).logEvent = jest.fn()
        ;(service as any).logError = jest.fn()
    }

    beforeEach(() => {
        service = new UserInterfaceServcie()
        setupMocks()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('disconnects device access and message queue', async () => {
        await (service as any).pause()

        expect(disconnect).toHaveBeenCalled()
        expect(mqDisconnect).toHaveBeenCalled()
    })

    test('still disconnects when pausing the page fails', async () => {
        jest.spyOn(IncyclistPageService, 'pausePage').mockRejectedValue(new Error('X'))

        await (service as any).pause()

        expect(disconnect).toHaveBeenCalled()
        expect(mqDisconnect).toHaveBeenCalled()
        expect((service as any).logError).toHaveBeenCalledWith(expect.any(Error), 'pause:pausePage')
    })

    test('still disconnects the message queue when device access disconnect fails', async () => {
        disconnect.mockRejectedValue(new Error('X'))

        await (service as any).pause()

        expect(mqDisconnect).toHaveBeenCalled()
        expect((service as any).logError).toHaveBeenCalledWith(expect.any(Error), 'pause:disconnect')
    })

})
