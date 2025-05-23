/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdapterFactory, IncyclistCapability,  SerialPortProvider } from "incyclist-devices";
import clone from "../../utils/clone";
import { DeviceConfigurationService } from "./service"
import { DeviceConfigurationSettings,
         LegacySettings,LegacyGearSetting, LegacySerialPortInfo, LegacySerialSettings } from "./model";
import UserSettingsMock from "../../settings/user/mock";


const SampleSettings: DeviceConfigurationSettings= {                
    devices: [
        {udid:'1', settings: {interface:'ble', name:'1', protocol:'fm'}, mode:'ERG', modes:{ "ERG": { "startPower": "100" }} },
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
const serialLegacy = {
    enabled: false,
    protocols: [
        { name: "Daum Premium", selected: false },
        { name: "Daum Classic", selected: true },
        { name: "Kettler Racer", selected: false }
    ],
    COM1: { "name": "COM1", "enabled": true }
} 

const EmptyLegacySettings: LegacySettings = {
    gearSelection:{},
    connections:{
      serial:serialLegacy as unknown as LegacySerialSettings & LegacySerialPortInfo,
      ant:{"enabled":true,"bike":true,"hrm":true},
      tcpip:{"enabled":false}}
  
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
    }, 
    modeSettings: {
        "Simulator": {
            "mode": "Simulator",
            "settings": {
              "power": "150",
              "mode": "Power"
            }
          },
          "Ant-Smart Trainer": {
            "mode": "ERG",
            "settings": {
              "startPower": "100"
            }
          }
    }
}

const ErrorLegacySettings:LegacySettings = {
    gearSelection: {
        bikes: [
            {name: "Ant+FE 2606",selected: false,protocol: "Ant",deviceID: "2606",profile: "Smart Trainer",interface: "ant"},
            {name: "Ant+PWR 2606",selected: false,protocol: "Ant",deviceID: "2606",profile: "Power Meter",interface: "ant"},
            {name: "Volt",selected: false,protocol: "BLE",profile: "Smart Trainer",interface: "ble"},
            {name: "Simulator",selected: true,protocol: "Simulator"} as LegacyGearSetting,
            {name: "Ant+FE 5797",selected: false,protocol: "Ant",deviceID: "5797",profile: "Smart Trainer",interface: "ant"},
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
            service.initFromLegacy = jest.fn() //spyOn(service,'initFromLegacy')
            service.doesAppSupportsWifi = jest.fn().mockReturnValue(true)
            service.isWindows = jest.fn().mockReturnValue(false)

            //service.initFromLegacy = jest.fn()
            service.inject('UserSettings', {
                init: jest.fn(),
                set: jest.fn(),
                get: jest.fn( (key,defVal) => testData[key]||defVal),
                save: jest.fn()
            })
            service.emitInitialized = jest.fn()
            SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue( {})
        })

        afterEach( ()=>{
            AdapterFactory.reset()
            service.reset()
        })

        test('empty configuration',async ()=>{
            testData= {}
            
            await service.init()

            expect(service.settings).toMatchSnapshot()
            expect(service.initFromLegacy).not.toHaveBeenCalled()

        })

        test('empty configuration on windows',async ()=>{
            testData= {}
            service.doesAppSupportsWifi = jest.fn().mockReturnValue(true)
            service.isWindows = jest.fn().mockReturnValue(true)
            
            await service.init()

            let wifi = service.settings.interfaces.find( i=> i.name === 'wifi')
            expect(wifi).toMatchObject({name:'wifi',enabled:false,invisible:false})

            service.doesAppSupportsWifi = jest.fn().mockReturnValue(true)
            
            await service.init()
            wifi = service.settings.interfaces.find( i=> i.name === 'wifi')
            expect(wifi).toMatchObject({name:'wifi',enabled:false,invisible:false})

        })

        test('proper configuration',async ()=>{
            const settings = clone(SampleSettings)
            testData = settings

            await service.init()

            expect(service.settings).toEqual( settings)
            expect(service.emitInitialized).toHaveBeenCalled()
            expect(service.initFromLegacy).not.toHaveBeenCalled()

        })


        test('new and legacy',async ()=>{


            const settings = clone({...SampleSettings, ...SampleLegacySettings})
            testData = settings
            await service.init()
            
            expect(service.emitInitialized).toHaveBeenCalled()
            expect(service.initFromLegacy).toHaveBeenCalled()
            /*
            expect(service.settings.devices.length).toBe(6)
            expect(service.settings.gearSelection).toBeUndefined()
            expect(service.settings.connections).toBeUndefined()
*/
        })

        test('no capabilities',async ()=>{
            const settings = clone (SampleSettings)
            delete settings.capabilities
            testData= settings
          
            service.initFromLegacy = jest.fn()
            await service.init()

            expect(service.settings.capabilities).toMatchSnapshot()
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
            service.doesAppSupportsWifi = jest.fn().mockReturnValue(true)
            service.isWindows = jest.fn().mockReturnValue(false)

            service.emit = jest.fn()
            service.inject('UserSettings', {
                init: jest.fn(),
                set: jest.fn(),
                get: jest.fn( (key,defVal) => testData[key]||defVal),
                save: jest.fn(),
            })

            SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue( {})
        })

        afterEach( ()=>{
            AdapterFactory.reset()
            service.reset()
        })

        afterAll( ()=>{
            (SerialPortProvider as any)._instance = undefined
        })

        test('normal legacy settings',async ()=>{
            const settings = clone(SampleLegacySettings)            
            testData = settings
            service.updateCapabilities = jest.fn()
            await service.init()

            //expect(service.settings).toMatchSnapshot()
            const {devices,capabilities,interfaces} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')
            expect(devices.map(d=>d.settings.name).join(',')).toBe(',,Simulator,Daum8i,HRM-Dual:068786,')

            expect(devices[0].settings.selected).toBeUndefined()
            expect(devices[0].settings.protocol).toBeUndefined()
            expect(interfaces.length).toBe(5)

            const keys = Object.keys(service.adapters)
            const emptyAdapters = keys.find( k=> service.adapters[k]===undefined)
            expect (emptyAdapters).toBeUndefined();

            expect(capabilities.length).toBe(5) // Control, Heartrate, Power, Cadence, Speed

            const AntFe2606 = devices.find(d=>d.settings.profile==='FE' && d.settings.deviceID==='2606')
            const AntHrm3250  = devices.find(d=>d.settings.profile==='HR' && d.settings.deviceID==='3250')
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)
            expect(getCap(IncyclistCapability.Control).devices.length).toBe(3)  // PWR does not have Control
            expect(getCap(IncyclistCapability.Speed).devices.length).toBe(4)
            expect(getCap(IncyclistCapability.Cadence).devices.length).toBe(4)
            expect(getCap(IncyclistCapability.Power).devices.length).toBe(4)
            expect(getCap(IncyclistCapability.HeartRate).devices.length).toBe(3)

            expect(getCap(IncyclistCapability.Control)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBe(AntHrm3250.udid)            
        })

        test('alternatve legacy settings',async ()=>{
            const settings = clone(ErrorLegacySettings)            

            testData = settings
            await service.init()

            const {devices,capabilities} = service.settings
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)
            expect(devices.length).toBe(8)
            expect(getCap(IncyclistCapability.HeartRate).devices.length).toBe(3)

        })

        test('legacy settings with two devices having the same name',async ()=>{
            const settings = clone(SampleLegacySettings)            

            const Daum2 = clone(settings.gearSelection.bikes[3])
            Daum2.host = '192.168.2.116'
            Daum2.displayName = 'Daum8i (192.168.2.116)'
            settings.gearSelection.bikes.push(Daum2)
            testData = settings

            await service.init()

            //expect(service.settings).toMatchSnapshot()
            const {devices} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,Daum8i,HRM-Dual:068786,Ant+HR 3250')
            expect(devices.map(d=>d.displayName||'').join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,,Daum8i (192.168.2.115),Daum8i (192.168.2.116),,')
        })

        test('legacy settings: Hrm disabled',async ()=>{
            const settings = clone(SampleLegacySettings)
            settings.gearSelection.disableHrm = true;
            testData = settings

            await service.init()

            const {devices,capabilities,interfaces} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')

            expect(interfaces.length).toBe(5)
            expect(capabilities.length).toBe(5) //  Control, Heartrate, Power, Cadence, Speed

            const AntFe2606 = devices.find(d=>d.settings.profile==='FE' && d.settings.deviceID==='2606')
            const AntHr3250 = devices.find(d=>d.settings.profile==='HR' && d.settings.deviceID==='3250')
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)

            expect(getCap(IncyclistCapability.Control)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.Cadence)?.selected).toBe(AntFe2606.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBe(AntHr3250.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.disabled).toBeTruthy()
        })


        test('legacy settings: Bike is also Hrm',async ()=>{
            const settings = clone(SampleLegacySettings)
            settings.gearSelection.bikes[0].selected = false;
            settings.gearSelection.bikes[3].selected = true
            settings.gearSelection.hrms[1].selected = false;
            settings.gearSelection.hrms[2].selected = true
            testData = settings
            await service.init()

            const {devices,capabilities,interfaces} = service.settings

            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')

            expect(devices.length).toBe(6)
            expect(interfaces.length).toBe(5)
            expect(capabilities.length).toBe(5) //  Control, Heartrate, Power, Cadence, Speed

            const daum = devices.find( d=>d.settings.name==='Daum8i')
            
            const getCap = (cap: IncyclistCapability|string) => capabilities.find( c=>c.capability===cap)            
            expect(getCap(IncyclistCapability.Control)?.selected).toBe(daum.udid)
            expect(getCap(IncyclistCapability.Cadence)?.selected).toBe(daum.udid)
            expect(getCap(IncyclistCapability.Power)?.selected).toBe(daum.udid)
            expect(getCap(IncyclistCapability.HeartRate)?.selected).toBe(daum.udid)            
        })

        test('migration',async ()=>{
            const settings = clone(SampleLegacySettings)
            testData = settings

            // reset service
            service.adapters = {}
            AdapterFactory.reset()
            
            await service.init()
            

            // now run with converted data
            const converted = service.settings
            testData = clone( {devices:converted.devices, capabilities:converted.capabilities,interfaces:converted.interfaces})
             await service.init(testData)
            

            const {devices} = service.settings
            expect(devices.map(d=>service.adapters[d.udid].getName()).join(',')).toBe('Ant+FE 2606,Ant+PWR 2606,Simulator,Daum8i,HRM-Dual:068786,Ant+HR 3250')
            expect(devices.map(d=>d.settings.name).join(',')).toBe(',,Simulator,Daum8i,HRM-Dual:068786,')

        })

        test('empty legacy', async ()=>{
            const settings = clone(EmptyLegacySettings)
            testData = settings

            await service.init()
            
            expect(service.settings.devices.length).toBe(0)
            expect(service.settings.capabilities.length).toBe(5)
            expect(service.settings.interfaces.length).toBe(5)

            expect(service.settings.interfaces.find(i=>i.name==='serial')).toEqual({enabled:false,name:'serial',protocol:'Daum Classic'})
            expect(service.settings.gearSelection).toBeUndefined()
            expect(service.settings.connections).toBeUndefined()

        })


    })


    describe( 'add',()=>{

        let service;
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()
            service.emitCapabiltyChanged = jest.fn()

            SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue( {})

        })

        afterEach( ()=>{
            AdapterFactory.reset()
            service.reset()
        })

        afterAll( ()=>{
            (SerialPortProvider as any)._instance = undefined
        })


        test('adding smart trainer to empty list',()=>{
            service.settings={}
            service.adapters={}

            service.add( {interface:'ble',address:'124',protocol:'fm'} )

            const settings = service.settings
            expect(settings.devices).toBeDefined()
            expect(settings.capabilities).toBeDefined()
            const udid = settings.devices[0].udid
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Speed)).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Cadence)).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:undefined})

            expect(service.emitCapabiltyChanged).toHaveBeenCalled()

        })

        test('adding Ergo to empty list',()=>{
            service.settings={}
            service.adapters={}

            
            service.add(  { name: "Daum8i", protocol: "Daum Premium", interface: "tcpip", host: "127.0.0.1", port: "51955"} )

            const settings = service.settings
            expect(settings.devices).toBeDefined()
            expect(settings.capabilities).toBeDefined()
            const udid = settings.devices[0].udid
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Speed)).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Cadence)).toMatchObject( {selected:udid})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:udid})

            expect(service.emitCapabiltyChanged).toHaveBeenCalled()

        })

        test('adding first bike to existing list',()=>{

            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1']},
                    {capability:IncyclistCapability.Control, selected:undefined, devices:[]},
                    {capability:'bike', selected:undefined,devices:[]}
                ]
            }
            service.adapters = {
                "1" : {
                    hasCapability: jest.fn( (c)=> c===IncyclistCapability.HeartRate),
                    isControllable: jest.fn().mockReturnValue(false),
                    isEqual:jest.fn().mockReturnValue(false)
                }
            }

            service.add( {interface:'ant',deviceID:'4711',profile:'FE'})

            const settings = service.settings
            expect(settings.devices.length).toBe(2)
            expect(settings.capabilities.length).toBe(6) 
            const udid = settings.devices[1].udid

            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:udid})

            // hearrate sensor was not overwritten
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:'1'})
        })

        test('adding another bike to existing list',()=>{

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
            service.adapters = {
                "1" : {
                    hasCapability: jest.fn( (c)=> c===IncyclistCapability.HeartRate),
                    isControllable: jest.fn().mockReturnValue(false),
                    isEqual:jest.fn().mockReturnValue(false)
                },
                "2" : {
                    hasCapability: jest.fn().mockReturnValue(true),
                    isControllable: jest.fn().mockReturnValue(true),
                    isEqual: jest.fn().mockReturnValue(false)
                }
            }

            service.add( {interface:'ant',deviceID:'4711',profile:'FE'})

            const settings = service.settings
            expect(settings.devices.length).toBe(3)
            expect(settings.capabilities.length).toBe(6)  

            expect(settings.capabilities.find(c=>c.capability==='bike')).toMatchObject( {selected:'2'})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:'2'})

            // hearrate sensor was not overwritten
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:'1'})
        })

        test('adding a sensor to existing list',()=>{

            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'ant',deviceID:'4711',profile:'FE'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2']},
                    {capability:IncyclistCapability.Control, selected:'2', devices:['2']},
                    {capability:IncyclistCapability.Power, selected:'2', devices:['2']},
                    {capability:'bike', selected:'2',devices:['2']}
                ]
            }
            service.adapters = {
                "1" : {
                    hasCapability: jest.fn( (c)=> c===IncyclistCapability.HeartRate),
                    isControllable: jest.fn().mockReturnValue(false),
                    isEqual:jest.fn().mockReturnValue(false)
                },
                "2" : {
                    hasCapability: jest.fn().mockReturnValue(true),
                    isControllable: jest.fn().mockReturnValue(true),
                    isEqual: jest.fn().mockReturnValue(false)
                }
            }

            service.add( {interface:'ant',deviceID:'4711',profile:'PWR'})

            const settings = service.settings
            expect(settings.devices.length).toBe(3)
            expect(settings.capabilities.length).toBe(6)  

            expect(settings.capabilities.find(c=>c.capability==='bike')).toMatchObject( {selected:'2'})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:'2'})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Power)).toMatchObject( {selected:'2'})

            // hearrate sensor was not overwritten
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:'1'})
        })

        test('legacy: adding a sensor to existing list',()=>{

            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'ant',deviceID:'4711',profile:'FE'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:undefined,devices:['1','2']},
                    {capability:IncyclistCapability.Control, selected:undefined, devices:['2']},
                    {capability:IncyclistCapability.Power, selected:undefined, devices:['2']},
                    {capability:'bike', selected:undefined,devices:['2']}
                ]
            }
            service.adapters = {
                "1" : {
                    hasCapability: jest.fn( (c)=> c===IncyclistCapability.HeartRate),
                    isControllable: jest.fn().mockReturnValue(false),
                    isEqual:jest.fn().mockReturnValue(false)
                },
                "2" : {
                    hasCapability: jest.fn().mockReturnValue(true),
                    isControllable: jest.fn().mockReturnValue(true),
                    isEqual: jest.fn().mockReturnValue(false)
                }
            }

            service.add( {interface:'ant',deviceID:'4711',profile:'PWR'},{legacy:true})

            const settings = service.settings
            expect(settings.devices.length).toBe(3)
            
            expect(settings.capabilities.length).toBe(6)  
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:undefined})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Power)).toMatchObject( {selected:undefined})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:undefined})
        })

        test('adding existing bike to a list',()=>{

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
            service.adapters = {
                "1" : {
                    hasCapability: jest.fn( (c)=> c===IncyclistCapability.HeartRate),
                    isControllable: jest.fn().mockReturnValue(false),
                    isEqual:jest.fn().mockReturnValue(false)
                },
                "2" : {
                    hasCapability: jest.fn().mockReturnValue(true),
                    isControllable: jest.fn().mockReturnValue(true),
                    isEqual: jest.fn().mockReturnValue(false)
                }
            }

            service.add( {interface:'serial',name:'Daum 8080',port:'COM4'})

            const settings = service.settings
            expect(settings.devices.length).toBe(2)

            expect(settings.capabilities.find(c=>c.capability==='bike')).toMatchObject( {selected:'2'})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:'2'})

            // hearrate sensor was not overwritten
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:'1'})
        })


    })    

    describe( 'select',()=>{

        let service;
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()
            service.emitCapabiltyChanged = jest.fn()
        })

        afterEach( ()=>{
            service.reset()
        })

        test('devices are undefined',()=>{
            service.settings={}
            service.select('1234','bike')

            const settings = service.settings
            expect(settings.devices).toBeUndefined()
            expect(service.emitCapabiltyChanged).not.toHaveBeenCalled()

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
            service.adapters = {
                "1" : {
                    hasCapability: jest.fn( (c)=> c===IncyclistCapability.HeartRate),
                    isControllable: jest.fn().mockReturnValue(false)
                },
                "2" : {
                    hasCapability: jest.fn().mockReturnValue(true),
                    isControllable: jest.fn().mockReturnValue(true)
                }
            }

            service.select('2',IncyclistCapability.HeartRate)

            const settings = service.settings
            expect(settings.devices.length).toBe(2)

            expect(settings.capabilities.find(c=>c.capability==='bike')).toMatchObject( {selected:'2'})
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:'2'})
        })






    })


    describe( 'delete',()=>{

        let service;
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()
        })

        afterEach( ()=>{
            service.reset()
        })

        test('deleting selected control device in middle of category',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                    {udid:'3',settings:{interface:'simulator',name:'Simulator'}},
                    {udid:'4',settings:{interface:'ble',address:'126',protocol:'fm'}},
                    {udid:'5',settings:{interface:'ble',address:'127',protocol:'fm'}},
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2']},
                    {capability:IncyclistCapability.Control, selected:'3', devices:['2','3','4','5']},
                ]
            }

            service.delete('3',IncyclistCapability.Control)

            const settings = service.settings
            expect(settings.devices.length).toBe(4)
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:'4', devices:['2','4','5']})

        })

        test('deleting selected control device at bottom of category',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                    {udid:'3',settings:{interface:'simulator',name:'Simulator'}},
                    {udid:'4',settings:{interface:'ble',address:'126',protocol:'fm'}},
                    {udid:'5',settings:{interface:'ble',address:'127',protocol:'fm'}},
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2']},
                    {capability:'bike', selected:'5', devices:['2','3','4','5']},
                ]
            }

            service.delete('5','bike')

            const settings = service.settings
            expect(settings.devices.length).toBe(4)
            expect(settings.capabilities.find(c=>c.capability==='bike')).toMatchObject( {selected:'4', devices:['2','3','4']})

        })

        test('deleting not selected control device in middle of category',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                    {udid:'3',settings:{interface:'simulator',name:'Simulator'}},
                    {udid:'4',settings:{interface:'ble',address:'126',protocol:'fm'}},
                    {udid:'5',settings:{interface:'ble',address:'127',protocol:'fm'}},
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2']},
                    {capability:IncyclistCapability.Control, selected:'3', devices:['2','3','4','5']},
                ]
            }

            service.delete('4',IncyclistCapability.Control)

            const settings = service.settings
            expect(settings.devices.length).toBe(4)
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject( {selected:'3', devices:['2','3','5']})

        })


        test('deleting control device in non-control capability',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                    {udid:'3',settings:{interface:'simulator',name:'Simulator'}},
                    {udid:'4',settings:{interface:'ble',address:'126',protocol:'fm'}},
                    {udid:'5',settings:{interface:'ble',address:'127',protocol:'fm'}},
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2']},
                    {capability:IncyclistCapability.Control, selected:'3', devices:['2','3','4','5']},
                ]
            }
           

            service.delete('2',IncyclistCapability.HeartRate)

            const settings = service.settings
            expect(settings.devices.length).toBe(5)
            expect(settings.capabilities.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject( {selected:'1', devices:['1']})

        })

        test('delete last remaining device',()=>{
            service.settings = {                
                devices: [
                    {udid:'1',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                ],
                capabilities: [
                    {capability:'bike',selected:'1',devices:['1']},
                    {capability:IncyclistCapability.Control,selected:'1',devices:['1']},
                    {capability:IncyclistCapability.Power,selected:'1',devices:['1']},
                    {capability:IncyclistCapability.HeartRate,selected:'1',devices:['1']}
            
                ],
                interfaces: [
                    {name:'ble', enabled:false},
                    {name:'ant', enabled:false},
                    {name:'tcpip', enabled:false},
                    {name:'serial', enabled:true}
                ]
            }

            service.delete('1','bike')

            const settings = service.settings
            expect(settings.devices.length).toBe(0)
            //expect(settings.capabilities).toBe(0)
            expect(settings.capabilities.find(c=>c.capability==='bike')?.devices.length).toBe(0)

            
        })



    })    

    describe( 'setInterfaceSettings',()=>{


        let service;
        beforeEach( async ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()

            service.inject('UserSettings', new UserSettingsMock({
                interfaces: [
                    {name:'ble', enabled:true},
                    {name:'ant', enabled:false},
                    {name:'serial', enabled:false}                              
                ]
            }))

            await service.init()

        })

        afterEach( ()=>{
            service.reset()
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

    describe( 'getDeviceConfigurationInfo',()=>{
        let service
        beforeEach( ()=>{
            service = new DeviceConfigurationService()
            service.settings =  clone(SampleSettings)
            service.adapters = {}
            service.settings.devices?.forEach(d => {
                
                const adapter = AdapterFactory.create(d.settings)
                service.adapters[d.udid]=adapter
            })
        })

        afterEach( ()=>{
            service.reset()
        })

        test('normal setup',()=>{
            const res = service.getDeviceConfigurationInfo()
            expect(res[IncyclistCapability.Control]).toBeDefined()
            expect(res[IncyclistCapability.Control]).toMatchObject( {capability:'control', devices:[ {name:'1',selected:true, udid:'1'},{name:'2',selected:false, udid:'2'}], disabled:false})
        })
    })

    describe('waitForInit',()=>{
        let service:DeviceConfigurationService
        let testData

        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.inject('UserSettings', new UserSettingsMock({}))
            service.emit = jest.fn()
            //service.initFromLegacy = jest.fn() //spyOn(service,'initFromLegacy')

        })

        afterEach( ()=>{
            AdapterFactory.reset()
            service.reset()
        })

        test('not initialized',()=>{
            expect(service.isInitialized()).toBe(false)
        })
    })

  
    describe ('getModeSettings',()=>{

        let service:DeviceConfigurationService
        
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()

        })

        afterEach( ()=>{
            AdapterFactory.reset()
        })

        test('with settings',async ()=>{
            const settings = clone(SampleSettings)
            service.inject('UserSettings', new UserSettingsMock(settings))
            await service.init()

            
            const res = service.getModeSettings('1')
            const options = res.options?.map( o=>o.getName())
            delete res.options
            expect(options).toEqual(['PowerMeter','Smart Trainer','ERG'])


            expect(res).toMatchObject({udid:'1',mode:'ERG',settings:{ startPower:"100" },isERG:true, isSIM:false})
        })

        test('no settings',async ()=>{
            const settings = clone(SampleSettings)
            service.inject('UserSettings', new UserSettingsMock(settings))
            await service.init()

            const res = service.getModeSettings('2')
            const options = res.options?.map( o=>o.getName())
            delete res.options
            expect(options).toEqual(['PowerMeter','Smart Trainer','ERG'])

            expect(res).toMatchObject({udid:'2',mode:'Smart Trainer',settings:{},isERG:false, isSIM:true})
        })

        test('mode selected',async ()=>{
            const settings = clone(SampleSettings)
            delete settings.devices[0].modes
            service.inject('UserSettings', new UserSettingsMock(settings))
            await service.init()

            const res = service.getModeSettings('1')

            const options = res.options?.map( o=>o.getName())
            delete res.options

            expect(res).toMatchObject({udid:'1',mode:'ERG',settings:{},isERG:true, isSIM:false  })
            expect(options).toEqual(['PowerMeter','Smart Trainer','ERG'])
        })

        
    })

    describe('getAdapters',()=>{

        const A = (c) => ({ getCapabilities: jest.fn().mockReturnValue(c)})

        let service;
        beforeEach( ()=>{            
            service = new DeviceConfigurationService()
            service.updateUserSettings =jest.fn()
            service.emitCapabiltyChanged = jest.fn()

            SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue( {})

        })

        afterEach( ()=>{
            AdapterFactory.reset()
        })

        afterAll( ()=>{
            (SerialPortProvider as any)._instance = undefined
        })

        test('get all adapters',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2','3']},
                    {capability:IncyclistCapability.Control, selected:'2', devices:['2']}
                ]
            }
            service.adapters = {
                "1" : A(['hearrate']),
                "2" : A(['control','power','speed','cadence','hearrate']),
            }
            

            const res = service.getAdapters(false)
            expect(res.map(a=>a.udid)).toEqual(['1','2'])

        })      

        test('get only selected adapters',()=>{


            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                    {udid:'3',settings:{interface:'serial',name:'Daum 8080',port:'COM5'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2','3']},
                    {capability:IncyclistCapability.Control, selected:'2', devices:['2','3']},
                ]
            }
            service.adapters = {
                "1" : A(['hearrate']),
                "2" : A(['control','power','speed','cadence','hearrate']),
                "3" : A(['control','power','speed','cadence','hearrate'])
            }

            const res = service.getAdapters(true)
            expect(res.map(a=>a.udid)).toEqual(['1','2'])

        })      


        test('device with unsupported interface',()=>{
            service.settings = {
                devices:[
                    {udid:'1',settings:{interface:'ble',address:'124',protocol:'hr'}},
                    {udid:'2',settings:{interface:'serial',name:'Daum 8080',port:'COM4'}},
                    {udid:'3',settings:{interface:'wifi',name:'234',protocol:'hr'}}
                ], 
                capabilities:[
                    {capability:IncyclistCapability.HeartRate, selected:'1',devices:['1','2','3']},
                    {capability:IncyclistCapability.Control, selected:'2', devices:['2']},
                    {capability:'bike', selected:'2',devices:['2']}
                ]
            }
            service.adapters = {
                "1" : A(['hearrate']),
                "2" : A(['control','power','speed','cadence','hearrate']),
            }

            const res = service.getAdapters(false)
            expect(res.map(a=>a.udid)).toEqual(['1','2'])

        })      

    })
    
})