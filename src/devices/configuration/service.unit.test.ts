/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from "incyclist-devices";
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

        afterEach( ()=>{
            AdapterFactory.reset()
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
            const settings = clone(SampleSettings)
            testData = settings

            await service.init()

            expect(service.settings).toEqual( settings)
            expect(service.emit).toHaveBeenCalledWith('initialized')
            expect(service.initFromLegacy).not.toHaveBeenCalled()
        })


        test('new and legacy',async ()=>{
            const settings = clone({...SampleSettings, ...SampleLegacySettings})
            testData = settings
            await service.init()
            
            expect(service.emit).toHaveBeenCalledWith('initialized')
            expect(service.initFromLegacy).not.toHaveBeenCalled()
        })

        test('no capabilities',async ()=>{
            const settings = clone (SampleSettings)
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

        afterEach( ()=>{
            AdapterFactory.reset()
        })

        afterAll( ()=>{
            (SerialPortProvider as any)._instance = undefined
        })

        test('normal legacy settings',()=>{
            const settings = clone(SampleLegacySettings)            

            testData = settings
            service.initFromLegacy(settings)

            //expect(service.settings).toMatchSnapshot()
            const {devices,capabilities,interfaces} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')
            expect(devices.map(d=>d.settings.name).join(',')).toBe(',,Simulator,Daum8i,HRM-Dual:068786,')

            expect(devices[0].settings.selected).toBeUndefined()
            expect(devices[0].settings.protocol).toBeUndefined()
            expect(interfaces.length).toBe(4)

            const keys = Object.keys(service.adapters)
            const emptyAdapters = keys.find( k=> service.adapters[k]===undefined)
            expect (emptyAdapters).toBeUndefined();

            expect(capabilities.length).toBe(4) // Bike, Control, Heartrate, Power
            const AntFe2606 = devices.find(d=>d.settings.profile==='FE' && d.settings.deviceID==='2606')
            const AntHrm3250  = devices.find(d=>d.settings.profile==='HR' && d.settings.deviceID==='3250')
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)
            expect(getCap('bike')?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Control)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBe(AntHrm3250.udid)            
        })

        test('legacy settings with two devices having the same name',()=>{
            const settings = clone(SampleLegacySettings)            

            const Daum2 = clone(settings.gearSelection.bikes[3])
            Daum2.host = '192.168.2.116'
            Daum2.displayName = 'Daum8i (192.168.2.116)'
            settings.gearSelection.bikes.push(Daum2)

            service.initFromLegacy(settings)

            //expect(service.settings).toMatchSnapshot()
            const {devices} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,Daum8i,HRM-Dual:068786,Ant+HR 3250')
            expect(devices.map(d=>d.displayName||'').join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,,Daum8i (192.168.2.115),Daum8i (192.168.2.116),,')
        })

        test('legacy settings: Hrm disabled',()=>{
            const settings = clone(SampleLegacySettings)
            settings.gearSelection.disableHrm = true;
            service.initFromLegacy(settings)

            const {devices,capabilities,interfaces} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')

            expect(interfaces.length).toBe(4)
            expect(capabilities.length).toBe(4) // Bike, Control, Heartrate, Power

            const AntFe2606 = devices.find(d=>d.settings.profile==='FE' && d.settings.deviceID==='2606')
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

            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')

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

        test('migration',async ()=>{
            const settings = clone(SampleLegacySettings)
            testData = settings
            service.initFromLegacy(settings)
            
            // reset service
            service.adapters = {}
            AdapterFactory.reset()

            // now run with converted data
            const converted = service.settings
            testData = clone( {devices:converted.devices, capabilities:converted.capabilities,interfaces:converted.interfaces})
             await service.init(testData)
            

            const {devices} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')
            expect(devices.map(d=>d.settings.name).join(',')).toBe(',,Simulator,Daum8i,HRM-Dual:068786,')

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

    describe( 'setInterfaceSettings',()=>{


        let service;
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()

            service.settings ={
                interfaces: [
                    {name:'ble', enabled:true},
                    {name:'ant', enabled:false},
                    {name:'serial', enabled:false}                              
                ]
            }

        })

        test('setting protocol',()=>{           
            service.setInterfaceSettings('serial',{protocol:'Daum Classic'})

            expect(service.settings.interfaces[2]).toMatchObject( {name:'serial', enabled:false, protocol:'Daum Classic'}  )
        })

        test('deleting protocol',()=>{           
            service.setInterfaceSettings('serial',{protocol:'Daum Classic'})
            service.setInterfaceSettings('serial',{protocol:null})
            expect(service.settings.interfaces[2]).toMatchObject( {name:'serial', enabled:false}  )
        })

        test('cannot overwrite name',()=>{            
            service.setInterfaceSettings('serial',{name: 'tcpip', protocol:'Daum Classic'})

            expect(service.settings.interfaces[2]).toMatchObject( {name:'serial', enabled:false}  ) // was not changed
        })

    })


    
})