import { DeviceAccessService } from './service'

describe('DeviceAccessService pause owners', () => {
    let service: DeviceAccessService
    let ble: { pauseBackgroundActivity: jest.Mock, resumeBackgroundActivity: jest.Mock }

    beforeEach(() => {
        service = new DeviceAccessService()
        ble = { pauseBackgroundActivity: jest.fn().mockResolvedValue(undefined), resumeBackgroundActivity: jest.fn().mockResolvedValue(undefined) };
        (service as unknown as { interfaces: unknown }).interfaces = { ble: { interface: ble } }
    })

    afterEach(() => {
        service.reset()
        jest.clearAllMocks()
    })

    test('without an owner it pauses and resumes like before', async () => {
        await service.pauseBackgroundActivity()
        await service.resumeBackgroundActivity()
        expect(ble.pauseBackgroundActivity).toHaveBeenCalledTimes(1)
        expect(ble.resumeBackgroundActivity).toHaveBeenCalledTimes(1)
    })

    test('resume without a prior pause still reaches the interfaces', async () => {
        await service.resumeBackgroundActivity()
        expect(ble.resumeBackgroundActivity).toHaveBeenCalledTimes(1)
    })

    test('background work resumes only when every owner has resumed', async () => {
        await service.pauseBackgroundActivity()                 // the app goes to the background
        await service.pauseBackgroundActivity('local-link')     // a short exclusive browse
        await service.resumeBackgroundActivity('local-link')
        expect(ble.resumeBackgroundActivity).not.toHaveBeenCalled()

        await service.resumeBackgroundActivity()                // the app comes back
        expect(ble.resumeBackgroundActivity).toHaveBeenCalledTimes(1)
    })

    test('the browse can end after the app resumed', async () => {
        await service.pauseBackgroundActivity('local-link')
        await service.pauseBackgroundActivity()
        await service.resumeBackgroundActivity()
        expect(ble.resumeBackgroundActivity).not.toHaveBeenCalled()
        await service.resumeBackgroundActivity('local-link')
        expect(ble.resumeBackgroundActivity).toHaveBeenCalledTimes(1)
    })
})
