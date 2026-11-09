/* eslint-disable @typescript-eslint/no-explicit-any */
import { IncyclistCapability } from "incyclist-devices";
import { DeviceConfigurationService } from "./service"
import { Inject } from "../../base/decorators";
import clone from "../../utils/clone";

// A stored device whose interface/protocol this build can't construct an adapter for (e.g. a
// protocol only supported by a test build) must not stay in the configuration: it would keep a
// capability "selected" that can never connect, and an undefined adapter entry crashes every
// caller of getAllAdapters(). It is removed the same way a rider's own delete removes a device.

const BROKEN_UDID = 'broken-udid-1234'
const TRAINER_UDID = 'trainer-udid-1'
const TRAINER2_UDID = 'trainer-udid-2'

const brokenSettings = { interface:'wifi', protocol:'openbikecontrol', name:'BikeControl', address:'192.168.1.17' }
const trainerSettings = { interface:'wifi', protocol:'fm', name:'DCSIM FTMS', address:'192.168.1.20' }
const trainer2Settings = { interface:'ble', protocol:'fm', name:'Other Trainer', address:'aa:bb:cc:dd:ee:ff' }

const makeAdapter = (settings:any) => ({
    settings,
    getSettings: () => settings,
    getCapabilities: () => [IncyclistCapability.Control, IncyclistCapability.Power],
    hasCapability: () => true,
    isEqual: (s:any) => s?.address===settings.address,
    getInterface: () => settings.interface,
})

describe('DeviceConfigurationService - stored devices that cannot be built',()=>{
    let service:any
    let stored:any
    let userSettings:any
    let adapterFactory:any
    let logEvent:jest.SpyInstance

    // the logger adds a timestamp to the event object; it's not part of what the service logs
    const removalLogs = () => logEvent.mock.calls.map(([e])=>e)
        .filter( e=> e?.message==='unsupported device removed')
        .map( ({ts:_ts, ...e}) => e )

    const setup = (data:any, create:(settings:any)=>any) => {
        stored = clone(data)
        userSettings = {
            init: jest.fn(),
            set: jest.fn( (key:string, value:any) => { stored[key]=clone(value) }),
            get: jest.fn( (key:string, defVal:any) => stored[key] ?? defVal),
            getValue: jest.fn( (_key:string, defVal:any) => defVal),
            save: jest.fn(),
        }
        adapterFactory = { create: jest.fn(create) }
        Inject('UserSettings', userSettings)
        Inject('AdapterFactory', adapterFactory)
        Inject('AppState', {
            getAppFeatures: () => ({ interfaces:'*', ble:'*' }),
            getChannel: () => 'mobile',
        })

        service = new DeviceConfigurationService()
        logEvent = jest.spyOn(service, 'logEvent')
    }

    const buildAllButBroken = (settings:any) => settings.protocol==='openbikecontrol' ? undefined : makeAdapter(settings)

    const capability = (c:string) => service.settings.capabilities.find( (r:any)=>r.capability===c)
    const storedCapability = (c:string) => stored.capabilities.find( (r:any)=>r.capability===c)

    const baseData = () => ({
        devices: [
            { udid:TRAINER_UDID, settings:trainerSettings },
            { udid:BROKEN_UDID, settings:brokenSettings },
        ],
        capabilities: [
            { capability:IncyclistCapability.Control, selected:TRAINER_UDID, devices:[TRAINER_UDID] },
            { capability:IncyclistCapability.Power, selected:TRAINER_UDID, devices:[TRAINER_UDID, BROKEN_UDID] },
            { capability:IncyclistCapability.AppControl, selected:BROKEN_UDID, devices:[BROKEN_UDID] },
        ],
        interfaces: [ {name:'wifi', enabled:true}, {name:'ble', enabled:true} ],
    })

    afterEach( ()=>{
        service.reset()
        Inject('UserSettings', null)
        Inject('AdapterFactory', null)
        Inject('AppState', null)
        jest.clearAllMocks()
    })

    describe('init',()=>{

        test('a device the factory returns no adapter for is unselected and deleted everywhere',async ()=>{
            setup(baseData(), buildAllButBroken)

            await service.init()

            expect(service.settings.devices.map((d:any)=>d.udid)).toEqual([TRAINER_UDID])
            service.settings.capabilities.forEach( (c:any)=> expect(c.devices).not.toContain(BROKEN_UDID))
            expect(capability(IncyclistCapability.AppControl).selected).toBeFalsy()
            expect(service.adapters[BROKEN_UDID]).toBeUndefined()
            expect(Object.keys(service.adapters)).toEqual([TRAINER_UDID])

            // persisted
            expect(stored.devices.map((d:any)=>d.udid)).toEqual([TRAINER_UDID])
            stored.capabilities.forEach( (c:any)=> expect(c.devices).not.toContain(BROKEN_UDID))
            expect(storedCapability(IncyclistCapability.AppControl).selected).toBeFalsy()

            // buildable entry untouched
            expect(capability(IncyclistCapability.Control)).toMatchObject({selected:TRAINER_UDID, devices:[TRAINER_UDID]})
            expect(capability(IncyclistCapability.Power)).toMatchObject({selected:TRAINER_UDID, devices:[TRAINER_UDID]})
        })

        test('the removal is logged once, with only interface, protocol, reason and selectedFor',async ()=>{
            setup(baseData(), buildAllButBroken)

            await service.init()

            const logs = removalLogs()
            expect(logs).toHaveLength(1)
            expect(logs[0]).toEqual({
                message:'unsupported device removed',
                interface:'wifi',
                protocol:'openbikecontrol',
                reason:'no-adapter',
                selectedFor:IncyclistCapability.AppControl,
            })
            const values = Object.values(logs[0]).join(' ')
            expect(values).not.toContain(BROKEN_UDID)
            expect(values).not.toContain('BikeControl')
            expect(values).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
            expect(values).not.toMatch(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i)
        })

        test('a device that is not selected anywhere is logged with an empty selectedFor',async ()=>{
            const data = baseData()
            data.capabilities[2].selected = undefined
            setup(data, buildAllButBroken)

            await service.init()

            const logs = removalLogs()
            expect(logs).toHaveLength(1)
            expect(logs[0].selectedFor).toBe('')
            expect(service.settings.devices.map((d:any)=>d.udid)).toEqual([TRAINER_UDID])
        })

        test('a removed selection is left empty, not reassigned to another listed device',async ()=>{
            const data = {
                devices: [
                    { udid:BROKEN_UDID, settings:brokenSettings },
                    { udid:TRAINER2_UDID, settings:trainer2Settings },
                ],
                capabilities: [
                    { capability:IncyclistCapability.Control, selected:BROKEN_UDID, devices:[BROKEN_UDID, TRAINER2_UDID] },
                    { capability:IncyclistCapability.Power, selected:BROKEN_UDID, devices:[BROKEN_UDID, TRAINER2_UDID] },
                ],
                interfaces: [ {name:'wifi', enabled:true}, {name:'ble', enabled:true} ],
            }
            setup(data, buildAllButBroken)

            await service.init()

            expect(capability(IncyclistCapability.Control)).toMatchObject({devices:[TRAINER2_UDID]})
            expect(capability(IncyclistCapability.Control).selected).toBeFalsy()
            expect(capability(IncyclistCapability.Power).selected).toBeFalsy()
            expect(storedCapability(IncyclistCapability.Control).selected).toBeFalsy()
            expect(removalLogs()[0].selectedFor).toBe(`${IncyclistCapability.Control},${IncyclistCapability.Power}`)
        })

        test('a device whose adapter creation throws is removed the same way, with the error',async ()=>{
            setup(baseData(), (settings:any) => {
                if (settings.protocol==='openbikecontrol')
                    throw new Error('unknown protocol')
                return makeAdapter(settings)
            })

            await service.init()

            expect(service.settings.devices.map((d:any)=>d.udid)).toEqual([TRAINER_UDID])
            expect(capability(IncyclistCapability.AppControl).selected).toBeFalsy()
            const logs = removalLogs()
            expect(logs).toHaveLength(1)
            expect(logs[0]).toEqual({
                message:'unsupported device removed',
                interface:'wifi',
                protocol:'openbikecontrol',
                reason:'create-failed',
                selectedFor:IncyclistCapability.AppControl,
                error:'unknown protocol',
            })
        })

        test('an ANT device is logged with its profile as protocol',async ()=>{
            const data = baseData()
            data.devices[1] = { udid:BROKEN_UDID, settings:{ interface:'ant', profile:'FE', deviceID:'2606' } as any }
            setup(data, (settings:any) => settings.interface==='ant' ? null : makeAdapter(settings))

            await service.init()

            expect(removalLogs()[0]).toMatchObject({ interface:'ant', protocol:'FE', reason:'no-adapter' })
        })

        test('a second init on the persisted result removes nothing and logs nothing',async ()=>{
            setup(baseData(), buildAllButBroken)
            await service.init()
            const persisted = clone(stored)
            service.reset()

            setup(persisted, buildAllButBroken)
            await service.init()

            expect(removalLogs()).toHaveLength(0)
            expect(service.settings.devices.map((d:any)=>d.udid)).toEqual([TRAINER_UDID])
            expect(capability(IncyclistCapability.Control)).toMatchObject({selected:TRAINER_UDID, devices:[TRAINER_UDID]})
        })

        test('the old error log with the full settings dump is gone',async ()=>{
            setup(baseData(), () => { throw new Error('unknown protocol') })

            await service.init()

            const dumps = logEvent.mock.calls.map(([e])=>e).filter( e=> e?.fn==='init()->Adapterfactory.create()')
            expect(dumps).toHaveLength(0)
        })
    })

    describe('getAllAdapters',()=>{
        test('an undefined adapter entry is skipped without throwing or logging',()=>{
            setup(baseData(), buildAllButBroken)
            service.adapters = { [TRAINER_UDID]: makeAdapter(trainerSettings), [BROKEN_UDID]: undefined }
            logEvent.mockClear()

            let result:any
            expect( ()=>{ result = service.getAllAdapters() }).not.toThrow()

            expect(result.map((a:any)=>a.udid)).toEqual([TRAINER_UDID])
            expect(logEvent).not.toHaveBeenCalled()
        })
    })
})
