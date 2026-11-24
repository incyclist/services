import { DeviceAccessService } from './service'

describe('DeviceAccessService: a second scan request while a scan runs', () => {

    let service: DeviceAccessService
    let finish: (devices: unknown[]) => void
    let runScan: jest.SpyInstance

    beforeEach(() => {
        service = new DeviceAccessService()
        service.logEvent = jest.fn()
        runScan = jest.spyOn(service as any, 'runScan').mockImplementation(
            () => new Promise(done => { finish = done as (devices: unknown[]) => void })
        )
    })

    afterEach(() => {
        runScan.mockRestore()
        service.reset()
    })

    test('joins the running scan and resolves with its result', async () => {
        const first = service.scan({})
        const second = service.scan({})

        finish([{ name: 'trainer' }])

        await expect(first).resolves.toEqual([{ name: 'trainer' }])
        await expect(second).resolves.toEqual([{ name: 'trainer' }])
        expect(runScan).toHaveBeenCalledTimes(1)
    })

    test('logs the join', async () => {
        const first = service.scan({})
        void service.scan({})
        finish([])
        await first

        expect(service.logEvent).toHaveBeenCalledWith(expect.objectContaining({ message: 'scan joined' }))
    })

    test('a request after the scan has finished starts a new scan', async () => {
        const first = service.scan({})
        finish([])
        await first

        const second = service.scan({})
        finish([])
        await second

        expect(runScan).toHaveBeenCalledTimes(2)
    })
})
