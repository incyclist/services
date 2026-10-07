import { Inject } from "../../../base/decorators/Injection"
import { DevicesPageService } from "./service"
import { IncyclistCapability } from "incyclist-devices"
import { Observer } from "../../../base/types"

describe('DevicesPageService - tile unselect', ()=> {

    let service: DevicesPageService

    const pairing = {
        getState: jest.fn(),
        unselectDevices: jest.fn(),
    }

    const setCapability = (props: Record<string, unknown>) => {
        pairing.getState.mockReturnValue({
            capabilities: [ { capability: IncyclistCapability.Power, devices: [], ...props } ],
        })
    }

    beforeEach( ()=> {
        Inject('DevicePairing', pairing)
        service = new DevicesPageService()
        ;(service as any).pageObserver = new Observer()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('DevicePairing', null)
        jest.clearAllMocks()
    })

    test('a tile with a selected device offers unselect', ()=> {
        setCapability({ selected: 'udid-1', deviceName: 'Tacx Neo' })
        const data = (service as any).state.capabilities[0]

        const tile = (service as any).getCapabilityDisplayProps(data)

        expect(typeof tile.onUnselect).toBe('function')
    })

    test('an empty tile does not offer unselect', ()=> {
        setCapability({ selected: undefined })
        const data = (service as any).state.capabilities[0]

        const tile = (service as any).getCapabilityDisplayProps(data)

        expect(tile.onUnselect).toBeUndefined()
    })

    test('unselect unselects the capability of that tile and refreshes the page', ()=> {
        setCapability({ selected: 'udid-1', deviceName: 'Tacx Neo' })
        const data = (service as any).state.capabilities[0]
        const emit = jest.spyOn((service as any).getPageObserver(), 'emit')
        const tile = (service as any).getCapabilityDisplayProps(data)

        tile.onUnselect()

        expect(pairing.unselectDevices).toHaveBeenCalledWith(IncyclistCapability.Power)
        expect(emit).toHaveBeenCalledWith('page-update')
    })
})

describe('DevicesPageService - tile use (turning a switched-off capability back on)', ()=> {

    let service: DevicesPageService

    const pairing = {
        getState: jest.fn(),
        useCapability: jest.fn(),
    }

    const setCapability = (props: Record<string, unknown>) => {
        pairing.getState.mockReturnValue({
            capabilities: [ { capability: IncyclistCapability.Power, devices: [], disabled: true, ...props } ],
        })
    }

    beforeEach( ()=> {
        Inject('DevicePairing', pairing)
        service = new DevicesPageService()
        ;(service as any).pageObserver = new Observer()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('DevicePairing', null)
        jest.clearAllMocks()
    })

    test('a switched-off tile with a remembered device (T16) offers use', ()=> {
        setCapability({ selected: 'udid-1', deviceName: 'Tacx Neo' })
        const data = (service as any).state.capabilities[0]

        const tile = (service as any).getCapabilityDisplayProps(data)

        expect(typeof tile.onUse).toBe('function')
    })

    test('a switched-off tile with nothing remembered (T16b) does not offer use', ()=> {
        setCapability({ selected: undefined, deviceName: undefined })
        const data = (service as any).state.capabilities[0]

        const tile = (service as any).getCapabilityDisplayProps(data)

        expect(tile.onUse).toBeUndefined()
    })

    test('use re-enables the capability of that tile and refreshes the page', ()=> {
        setCapability({ selected: 'udid-1', deviceName: 'Tacx Neo' })
        const data = (service as any).state.capabilities[0]
        const emit = jest.spyOn((service as any).getPageObserver(), 'emit')
        const tile = (service as any).getCapabilityDisplayProps(data)

        tile.onUse()

        expect(pairing.useCapability).toHaveBeenCalledWith(IncyclistCapability.Power)
        expect(emit).toHaveBeenCalledWith('page-update')
    })
})
