/* eslint-disable @typescript-eslint/no-explicit-any */
import { AntPwrAdapter, IncyclistCapability } from 'incyclist-devices'
import { DeviceRideService } from './service'
import { AdapterRideInfo } from './types'
import { Inject } from '../../base/decorators'

// The BLE peripheral scan and the Wifi (mDNS) discovery are paused while a ride is running (reason 'ride') and must be resumed on every
// way a ride can end, without undoing a pause that was requested by the app going to the background.

describe('DeviceRideService - background scan during a ride',()=>{
    let service:DeviceRideService
    let access:any

    const createInfo = (udid:string, deviceID:string, startResult=true):AdapterRideInfo => {
        const adapter = new AntPwrAdapter({deviceID, profile:'PWR', interface:'ant'})
        jest.spyOn(adapter,'start').mockResolvedValue(startResult)
        jest.spyOn(adapter,'stop').mockResolvedValue(true)
        return { udid, adapter, capabilities:[IncyclistCapability.Power], isStarted:false }
    }

    beforeEach( ()=>{
        const config = {
            getEnabledInterfaces: jest.fn().mockReturnValue([]),
            getAllAdapters: jest.fn().mockReturnValue([]),
            getModeSettings: jest.fn().mockReturnValue({}),
            getSelectedDevices: jest.fn().mockReturnValue([]),
        }
        access = {
            getInterface: jest.fn(),
            pauseBackgroundActivity: jest.fn().mockResolvedValue(undefined),
            resumeBackgroundActivity: jest.fn().mockResolvedValue(undefined),
        }
        Inject('DeviceConfiguration', config)
        Inject('DeviceAccess', access)
        service = new DeviceRideService()
        service.logEvent = jest.fn()
    })

    afterEach( ()=>{
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        service.reset()
        jest.clearAllMocks()
    })

    test('pauses the BLE scan and the Wifi (mDNS) discovery once the ride has started, and nothing else',async ()=>{
        await service.startAdapters([createInfo('1','2606')],'start')

        expect(access.pauseBackgroundActivity).toHaveBeenCalledTimes(1)
        expect(access.pauseBackgroundActivity).toHaveBeenCalledWith('ride',['ble','wifi'])
    })

    test.each(['pair','check'] as const)('does not pause the scan for a %s start',async (startType)=>{
        await service.startAdapters([createInfo('1','2606')],startType)

        expect(access.pauseBackgroundActivity).not.toHaveBeenCalled()
    })

    test('does not pause the scan if a device failed to start',async ()=>{
        await service.startAdapters([createInfo('1','2606',false)],'start')

        expect(access.pauseBackgroundActivity).not.toHaveBeenCalled()
    })

    test('a repeated start does not request the pause twice',async ()=>{
        await service.startAdapters([createInfo('1','2606')],'start')
        await service.startAdapters([createInfo('2','2607')],'start')

        expect(access.pauseBackgroundActivity).toHaveBeenCalledTimes(1)
    })

    test('stop() resumes the scan',async ()=>{
        await service.startAdapters([createInfo('1','2606')],'start')

        await service.stop()

        expect(access.resumeBackgroundActivity).toHaveBeenCalledWith('ride',['ble','wifi'])
    })

    test('stopping a single device keeps the scan paused',async ()=>{
        await service.startAdapters([createInfo('1','2606')],'start')

        await service.stop('1')

        expect(access.resumeBackgroundActivity).not.toHaveBeenCalled()
    })

    test('stop() resumes the scan even if stopping a device hangs',async ()=>{
        const ai = createInfo('1','2606')
        ;(service as any).rideAdapters = [ai]
        await service.startAdapters([ai],'start')
        jest.spyOn(ai.adapter,'stop').mockImplementation( ()=>new Promise<boolean>( ()=>{} ))

        void service.stop()

        expect(access.resumeBackgroundActivity).toHaveBeenCalledTimes(1)
    })

    test('cancelStart() and dropPendingStart() resume the scan',async ()=>{
        await service.startAdapters([createInfo('1','2606')],'start')
        await service.cancelStart()
        expect(access.resumeBackgroundActivity).toHaveBeenCalledTimes(1)

        await service.startAdapters([createInfo('1','2606')],'start')
        service.dropPendingStart()
        expect(access.resumeBackgroundActivity).toHaveBeenCalledTimes(2)
    })

    test('resuming without a pause does nothing',async ()=>{
        await service.stop()
        await service.cancelStart()
        service.dropPendingStart()

        expect(access.resumeBackgroundActivity).not.toHaveBeenCalled()
    })

    test('a ride that ended without stop() is detected and repaired on the next start',async ()=>{
        await service.startAdapters([createInfo('1','2606')],'start')
        ;(service as any).lazyInit = jest.fn().mockResolvedValue(undefined)
        ;(service as any).waitForPreviousStartToFinish = jest.fn().mockResolvedValue(false)

        await service.start({} as any)

        expect(service.logEvent).toHaveBeenCalledWith({message:'ride scan pause leaked'})
        expect(access.resumeBackgroundActivity).toHaveBeenCalledWith('ride',['ble','wifi'])
    })

    test('a failing pause or resume never breaks the ride',async ()=>{
        access.pauseBackgroundActivity.mockRejectedValue(new Error('ble down'))
        access.resumeBackgroundActivity.mockRejectedValue(new Error('ble down'))

        await expect(service.startAdapters([createInfo('1','2606')],'start')).resolves.toBe(true)
        await expect(service.stop()).resolves.toBe(true)
    })
})
