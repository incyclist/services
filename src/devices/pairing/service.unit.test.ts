/* eslint-disable @typescript-eslint/no-explicit-any */
import {  IncyclistCapability, IncyclistDeviceAdapter, DeviceProperties, IncyclistDevice,DeviceSettings } from 'incyclist-devices'
import { CapabilityInformation, DeviceConfigurationService, DeviceConfigurationSettings, ExtendedIncyclistCapability, InterfaceSetting, useDeviceConfiguration,} from '../configuration'
import {DevicePairingService} from './service'
import { DeviceAccessService, useDeviceAccess } from '../access'
import { DeviceRideService, useDeviceRide } from '../ride'
import UserSettingsMock from '../../settings/user/mock'
import { CapabilityData, DevicePairingData, PairingSettings, PairingState } from './model'
import { UserSettingsService } from '../../settings'
import { sleep } from '../../utils/sleep'

let ride:DeviceRideService
let access:DeviceAccessService
let configuration:DeviceConfigurationService
let svc:TestWrapper
const onStateChanged = jest.fn()
const onDeviceSelectStateChanged = jest.fn()

const settings:DeviceConfigurationSettings = {
    devices:[],
    capabilities:[],
    interfaces: [
        { name:'ant', enabled:true },
        { name:'ble', enabled:true },
        { name:'serial', enabled:false, protocol:'Daum Classic' },
        { name:'tcpip', enabled:true },
    ],
}
type DeviceList =  Array<{ udid:string, selected?:boolean,deleted?:boolean, c?:Array<string>,isStarted?:boolean,profile?:string,interface?:string,interfaceInactive?:boolean}>

class TestWrapper extends DevicePairingService {

    static setupMocks  ( props:{forStart?:boolean, userSettings?:UserSettingsService}={}) {
        const {forStart=false} = props;
        ride = useDeviceRide()
        access = useDeviceAccess()
        configuration = useDeviceConfiguration()

        if (!forStart) {
            configuration.add = jest.fn()
            configuration.canStartRide = jest.fn()
            configuration.getAdapter = jest.fn()  // (udid)=>IncyclistDeviceAdapter
            configuration.select=jest.fn()// ()=>{console.log('select')})
            configuration.unselect=jest.fn()
            configuration.canStartRide=jest.fn()
            configuration.delete=jest.fn()
            configuration.setInterfaceSettings=jest.fn()
            configuration.init=jest.fn()
        }

        ride.startAdapters=jest.fn()
        ride.getAdapters=jest.fn().mockReturnValue([])
        ride.cancelStart = jest.fn().mockResolvedValue(true)
        ride.lazyInit = jest.fn().mockResolvedValue(true)

        access.scan = jest.fn()
        access.enableInterface = jest.fn()
        access.disableInterface = jest.fn()
        access.stopScan = jest.fn()
        access.enrichWithAccessState = jest.fn( (interfaces)=>{ return interfaces.map(i => ({...i, state:'connected', isScanning:false}))})


        // simulate feature toggle
        
    }

    static resetMocks() {
        ride.removeAllListeners();
        access.removeAllListeners();
        access.reset()
        configuration?.removeAllListeners();
        configuration?.reset();

        (DeviceAccessService as any)._instance = undefined;
        (DeviceConfigurationService as any)._instance = undefined;
        (DeviceRideService as any)._instance = undefined;  
        (UserSettingsService as any)._instance = undefined              
    }

    setCanStartRide(enabled) {
        configuration.canStartRide= jest.fn().mockReturnValue(enabled)
    }


    setupMockData  (capability:IncyclistCapability|string, devices:DeviceList  )   {

        if (!this.state.deleted) this.state.deleted = []

        const addAdapter = ( udid, c, ifName)=> {
            

            try {
            const capabilities = c.map(cap=>cap as IncyclistCapability)
            if (!this.getState().adapters)                    
                this.getState().adapters=[]

            if (this.getState().adapters?.find(ai=>ai.udid===udid))
                return;

            this.getState().adapters?.push( {udid,capabilities,
                adapter:{                         
                    onScanStart:jest.fn(),
                    onScanStop:jest.fn(),
                    getCapabilities:jest.fn().mockReturnValue(capabilities),
                    hasCapability:jest.fn( (name) => capabilities.find(c =>c===name)),
                    pause:jest.fn().mockResolvedValue(true),
                    start:jest.fn().mockResolvedValue(true),
                    stop:jest.fn().mockResolvedValue(true),
                    getInterface:jest.fn().mockReturnValue(ifName),
                    isStarted:jest.fn().mockReturnValue(true),
                    isPaused:jest.fn().mockReturnValue(false),
                    isStopped:jest.fn().mockReturnValueOnce(false).mockReturnValue(true)
                } as unknown as IncyclistDevice<DeviceProperties>})
            }
            catch(err) {
                console.log(err)
            }
        }

        devices.forEach( d=> { 
            if(!d)
                return
            try {
                const caps = [capability];
                if (d?.c && d.c?.length>0)
                    caps.push(...d.c)
                addAdapter(d.udid, caps, d.interface) 
    
                settings.devices?.push( {udid:d.udid,settings: {profile: d.profile||"FE", interface: d.interface||"ant", deviceID:d.udid } } as any)

                const setCaps = settings.capabilities || []
                const setDev = settings.devices || []

                if (!this.getState().capabilities)                    
                    this.getState().capabilities=[] as CapabilityData[]
                const state = this.getState().capabilities as CapabilityData[]
                const existing = state.find(c=>c.capability===capability) 
                const idx = state.findIndex(c=>c.capability===capability) 
                const info = existing || { capability, devices:[] as Array<DevicePairingData>} as CapabilityData                   
                info.devices.push( {...d,interface:d.interface||'ant', name:d.udid,selected:d.selected||false,udid:d.udid,connectState:'connecting'} )
                if (d.selected) {
                    info.selected = d.udid;
                    info.interface = d.interface as string
                }
                if (d.deleted) this.state.deleted.push( {capability: capability as IncyclistCapability,udid:d.udid})
                if (!existing) 
                    state.push(info)
                else 
                    state[idx] = info
    
                if (!settings.capabilities)
                    settings.capabilities=[]
    

                const settingsCap  = {capability:capability as ExtendedIncyclistCapability, selected:info.selected, devices:setDev.map(sd=>sd.udid),disabled:false}
                if (setCaps.find(c=>c.capability===capability)) {
                    const i = setCaps.findIndex(c=>c.capability===capability)
                    setCaps[i]=settingsCap
                }
                else 
                    setCaps.push(settingsCap)
                

            }
            catch(err) {
                console.log(err)
            }
        })

        this.state.interfaces =  [
            { name:'ant', enabled:true, isScanning:false,state:'connected' },
            { name:'ble', enabled:true, isScanning:false,state:'connected' },
            { name:'serial', enabled:false, protocol:'Daum Classic', isScanning:false,state:'unknown' },
            { name:'tcpip', enabled:true, isScanning:false,state:'connected' },
        ]

        this.loadConfiguration = jest.fn()
        this.waitForInit = jest.fn().mockResolvedValue(true)


      
    
    }

    mock(fn:string, mockFn?) {
        this[fn] = mockFn|| jest.fn()
        return this[fn]
    }

    getState() {
        return this.state
    }

    initServices() {
        this.configuration = useDeviceConfiguration()
        this.access = useDeviceAccess()
        this.rideService = useDeviceRide()
    }

    resetServices() {
        this.run = jest.fn();

        configuration.reset()
        this.configuration.reset();

        (DeviceAccessService as any)._instance = undefined;
        (DeviceRideService as any)._instance = undefined;  

    }

    getPairingRetryDelay() {
        return 10;
    }

    getScanDelay() {
        return 10000;
    }

    setSettings( settings:PairingSettings) {
        this.settings = settings
    }

    setPairingInfo( info) {
        this.state = {...this.state, ...info}
    }
    addToPairingInfo( info) {
        this.state = {...this.state,...info}
    }

    simulatePairing() {
        this.state.check ={promise:new Promise<boolean>(()=>{})}
        this.state.scan = undefined;
        this.state.props= {}
        
        
        this.setSettings({onStateChanged})
        this.initPairingCallbacks()
        this.initConfigHandlers()

    }

    isPairing() {
        return super.isPairing()
    }
    isScanning() {
        return super.isScanning()
    }

    simulateScanning() {
        this.state.check = undefined;
        this.state.scan= {
                promise:new Promise<DeviceSettings[]>(()=>{}),
                adapters:[]
            }
        this.state.props= {}
        this.setSettings({onStateChanged,onDeviceSelectStateChanged})
        this.initScanningCallbacks()

    }

    setCapabilityData(capability:IncyclistCapability|string, data) {
        const c =  this.getCapability(capability as IncyclistCapability)
        if (!c)
            return
        const d = this.getCapabilityDevice(c)

        Object.assign(c,{...data})
        const {unit,value,connectState} = data
        Object.assign(d,{unit,value,connectState})
    }

    getCapabilityData(capability:IncyclistCapability|string) {
        const c =  this.getCapability(capability as IncyclistCapability)
        return c
    }

    getDeviceAdapter(udid: string): IncyclistDeviceAdapter | undefined {
        return super.getDeviceAdapter(udid)
    }

    mappedCapability(c:CapabilityInformation):CapabilityData {
        return super.mappedCapability(c)
    }


}


describe('PairingService',()=>{


    describe('api',()=>{

        describe('start',()=>{
            
            let logEvent
            let logCapabilities
            let userSettings

            beforeEach( ()=>{


                TestWrapper.setupMocks({forStart:true})

                settings.interfaces= [
                    { name:'ant', enabled:true },
                    { name:'ble', enabled:true },
                    { name:'serial', enabled:false, protocol:'Daum Classic' },
                    { name:'tcpip', enabled:true },
                ]
                settings.devices = []
                settings.capabilities= []

                svc = new TestWrapper()
                logEvent  = jest.spyOn(svc as any,'logEvent')
                logCapabilities = svc.mock('logCapabilities')
                

            })

            afterEach( async ()=>{
                svc.stop();

                TestWrapper.resetMocks()
                jest.resetAllMocks()

            })

            test('no devices in configuration will start scan',async ()=>{
                configuration.inject('UserSettings',new UserSettingsMock(settings))

                const updates: Array<PairingState> = [];
                const res = await new Promise (done => {
                    svc.start( (status:PairingState)=>{ 
                        updates.push(status);
                        if (updates.length==4) done(updates)  
                    })
                })

                expect(res).toMatchSnapshot()        
                expect(logEvent).toHaveBeenCalledWith( expect.objectContaining( {message:'Start Scanning'}))
                expect(ride.startAdapters).not.toHaveBeenCalled()
                expect(access.scan).toHaveBeenCalled()
            },50000)

            test('no devices in configuration; FE device found in scan',async ()=>{
                settings.devices = []
                settings.capabilities= []
                configuration.inject('UserSettings',new UserSettingsMock(settings))
                

                const device = {interface:'ant', profile: "FE", deviceID: 1234 }
                
                access.scan = jest.fn( async ()=>{
                    access.emit('device', device)
                    
                    return [device]
                })
                const updates: Array<PairingState> = [];
                
                // we are expecting 3 status updates, the last one to contain the 
                await new Promise (done => {
                    svc.on('log',(e)=>{ 
                        if (e.message == 'Pairing completed')
                            done(updates)
                    })                   
                    svc.start( (status:PairingState)=>{ 
                        updates.push(status)
                    })
                })


                expect(logCapabilities).toHaveBeenCalled()
                
                expect(logEvent).toHaveBeenNthCalledWith( 1,expect.objectContaining( {message:'Stopping Adapters'}))
                expect(logEvent).toHaveBeenNthCalledWith( 2,expect.objectContaining( {message:'Start Scanning'}))
                expect(logEvent).toHaveBeenNthCalledWith( 4,expect.objectContaining( {message:'device detected', device:{deviceID:1234, interface:'ant', profile:'FE'}}))
                expect(logEvent).toHaveBeenCalledWith( expect.objectContaining( {message:'Pairing completed'}))
                expect(access.scan).toHaveBeenCalled()
                
                expect(svc.getState().canStartRide).toBe(true)
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject({deviceName:'Ant+FE 1234'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Power)).toMatchObject({deviceName:'Ant+FE 1234'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Speed)).toMatchObject({deviceName:'Ant+FE 1234'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Cadence)).toMatchObject({deviceName:'Ant+FE 1234'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject({deviceName:undefined})
                expect(svc.getState).toMatchSnapshot()

            })

            test('no devices in configuration; HRM sensor found in scan',async ()=>{

                const device = {interface:'ant', profile: "HR", deviceID: 1234 }
                settings.devices = []
                settings.capabilities =[]
                configuration.inject('UserSettings',new UserSettingsMock(settings))

                
                access.scan = jest.fn( async ()=>{
                    access.emit('device', device)                    
                    return [device]
                })

                const updates: Array<PairingState> = [];
                let startCnt = 0;
                // we are expecting a couple of message until we finally receive a 2nd "Start Scanning"
                await new Promise (done => {
                    svc.on('log',(e)=>{ 
                        
                        if (e.message==='Start Scanning') 
                            startCnt++;

                        if (startCnt===2)
                            done(updates)
                    })                   

                    svc.start( (status:PairingState)=>{ 
                        updates.push(status)
                    })
                })

                expect(logEvent).toHaveBeenNthCalledWith( 1,expect.objectContaining( {message:'Stopping Adapters'}))
                expect(logEvent).toHaveBeenNthCalledWith( 2,expect.objectContaining( {message:'Start Scanning'}))
                // message 3: connect state
                expect(logEvent).toHaveBeenNthCalledWith( 4,expect.objectContaining( {message:'device detected', device:{deviceID:1234, interface:'ant', profile:'HR'}}))
                
                expect(access.scan).toHaveBeenCalled()
                expect(ride.startAdapters).not.toHaveBeenCalled()
                expect(svc.getState().canStartRide).toBe(false)
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject({deviceName:undefined})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Power)).toMatchObject({deviceName:undefined})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Speed)).toMatchObject({deviceName:undefined})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Cadence)).toMatchObject({deviceName:undefined})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject({deviceName:'Ant+HR 1234'})
                expect(svc.getState).toMatchSnapshot()

            })

            test('FE device in configuration',async ()=>{

                settings.devices = [
                        { "udid": "1", settings: {"profile": "FE", "interface": "ant","deviceID": "1234" } }
                    ];

                settings.capabilities = [
                        {capability: IncyclistCapability.Control,devices: ["1"],selected: "1",disabled: false },
                        {capability: IncyclistCapability.Power,devices: ["1"],selected: "1",disabled: false },
                        {capability: IncyclistCapability.Cadence,devices: ["1"],selected: "1",disabled: false },
                        {capability: IncyclistCapability.Speed,devices: ["1"],selected: "1",disabled: false },
                        {capability: IncyclistCapability.HeartRate,devices: [],selected: undefined,disabled: false },
                    ]
                configuration.inject('UserSettings',new UserSettingsMock(settings))
    
                ride.startAdapters=jest.fn( async ()=> { 
                    ride.emit('pairing-start',)
                    return false
                })
                ride.getAdapters= jest.fn().mockReturnValue( 
                    [ { udid:'1', 
                        capabilties:[IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Speed, IncyclistCapability.Cadence], 
                        adapter: {  
                            isStarted:jest.fn().mockReturnValue(false),
                            isPaused:jest.fn().mockReturnValue(false),
                            isStopped:jest.fn().mockReturnValue(undefined),
                            pause:jest.fn().mockResolvedValue(true)
                        }
                      }])
                svc.getState().adapters = ride.getAdapters({})
                

                const updates: Array<PairingState> = [];
                let numLogs = 0;
                // we are expecting 3 status updates, the last one to contain the 
                await new Promise (done => {
                    svc.on('log',()=>{ 
                        ++numLogs
                        if (numLogs===2) 
                            done(updates)
                    })                   
                    svc.start( (status:PairingState)=>{ 
                        updates.push(status)
                    })
                })

                //expect(res).toMatchSnapshot()        
                //console.log(JSON.stringify(res,undefined,2))

                expect(logEvent).toHaveBeenNthCalledWith( 1,expect.objectContaining( {message:'Start Pairing'}))
                expect(access.scan).not.toHaveBeenCalled()
                expect(ride.startAdapters).toHaveBeenCalled()

                expect(svc.getState().canStartRide).toBe(false)
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Power)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Speed)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Cadence)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
                expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject({deviceName:undefined})
                expect(svc.getState).toMatchSnapshot()

            })

            test.skip('FE and PWR device in configuration, PWR device fails to start',async ()=>{ 
                settings.devices = [
                    { udid: "1", settings: {"profile": "FE", "interface": "ant","deviceID": "1234" } },
                    { udid: "2", settings: {"profile": "PWR", "interface": "ant","deviceID": "2345" } }
                ];

            settings.capabilities = [

                {capability: IncyclistCapability.Control,devices: ["1"],selected: "1",disabled: false },
                {capability: IncyclistCapability.Power,devices: ["1","2"],selected: "2",disabled: false },
                {capability: IncyclistCapability.Cadence,devices: ["1"],selected: "1",disabled: false },
                {capability: IncyclistCapability.Speed,devices: ["1"],selected: "1",disabled: false },
                {capability: IncyclistCapability.HeartRate,devices: [],selected: undefined,disabled: false },

                ]
            
            ride.startAdapters=jest.fn( async ()=> { 
                ride.emit('pair-start',{sType:'bike ',})
                ride.emit('pair-error','2')
                return false
            })
            ride.getAdapters= jest.fn().mockReturnValue( 
                [ { udid:'1', 
                    capabilties:[IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Speed, IncyclistCapability.Cadence], 
                    adapter: {  
                        isStarted:jest.fn().mockReturnValue(false),
                        pause:jest.fn().mockResolvedValue(true)
                    }
                  },
                  { udid:'2', 
                    capabilties:[IncyclistCapability.Power], 
                    adapter: {  
                        isStarted:jest.fn().mockReturnValue(false),
                        pause:jest.fn().mockResolvedValue(true)
                    }
                  }
                ])

                
            

            const updates: Array<PairingState> = [];
            let numLogs = 0;
            // we are expecting 3 status updates, the last one to contain the 
            await new Promise (done => {
                svc.on('log',()=>{ 
                    ++numLogs
                    if (numLogs===2) 
                        done(updates)
                })                   
                svc.start( (status:PairingState)=>{ 
                    updates.push(status)
                })
            })

            //expect(res).toMatchSnapshot()        
            //console.log(JSON.stringify(res,undefined,2))

            expect(logEvent).toHaveBeenNthCalledWith( 1,expect.objectContaining( {message:'Start Pairing'}))
            expect(access.scan).not.toHaveBeenCalled()
            expect(ride.startAdapters).toHaveBeenCalled()

            expect(svc.getState().canStartRide).toBe(true)
            expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Control)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
            expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Power)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
            expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Speed)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
            expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.Cadence)).toMatchObject({deviceName:'Ant+FE 1234', connectState:'connecting'})
            expect(svc.getState().capabilities?.find(c=>c.capability===IncyclistCapability.HeartRate)).toMatchObject({deviceName:undefined})
            expect(svc.getState).toMatchSnapshot()

            })

            afterEach( ()=>{
                svc.stop()
            })
        })
        describe('stop',()=>{})

        describe('startDeviceSelection',()=>{

            let _run;
            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               

                svc.initServices()
                svc.setSettings( {onStateChanged})
                svc.setupMockData( IncyclistCapability.Control, [ 
                    {udid:'1', selected:true,interface:'ant'}, 
                    {udid:'3', selected:true,interface:'ant'}, 
                    {udid:'2',interface:'ble'} ]) 
                svc.setupMockData( IncyclistCapability.Power, []) 
    
                svc.simulatePairing() // the interface settings are not
                _run = svc.mock('run',jest.fn())
            })

            afterEach( ()=>{
                TestWrapper.resetMocks()
                jest.resetAllMocks()
            })


            test('capability with devices',async ()=>{                
                const antAdapter1 = svc.getDeviceAdapter('1')
                const antAdapter3 = svc.getDeviceAdapter('3')

                svc.getScanDelay = jest.fn().mockReturnValue(200)
                const promise = svc.startDeviceSelection(IncyclistCapability.Control,jest.fn())
                
                await sleep(20) // before scan delay
                expect(svc.getState().check).toBeDefined()        // still pairing
                expect(antAdapter1?.stop).not.toHaveBeenCalled()    // devices are not stopped

                await sleep(200) // go past scan delay
                expect(svc.getState().check).toBeUndefined()
                
                // all ant adapters are stopped
                expect(antAdapter1?.stop).toHaveBeenCalled()
                expect(antAdapter3?.stop).toHaveBeenCalled()

                // scan is enforced
                expect(_run).toHaveBeenCalledWith({enforcedScan:true})

                const res = await promise
                expect(res).toMatchSnapshot()

            })
            test('capability with no devices',async ()=>{
                svc.getScanDelay = jest.fn().mockReturnValue(1000)
                svc.startDeviceSelection(IncyclistCapability.Power,jest.fn())
                await sleep(20) // before scan delay

                expect(svc.getState().check).toBeUndefined()
                

                // scan is enforced
                expect(_run).toHaveBeenCalledWith({enforcedScan:true})

            })


            test('stop before scanStartDelay',async ()=>{
                const antAdapter1 = svc.getDeviceAdapter('1')
                
                expect(svc.getState().check).toBeDefined()        // still pairing

                svc.getScanDelay = jest.fn().mockReturnValue(200)
                const promise = svc.startDeviceSelection(IncyclistCapability.Control,jest.fn())
                
                await sleep(20) // before scan delay
                expect(svc.getState().check).toBeDefined()        // still pairing
                expect(antAdapter1?.stop).not.toHaveBeenCalled()    // devices are not stopped

                svc.stopDeviceSelection()

                await sleep(200) // go past scan delay
                expect(svc.getState().check).toBeDefined()        // still pairing
                expect(antAdapter1?.stop).not.toHaveBeenCalled()    // devices are not stopped
                expect(_run).not.toHaveBeenCalled()                 // scan is not enfored

                const res = await promise
                expect(res).toMatchSnapshot()


            })

        })
        //describe('stopDeviceSelection',()=>{})


        describe('selectDevice',()=>{
            let stopDeviceSelection;
            beforeEach( ()=>{
                TestWrapper.setupMocks()

                svc = new TestWrapper()

                svc.initServices()
                svc.simulateScanning()
                stopDeviceSelection = jest.spyOn(svc as any,'_stopDeviceSelection')
            })
            afterEach( ()=>{
                svc.resetServices()
                TestWrapper.resetMocks()
            })

            test('selecting a different device',async ()=>{

                // device is selected
                // previously selected device is not selected -> (can't be tested - as this is done by Config service)
                // scanning has been stopped
                // all adapters with same capability have beens stopped
                svc.setupMockData( IncyclistCapability.Power, [
                    {udid:'1', selected:true},
                    {udid:'2'}
                ])
                svc.setCapabilityData('power',{connectState:'connecting', value:100, unit:'W'})

                await svc.selectDevice( IncyclistCapability.Power,'2')

                expect(configuration.select).toHaveBeenCalledWith('2',IncyclistCapability.Power,{emit:true})
                expect(access.stopScan).toHaveBeenCalled()
                expect(svc.getCapabilityData('power')?.value).toBeUndefined()
                expect(stopDeviceSelection).toHaveBeenCalled()
            })


            test('selecting the same device - while scanning',async ()=>{
                // device is selected
                // scanning has been stopped
                // all adapters with same capability have beens stopped
                svc.setupMockData( IncyclistCapability.Power, [
                    {udid:'1', selected:true},
                    {udid:'2'}
                ])

                svc.setCapabilityData('power',{connectState:'connecting', value:100, unit:'W'})

                await svc.selectDevice( IncyclistCapability.Power,'1')

                expect(configuration.select).not.toHaveBeenCalled()
                expect(access.stopScan).toHaveBeenCalled()
                expect(svc.getCapabilityData('power')?.value).toBe(100)
                expect(stopDeviceSelection).toHaveBeenCalled()

            })

            test('selecting the same device - while pairing',async ()=>{
               
                // device is selected
                // pairing has not been stopped
                // scanning has not been stopped
                // all adapters with same capability have beens stopped
                svc.setupMockData( 'power', [
                    {udid:'1', selected:true},
                    {udid:'2'}
                ])

                svc.simulatePairing()
                svc.setCapabilityData('power',{connectState:'connecting', value:100, unit:'W'})

                await svc.selectDevice( IncyclistCapability.Power,'1')

                expect(configuration.select).not.toHaveBeenCalled()
                expect(ride.cancelStart).not.toHaveBeenCalled()
                expect(access.stopScan).not.toHaveBeenCalled()
                expect(svc.getCapabilityData('power')?.value).toBe(100)
                expect(stopDeviceSelection).toHaveBeenCalled()
            })


            test('no device selected before',async ()=>{
                // device is selected
                // previously selected device is not selected -> (can't be tested - as this is done by Config service)
                // scanning has been stopped
                // all adapters with same capability have beens stopped
                svc.setupMockData( IncyclistCapability.Power, [
                    {udid:'1'},
                    {udid:'2'}
                ])

                await svc.selectDevice( IncyclistCapability.Power,'2')

                expect(configuration.select).toHaveBeenCalledWith('2',IncyclistCapability.Power,{emit:true})
                expect(stopDeviceSelection).toHaveBeenCalled()

            })
            test('device not in list',async ()=>{
                // device is selected
                // pairing has not been stopped
                // scanning has not been stopped
                // all adapters with same capability have beens stopped
                svc.setupMockData( 'power', [
                    {udid:'1', selected:true},
                    {udid:'2'}
                ])
                svc.getDeviceAdapter = jest.fn( udid=> {

                    if (udid==='1' || udid==='2' || udid==='3') return  {  
                        isStarted:jest.fn().mockReturnValue(false),
                        pause:jest.fn().mockResolvedValue(true)
                    } as unknown as IncyclistDeviceAdapter
                  
                })

                await svc.selectDevice( IncyclistCapability.Power,'3')

                expect(configuration.select).toHaveBeenCalledWith('3',IncyclistCapability.Power,{emit:true})
                expect(stopDeviceSelection).toHaveBeenCalled()

            })

            test('select a device on all capabilities',async ()=>{
                // device is selected
                // pairing has not been stopped
                // scanning has not been stopped
                // all adapters with same capability have beens stopped
                
                svc.setupMockData( 'control',    [ {udid:'1', selected:true},{udid:'4', c:[ 'power', 'speed', 'cadence']}] )
                svc.setupMockData( 'power',      [ {udid:'1'}, {udid:'2',selected:true} ])
                svc.setupMockData( 'heartrate',  [])
                svc.setupMockData( 'cadence',    [ {udid:'4'}, {udid:'2',selected:true} ])
                svc.setupMockData( 'speed',      [ {udid:'4'}, {udid:'2',selected:true} ])

                await svc.selectDevice( IncyclistCapability.Control,'4',true)

                expect(configuration.select).toHaveBeenNthCalledWith(1,'4','control',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(2,'4','power',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(3,'4','speed',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(4,'4','cadence',{emit:true})
                expect(stopDeviceSelection).toHaveBeenCalled()

            })

            test('select a device with unknown capability(gear) on all capabilities',async ()=>{
                // device is selected
                // pairing has not been stopped
                // scanning has not been stopped
                // all adapters with same capability have beens stopped

                
                svc.setupMockData( 'control',    [ {udid:'1', selected:true},{udid:'4', c:[ 'power', 'speed', 'cadence']}] )
                svc.setupMockData( 'power',      [ {udid:'1'}, {udid:'2',selected:true} ])
                svc.setupMockData( 'heartrate',  [])
                svc.setupMockData( 'cadence',    [ {udid:'4'}, {udid:'2',selected:true} ])
                svc.setupMockData( 'speed',      [ {udid:'4'}, {udid:'2',selected:true} ])

                const adapter = svc.getDeviceAdapter('4') as IncyclistDeviceAdapter
                const capabilites = adapter?.getCapabilities()
                capabilites?.push('gear' as IncyclistCapability)
                adapter.getCapabilities = jest.fn().mockReturnValue(capabilites)

                await svc.selectDevice( IncyclistCapability.Control,'4',true)

                expect(configuration.select).toHaveBeenNthCalledWith(1,'4','control',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(2,'4','power',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(3,'4','speed',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(4,'4','cadence',{emit:true})
                expect(stopDeviceSelection).toHaveBeenCalled()
            })

            test('select a device on all capabilities which is already selected in the last of its capabilities',async ()=>{
                // device is selected
                // pairing has not been stopped
                // scanning has not been stopped
                // all adapters with same capability have beens stopped

                
                svc.setupMockData( 'control',    [ {udid:'1', selected:true},{udid:'4', c:[ 'power', 'speed', 'cadence','heartrate']}] )
                svc.setupMockData( 'power',      [ {udid:'1'}, {udid:'2',selected:true} ])
                svc.setupMockData( 'heartrate',  [ {udid:'4',selected:true}])
                svc.setupMockData( 'cadence',    [ {udid:'4'}, {udid:'2',selected:true} ])
                svc.setupMockData( 'speed',      [ {udid:'4'}, {udid:'2',selected:true}, {udid:'3',deleted:true} ])

                const adapter = svc.getDeviceAdapter('4') as IncyclistDeviceAdapter
                const capabilites = adapter?.getCapabilities()
                capabilites?.push('gear' as IncyclistCapability)
                adapter.getCapabilities = jest.fn().mockReturnValue(capabilites)

                await svc.selectDevice( IncyclistCapability.Control,'4',true)

                expect(configuration.select).toHaveBeenNthCalledWith(1,'4','control',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(2,'4','power',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(3,'4','speed',{emit:false})
                expect(configuration.select).toHaveBeenNthCalledWith(4,'4','cadence',{emit:true})
                expect(configuration.select).not.toHaveBeenNthCalledWith(5,'4','heartrate',{emit:false})
                expect(stopDeviceSelection).toHaveBeenCalled()
            })


        })
        describe('deleteDevice',()=>{
            describe('scanning',()=> {
                beforeEach( ()=>{
                    TestWrapper.setupMocks()
                    svc = new TestWrapper()               
                    svc.initServices()
                    svc.simulateScanning()
                    
                })
    
                afterEach( ()=>{
                    svc.resetServices()
                    TestWrapper.resetMocks()
                })
    
                test('device is selected',async () =>{
                    // device was deleted
                    // "unselect" was called to ensure that no other device is selected
                    // scanning was not stopped
                    // value is reset
                    
                    svc.setupMockData( IncyclistCapability.Power, [
                        {udid:'1', selected:true},
                        {udid:'2'}
                    ])
                    svc.setCapabilityData('power',{connectState:'connecting', value:100, unit:'W'})
    
                    await svc.deleteDevice( IncyclistCapability.Power,'1')
    
                    expect(configuration.unselect).toHaveBeenCalledWith(IncyclistCapability.Power,true)
                    expect(configuration.delete).toHaveBeenCalledWith('1',IncyclistCapability.Power,true)
                    expect(access.stopScan).not.toHaveBeenCalled()
                    expect(svc.getCapabilityData('power')?.value).toBeUndefined()
    
    
                })
                test('device is not selected',async () =>{
                    // device was deleted
                    // "unselect" was not called
                    // scanning was not stopped
                    // value is unchanged
                    
                    svc.setupMockData( IncyclistCapability.Power, [
                        {udid:'1', selected:true},
                        {udid:'2'}
                    ])
                    svc.setCapabilityData('power',{connectState:'connecting', value:100, unit:'W'})
    
                    await svc.deleteDevice( IncyclistCapability.Power,'2')
    
                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Power)
                    expect(configuration.delete).toHaveBeenCalledWith('2',IncyclistCapability.Power,true)
                    expect(access.stopScan).not.toHaveBeenCalled()
                    expect(svc.getCapabilityData('power')?.value).toBe(100)

                })

                test('device was deleted',async () =>{
                    // device was deleted
                    // "unselect" was not called
                    // scanning was not stopped
                    // value is unchanged
                    
                    svc.setupMockData( IncyclistCapability.Speed, [
                        {udid:'1', selected:true},
                        {udid:'2'},
                        {udid:'X', deleted:true}
                    ])
                    svc.setCapabilityData('speed',{connectState:'connecting', value:100, unit:'W'})
    
                    await svc.deleteDevice( IncyclistCapability.Speed,'X')
    
                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Speed)
                    expect(configuration.delete).not.toHaveBeenCalledWith('X',IncyclistCapability.Speed,true)
                    expect(access.stopScan).not.toHaveBeenCalled()
                    expect(svc.getCapabilityData('speed')?.value).toBe(100)

                })

                test('empty list',async () =>{
                    // device was deleted
                    // "unselect" was not called
                    // scanning was not stopped
                    // value is unchanged
                    
                    svc.setupMockData( IncyclistCapability.Power, [])
    
                    await svc.deleteDevice( IncyclistCapability.Power,'2')
    
                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Power)
                    expect(configuration.delete).not.toHaveBeenCalledWith('2',IncyclistCapability.Power,true)
                    expect(access.stopScan).not.toHaveBeenCalled()
                    

                })
                test('delelete All set',async () =>{
                    svc.setupMockData( 'control',    [ {udid:'1', selected:true},{udid:'4', c:[ 'power', 'cadence', 'speed']}] )
                    svc.setupMockData( 'power',      [ {udid:'1'}, {udid:'2',selected:true} ])
                    svc.setupMockData( 'heartrate',  [])
                    svc.setupMockData( 'cadence',    [ {udid:'4'}, {udid:'2',selected:true} ])
                    svc.setupMockData( 'speed',      [ {udid:'4', selected:true}])

                    await svc.deleteDevice( IncyclistCapability.Cadence,'4',true)

                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Control)
                    expect(configuration.delete).toHaveBeenCalledWith('4', IncyclistCapability.Control,false)

                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Power)
                    expect(configuration.delete).not.toHaveBeenCalledWith(expect.anything(), IncyclistCapability.Power, expect.anything())

                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.HeartRate)
                    expect(configuration.delete).not.toHaveBeenCalledWith(expect.anything(), IncyclistCapability.HeartRate, expect.anything())

                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Cadence)
                    expect(configuration.delete).toHaveBeenCalledWith(expect.anything(), IncyclistCapability.Cadence, expect.anything())

                    expect(configuration.unselect).toHaveBeenCalledWith(IncyclistCapability.Speed,true)
                    expect(configuration.delete).toHaveBeenCalledWith('4', IncyclistCapability.Speed,true)

                })
    
            })

            describe('pairing',()=>{

                beforeEach( ()=>{
                    TestWrapper.setupMocks()
                    svc = new TestWrapper()               
                    svc.initServices()
                    svc.simulatePairing()
                })
    
                afterEach( ()=>{
                    TestWrapper.resetMocks()
                })


                test('device is selected only for this capability',async () =>{
                    // device should be paused
                    svc.setupMockData( 'control',    [ {udid:'1', selected:true},{udid:'4', c:[ 'power', 'cadence', 'speed']}] )
                    svc.setupMockData( 'power',      [ {udid:'1'}, {udid:'2',selected:true} ])
                    svc.setupMockData( 'heartrate',  [])
                    svc.setupMockData( 'cadence',    [ {udid:'4'} ])
                    svc.setupMockData( 'speed',      [ {udid:'4', selected:true}])

                    const adapter = svc.getDeviceAdapter('2')

                    await svc.deleteDevice( IncyclistCapability.Power,'2')

                    expect(configuration.unselect).not.toHaveBeenCalledWith(IncyclistCapability.Power)
                    expect(configuration.delete).toHaveBeenCalledWith('2',IncyclistCapability.Power,true)
                    expect(access.stopScan).not.toHaveBeenCalled()
                    expect(adapter?.stop).toHaveBeenCalled()
    
                })


                test('device is selected, but also in other capabiltiies',async () =>{
                    // device should be paused
                    svc.setupMockData( 'control',    [ {udid:'1', selected:true},{udid:'4', c:[ 'power', 'cadence', 'speed']}] )
                    svc.setupMockData( 'power',      [ {udid:'1'}, {udid:'2',selected:true} ])
                    svc.setupMockData( 'heartrate',  [])
                    svc.setupMockData( 'cadence',    [ {udid:'4'} ])
                    svc.setupMockData( 'speed',      [ {udid:'4', selected:true}])

                    const adapter = svc.getDeviceAdapter('4')
                    svc.setCapabilityData('power',{connectState:'connecting', value:100, unit:'W'})
    
                    await svc.deleteDevice( IncyclistCapability.Cadence,'4')
    
                    expect(configuration.delete).toHaveBeenCalledWith('4',IncyclistCapability.Cadence,true)
                    expect(adapter?.stop).not.toHaveBeenCalled()
                })

            })


        })
        describe('changeInterfaceSettings',()=>{
            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               

                svc.initServices()
                svc.setSettings( {onStateChanged})
                svc.setupMockData( IncyclistCapability.Control, [ 
                    {udid:'1', selected:true,interface:'ant'}, 
                    {udid:'2',interface:'ble'} ]) 
                                svc.simulatePairing() // the interface settings are not
              
           
          
            })
            afterEach( ()=>{
                TestWrapper.resetMocks()
                jest.resetAllMocks()
            })

            test('disable',()=>{
                const ant: Partial<InterfaceSetting> = {enabled:false}
                svc.changeInterfaceSettings('ant',ant as InterfaceSetting)
                expect( configuration.setInterfaceSettings).toHaveBeenCalledWith('ant',ant)
            })

            test('enable',()=>{
                const antIf = svc.getState()?.interfaces?.find(i=>i.name==='ant') || {} as any
                antIf.enabled = false
                const ant: Partial<InterfaceSetting> = {enabled:true}
                svc.changeInterfaceSettings('ant',ant as InterfaceSetting)

                expect( configuration.setInterfaceSettings).toHaveBeenCalledWith('ant',ant)

            })
            test('no change',()=>{
                const ant: Partial<InterfaceSetting> = {enabled:true}
                svc.changeInterfaceSettings('ant',ant as InterfaceSetting)
                expect( configuration.setInterfaceSettings).not.toHaveBeenCalledWith('ant',ant)

            })

    

        })
    })

    describe('events',()=> {
        // emitted by configuratin service whenever an interface is enabled/disabled
        describe('configuration:interface-changed',()=>{
            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               

                svc.initServices()
                svc.setSettings( {onStateChanged})
                svc.setupMockData( IncyclistCapability.Control, [ 
                    {udid:'1', selected:true,interface:'ant'}, 
                    {udid:'X', deleted:true, interface:'ble'}, 
                    {udid:'2',interface:'ble'} ])
                svc.setupMockData( IncyclistCapability.Power, [ 
                    {udid:'X', deleted:true, interface:'ant'}, 
                    {udid:'1',interface:'ant'}, 
                    {udid:'2',interface:'ble'} ])
                svc.setupMockData( IncyclistCapability.Cadence, [ 
                    {udid:'1',interface:'ant'}, 
                    {udid:'2',interface:'ble', selected:true} ])
                svc.setupMockData( IncyclistCapability.Speed, [ 
                    {udid:'2',interface:'ble', interfaceInactive:true} ])
            
                svc.simulatePairing()            
            })

            afterEach( ()=>{
                
                svc.resetServices()
                TestWrapper.resetMocks()
                jest.resetAllMocks()

            })

            describe('disabled',()=>{

                test('selected device is on interface',()=>{
                    configuration.emit('interface-changed','ant',{enabled:false})
                    
                    expect(access.disableInterface).toHaveBeenCalledWith('ant')
                    expect(configuration.unselect).not.toHaveBeenCalledWith('control')
                    expect(configuration.select).toHaveBeenCalledWith('2','control',expect.anything())
                    expect(onStateChanged).toHaveBeenCalled()
                })
                test('selected device is not on interface',()=>{
                    configuration.emit('interface-changed','ble',{enabled:false})
                    
                    expect(access.disableInterface).toHaveBeenCalledWith('ble')
                    expect(configuration.unselect).not.toHaveBeenCalledWith('control')
                    expect(configuration.select).not.toHaveBeenCalledWith(expect.anything,'control')

                })  
                
                test('was already disabled',()=>{
                    const ant = svc.getState().interfaces?.find(i=>i.name==='ant')  as any                    
                    ant.enabled = false;
                    configuration.emit('interface-changed','ant',{enabled:false})
                    
                    expect(access.disableInterface).not.toHaveBeenCalledWith('ant')
                    expect(configuration.unselect).not.toHaveBeenCalledWith('control')
                    expect(configuration.select).not.toHaveBeenCalled()

                })    
            })

            describe('enabled',()=>{

                test('no device selected, no device on interface',()=>{
                    const ant = svc.getState().interfaces?.find(i=>i.name==='ant')  as any                    
                    ant.enabled = false;                    

                    configuration.emit('interface-changed','ant',{enabled:true})
                    
                    expect(access.enableInterface).toHaveBeenCalledWith('ant',undefined,expect.anything())
                    expect(configuration.select).not.toHaveBeenCalledWith(expect.anything(),'speed')

                })

                test('no device selected, but device available',()=>{
                    const ant = svc.getState().interfaces?.find(i=>i.name==='ant')  as any                    
                    ant.enabled = false;                    

                    configuration.emit('interface-changed','ant',{enabled:true})
                    
                    expect(access.enableInterface).toHaveBeenCalledWith('ant',undefined,expect.anything())
                    expect(configuration.select).toHaveBeenCalledWith(expect.anything(),'power',expect.anything())

                })
                test('selected device',()=>{
                    const ant = svc.getState().interfaces?.find(i=>i.name==='ant')  as any                    
                    ant.enabled = false;                    

                    configuration.emit('interface-changed','ant',{enabled:true})
                    
                    expect(access.enableInterface).toHaveBeenCalledWith('ant',undefined,expect.anything())
                    expect(configuration.select).not.toHaveBeenCalledWith(expect.anything(),'cadence',expect.anything())

                })    
                test('was already enabled',()=>{

                    configuration.emit('interface-changed','ant',{enabled:true})
                    
                    expect(access.enableInterface).not.toHaveBeenCalledWith('ant')
                    expect(configuration.select).not.toHaveBeenCalled()

                })    
            })

        })

        // emitted whenever the device configuration has changed
        describe('configuration:capability-changed',()=>{

        })
        

        // emitted by access service whenever an interface is connected/disconnected or enabled/disabled 
        describe('access:interface-changed',()=>{

            let ant
            let control
            let cadence
            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               
                svc.initServices()

                svc.setSettings( {onStateChanged})

                svc.setupMockData( IncyclistCapability.Control, [ {udid:'1', interface:'ant', selected:true}, {udid:'2', interface:'ant'} ])
                svc.setupMockData( IncyclistCapability.Power, [ {udid:'1', selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.Cadence, [ {udid:'1', interface:'ant'},{udid:'2', interface:'ant'}, {udid:'4', selected:true, interface:'ble'} ])
                svc.setupMockData( IncyclistCapability.Speed, [ {udid:'1', selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.HeartRate, [ {udid:'3', selected:true} ])

                ant = svc.getState().interfaces?.find(i=>i.name==='ant')
                svc.simulatePairing()

                control = svc.getCapabilityData('control')
                cadence = svc.getCapabilityData('cadence')

                control.devices[0].connectState='connecting'
                control.devices[1].connectState=undefined
                control.connectState = 'connecting'

                cadence.devices[0].connectState=undefined
                cadence.devices[1].connectState='connected'
                cadence.devices[2].connectState='connecting'
                cadence.connectState = 'connecting'
                

            })

            afterEach( ()=>{
                svc.resetServices()

                TestWrapper.resetMocks()
                jest.resetAllMocks()
            })

            test('enabled changed, will be ignored',()=>{
                // access service is not aware of configuration state
                // `enabled` in access service has a different meaning
                access.emit('interface-changed','ant', { name: 'ant', enabled: false, isScanning: false, state: 'connected'})
                expect(ant.enabled).toBe(true)
                expect(ant.state).toBe('connected')
                expect(ant.isScanning).toBe(false)
                expect(onStateChanged).toHaveBeenCalled()
            })

            test('state changed -> disconncted',()=>{
                access.emit('interface-changed','ant', { name: 'ant', enabled: true, isScanning: false, state: 'disconnected'})
                expect(ant.state).toBe('disconnected')
                expect(ant.isScanning).toBe(false)

                expect(control.devices[0].connectState).toBe('failed')
                expect(control.devices[1].connectState).toBe('failed')
                expect(control.connectState).toBe('failed')
                expect(cadence.devices[0].connectState).toBe('failed')
                expect(cadence.devices[1].connectState).toBe('failed')
                expect(cadence.devices[2].connectState).toBe('connecting')
                expect(cadence.connectState).toBe('connecting')

                expect(onStateChanged).toHaveBeenCalled()
            })

            test('state changed -> unavailable',()=>{
                access.emit('interface-changed','ant', { name: 'ant', enabled: true, isScanning: false, state: 'unavailable'})
                expect(ant.state).toBe('unavailable')
                expect(ant.isScanning).toBe(false)

                expect(control.devices[0].interfaceInactive).toBe(true)
                expect(control.devices[1].interfaceInactive).toBe(true)
                expect(configuration.unselect).toHaveBeenCalledWith('control',true)

                expect(cadence.devices[0].interfaceInactive).toBe(true)
                expect(cadence.devices[1].interfaceInactive).toBe(true)
                expect(cadence.devices[2].interfaceInactive).toBeFalsy()
                expect(cadence.devices[2].connectState).toBe('connecting')
                expect(configuration.unselect).not.toHaveBeenCalledWith('cadence',expect.anything())

                expect(onStateChanged).toHaveBeenCalled()
            })

            test('isScanning changed',()=>{
                access.emit('interface-changed','ant', { name: 'ant', enabled: true, isScanning: true, state: 'connected'})
                expect(ant.enabled).toBe(true)
                expect(ant.state).toBe('connected')
                expect(ant.isScanning).toBe(true)
                expect(onStateChanged).toHaveBeenCalled()
            })

            test('no changes',()=>{})

        })

        // emitted when a new device is detected in a scan
        describe('access:device',()=>{
            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               
                svc.initServices()

                svc.setSettings( {onStateChanged})

                svc.setupMockData( IncyclistCapability.Control, [ {udid:'1', selected:true}, {udid:'2'},{udid:'X',deleted:true} ])
                svc.setupMockData( IncyclistCapability.Power, [ {udid:'1', selected:true}, {udid:'2'},{udid:'X',deleted:true} ])
                svc.setupMockData( IncyclistCapability.Cadence, [ {udid:'1'}, {udid:'2', selected:true},{udid:'X',deleted:true} ])
                svc.setupMockData( IncyclistCapability.Speed, [ {udid:'1', selected:true}, {udid:'2'},{udid:'X',deleted:true} ])
                svc.setupMockData( IncyclistCapability.HeartRate, [ {udid:'3', selected:true},{udid:'X',deleted:true} ])

            })

            afterEach( ()=>{
                svc.resetServices()
                TestWrapper.resetMocks()
                jest.resetAllMocks()
            })


            describe('pairing',()=>{

                test('should not make any changes',()=>{
                    svc.simulatePairing()               
                    const control = svc.getCapabilityData('control')
                    control.connectState = 'connecting'

                    access.emit('device',{udid:'10',interface:'ant', deviceID:'10',profile:'FE'} )
                    expect(configuration.add).not.toHaveBeenCalled()
                    
                    expect (control.devices.length).toBe(3)

                    expect(control.connectState).toBe('connecting')

                })

            })

            describe('scanning',()=>{
                beforeEach( ()=>{
                    svc.simulateScanning()               
                })

                test('adding a new device',()=>{
                    const onData = jest.fn()

                    const control = svc.getCapabilityData('control')
                    control.connectState = 'paused'
                    const device1 = control.devices.find(d=>d.udid==='1')||{} as any
                    const device2 = control.devices.find(d=>d.udid==='2')||{} as any
                    device1.connectState = 'paused'
                    device2.connectState = 'paused'

                    configuration.add = jest.fn( (d) =>  {
                        configuration.getAdapter = jest.fn().mockReturnValue( {
                            onScanStart:jest.fn(),
                            onScanStop:jest.fn(),
                            getCapabilities: jest.fn().mockReturnValue( [IncyclistCapability.Control]),
                            on:onData,
                            getUniqueName:jest.fn().mockReturnValue(d.name),
                            getInterface:jest.fn().mockReturnValue(d.interface)
                        })
                        return '10'    
                    })
                    
                    access.emit('device',{name:'10',interface:'ant', deviceID:'10',profile:'FE'} )

                    expect(configuration.add).toHaveBeenCalled()
                    expect(onData).toHaveBeenCalled()

                    expect (control.devices.length).toBe(4)
                    expect(control.connectState).toBe('paused')
                    expect(device1.connectState).toBe('paused')
                    expect(device2.connectState).toBe('paused')
                    expect(control.devices.find(d=>d.udid==='10')?.connectState).toBe('connected')

                    expect(svc.getState().scan?.adapters?.length).toBe(1)

                })


                test('no devices selected - adding a new device',()=>{
                    const onData = jest.fn()

                    const control = svc.getCapabilityData('control');
                    control.selected = undefined
                    control.connectState = 'paused'
                    const device1 = control.devices.find(d=>d.udid==='1')||{} as any
                    const device2 = control.devices.find(d=>d.udid==='2')||{} as any
                    device1.connectState = 'paused'
                    device2.connectState = 'paused'

                    configuration.add = jest.fn( (d) =>  {
                        configuration.getAdapter = jest.fn().mockReturnValue( {
                            onScanStart:jest.fn(),
                            onScanStop:jest.fn(),
                            getCapabilities: jest.fn().mockReturnValue( [IncyclistCapability.Control]),
                            on:onData,
                            getUniqueName:jest.fn().mockReturnValue(d.name),
                            getInterface:jest.fn().mockReturnValue(d.interface)
                        })
                        return '10'    
                    })
                    
                    access.emit('device',{name:'10',interface:'ant', deviceID:'10',profile:'FE'} )

                    expect(configuration.add).toHaveBeenCalled()
                    expect(onData).toHaveBeenCalled()

                    expect (control.devices.length).toBe(4)
                    expect(control.connectState).toBe('paused')
                    expect(control.selected).toBeUndefined()


                })


                test('no devices selected - adding a deleted device',()=>{
                    const onData = jest.fn()

                    const control = svc.getCapabilityData('control');
                    control.selected = undefined
                    control.connectState = 'paused'
                    const device1 = control.devices.find(d=>d.udid==='1')||{} as any
                    const device2 = control.devices.find(d=>d.udid==='2')||{} as any
                    device1.connectState = 'paused'
                    device2.connectState = 'paused'

                    configuration.add = jest.fn( (d) =>  {
                        configuration.getAdapter = jest.fn().mockReturnValue( {
                            onScanStart:jest.fn(),
                            onScanStop:jest.fn(),
                            getCapabilities: jest.fn().mockReturnValue( [IncyclistCapability.Control]),
                            on:onData,
                            getUniqueName:jest.fn().mockReturnValue(d.name),
                            getInterface:jest.fn().mockReturnValue(d.interface)
                        })
                        return 'X'    
                    })
                    
                    access.emit('device',{name:'XX',interface:'ant', deviceID:'1234',profile:'FE'} )

                    expect(configuration.add).toHaveBeenCalled()
                    expect(onData).toHaveBeenCalled()

                    expect (control.devices.length).toBe(3)
                    expect(control.connectState).toBe('paused')
                    expect(control.selected).toBeUndefined()


                })


                test('exceptional case: cannot add adapter',()=>{
                    const onData = jest.fn()
                    configuration.add = jest.fn()
                    
                    access.emit('device',{udid:'10',interface:'ant', deviceID:'10',profile:'FE'} )

                    expect(configuration.add).toHaveBeenCalled()
                    expect(onData).not.toHaveBeenCalled()
                    
                    const c = svc.getCapabilityData('control')
                    expect (c.devices.length).toBe(3)

                })

                test('exceptional case: device already added',()=>{
                    const onData = jest.fn()

                    const control = svc.getCapabilityData('control')
                    control.connectState = 'paused'
                    const device1 = control.devices.find(d=>d.udid==='1')||{} as any
                    const device2 = control.devices.find(d=>d.udid==='2')||{} as any
                    device1.connectState = 'paused'
                    device2.connectState = 'paused'

                    configuration.add = jest.fn( (d) =>  {
                        configuration.getAdapter = jest.fn().mockReturnValue( {
                            onScanStart:jest.fn(),
                            onScanStop:jest.fn(),
                            getCapabilities: jest.fn().mockReturnValue( [IncyclistCapability.Control]),
                            on:onData,
                            getUniqueName:jest.fn().mockReturnValue(d.name),
                            getInterface:jest.fn().mockReturnValue(d.interface)
                        })
                        return '1'    
                    })
                    
                    access.emit('device',{name:'XXX',interface:'ant', deviceID:'1',profile:'FE'} )

                    expect(configuration.add).toHaveBeenCalled()
                    expect(onData).toHaveBeenCalled()

                    expect (control.devices.length).toBe(3)
                    expect(control.connectState).toBe('connected')
                    expect(device1.connectState).toBe('connected')
                    expect(device2.connectState).toBe('paused')

                    expect(svc.getState()?.scan?.adapters?.length).toBe(1)
                })

            })

        })

        // emitted when a device sends data during a scan
        describe('access:data',()=>{

            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               
                svc.initServices()

                svc.setSettings( {onStateChanged})
                svc.simulateScanning()               

                svc.setupMockData( IncyclistCapability.Power, [ {udid:'1', selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.Cadence, [ {udid:'1'}, {udid:'2', selected:true} ])
                svc.setupMockData( IncyclistCapability.Speed, [ {udid:'1', selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.HeartRate, [ {udid:'3', selected:true} ])

            })

            afterEach( ()=>{
                svc.resetServices()
                TestWrapper.resetMocks()
                jest.resetAllMocks()
            })

            test('device is selected',async () =>{
                svc.setCapabilityData('power',{connectState:'connecting', value:'100', unit:'W'});

                access.emit('data',{power:120,cadence:90, speed:21.123},'1')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('120')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'120', unit:'W'})

                expect(onStateChanged).toHaveBeenCalledWith( {capabilities: expect.arrayContaining([pwr])}) 
            })
            

            test('device is not selected',() =>{
                svc.setCapabilityData('power',{connectState:'connecting', value:'100', unit:'W'})

                access.emit('data',{power:120,cadence:90, speed:21.123},'2')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('100')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'100', unit:'W'})
                expect(pwr.devices.find(d=>d.udid==='2')).toMatchObject({value:'120', unit:'W'})

                expect(onStateChanged).toHaveBeenCalledWith( {capabilities: expect.arrayContaining([pwr])}) 
            })

            test('multiple capabilities',() =>{
                svc.setCapabilityData('power',{connectState:'connecting', value:'100', unit:'W'})

                access.emit('data',{power:120,cadence:90, speed:21.123},'1')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('120')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'120', unit:'W'})

                const spd = svc.getCapabilityData('speed')                
                expect(spd.value).toBe('21.1')
                expect(spd.unit).toBe('km/h')
                expect(spd.devices.find(d=>d.udid==='1')).toMatchObject({value:'21.1', unit:'km/h'})

                expect(onStateChanged).toHaveBeenCalledWith( {capabilities: expect.arrayContaining([pwr,spd])}) 
            })

            test('no scan, no pairing',()=>{

            })
            test('data too recent',()=>{

                svc.setCapabilityData('power',{connectState:'connected', value:'100', unit:'W'})
                svc.addToPairingInfo({data:[{udid:'1', data:{power:100},ts:Date.now()-10}]})
                access.emit('data',{power:120,cadence:90, speed:21.123},'1')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('100')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'100', unit:'W'})

                expect(onStateChanged).not.toHaveBeenCalled() 

            })



        })
        // emitted when a device sends data during pairing


        describe('ride:data',()=>{

            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               
                svc.initServices()

                svc.setSettings( {onStateChanged})
                svc.simulatePairing()               

                svc.setupMockData( IncyclistCapability.Power, [ {udid:'1', selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.Cadence, [ {udid:'1'}, {udid:'2', selected:true} ])
                svc.setupMockData( IncyclistCapability.Speed, [ {udid:'1', selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.HeartRate, [ {udid:'3', selected:true} ])

            })

            afterEach( ()=>{
                svc.resetServices()
                TestWrapper.resetMocks()
                jest.resetAllMocks()
            })

            test('device is selected',() =>{
                svc.setCapabilityData('power',{connectState:'connecting', value:'100', unit:'W'})

                ride.emit('data',{power:120,cadence:90, speed:21.123},'1')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('120')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'120', unit:'W'})

                expect(onStateChanged).toHaveBeenCalledWith( {capabilities: expect.arrayContaining([pwr])}) 
            })
            

            test('device is not selected',() =>{
                svc.setCapabilityData('power',{connectState:'connecting', value:'100', unit:'W'})

                ride.emit('data',{power:120,cadence:90, speed:21.123},'2')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('100')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'100', unit:'W'})
                expect(pwr.devices.find(d=>d.udid==='2')).toMatchObject({value:'120', unit:'W'})

                expect(onStateChanged).toHaveBeenCalledWith( {capabilities: expect.arrayContaining([pwr])}) 
            })

            test('multiple capabilities',() =>{
                svc.setCapabilityData('power',{connectState:'connecting', value:'100', unit:'W'})
                 
                ride.emit('data',{power:120,cadence:90, speed:21.123},'1')

                const pwr = svc.getCapabilityData('power')                
                const spd = svc.getCapabilityData('speed')                

                expect(pwr.value).toBe('120')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'120', unit:'W'})
                expect(pwr.devices.find(d=>d.udid==='2')?.value).toBeUndefined()

                expect(spd.value).toBe('21.1')
                expect(spd.unit).toBe('km/h')
                expect(spd.devices.find(d=>d.udid==='1')).toMatchObject({value:'21.1', unit:'km/h'})
                expect(spd.devices.find(d=>d.udid==='2')?.value).toBeUndefined()

                expect(onStateChanged).toHaveBeenCalledWith( {capabilities: expect.arrayContaining([pwr,spd])}) 

                ride.emit('data',{power:130,cadence:91, speed:25},'2')
                expect(pwr.devices.find(d=>d.udid==='1')?.value).toBe('120')
                expect(pwr.devices.find(d=>d.udid==='2')?.value).toBe('130')
                expect(spd.devices.find(d=>d.udid==='1')?.value).toBe('21.1')
                expect(spd.devices.find(d=>d.udid==='2')?.value).toBe('25.0')

            })

            test('no scan, no pairing',()=>{

            })
            test('data too recent',()=>{

                svc.setCapabilityData('power',{connectState:'connected', value:'100', unit:'W'})
                svc.addToPairingInfo({data:[{udid:'1', data:{power:100},ts:Date.now()-10}]})
                ride.emit('data',{power:120,cadence:90, speed:21.123},'1')

                const pwr = svc.getCapabilityData('power')                
                expect(pwr.value).toBe('100')
                expect(pwr.unit).toBe('W')
                expect(pwr.devices.find(d=>d.udid==='1')).toMatchObject({value:'100', unit:'W'})

                expect(onStateChanged).not.toHaveBeenCalled() 

            })



        })

        describe('ride:pairing-success',()=>{})
        describe('ride:pairing-error',()=>{})


        describe('flow: interface gets connected after pairing was started',()=>{
            let ant
            let control
            let cadence
            beforeEach( ()=>{
                TestWrapper.setupMocks()
                svc = new TestWrapper()               
                svc.initServices()
                svc.getPairingRetryDelay= jest.fn().mockReturnValue(30000)


                svc.setupMockData( IncyclistCapability.Control, [ {udid:'1', interface:'ant', selected:true}, {udid:'2', interface:'ant'} ])
                svc.setupMockData( IncyclistCapability.Power, [ {udid:'1', interface:'ant',selected:true}, {udid:'2'} ])
                svc.setupMockData( IncyclistCapability.Cadence, [ {udid:'1', interface:'ant'},{udid:'2', interface:'ant'}, {udid:'4', selected:true, interface:'ble'} ])
                svc.setupMockData( IncyclistCapability.Speed, [ {udid:'1', interface:'ant', selected:true}])
                svc.setupMockData( IncyclistCapability.HeartRate, [ {udid:'3', interface:'ant',selected:true} ])
                svc.setCanStartRide(true)

                ant = svc.getState().interfaces?.find(i=>i.name==='ant')
                ant.state = 'connecting'
                svc.getState().initialized = true;

                control = svc.getCapabilityData('control')
                cadence = svc.getCapabilityData('cadence')

                control.devices[0].connectState='connecting'
                control.devices[1].connectState=undefined
                control.connectState = 'connecting'

                cadence.devices[0].connectState=undefined
                cadence.devices[1].connectState='connected'
                cadence.devices[2].connectState='connecting'
                cadence.connectState = 'connecting'

                svc.getState().adapters?.filter( a=>a.adapter.getInterface()==='ant')
                    .forEach( ai => {ai.adapter.isStarted = jest.fn().mockReturnValue(false)})

                ride.startAdapters= jest.fn( async()=> { await sleep(1000); return false;} )
                

            })

            afterEach( async ()=>{
                svc.resetServices()
                TestWrapper.resetMocks()
                jest.resetAllMocks()
                await svc.stop()
            })


            test('isScanning changed',async ()=>{
                
                svc.start( onStateChanged)
                await sleep (500)
                
                expect(svc.getState().check?.preparing).toBeDefined()
                expect(svc.getState().check?.promise).toBe(undefined)

                access.emit('interface-changed','ant', { name: 'ant', enabled: true, isScanning: true, state: 'connected'})
                expect(ant.enabled).toBe(true)
                expect(ant.state).toBe('connected')

                svc.start( onStateChanged)
                await sleep (100)

                expect(svc.isPairing()).toBe(true)
                expect(svc.getState().check?.preparing).toBeUndefined()
                expect(svc.getState().check?.promise).toBeDefined()
                
            })

            test('no changes',()=>{})

        })        

    })

    describe('helpers',()=>{
        describe('mapCapability',()=>{
            test('success',()=>{
                const devices = [
                    {udid: "f594f6a6-6ff6-4717-b980-b491002fd0d4", name: "Jetblack FE 2606", interface: "ant",selected:true },
                    {udid: "5a81bd7a-4fe3-40b7-8206-8b28cb5a44e7", interface: "ble", name: 'Jetblack Volt',selected:false}
                ];
                const c:CapabilityInformation ={                
                        capability: IncyclistCapability.Control,
                        devices,
                        disabled: false                  
                }

                const service = new TestWrapper()
    
                const res = service.mappedCapability(c)
    
                expect(res).toMatchObject({
                    capability:IncyclistCapability.Control,
                    deviceName:'Jetblack FE 2606',
                    deviceNames: 'Jetblack FE 2606;Jetblack Volt',
                    disabled: false,
                    selected: "f594f6a6-6ff6-4717-b980-b491002fd0d4",
                    interface: 'ant',
                    devices
                })
            })
        })
    
    })



} )