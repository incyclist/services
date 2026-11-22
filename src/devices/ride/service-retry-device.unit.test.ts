/* eslint-disable @typescript-eslint/no-explicit-any */
import { AntPwrAdapter, IncyclistCapability } from 'incyclist-devices'
import { DeviceRideService } from './service'
import { AdapterRideInfo } from './types'
import { Inject } from '../../base/decorators'

// A single device can be restarted while the ride is still starting, without touching the other
// devices and without waiting for their start.

describe('DeviceRideService - per-device start retry',()=>{
    let service:DeviceRideService
    let events:Array<{event:string, udid?:string}>

    const createInfo = (udid:string, deviceID:string, isControl=false):AdapterRideInfo => {
        const adapter = new AntPwrAdapter({deviceID, profile:'PWR', interface:'ant'})
        jest.spyOn(adapter,'start').mockResolvedValue(true)
        jest.spyOn(adapter,'stop').mockResolvedValue(true)
        return { udid, adapter, capabilities:[IncyclistCapability.Power], isStarted:false, isControl }
    }

    const deferred = () => {
        let resolve:(v:boolean)=>void
        const promise = new Promise<boolean>( r=>{ resolve = r })
        return { promise, resolve }
    }

    const setAdapters = (...adapters:AdapterRideInfo[]) => {
        (service as any).rideAdapters = adapters;
        (service as any).lazyInitDone = true
    }

    beforeEach( ()=>{
        Inject('DeviceConfiguration', {
            getEnabledInterfaces: jest.fn().mockReturnValue([]),
            getAllAdapters: jest.fn().mockReturnValue([]),
            getModeSettings: jest.fn().mockReturnValue({}),
            getSelectedDevices: jest.fn().mockReturnValue([]),
        })
        Inject('DeviceAccess', { getInterface: jest.fn() })
        service = new DeviceRideService()
        events = []
        for (const event of ['start-request','start-success','start-error']) {
            service.on(event, (info)=> { events.push({event, udid:info?.udid}) })
        }
        jest.spyOn(service,'logEvent').mockImplementation( ()=>{} )
    })

    afterEach( ()=>{
        jest.useRealTimers()
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('retryStartDevice',()=>{

        test('restarts an errored sensor while another device is still starting, without a start-request',async ()=>{
            const trainer = createInfo('1','2606',true)
            const sensor = createInfo('2','2607')
            setAdapters(trainer, sensor);
            (service as any).startPromises = [ new Promise( ()=>{} ) ]  // trainer start has not settled

            const result = await service.retryStartDevice('2',{})

            expect(result).toBe(true)
            expect(sensor.adapter.start).toHaveBeenCalledTimes(1)
            expect(trainer.adapter.start).not.toHaveBeenCalled()
            expect(events).toEqual([{event:'start-success', udid:'2'}])
        })

        test('reports the outcome of the retry',async ()=>{
            const sensor = createInfo('2','2607')
            setAdapters(sensor)
            ;(sensor.adapter.start as jest.Mock).mockResolvedValue(false)

            const result = await service.retryStartDevice('2',{})

            expect(result).toBe(false)
            expect(events).toEqual([{event:'start-error', udid:'2'}])
            expect(service.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                message:'start device retry result', retryResult:'failed', deviceRole:'sensor', retryAttempt:1, retryDurationMs:expect.any(Number)
            }))
        })

        test('returns false for an unknown device',async ()=>{
            setAdapters(createInfo('2','2607'))
            expect(await service.retryStartDevice('9',{})).toBe(false)
        })

        test('stops the attempt that is still running and ignores its late error',async ()=>{
            const sensor = createInfo('2','2607')
            setAdapters(sensor)

            const first = deferred()
            ;(sensor.adapter.start as jest.Mock).mockReturnValueOnce(first.promise)
            ;(sensor.adapter.stop as jest.Mock).mockImplementation( async ()=> { first.resolve(false); return true })

            const firstStart = (service as any).startSingleAdapter(sensor,[],{},'start')
            const result = await service.retryStartDevice('2',{})
            await firstStart

            expect(sensor.adapter.stop).toHaveBeenCalledTimes(1)
            expect(sensor.adapter.start).toHaveBeenCalledTimes(2)
            expect(result).toBe(true)
            // the superseded attempt reported nothing: only the success of the retry
            expect(events).toEqual([{event:'start-success', udid:'2'}])
        })

        test('does not stop a device that is not starting',async ()=>{
            const sensor = createInfo('2','2607')
            setAdapters(sensor)
            ;(sensor.adapter.start as jest.Mock).mockResolvedValueOnce(false)
            await (service as any).startSingleAdapter(sensor,[],{},'start')

            await service.retryStartDevice('2',{})

            expect(sensor.adapter.stop).not.toHaveBeenCalled()
        })

        test('gives up after 5s if the device does not stop, and reports an error',async ()=>{
            jest.useFakeTimers()
            const sensor = createInfo('2','2607')
            setAdapters(sensor)
            ;(sensor.adapter.start as jest.Mock).mockReturnValueOnce(new Promise( ()=>{} ))
            ;(sensor.adapter.stop as jest.Mock).mockReturnValue(new Promise( ()=>{} ))
            ;(service as any).startSingleAdapter(sensor,[],{},'start').catch( ()=>{} )

            const retry = service.retryStartDevice('2',{})
            await jest.advanceTimersByTimeAsync(4999)
            expect(events).toEqual([])

            await jest.advanceTimersByTimeAsync(1)
            const result = await retry

            expect(result).toBe(false)
            expect(sensor.adapter.start).toHaveBeenCalledTimes(1)
            expect(events).toEqual([{event:'start-error', udid:'2'}])
            expect(service.logEvent).toHaveBeenCalledWith(expect.objectContaining({ message:'start device retry result', retryResult:'stop-timeout' }))
        })
    })

    describe('cancelStart',()=>{

        test('stops a device that is waiting to be retried and does not start it afterwards',async ()=>{
            jest.useFakeTimers()
            const sensor = createInfo('2','2607')
            setAdapters(sensor)
            ;(sensor.adapter.start as jest.Mock).mockReturnValueOnce(new Promise( ()=>{} ))
            const stops:Array<(v:boolean)=>void> = []
            ;(sensor.adapter.stop as jest.Mock).mockImplementation( ()=> new Promise( r=>{ stops.push(r) }) )
            ;(service as any).startSingleAdapter(sensor,[],{},'start').catch( ()=>{} )

            const retry = service.retryStartDevice('2',{})
            await jest.advanceTimersByTimeAsync(100)

            const cancel = service.cancelStart()
            stops.forEach( release=>release(true) )
            await cancel
            const result = await retry

            expect(result).toBe(false)
            expect(sensor.adapter.stop).toHaveBeenCalled()
            expect(sensor.adapter.start).toHaveBeenCalledTimes(1)
            expect(service.logEvent).toHaveBeenCalledWith(expect.objectContaining({ message:'start device retry result', retryResult:'cancelled' }))
        })

        test('stops a device that is being retried although no start is pending',async ()=>{
            const sensor = createInfo('2','2607')
            setAdapters(sensor)
            const pending = deferred()
            ;(sensor.adapter.start as jest.Mock).mockReturnValue(pending.promise)

            const retry = service.retryStartDevice('2',{})
            await new Promise( r=>setImmediate(r) )
            await service.cancelStart()
            pending.resolve(false)
            await retry

            expect(sensor.adapter.stop).toHaveBeenCalled()
        })
    })
})
