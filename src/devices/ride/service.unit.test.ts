import { AntCadAdapter, AntDeviceSettings, AntFEAdapter, AntPwrAdapter, DeviceData, DeviceSettings, IncyclistCapability } from 'incyclist-devices'
import {DeviceRideService} from './service'
import { AdapterRideInfo, RideServiceDeviceProperties } from './model'
import { DeviceConfigurationService } from '../configuration'
import { Inject } from '../../base/decorators'
import { createFromJson } from '../../routes'
import sydney from '../../../__tests__/data/routes/sydney.json'
import tryvann from '../../../__tests__/data/rlv/Tryvann.json'
import { RouteApiDetail } from '../../routes/base/api/types'

describe('DeviceRideService',()=>{
    describe('onData',()=>{
        let service:DeviceRideService, s
        const data: Array<DeviceData> = []
        const setupMocks  = (s,adapters)=>{
            s.getSelectedAdapters = jest.fn().mockReturnValue( adapters)

            const configurationService= { 
                getSelectedDevices: jest.fn(()=>
                    [{capability:IncyclistCapability.Cadence,selected:'2'},
                    {capability:IncyclistCapability.Power,selected:'1'}]
            )}
            s.emit = jest.fn( (e,d)=>{ data.push(d)} )
            s.inject('DeviceConfiguration', configurationService)

        }
        beforeEach( ()=>{
            service = new DeviceRideService()            
        })

        afterEach( ()=>{
            service.reset()
        })

        test('bug: no progress at  ride with ANT+PWR+ anf ANT+CAD',()=>{
            const d1 = {deviceID:'1',interface:'ant', profile:'PWR'} as DeviceSettings
            const d2 = {deviceID:'2',interface:'ant', profile:'CAD'} as DeviceSettings

            const pwr = new AntPwrAdapter(d1 as AntDeviceSettings)
            const cad = new AntCadAdapter(d2 as AntDeviceSettings)
            const adapters:AdapterRideInfo[] = []
            adapters.push( { adapter:pwr,udid:'1', capabilities:[IncyclistCapability.Power, IncyclistCapability.Cadence, IncyclistCapability.Speed], isStarted:true })
            adapters.push( { adapter:cad,udid:'2', capabilities:[IncyclistCapability.Cadence], isStarted:true })

            setupMocks(service,adapters)            


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

    describe('start',()=>{

        let service: DeviceRideService
        let adapter
        let mockConfig: Partial<DeviceConfigurationService> = {
            isInitialized: jest.fn().mockReturnValue(true),
            once:jest.fn(),
            on:jest.fn(),
            off:jest.fn(),
            removeAllListeners:jest.fn(),
            getModeSettings:jest.fn().mockReturnValue({}),
            //getSelectedDevices:jest.fn().mockReturnValue(null)
        }

        const setupMocks = (s,a,props?)=> {

            let _mode = undefined
            const {disableControl} = props ?? {}

            if (disableControl) {
                s.getSelectedAdapters = jest.fn().mockReturnValue( [{udid:'1', adapter:a, capabilities:a.getCapabilities().filter( c => c !== IncyclistCapability.Control)}])
                s.getConfiguredAdapters= jest.fn().mockReturnValue( [{udid:'1', adapter:a, capabilities:a.getCapabilities().filter( c => c !== IncyclistCapability.Control)}])
                
            }
            else  {
                s.getSelectedAdapters = jest.fn().mockReturnValue( [{udid:'1', adapter:a, capabilities:a.getCapabilities()}])
                s.getConfiguredAdapters= jest.fn().mockReturnValue( [{udid:'1', adapter:a, capabilities:a.getCapabilities()}])

            }

            a.isStarted = jest.fn().mockReturnValue(true)
            a.start = jest.fn().mockResolvedValue(true)

            a.getCyclingMode = jest.fn( ()=> { return _mode ?? a.getDefaultCyclingMode()})
            a.setCyclingMode = jest.fn( (mode, settings) => { _mode = mode })
        }
        beforeEach( ()=>{
            service = new DeviceRideService()
            service.inject('DeviceConfiguration', mockConfig)
        })

        afterEach( ()=>{                
            service.stop()
            service.reset()        
        })

        test('only powermeter',async ()=>{
            adapter = new AntPwrAdapter({deviceID: '2606',profile: 'PWR',interface: 'ant'})
            setupMocks(service,adapter)

            const props:Partial<RideServiceDeviceProperties> = {forceErgMode:false, user:{weight:70}}
            const started = await service.start(props)
            expect(started).toBe(true)
        })

        test('only smarttrainer',async ()=>{
            adapter = new AntFEAdapter({deviceID: '2606',profile: 'FE',interface: 'ant'})
            setupMocks(service,adapter)

            const props:Partial<RideServiceDeviceProperties> = {forceErgMode:false, user:{weight:70}}
            const started = await service.start(props)
            expect(started).toBe(true)
            expect(adapter.setCyclingMode).toHaveBeenCalled()
            expect(adapter.getCyclingMode().getName()).toBe('Smart Trainer')
        })

        test('workout with enforced erg mode',async ()=>{
            adapter = new AntFEAdapter({deviceID: '2606',profile: 'FE',interface: 'ant'})
            setupMocks(service,adapter)

            const props:Partial<RideServiceDeviceProperties> = {forceErgMode:true, user:{weight:70}}
            const started = await service.start(props)
            expect(started).toBe(true)
            expect(adapter.setCyclingMode).toHaveBeenCalled()
            expect(adapter.getCyclingMode().getName()).toBe('ERG')

        })

        test('adapter is disabled for control capability',async ()=>{
            adapter = new AntFEAdapter({deviceID: '2606',profile: 'FE',interface: 'ant' },{capabilities:[IncyclistCapability.Power]})
            setupMocks(service,adapter,{disableControl:true})

            

            const props:Partial<RideServiceDeviceProperties> = {forceErgMode:true, user:{weight:70}}
            const started = await service.start(props)
            expect(started).toBe(true)
            //expect(adapter.setCyclingMode).not.toHaveBeenCalled()
            expect(adapter.getCyclingMode().getName()).toBe('PowerMeter')

        })

    })

    describe('resetCyclingMode',()=>{
        let service: DeviceRideService
        let adapter
        let mockConfig: Partial<DeviceConfigurationService> = {
            isInitialized: jest.fn().mockReturnValue(true),
            once:jest.fn(),
            on:jest.fn(),
            off:jest.fn(),
            removeAllListeners:jest.fn(),
            getModeSettings:jest.fn().mockReturnValue({}),
        }

        const setupMocks = (s,a, props:{mode?:string}={})=> {
            s.getSelectedAdapters = jest.fn().mockReturnValue( [{udid:'1', adapter:a, capabilities:a.getCapabilities()}])
            s.getConfiguredAdapters= jest.fn().mockReturnValue( [{udid:'1', adapter:a, capabiilties:a.getCapabilities()}])
            a.isStarted = jest.fn().mockReturnValue(true)
            a.start = jest.fn().mockResolvedValue(true)
            s.getConfiguredModeInfo = jest.fn().mockReturnValue({ mode: props?.mode??a.getDefaultCyclingMode().getName(), settings: {} });
            s.isToggleEnabled = jest.fn().mockReturnValue(true)
        }
        beforeEach( ()=>{
            service = new DeviceRideService()
            service.inject('DeviceConfiguration', mockConfig)
        })

        afterEach( ()=>{                
            service.stop()
            service.reset()            
        })

        test('still in same mode as start',async ()=>{
            adapter = new AntFEAdapter({deviceID: '2606',profile: 'FE',interface: 'ant'})
            setupMocks(service,adapter)

            const originalMode = service.getCyclingMode()
            const res = await service.resetCyclingMode()

            expect(res.changed).toBe(false)
            expect (res.mode?.getName()).toEqual(originalMode.getName())
        })

        test('after toggling cycling mode once',async ()=>{
            adapter = new AntFEAdapter({deviceID: '2606',profile: 'FE',interface: 'ant'})
            setupMocks(service,adapter)

            const originalMode = service.getCyclingMode()

            service.toggleCyclingMode()
            const res = await service.resetCyclingMode()

            expect(res.changed).toBe(true)
            expect (res.mode?.getName()).toEqual(originalMode.getName())
        })



    })


    describe('prepareEppRoute',()=>{

        let service:DeviceRideService
        let settings

        const setupMocks = ( s, props?:{programId?:number, routeInfo?} )=> {
            const {programId,routeInfo} = props??{}
            settings = {
                get: jest.fn( (key,def)=> key === 'eppPreferences' ? {programId} : def ),
                update: jest.fn()
            }
    
            Inject('UserSettings',settings)
            if (routeInfo) {
                s.getRouteInfo = jest.fn().mockReturnValue(routeInfo)
            }
        }

        beforeEach( ()=> {
            service = new DeviceRideService()            

        })

        afterEach( ()=> {
            service.reset()
            Inject('UserSettings',null)
            jest.resetAllMocks()

        })


        describe('with EPP',()=>{
            const route = createFromJson(tryvann as unknown as RouteApiDetail)
            

            test('no startPos',()=>{
                setupMocks(service)
                const res = service.prepareEppRoute({route, rideMode:'video'})
                expect(res).toMatchSnapshot()
            })
            test('with startPos',()=>{
                setupMocks(service)
                const res = service.prepareEppRoute({route, startPos:5611, rideMode:'video'})                
                expect(res).toMatchSnapshot()
            })
            test('with RealityFactor',()=>{
                setupMocks(service)
                const res = service.prepareEppRoute({route, startPos:5611, realityFactor:10})         
                expect(res).toMatchSnapshot()
            })

        })

        describe('no EPP',()=>{
            const route = createFromJson(sydney as unknown as RouteApiDetail)

            test('no startPos',()=>{
                setupMocks(service,{programId:10})
                route.description.isLoop = true
                const res = service.prepareEppRoute({route})                
                expect(res).toMatchSnapshot()
                expect(settings.update).toHaveBeenCalledWith({"eppPreferences": {"programId": 11}})

            })

            test('with startPos',()=>{
                setupMocks(service,{programId:10})
                route.description.isLoop = false
                const res = service.prepareEppRoute({route, startPos:3750})
                expect(res).toMatchSnapshot()
            })
            test('with realityFactor',()=>{
                setupMocks(service,{programId:10})
                route.description.isLoop = false
                const res = service.prepareEppRoute({route, startPos:3750, realityFactor:10})
                expect(res).toMatchSnapshot()
            })


            test('loop with startPos',()=>{
                setupMocks(service,{programId:32767})
                route.description.isLoop = true
                const res = service.prepareEppRoute({route, startPos:3750})
                expect(res).toMatchSnapshot()
                expect(settings.update).toHaveBeenCalledWith({"eppPreferences": {"programId": 1}})

            })

        })

    })
})