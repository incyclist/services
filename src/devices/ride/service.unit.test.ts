import { AntCadAdapter, AntDeviceSettings, AntPwrAdapter, DeviceData, DeviceSettings, IncyclistCapability } from 'incyclist-devices'
import {DeviceRideService} from './service'
import { AdapterRideInfo } from './model'

describe('DeviceRideService',()=>{
    describe('onData',()=>{
        let service:DeviceRideService, s
        beforeEach( ()=>{
            s = service = new DeviceRideService()

        })

        afterEach( ()=>{

        })

        test('bug: no progress at  ride with ANT+PWR+ anf ANT+CAD',()=>{
            const d1 = {deviceID:'1',interface:'ant', profile:'PWR'} as DeviceSettings
            const d2 = {deviceID:'2',interface:'ant', profile:'CAD'} as DeviceSettings

            const pwr = new AntPwrAdapter(d1 as AntDeviceSettings)
            const cad = new AntCadAdapter(d2 as AntDeviceSettings)
            const adapters:AdapterRideInfo[] = []
            adapters.push( { adapter:pwr,udid:'1', capabilities:[IncyclistCapability.Power, IncyclistCapability.Cadence, IncyclistCapability.Speed], isStarted:true })
            adapters.push( { adapter:cad,udid:'2', capabilities:[IncyclistCapability.Cadence], isStarted:true })

            s.getAdapterList = jest.fn().mockReturnValue( adapters)
            s.configurationService= { 
                getSelectedDevices: jest.fn(()=>
                    [{capability:IncyclistCapability.Cadence,selected:'2'},
                    {capability:IncyclistCapability.Power,selected:'1'}]
            )}
            const data:Array<DeviceData> = []
            s.emit = jest.fn( (e,d)=>{ data.push(d)} )
            


            service.onData(d1,{power:0, speed:0, cadence:0})
            service.onData(d2,{})           
            service.onData(d1,{power:42,cadence:0,speed:4.103888543378169,timestamp:1709311695883,deviceTime:1.315})
            service.onData(d1,{power:99,cadence:0,speed:7.164162906660091,timestamp:1709311697070,deviceTime:1.187})           
            service.onData(d2,{cadence:45.043988269794724,timestamp:1709311697289})
            service.onData(d1,{power:138,cadence:0,speed:10.182426208863417,timestamp:1709311698387,deviceTime:1.317})
            
            // check last emitted data
            const currentData = data[data.length-1]
            expect(currentData.speed??0).not.toBe(0)
            expect(currentData.cadence??0).not.toBe(0)
            expect(currentData.power??0).not.toBe(0)


        })

    })
})