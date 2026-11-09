/* eslint-disable @typescript-eslint/no-explicit-any */
import { AntPwrAdapter, IncyclistCapability } from 'incyclist-devices'
import { DeviceRideService } from './service'
import { AdapterRideInfo } from './types'
import { Inject } from '../../base/decorators'

// Starting devices must not depend on helpers around the start (logging) working, and a start that
// fails half-way must not leave stale state behind that blocks or confuses the next start.

describe('DeviceRideService - device start robustness',()=>{
    let service:DeviceRideService
    let config:any

    const createInfo = (udid:string, deviceID:string):AdapterRideInfo => {
        const adapter = new AntPwrAdapter({deviceID, profile:'PWR', interface:'ant'})
        jest.spyOn(adapter,'start').mockResolvedValue(true)
        jest.spyOn(adapter,'stop').mockResolvedValue(true)
        return { udid, adapter, capabilities:[IncyclistCapability.Power], isStarted:false }
    }

    beforeEach( ()=>{
        config = {
            getEnabledInterfaces: jest.fn().mockReturnValue([]),
            getAllAdapters: jest.fn().mockReturnValue([]),
            getModeSettings: jest.fn().mockReturnValue({}),
            getSelectedDevices: jest.fn().mockReturnValue([]),
        }
        Inject('DeviceConfiguration', config)
        Inject('DeviceAccess', { getInterface: jest.fn() })
        service = new DeviceRideService()
    })

    afterEach( async ()=>{
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('startAdapters',()=>{

        test('a device is still started when resuming the logs throws',async ()=>{
            config.getAllAdapters.mockImplementation( ()=>{ throw new TypeError("Cannot read properties of undefined (reading 'getCapabilities')") })
            const ai = createInfo('1','2606')

            const result = await service.startAdapters([ai],'pair')

            expect(ai.adapter.start).toHaveBeenCalled()
            expect(result).toBe(true)
        })

        test('a device is still started when an adapter fails to resume its own logs',async ()=>{
            const ai = createInfo('1','2606')
            jest.spyOn(ai.adapter,'resumeLogging').mockImplementation( ()=>{ throw new Error('logging failed') })

            const result = await service.startAdapters([ai],'start')

            expect(ai.adapter.start).toHaveBeenCalled()
            expect(result).toBe(true)
        })

        test('a start that throws does not leave a pending start behind',async ()=>{
            const ai = createInfo('1','2606')
            jest.spyOn(ai.adapter,'getUniqueName').mockImplementation( ()=>{ throw new Error('broken adapter') })

            await expect(service.startAdapters([ai],'pair')).rejects.toThrow('broken adapter')

            // nothing left to cancel
            expect(await service.cancelStart()).toBeUndefined()
        })
    })

    describe('dropPendingStart',()=>{

        const never = ()=>new Promise<boolean>( ()=>{ /* never settles */ })

        test('fires a stop on every device that has not started, without waiting for it, and leaves started ones alone',async ()=>{
            const pending = createInfo('1','2606')
            const connected = createInfo('2','2607')
            ;(pending.adapter.start as jest.Mock).mockImplementation(never)
            ;(pending.adapter.stop as jest.Mock).mockImplementation(never)
            jest.spyOn(connected.adapter,'isStarted').mockReturnValue(true)
            const pause = jest.spyOn(connected.adapter,'pause')
            ;(service as any).rideAdapters = [pending,connected]
            void service.startAdapters([pending],'pair')

            service.dropPendingStart()

            expect(pending.adapter.stop).toHaveBeenCalled()
            expect(connected.adapter.stop).not.toHaveBeenCalled()
            expect(pause).not.toHaveBeenCalled()
            // nothing left for the next start to wait for, or to cancel
            expect(await service.waitForPreviousStartToFinish()).toBe(true)
            expect(await service.cancelStart()).toBeUndefined()
            expect((service as any).rideAdapters).toBeUndefined()
        })

        test('a fired stop that fails does not leak an unhandled rejection',async ()=>{
            const pending = createInfo('1','2606')
            ;(pending.adapter.start as jest.Mock).mockImplementation(never)
            ;(pending.adapter.stop as jest.Mock).mockRejectedValue(new Error('stop failed'))
            ;(service as any).rideAdapters = [pending]
            void service.startAdapters([pending],'pair')
            const unhandled = jest.fn()
            process.on('unhandledRejection',unhandled)

            try {
                service.dropPendingStart()
                await new Promise( done=>setImmediate(done))
            }
            finally {
                process.off('unhandledRejection',unhandled)
            }

            expect(pending.adapter.stop).toHaveBeenCalled()
            expect(unhandled).not.toHaveBeenCalled()
        })

        test('a dropped start that settles later does not clear the start that followed it',async ()=>{
            const ai = createInfo('1','2606')
            let settleDropped:(ok:boolean)=>void = ()=>{}
            ;(ai.adapter.start as jest.Mock)
                .mockImplementationOnce( ()=>new Promise<boolean>( done=>{ settleDropped=done }))
                .mockImplementationOnce(never)
            ;(service as any).rideAdapters = [ai]
            const dropped = service.startAdapters([ai],'pair')
            service.dropPendingStart()
            void service.startAdapters([ai],'pair')

            settleDropped(false)
            await dropped

            // the newer start is still pending, so it can still be cancelled
            expect(await service.cancelStart()).toBe(true)
        })
    })

    describe('getStartedCapabilities',()=>{

        test('provides the capabilities a device was successfully started for',async ()=>{
            const ai = createInfo('1','2606')
            ai.capabilities = [IncyclistCapability.Power, IncyclistCapability.Cadence]

            await service.startAdapters([ai],'pair')

            expect(service.getStartedCapabilities('1')).toEqual([IncyclistCapability.Power, IncyclistCapability.Cadence])
        })

        test('is undefined for a device whose start failed',async ()=>{
            const ai = createInfo('1','2606')
            await service.startAdapters([ai],'pair')
            ;(ai.adapter.start as jest.Mock).mockResolvedValue(false)

            await service.startAdapters([ai],'pair')

            expect(service.getStartedCapabilities('1')).toBeUndefined()
        })

        test('is undefined for a device that was never started',()=>{
            expect(service.getStartedCapabilities('1')).toBeUndefined()
        })
    })

    describe('stopDevices',()=>{

        test('stops only the given devices and keeps the others',async ()=>{
            const ai1 = createInfo('1','2606')
            const ai2 = createInfo('2','2607')
            ;(service as any).rideAdapters = [ai1,ai2]
            const onStopRide = jest.fn()
            service.on('stop-ride',onStopRide)

            await service.stopDevices(['1'])

            expect(ai1.adapter.stop).toHaveBeenCalled()
            expect(ai2.adapter.stop).not.toHaveBeenCalled()
            expect((service as any).rideAdapters).toEqual([ai1,ai2])
            expect(onStopRide).not.toHaveBeenCalled()
        })

        test('stops a configured device that is not in the ride list',async ()=>{
            const ai1 = createInfo('1','2606')
            config.getAllAdapters.mockReturnValue([ {udid:'1', adapter:ai1.adapter, capabilities:ai1.capabilities} ])

            await service.stopDevices(['1'])

            expect(ai1.adapter.stop).toHaveBeenCalled()
        })

        test('an empty list stops nothing',async ()=>{
            const ai1 = createInfo('1','2606')
            ;(service as any).rideAdapters = [ai1]

            await service.stopDevices([])

            expect(ai1.adapter.stop).not.toHaveBeenCalled()
        })
    })
})
