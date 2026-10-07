/* eslint-disable @typescript-eslint/no-explicit-any */
import { DevicePairingService } from './service'

// Unselecting a capability from a tile disables it, without clearing which device was selected:
// getSelected()/getAdapters() already ignore a disabled capability's selection, so the device
// stays remembered and switching the capability back on restores it deterministically, with no
// new scan. Disabling (rather than only unselecting) also keeps a scan running for a different
// capability from silently reselecting the same device meanwhile. Opening the device list to
// browse does not switch the capability back on by itself - only picking a device, or the tile's
// own toggle, does.

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
    // startDeviceSelection() kicks off a fire-and-forget scan; these tests don't need it to
    // complete, so run() is stubbed out
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

    test('unselectDevices disables the capability without unselecting it, so the device stays remembered', async ()=> {
        const { svc, configuration } = createService()

        await svc.unselectDevices('power' as any)

        expect(configuration.disableCapability).toHaveBeenCalledWith('power', true)
        expect(configuration.unselect).not.toHaveBeenCalled()
    })

    test('startDeviceSelection does not switch the capability back on by itself', ()=> {
        const { svc, configuration } = createService()

        svc.startDeviceSelection('power' as any, jest.fn())

        expect(configuration.disableCapability).not.toHaveBeenCalled()
    })
})

describe('DevicePairingService - turning a switched-off capability back on', ()=> {

    afterEach( ()=> {
        jest.clearAllMocks()
    })

    test('useCapability re-enables the capability and restarts to reconnect its remembered device', ()=> {
        const { svc, configuration } = createService()
        const restart = jest.spyOn(svc as any, 'restart').mockResolvedValue(undefined)

        svc.useCapability('power' as any)

        expect(configuration.disableCapability).toHaveBeenCalledWith('power', false)
        expect(restart).toHaveBeenCalled()
    })

    test('a failure in useCapability does not throw', ()=> {
        const { svc, configuration } = createService()
        configuration.disableCapability.mockImplementationOnce( ()=>{ throw new Error('boom') })

        expect( ()=> svc.useCapability('power' as any)).not.toThrow()
    })
})
