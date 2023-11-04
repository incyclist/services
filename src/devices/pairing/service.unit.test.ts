/* eslint-disable @typescript-eslint/no-explicit-any */
import {  IncyclistCapability, IncyclistDeviceAdapter, DeviceProperties, IncyclistDevice,DeviceSettings } from 'incyclist-devices'
import { CapabilityInformation, DeviceConfigurationService, DeviceConfigurationSettings, ExtendedIncyclistCapability, useDeviceConfiguration,} from '../configuration'
import {DevicePairingService, mappedCapability} from './service'
import clone from '../../utils/clone'
import { DeviceAccessService, useDeviceAccess } from '../access'
import { DeviceRideService, useDeviceRide } from '../ride'
import UserSettingsMock from '../../settings/user/mock'
import { CapabilityData, DevicePairingData, PairingInfo, PairingSettings, PairingState } from './model'
import { UserSettingsService } from '../../settings'

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
type DeviceList =  Array<{ udid:string, selected?:boolean, c?:Array<string>,isStarted?:boolean,profile?:string,interface?:string}>

class TestWrapper extends DevicePairingService {

    static setupMocks  ( props:{forStart?:boolean}={}) {
        const {forStart=false} = props;
        ride = useDeviceRide()
        access = useDeviceAccess()
        if (!forStart) {
            configuration = useDeviceConfiguration()
        
            configuration.add = jest.fn()
            configuration.getAdapter = jest.fn()  // (udid)=>IncyclistDeviceAdapter
            configuration.select=jest.fn()// ()=>{console.log('select')})
            configuration.unselect=jest.fn()
            configuration.canStartRide=jest.fn()
            configuration.delete=jest.fn()
        }

        ride.startAdapters=jest.fn()
        ride.getAdapters=jest.fn().mockReturnValue([])
        ride.cancelStart = jest.fn()

        access.scan = jest.fn()
        access.enableInterface = jest.fn()
        access.stopScan = jest.fn()
        access.enrichWithAccessState = jest.fn( (interfaces)=>{ return interfaces.map(i => ({...i, state:'connected', isScanning:false}))})

        // simulate feature toggle
        settings['NEW_UI']=true
    }

    static resetMocks() {
        ride.removeAllListeners();
        access.removeAllListeners();
        configuration?.removeAllListeners();

        (DeviceAccessService as any)._instance = undefined;
        (DeviceConfigurationService as any)._instance = undefined;
        (DeviceRideService as any)._instance = undefined;  
        (UserSettingsService as any)._instance = undefined              

    }

    setupMockData  (capability:IncyclistCapability|string, devices: DeviceList)   {

        const addAdapter = ( udid, c)=> {
            try {
            const capabilities = c.map(cap=>cap as IncyclistCapability)
            if (!this.getState().adapters)                    
                this.getState().adapters=[]

            this.getState().adapters?.push( {udid,capabilities,
                adapter:{                         
                    getCapabilities:jest.fn().mockReturnValue(capabilities),
                    pause:jest.fn().mockResolvedValue(true),
                    start:jest.fn().mockResolvedValue(true),
                    stop:jest.fn().mockResolvedValue(true),
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
                addAdapter(d.udid, caps) 
    
                settings.devices?.push( {udid:d.udid,settings: {profile: d.profile||"FE", interface: d.interface||"ant"} } as any)

                const setCaps = settings.capabilities || []
                const setDev = settings.devices || []

                if (!this.getState().capabilities)                    
                    this.getState().capabilities=[] as CapabilityData[]
                const state = this.getState().capabilities as CapabilityData[]
                const existing = state.find(c=>c.capability===capability) 
                const idx = state.findIndex(c=>c.capability===capability) 
                const info = existing || { capability, devices:[] as Array<DevicePairingData>} as CapabilityData                   
                info.devices.push( {interface:'ant', name:d.udid,selected:d.selected||false,udid:d.udid,connectState:'connecting'} )
                if (d.selected) info.selected = d.udid;
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
        (DeviceAccessService as any)._instance = undefined;
        (DeviceConfigurationService as any)._instance = undefined;
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

    setPairingInfo( info:PairingInfo) {
        this.pairingInfo = info
    }
    addToPairingInfo( info) {
        this.pairingInfo = {...this.pairingInfo,...info}
    }

    simulatePairing() {
        this.setPairingInfo( {
            promiseCheck: new Promise<boolean>(()=>{}),
            props:{}
        })
        this.setSettings({onStateChanged})
        this.initPairingCallbacks()
    }

    simulateScanning() {
        this.setPairingInfo( {
            promiseScan: new Promise<DeviceSettings[]>(()=>{}),
            props:{}
        })
        this.setSettings({onStateChanged,onDeviceSelectStateChanged})
        this.initScanningCallbacks()

    }

    setCapabilityData(capability:IncyclistCapability|string, data) {
        const c =  this.getCapability(capability as IncyclistCapability)
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


}


describe('PairingService',()=>{


    describe('api',()=>{

        describe('start',()=>{
            
            let logEvent
            let logCapabilities
            let userSettings

            beforeEach( ()=>{
                userSettings = new UserSettingsMock(settings)
                TestWrapper.setupMocks({forStart:true})
                
                svc = new TestWrapper()
                logEvent  = jest.spyOn(svc as any,'logEvent')
                logCapabilities = svc.mock('logCapabilities')
                

            })

            afterEach( ()=>{
                TestWrapper.resetMocks()
            })

            test('no devices in configuration will start scan',async ()=>{
                settings.devices = []
                settings.capabilities= []

                const updates: Array<PairingState> = [];
                const res = await new Promise (done => {
                    svc.start( (status:PairingState)=>{ updates.push(status);if (updates.length==2) done(updates)  })
                })

                expect(res).toMatchSnapshot()        
                expect(logEvent).toHaveBeenCalledWith( expect.objectContaining( {message:'Start Scanning'}))
                expect(ride.startAdapters).not.toHaveBeenCalled()
                expect(access.scan).toHaveBeenCalled()
            })

            test('no devices in configuration; FE device found in scan',async ()=>{
                settings.devices = []
                settings.capabilities= []

                const device = {interface:'ant', profile: "FE", deviceID: 1234 }
                userSettings.settings = {}
                access.scan = jest.fn( async ()=>{
                    access.emit('device', device)
                    
                    return [device]
                })
                const updates: Array<PairingState> = [];
                let numLogs = 0;
                // we are expecting 3 status updates, the last one to contain the 
                await new Promise (done => {
                    svc.on('log',()=>{ 
                        ++numLogs
                        if (numLogs===3) 
                            done(updates)
                    })                   
                    svc.start( (status:PairingState)=>{ 
                        updates.push(status)
                    })
                })

                //console.log( (svc as any).logCapabilities)

                
                //expect(res).toMatchSnapshot()        
                //console.log(JSON.stringify(res,undefined,2))

                expect(logCapabilities).toHaveBeenCalled()
                
                expect(logEvent).toHaveBeenNthCalledWith( 1,expect.objectContaining( {message:'Start Scanning'}))
                expect(logEvent).toHaveBeenNthCalledWith( 2,expect.objectContaining( {message:'device detected', device:{deviceID:1234, interface:'ant', profile:'FE'}}))
                expect(logEvent).toHaveBeenNthCalledWith( 3,expect.objectContaining( {message:'Start Pairing'}))
                expect(access.scan).toHaveBeenCalled()
                expect(ride.startAdapters).toHaveBeenCalled()
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
                
                access.scan = jest.fn( async ()=>{
                    access.emit('device', device)                    
                    return [device]
                })

                const updates: Array<PairingState> = [];
                let numLogs = 0;
                // we are expecting 3 status updates, the last one to contain the 
                await new Promise (done => {
                    svc.on('log',()=>{ 
                        ++numLogs
                        if (numLogs===3) 
                            done(updates)
                    })                   
                    svc.start( (status:PairingState)=>{ 
                        updates.push(status)
                    })
                })

                expect(logEvent).toHaveBeenNthCalledWith( 1,expect.objectContaining( {message:'Start Scanning'}))
                expect(logEvent).toHaveBeenNthCalledWith( 2,expect.objectContaining( {message:'device detected', device:{deviceID:1234, interface:'ant', profile:'HR'}}))
                expect(logEvent).toHaveBeenNthCalledWith( 3,expect.objectContaining( {message:'Start Scanning'}))
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
        describe('startDeviceSelection',()=>{})
        describe('stopDeviceSelection',()=>{})


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
        describe('changeInterfaceSettings',()=>{})
    })

    describe('events',()=> {
        // emitted whenever a interface is enabled/disabled
        describe('configuration:interface-changed',()=>{})

        // emitted whenever the device configuration has changed
        describe('configuration:capability-changed',()=>{})
        

        // emitted whenever a interface is connected/disconnected
        describe('access:interface-changed',()=>{

        })

        // emitted when a new device is detected in a scan
        describe('access:device',()=>{})

        // emitted when a device sends data during a scan
        describe('access:data',()=>{})
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
                TestWrapper.resetMocks()
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
    
                const res = mappedCapability(c)
    
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


    describe('protected',()=>{

        class TestWrapper1 extends DevicePairingService {
    
            _get(member:string){
                return (this as any)[member]
                
            }
            _set(member:string,value) {
                (this as any)[member] = value
                //console.log(this)
            }
        
            _call(func:string,...args) {
                const fn = (this as any)[func].bind(this)
                
                try {
                    return fn(...args)
                }
                catch(err) {
                    console.log(func,'->',fn,err.message)
                }
            }
        }
        
        describe('disableInterfaceInCapabilities',()=>{
            const ctrl = [
                {udid: "1", interface: "ant", name: "A", selected:true },
                {udid: "2", interface: "ble", name: 'B',selected:false},
            ];
    
            const pwr = [
                {udid: "3", interface: "ble", name: 'C',selected:true}
            ];
            const hrm = [
                {udid: "4", interface: "ant", name: 'D',selected:true}
            ];
    
    
            const capabilities = [
                { capability:'control',deviceName:'A', deviceNames: 'A,B', disabled: false, selected: "1", interface: 'ant', devices:ctrl, value:1},
                { capability:'power',deviceName:'C', deviceNames: 'C', disabled: false, selected: "3", interface: 'ble', devices:pwr,value:2,},
                { capability:'heartrate',deviceName:'D', deviceNames: 'D', disabled: false, selected: "4", interface: 'ant', devices:hrm, value:3}
            
            ]
            let svc:TestWrapper1
            beforeEach( ()=>{
                svc = new TestWrapper1()
                svc._set('isInterfaceEnabled', jest.fn().mockReturnValue(true))            
                svc._set('state', {capabilities:clone(capabilities)})
                svc._set('access', { disableInterface:jest.fn()}  )
                svc._set('configuration',{ select:jest.fn(), unselect:jest.fn()})
            })
    
            test('active device has interface',()=>{
                const changed = svc._call('disableInterfaceInCapabilities','ant')           
    
                //const changed = (svc as any).disableInterfaceInCapabilities('ant')           
                const res = svc._get('state').capabilities
                
    
                expect(changed).toBe(true)
                expect( res[0].selected).toBe('2')
                expect( res[1].selected).toBe('3')
                expect( res[2]).toMatchObject( {selected:undefined, deviceName:undefined, value:undefined, interface:undefined})
    
                expect( res[0].devices[0].selected).toBe(false)
                expect( res[0].devices[1].selected).toBe(true)
                expect( res[1].devices[0].selected).toBe(true)
                expect( res[2].devices[0].selected).toBe(false)
    
            })
    
            test('no active device has interface',()=>{
                const changed = svc._call('disableInterfaceInCapabilities','ble')
                const res = (svc as any).state.capabilities
                
                expect(changed).toBe(true)
                expect( res[0].selected).toBe('1')
                expect( res[1]).toMatchObject( {selected:undefined, deviceName:undefined, value:undefined, interface:undefined})
                expect( res[2].selected).toBe('4')
    
                expect( res[0].devices[0].selected).toBe(true)
                expect( res[0].devices[1].selected).toBe(false)
                expect( res[1].devices[0].selected).toBe(false)
                expect( res[2].devices[0].selected).toBe(true)
            })
    
            test('interface is disabled',()=>{
    
                svc._set('isInterfaceEnabled', jest.fn().mockReturnValue(false))
                const changed = svc._call('disableInterfaceInCapabilities','ant')
                const res = (svc as any).state.capabilities
                
                expect(changed).toBe(true)
                expect( res[0]).toMatchObject( {selected:undefined, deviceName:undefined, value:undefined, interface:undefined})
                expect( res[1].selected).toBe('3')
                expect( res[2]).toMatchObject( {selected:undefined, deviceName:undefined, value:undefined, interface:undefined})
    
                expect( res[0].devices[0].selected).toBe(false)
                expect( res[0].devices[1].selected).toBe(false)
                expect( res[1].devices[0].selected).toBe(true)
                expect( res[2].devices[0].selected).toBe(false)
            })
    
            test('no device impacted',()=>{
                const changed = svc._call('disableInterfaceInCapabilities','serial')
                expect(changed).toBe(false)
            })
    
    
            
        })
    
     
        describe('enableInterfaceInCapabilities',()=>{
            const ctrl = [
                {udid: "1", interface: "ant", name: "A", selected:true },
                {udid: "2", interface: "ble", name: 'B',selected:false},
            ];
    
            const pwr = [
                {udid: "3", interface: "ble", name: 'C',selected:false}
            ];
            const hrm = [
                {udid: "4", interface: "ant", name: 'D',selected:true}
            ];
            const cad = [
                {udid: "5", interface: "ant", name: 'E',selected:true, connectState:'failed'},
                {udid: "6", interface: "ble", name: 'F',selected:false}
            ];
            const spd = [
                {udid: "7", interface: "ant", name: 'G',selected:false},
                {udid: "8", interface: "ble", name: 'H',selected:false}
            ];
    
    
            const capabilities = [
                { capability:'control',deviceName:'A', deviceNames: 'A;B', disabled: false, selected: "1", interface: 'ant', devices:ctrl, value:1},
                { capability:'power',disabled: false, devices:pwr,value:2,},
                { capability:'heartrate',deviceName:'D', deviceNames: 'D', disabled: false, selected: "4", interface: 'ant', devices:hrm, value:3},
                { capability:'cadence',deviceName:'E', deviceNames: 'E;F', disabled: false, selected: "5", interface: 'ant', devices:cad, value:90},
                { capability:'speed',disabled: false, devices:spd}
            
            ]
            let svc:TestWrapper1;
            beforeEach( ()=>{
                svc = new TestWrapper1();
                svc._set('isInterfaceEnabled', jest.fn().mockReturnValue(true))
                svc._set('state',{capabilities:clone(capabilities)})
                svc._set('access', { disableInterface:jest.fn()});
                svc._set('configuration', { select:jest.fn(), unselect:jest.fn()});         
            })
    
            test('single device not selected',()=>{
                const changed = svc._call('enableInterfaceInCapabilities','ble')           
                const res = (svc as any).state.capabilities
    
                expect(changed).toBe(true)
                expect( res[1].selected).toBe('3')
                expect( res[1].devices[0].selected).toBe(true)
    
            })
    
            test('multiple devices none selected',()=>{
                const changed = svc._call('enableInterfaceInCapabilities','ble')           
                const res = (svc as any).state.capabilities
    
                expect(changed).toBe(true)
                expect( res[4].selected).toBe('8')
                expect( res[4].devices[1].selected).toBe(true)
            })
    
            test('multiple devices, prev selected in failed state',()=>{
                const changed = svc._call('enableInterfaceInCapabilities','ble')           
                const res = (svc as any).state.capabilities
    
                expect(changed).toBe(true)
                expect( res[3]).toMatchObject( {selected:'6', deviceName:'F'})
                expect( res[3].devices[0].selected).toBe(false)
                expect( res[3].devices[1].selected).toBe(true)
            })
    
            test('no device impacted',()=>{
                const changed = svc._call('enableInterfaceInCapabilities','serial')           
                expect(changed).toBe(false)
            })
    
    
            
        })
    })



} )