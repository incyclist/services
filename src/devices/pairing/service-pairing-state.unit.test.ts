/* eslint-disable @typescript-eslint/no-explicit-any */
import { DevicePairingService } from './service'

const createService = (usage:'page'|'direct') => {
    const services = {
        configuration: {
            canStartRide: jest.fn().mockReturnValue(false),
            getAdapters: jest.fn().mockReturnValue([]),
            revertExclusionsOnConnect: jest.fn(),
            getExclusions: jest.fn().mockReturnValue([]),
        },
        access: {
            enrichWithAccessState: jest.fn( (i:any)=>i),
        },
        ride: {},
    }
    const svc = new DevicePairingService(services as any)
    svc.usage = usage
    const state = svc.getState() as any
    state.interfaces = []
    state.capabilities = [
        { capability:'control', connectState:'connecting', selected:'udid-1', interface:'ble', devices:[] },
    ]
    jest.spyOn(svc as any, 'checkCanStart').mockReturnValue(undefined)
    jest.spyOn(svc as any, 'revertExclusionsOnConnect').mockReturnValue(undefined)
    return svc
}

describe.each(['page','direct'] as const)('DevicePairingService pairing-state event (%s mode)', (usage)=> {

    afterEach( ()=> {
        jest.clearAllMocks()
    })

    test('a state change emits pairing-state with the full pairing state', ()=> {
        const svc = createService(usage)
        const listener = jest.fn()
        svc.on('pairing-state', listener)

        ;(svc as any).emitStateChange({canStartRide:false})

        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener.mock.calls[0][0].capabilities[0]).toMatchObject({capability:'control', connectState:'connecting'})
    })

    test('a start status update emits pairing-state', ()=> {
        const svc = createService(usage)
        const listener = jest.fn()
        svc.on('pairing-state', listener)

        ;(svc as any).emitStartStatus()

        expect(listener).toHaveBeenCalledTimes(1)
    })

    test('a pairing error for a device emits pairing-state showing it failed', ()=> {
        const svc = createService(usage)
        const listener = jest.fn()
        svc.on('pairing-state', listener)

        ;(svc as any).onPairingError('udid-1')

        expect(listener).toHaveBeenCalled()
        expect(listener.mock.calls.at(-1)[0].capabilities[0].connectState).toBe('failed')
    })

    test('the state passed does not expose adapters', ()=> {
        const svc = createService(usage)
        ;(svc.getState() as any).adapters = [{udid:'udid-1'}]
        const listener = jest.fn()
        svc.on('pairing-state', listener)

        ;(svc as any).emitStateChange()

        expect(listener.mock.calls[0][0].adapters).toBeUndefined()
    })

    test('the onStateChanged callback is still called, and stays the only one', ()=> {
        const svc = createService(usage)
        const onStateChanged = jest.fn()
        ;(svc as any).settings.onStateChanged = onStateChanged
        svc.on('pairing-state', jest.fn())

        ;(svc as any).emitStateChange()

        expect(onStateChanged).toHaveBeenCalledTimes(1)
        expect((svc as any).settings.onStateChanged).toBe(onStateChanged)
    })

    test('a listener that throws never reaches the pairing loop', ()=> {
        const svc = createService(usage)
        const onStateChanged = jest.fn()
        ;(svc as any).settings.onStateChanged = onStateChanged
        const logError = jest.spyOn(svc as any, 'logError').mockReturnValue(undefined)
        svc.on('pairing-state', ()=>{ throw new Error('listener failed') })

        expect( ()=>(svc as any).emitStateChange()).not.toThrow()
        expect( ()=>(svc as any).emitStartStatus()).not.toThrow()
        expect( ()=>(svc as any).onPairingError('udid-1')).not.toThrow()
        expect(onStateChanged).toHaveBeenCalled()
        expect(logError).toHaveBeenCalled()
    })
})
