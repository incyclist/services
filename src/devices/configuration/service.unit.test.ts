/* eslint-disable @typescript-eslint/no-explicit-any */
import { IncyclistCapability, SerialPortProvider } from "incyclist-devices";
import clone from "../../utils/clone";
import { DeviceConfigurationService } from "./service"
import DeviceConfigurationSettings from "./model/devices";
import { LegacySettings,LegacyGearSetting } from "./model/legacy";


const SampleSettings: DeviceConfigurationSettings= {                
    devices: [
        {udid:'1', settings: {interface:'ble', name:'1', protocol:'fm'}},
        {udid:'2', settings: {interface:'ble', name:'2', protocol:'fm'}},
        {udid:'3', settings: {interface:'ble', name:'3', protocol:'hr'}},
    ],
    capabilities: [
        {capability:'bike',selected:'1',devices:['1','2']},
        {capability:IncyclistCapability.Control,selected:'1',devices:['1','2']},
        {capability:IncyclistCapability.Power,selected:'2',devices:['1','2']},
        {capability:IncyclistCapability.HeartRate,selected:'3',devices:['1','3']}

    ],
    interfaces: [
        {name:'ble', enabled:true},
        {name:'ant', enabled:false},
        {name:'serial', enabled:false}
    ]
}


const SampleLegacySettings:LegacySettings = {
    gearSelection: {
        bikes: [
            {name: "Ant+FE 2606",selected: true,protocol: "Ant",deviceID: "2606",profile: "Smart Trainer",interface: "ant"},
            {name: "Ant+PWR 2606",selected: false,protocol: "Ant",deviceID: "2606",profile: "Power Meter",interface: "ant"},
            {name: "Simulator",selected: false,protocol: "Simulator"} as LegacyGearSetting,
            {name: "Daum8i",displayName: "Daum8i (192.168.2.115)",selected: false,protocol: "Daum Premium",interface: "tcpip",host: "192.168.2.115",port: "51955"}
          ],
          hrms: [            
            {name: "HRM-Dual:068786",selected: false,protocol: "BLE",interface: "ble",profile: "Heartrate Monitor"},
            {name: "Ant+Hrm 3250",selected: true,protocol: "Ant",deviceID: "3250",profile: "Heartrate Monitor",interface: "ant"},
            {name: "Daum8i",displayName: "Daum8i (192.168.2.115)",selected: false,protocol: "Daum Premium",interface: "tcpip",host: "192.168.2.115",port: "51955"}
          ],
          "disableHrm": false        
    }
}


describe( 'DeviceConfigurationService',()=>{

    describe('init',()=>{


        
        let service;
        let testData
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.emit = jest.fn()
            service.initFromLegacy = jest.fn()
            service.userSettings= {
                init: jest.fn(),
                set: jest.fn(),
                get: jest.fn( (key,defVal) => testData[key]||defVal)
            }
        })

        test('empty configuration',async ()=>{
            testData= {}

            await service.init()

            expect(service.settings).toEqual( {
                devices:[], 
                capabilities:[],
                interfaces:[]
            })
            expect(service.initFromLegacy).not.toHaveBeenCalled()

        })

        test('proper configuration',async ()=>{
            const settings = Object.assign( {},SampleSettings)
            testData = settings

            await service.init()

            expect(service.settings).toEqual( settings)
            expect(service.emit).toHaveBeenCalledWith('initialized')
            expect(service.initFromLegacy).not.toHaveBeenCalled()
        })

        test('no capabilities',async ()=>{
            const settings = Object.assign( {},SampleSettings)
            delete settings.capabilities
            testData= settings
          
            service.initFromLegacy = jest.fn()
            await service.init()

            expect(service.settings.capabilities).toEqual( [])
            

        })


        test('legacy format',async ()=>{
            const settings= {
                gearSelection:{
                    bike: [],
                    hrm: []
                },
                connections: {
                    serial: {},
                    ant: {}
                }
            }
            testData = settings

            service.initFromLegacy = jest.fn()
            await service.init()

            expect(service.initFromLegacy).toHaveBeenCalled()

        })

    })

    describe('initLegacy', ()=>{

        let service;
        let testData
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.emit = jest.fn()
            service.userSettings= {
                init: jest.fn(),
                set: jest.fn(),
                get: jest.fn( (key,defVal) => testData[key]||defVal)
            };

            SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue( {})
        })

        afterAll( ()=>{
            (SerialPortProvider as any)._instance = undefined
        })

        test('normal legacy settings',()=>{
            const settings = clone(SampleLegacySettings)            

            service.initFromLegacy(settings)

            const {devices,capabilities,interfaces} = service.settings
            expect(devices.map(d=>d.settings.name).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+Hrm 3250')

            expect(interfaces.length).toBe(4)

            expect(capabilities.length).toBe(4) // Bike, Control, Heartrate, Power
            const AntFe2606 = devices.find(d=>d.settings.name==='Ant+FE 2606')
            const AntHrm3250  = devices.find(d=>d.settings.name==='Ant+Hrm 3250')
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)
            expect(getCap('bike')?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Control)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBe(AntHrm3250.udid)            
        })

        test('legacy settings: Hrm disabled',()=>{
            const settings = clone(SampleLegacySettings)
            settings.gearSelection.disableHrm = true;
            service.initFromLegacy(settings)

            const {devices,capabilities,interfaces} = service.settings
            expect(devices.map(d=>d.settings.name).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+Hrm 3250')

            expect(interfaces.length).toBe(4)
            expect(capabilities.length).toBe(4) // Bike, Control, Heartrate, Power

            const AntFe2606 = devices.find(d=>d.settings.name==='Ant+FE 2606')
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)

            expect(getCap('bike')?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Control)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBeUndefined()            
            expect(getCap(IncyclistCapability.HeartRate)?.disabled).toBeTruthy()
        })


        test('legacy settings: Bike is also Hrm',()=>{
            const settings = clone(SampleLegacySettings)
            settings.gearSelection.bikes[0].selected = false;
            settings.gearSelection.bikes[3].selected = true
            settings.gearSelection.hrms[1].selected = false;
            settings.gearSelection.hrms[2].selected = true
            
            service.initFromLegacy(settings)

            const {devices,capabilities,interfaces} = service.settings

            expect(devices.map(d=>d.settings.name).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+Hrm 3250')

            expect(devices.length).toBe(6)
            expect(interfaces.length).toBe(4)
            expect(capabilities.length).toBe(4) // Bike, Control, Heartrate, Power

            const daum = devices.find( d=>d.settings.name==='Daum8i')
            
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)
            expect(getCap('bike')?.selected).toBe(daum.udid)
            expect(getCap(IncyclistCapability.Control)?.selected).toBe(daum.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(daum.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBe(daum.udid)            
        })


        

    })

    describe( 'select',()=>{

        let service;
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()

        })
        test('devices are undefined',()=>{
            service.settings={}
            service.select({interface:'ble',address:'123',protocol:'fm'},'bike')

            const settings = service.settings
            expect(settings.devices.length).toBe(1)
            expect(settings.devices[0]).toMatchObject( {udid:expect.any(String), settings:{interface:'ble',address:'123',protocol:'fm'}})
            const udid = settings.devices[0].udid
            expect(settings.capabilities).toMatchObject( [ {capability:'bike', selected:udid}])
        })

        test('adding and selecting at the same time',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1']}
                ]
            }
            
            service.select({interface:'ant',address:'123',profile:'HR'},IncyclistCapability.HeartRate)

            const settings = service.settings
            expect(settings.devices.length).toBe(2)

            const udid = settings.devices[1].udid
            expect(settings.capabilities).toMatchObject( [ {capability:IncyclistCapability.HeartRate, selected:udid}])
        })

        test('selecting bike as heartrate',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2']},
                    {capability:IncyclistCapability.Control, selected:'2', devices:['2']},
                    {capability:'bike', selected:'2',devices:['2']}
                ]
            }

            service.select({interface:'ble',address:'123',protocol:'fm'},IncyclistCapability.HeartRate)

            const settings = service.settings
            expect(settings.devices.length).toBe(3)
            expect(settings.devices[2]).toMatchObject( {udid:expect.any(String), settings:{interface:'ble',address:'123',protocol:'fm'}})

            const udid = settings.devices[2].udid
            expect(settings.capabilities.find(c=>c.capability==='bike')).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:udid})
        })



    })
})