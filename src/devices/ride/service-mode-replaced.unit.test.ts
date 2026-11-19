/* eslint-disable @typescript-eslint/no-explicit-any */
import { AntPwrAdapter, IncyclistCapability } from 'incyclist-devices'
import { DeviceRideService } from './service'
import { AdapterRideInfo } from './types'
import { Inject } from '../../base/decorators'
import { EventEmitter } from 'node:events'

// The adapter switches the cycling mode on its own when the requested mode is not supported by the device
// ('mode-replaced'). The saved device mode must follow, so that the UI doesn't show a mode that is not in the list.

describe('DeviceRideService - mode replaced by adapter',()=>{
    let service:DeviceRideService
    let config:any

    const createInfo = (udid:string):AdapterRideInfo => {
        const adapter = new AntPwrAdapter({deviceID:'2606', profile:'PWR', interface:'ant'})
        jest.spyOn(adapter,'start').mockResolvedValue(true)
        jest.spyOn(adapter,'stop').mockResolvedValue(true)
        return { udid, adapter, capabilities:[IncyclistCapability.Power], isStarted:false }
    }

    beforeEach( ()=>{
        // real emitter, so that 'mode-changed' reaches listeners the way it does in the app
        config = Object.assign(new EventEmitter(),{
            getEnabledInterfaces: jest.fn().mockReturnValue([]),
            getAllAdapters: jest.fn().mockReturnValue([]),
            getModeSettings: jest.fn().mockReturnValue({}),
            getSelectedDevices: jest.fn().mockReturnValue([]),
            setMode: jest.fn( (udid:string,mode:string)=>{ config.emit('mode-changed',udid,mode,undefined) } ),
        })
        Inject('DeviceConfiguration', config)
        Inject('DeviceAccess', { getInterface: jest.fn() })
        service = new DeviceRideService()
    })

    afterEach( ()=>{
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        service.reset()
        jest.clearAllMocks()
    })

    test('saves the replacement mode and emits mode-changed',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]
        const onModeChanged = jest.fn()
        config.on('mode-changed',onModeChanged)

        await service.startAdapters([ai],'start')
        ai.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer',newMode:'Resistance'})

        expect(config.setMode).toHaveBeenCalledTimes(1)
        expect(config.setMode).toHaveBeenCalledWith('1','Resistance')
        expect(onModeChanged).toHaveBeenCalledWith('1','Resistance',undefined)
    })

    test('is subscribed while the adapter is starting',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]
        ;(ai.adapter.start as jest.Mock).mockImplementation( async ()=>{
            ai.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer',newMode:'Resistance'})
            return true
        })

        await service.startAdapters([ai],'check')

        expect(config.setMode).toHaveBeenCalledWith('1','Resistance')
    })

    test('does not subscribe twice when started repeatedly',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]

        await service.startAdapters([ai],'start')
        await service.startAdapters([ai],'start')
        ai.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer',newMode:'Resistance'})

        expect(ai.adapter.listenerCount('mode-replaced')).toBe(1)
        expect(config.setMode).toHaveBeenCalledTimes(1)
    })

    test('looks up the device in the configuration if it is not part of the ride list',async ()=>{
        const ai = createInfo('7')
        config.getAllAdapters.mockReturnValue([ai])

        await service.startAdapters([ai],'check')
        ai.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer',newMode:'Resistance'})

        expect(config.setMode).toHaveBeenCalledWith('7','Resistance')
    })

    test('removes the listener when the device is stopped',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]
        await service.startAdapters([ai],'start')

        await service.stop()

        expect(ai.adapter.listenerCount('mode-replaced')).toBe(0)
    })

    test('removes the listener when a single device is stopped',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]
        await service.startAdapters([ai],'start')

        await service.stopDevices(['1'])

        expect(ai.adapter.listenerCount('mode-replaced')).toBe(0)
    })

    test('ignores an event without a new mode and an unknown device',async ()=>{
        const known = createInfo('1')
        const unknown = createInfo('2')
        ;(service as any).rideAdapters = [known]
        await service.startAdapters([known],'start')
        await service.startAdapters([unknown],'start')

        known.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer'})
        unknown.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer',newMode:'Resistance'})

        expect(config.setMode).not.toHaveBeenCalled()
    })

    test('a failing configuration does not break the adapter',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]
        config.setMode.mockImplementation( ()=>{ throw new Error('boom') })
        await service.startAdapters([ai],'start')

        expect( ()=>ai.adapter.emit('mode-replaced',{requestedMode:'Smart Trainer',newMode:'Resistance'}) ).not.toThrow()
    })

    test('adapters that never emit the event are not affected',async ()=>{
        const ai = createInfo('1')
        ;(service as any).rideAdapters = [ai]

        await expect(service.startAdapters([ai],'start')).resolves.toBe(true)
        await service.stop()

        expect(config.setMode).not.toHaveBeenCalled()
    })
})
