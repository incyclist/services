/* eslint-disable @typescript-eslint/no-explicit-any */
import { DevicePairingService } from './service'

// Unselecting a capability from a tile must disable it (not just unselect it), so that a device
// redetected by an ambient scan running for another capability can't silently reselect it.
// Searching a capability again (starting or reopening its device list) re-enables it.

const createService = () => {
    const services = {
        configuration: {
            canStartRide: jest.fn().mockReturnValue(false),
            getAdapters: jest.fn().mockReturnValue([]),
            getSelected: jest.fn().mockReturnValue(undefined),
            unselect: jest.fn(),
            disableCapability: jest.fn(),
        },
        access: {
            scan: jest.fn(),
            stopScan: jest.fn(),
            enrichWithAccessState: jest.fn( (i:any)=>i),
        },
        ride: {
            stop: jest.fn().mockResolvedValue(undefined),
            lazyInit: jest.fn().mockResolvedValue(true),
            waitForPreviousStartToFinish: jest.fn().mockResolvedValue(true),
            startAdapters: jest.fn(),
        },
    }
    const svc = new DevicePairingService(services as any)
    // startDeviceSelection() kicks off a fire-and-forget scan; these tests only care about the
    // synchronous disableCapability() call it makes before that, so run() is stubbed out
    jest.spyOn(svc as any, 'run').mockResolvedValue(undefined)
    const state = svc.getState() as any
    state.interfaces = []
    state.capabilities = [ { capability:'power', connectState:'connected', selected:'udid-1', devices:[] } ]
    return { svc, configuration: services.configuration }
}

describe('DevicePairingService - disabling a capability on unselect', ()=> {

    afterEach( ()=> {
        jest.clearAllMocks()
    })

    test('unselectDevices disables the capability, after unselecting it', async ()=> {
        const { svc, configuration } = createService()

        await svc.unselectDevices('power' as any)

        expect(configuration.unselect).toHaveBeenCalledWith('power', true)
        expect(configuration.disableCapability).toHaveBeenCalledWith('power', true)
    })

    test('startDeviceSelection re-enables the capability before searching it', ()=> {
        const { svc, configuration } = createService()

        svc.startDeviceSelection('power' as any, jest.fn())

        expect(configuration.disableCapability).toHaveBeenCalledWith('power', false)
    })
})
