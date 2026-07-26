import { Inject } from "../../base/decorators/Injection"
import { DevicesPageService } from "./service"
import { IncyclistCapability } from "incyclist-devices"
import { DevicePairingData } from "../pairing"
import { Observer } from "../../base/types"

describe('DevicesPageService - device delete', ()=> {

    let service: DevicesPageService

    const MockDevice = (props:Partial<DevicePairingData> = {}):DevicePairingData => ({
        udid: '508c6bf1-3f2f-4e8d-bcef-bc1910bd2f07',
        name: 'Tacx Neo',
        interface: 'ble',
        connectState: 'connected',
        value: 100,
        unit: 'W',
        selected: true,
        ...props
    })

    const pairingMock = {
        getState: jest.fn(),
        deleteDevice: jest.fn(),
        selectDevice: jest.fn(),
        unselectDevices: jest.fn(),
    }

    const setupMocks = (devices:Array<DevicePairingData>)=> {
        pairingMock.getState.mockReturnValue({ capabilities: [
            { capability: IncyclistCapability.Power, devices, disabled:false, deviceName:'', deviceNames:'', interface:'ble' }
        ]})
        Inject('DevicePairing', pairingMock)
    }

    beforeEach( ()=> {
        service = new DevicesPageService()
        // updatePage() emits on the page observer, which is normally created in openPage() -
        // stub it directly so onDeviceDelete's updatePage() call doesn't blow up in isolation
        ;(service as any).pageObserver = new Observer()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('DevicePairing', null)
        jest.clearAllMocks()
    })

    test('populates onDelete for each device in the list', ()=> {
        const device = MockDevice()
        setupMocks([device])
        ;(service as any).openedCapability = IncyclistCapability.Power

        const props = (service as any).getDeviceListDisplayProps()

        expect(props.devices).toHaveLength(1)
        expect(typeof props.devices[0].onDelete).toBe('function')
    })

    test('onDelete calls DevicePairingService.deleteDevice with the opened capability and udid', ()=> {
        const device = MockDevice()
        setupMocks([device])
        ;(service as any).openedCapability = IncyclistCapability.Power

        const props = (service as any).getDeviceListDisplayProps()
        props.devices[0].onDelete()

        expect(pairingMock.deleteDevice).toHaveBeenCalledWith(IncyclistCapability.Power, device.udid)
    })

    test('onDelete does not affect other devices in the list', ()=> {
        const deviceA = MockDevice({udid:'device-a', name:'Device A'})
        const deviceB = MockDevice({udid:'device-b', name:'Device B'})
        setupMocks([deviceA, deviceB])
        ;(service as any).openedCapability = IncyclistCapability.Power

        const props = (service as any).getDeviceListDisplayProps()
        props.devices[1].onDelete()

        expect(pairingMock.deleteDevice).toHaveBeenCalledTimes(1)
        expect(pairingMock.deleteDevice).toHaveBeenCalledWith(IncyclistCapability.Power, 'device-b')
    })
})
