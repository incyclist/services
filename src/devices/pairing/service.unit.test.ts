/* eslint-disable @typescript-eslint/no-explicit-any */
import { DeviceSettings, IncyclistCapability } from 'incyclist-devices'
import { CapabilityInformation, DeviceConfigurationService,} from '../configuration'
import {DevicePairingService, mappedCapability} from './service'
import clone from '../../utils/clone'
import { DeviceAccessService, useDeviceAccess } from '../access'
import { DeviceRideService, useDeviceRide } from '../ride'
import UserSettingsMock from '../../settings/user/mock'
import { DevicePairingStatus, PairingState } from './model'
import { UserSettingsService } from '../../settings'

class TestWrapper extends DevicePairingService {
    
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

describe('PairingService',()=>{

    describe('api',()=>{
        describe('start',()=>{
            class TestWrapper extends DevicePairingService {
                getState() {
                    return this.state
                }
                getPairingRetryDelay() {
                    return 10;
                }
            }

            let svc:TestWrapper
            let userSettings:UserSettingsMock
            let ride:DeviceRideService
            let access:DeviceAccessService
            
            let logEvent
            let settings:any = {
                interfaces: [
                    { name:'ant', enabled:true },
                    { name:'ble', enabled:true },
                    { name:'serial', enabled:false, protocol:'Daum Classic' },
                    { name:'tcpip', enabled:true },
                ],
                "NEW_UI":true

            }

            beforeEach( ()=>{
                userSettings = new UserSettingsMock(settings)
                ride = useDeviceRide()
                access = useDeviceAccess()
                
                svc = new TestWrapper()

                ride.startAdapters=jest.fn()
                ride.getAdapters=jest.fn().mockReturnValue([])
                ride.cancelStart = jest.fn()

                access.scan = jest.fn()
                access.enableInterface = jest.fn()
                access.stopScan = jest.fn()
                access.enrichWithAccessState = jest.fn( (interfaces)=>{ return interfaces.map(i => ({...i, state:'connected', isScanning:false}))})

                logEvent  = jest.spyOn(svc as any,'logEvent')
            })

            afterEach( ()=>{
                (DeviceAccessService as any)._instance = undefined;
                (DeviceConfigurationService as any)._instance = undefined;
                (DeviceRideService as any)._instance = undefined;  
                (UserSettingsService as any)._instance = undefined              
            })

            test('no devices in configuration will start scan',async ()=>{
                settings.devices = []
                settings.cabilities= {}

                let updates: Array<PairingState> = [];
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
                settings.cabilities= {}

                const device = {interface:'ant', profile: "FE", deviceID: 1234 }
                userSettings.settings = {}
                access.scan = jest.fn( async ()=>{
                    access.emit('device', device)
                    
                    return [device]
                })
                let updates: Array<PairingState> = [];
                let numLogs = 0;
                // we are expecting 3 status updates, the last one to contain the 
                const res = await new Promise (done => {
                    svc.on('log',()=>{ 
                        ++numLogs
                        if (numLogs===3) 
                            done(updates)
                    })                   
                    svc.start( (status:PairingState)=>{ 
                        updates.push(status)
                    })
                })

                //expect(res).toMatchSnapshot()        
                //console.log(JSON.stringify(res,undefined,2))

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
                settings.cabilities= {}
                
                access.scan = jest.fn( async ()=>{
                    access.emit('device', device)                    
                    return [device]
                })

                let updates: Array<PairingState> = [];
                let numLogs = 0;
                // we are expecting 3 status updates, the last one to contain the 
                const res = await new Promise (done => {
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
                        { "udid": "1", "settings": {"profile": "FE", "interface": "ant","deviceID": 1234 } }
                    ];

                settings.capabilities = [
                        {"capability": "control","devices": ["1"],"selected": "1","disabled": false },
                        {"capability": "power","devices": ["1"],"selected": "1","disabled": false },
                        {"capability": "cadence","devices": ["1"],"selected": "1","disabled": false },
                        {"capability": "speed","devices": ["1"],"selected": "1","disabled": false },
                        {"capability": "heartrate","devices": [],"selected": undefined,"disabled": false },
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
                            pause:jest.fn().mockResolvedValue(true)
                        }
                      }])

                

                let updates: Array<PairingState> = [];
                let numLogs = 0;
                // we are expecting 3 status updates, the last one to contain the 
                const res = await new Promise (done => {
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
                    { "udid": "1", "settings": {"profile": "FE", "interface": "ant","deviceID": 1234 } },
                    { "udid": "2", "settings": {"profile": "PWR", "interface": "ant","deviceID": 2345 } }
                ];

            settings.capabilities = [
                    {"capability": "control","devices": ["1"],"selected": "1","disabled": false },
                    {"capability": "power","devices": ["1","2"],"selected": "2","disabled": false },
                    {"capability": "cadence","devices": ["1"],"selected": "1","disabled": false },
                    {"capability": "speed","devices": ["1"],"selected": "1","disabled": false },
                    {"capability": "heartrate","devices": [],"selected": undefined,"disabled": false },
                ]
            
            ride.startAdapters=jest.fn( async ()=> { 
                ride.emit('pair-start',)
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

            

            let updates: Array<PairingState> = [];
            let numLogs = 0;
            // we are expecting 3 status updates, the last one to contain the 
            const res = await new Promise (done => {
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
        describe('selectDevice',()=>{})
        describe('deleteDevice',()=>{})
        describe('changeInterfaceSettings',()=>{})
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
            let svc:TestWrapper
            beforeEach( ()=>{
                svc = new TestWrapper()
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
            let svc:TestWrapper;
            beforeEach( ()=>{
                svc = new TestWrapper();
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