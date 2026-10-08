/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from "incyclist-devices";
import { DeviceConfigurationService } from "./service"

// A rider turning a capability off must not be undone by a scan that rediscovers the same
// device while searching a different capability (e.g. clicking "Power" also redetects the
// trainer's Speed and Cadence, and any nearby HR strap). disableCapability()/add() are the
// mechanism; see the pairing service tests for who calls disableCapability() and when.
describe( 'DeviceConfigurationService - a redetected device respects disabled capabilities',()=>{

    let service:any

    beforeEach( ()=>{
        service = new DeviceConfigurationService()
        service.updateUserSettings = jest.fn()
        service.emitCapabiltyChanged = jest.fn()
        service.settings = {}
        service.adapters = {}

        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue( {})
    })

    afterEach( ()=>{
        AdapterFactory.reset()
        service.reset()
    })

    afterAll( ()=>{
        (SerialPortProvider as any)._instance = undefined
    })

    test('disableCapability marks the capability and persists it',()=>{
        service.settings.capabilities = [ {capability:IncyclistCapability.Power, selected:undefined, devices:[]} ]

        service.disableCapability(IncyclistCapability.Power)

        const c = service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Power)
        expect(c.disabled).toBe(true)
        expect(service.updateUserSettings).toHaveBeenCalled()
    })

    test('disableCapability(capability, false) clears the flag and persists it',()=>{
        service.settings.capabilities = [ {capability:IncyclistCapability.Power, selected:undefined, devices:[], disabled:true} ]

        service.disableCapability(IncyclistCapability.Power, false)

        const c = service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Power)
        expect(c.disabled).toBe(false)
        expect(service.updateUserSettings).toHaveBeenCalled()
    })

    test('disableCapability on an unknown capability does not throw',()=>{
        service.settings.capabilities = []
        expect( ()=> service.disableCapability(IncyclistCapability.Power)).not.toThrow()
        expect(service.updateUserSettings).not.toHaveBeenCalled()
    })

    test('disableCapability before any settings exist does not throw',()=>{
        service.settings = {}
        expect( ()=> service.disableCapability(IncyclistCapability.Power)).not.toThrow()
    })

    test('a redetected device does not reselect a disabled capability, but does reselect the others',()=>{
        const deviceSettings = {interface:'ble',address:'124',protocol:'fm'}

        // first detection: a fresh smart trainer selects Control, Speed and Cadence
        service.add(deviceSettings)
        const udid = service.settings.devices[0].udid

        // the rider turns Speed off (unselectDevices(): unselect() + disableCapability())
        service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Speed).selected = null
        service.disableCapability(IncyclistCapability.Speed)

        // the same device is redetected by a scan running for another capability (e.g. Power)
        service.add(deviceSettings)

        expect(service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Speed)).toMatchObject({selected:null, disabled:true})
        expect(service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Control)).toMatchObject({selected:udid})
        expect(service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Cadence)).toMatchObject({selected:udid})
    })

    test('once re-enabled, a later redetection reselects the capability',()=>{
        const deviceSettings = {interface:'ble',address:'124',protocol:'fm'}

        service.add(deviceSettings)
        const udid = service.settings.devices[0].udid

        service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Speed).selected = null
        service.disableCapability(IncyclistCapability.Speed)
        service.disableCapability(IncyclistCapability.Speed, false)

        service.add(deviceSettings)

        expect(service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Speed)).toMatchObject({selected:udid})
    })

    test('selecting a device for a disabled capability clears the disabled flag (existing behaviour)',()=>{
        service.settings = {
            devices:[ {udid:'1',settings:{interface:'ble',address:'124',protocol:'fm'}} ],
            capabilities:[ {capability:IncyclistCapability.Power, selected:undefined, devices:['1'], disabled:true} ],
        }
        service.adapters = { '1': { getSettings: jest.fn().mockReturnValue({}) } }

        service.select('1', IncyclistCapability.Power)

        const c = service.settings.capabilities.find((c:any)=>c.capability===IncyclistCapability.Power)
        expect(c.selected).toBe('1')
        expect(c.disabled).toBeUndefined()
    })
})
