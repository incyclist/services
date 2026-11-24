/* eslint-disable @typescript-eslint/no-explicit-any */
import { AntPwrAdapter, IncyclistCapability } from 'incyclist-devices'
import { DeviceRideService } from './service'
import { AdapterRideInfo } from './types'
import { Inject } from '../../base/decorators'

describe('DeviceRideService - device state read-outs', () => {
    let service: DeviceRideService
    let config: any
    let infos: AdapterRideInfo[]

    const createInfo = (udid: string, deviceID: string, isControl = false): AdapterRideInfo => {
        const adapter = new AntPwrAdapter({ deviceID, profile: 'PWR', interface: 'ant' })
        jest.spyOn(adapter, 'isStarted').mockReturnValue(false)
        jest.spyOn(adapter, 'isStopped').mockReturnValue(false)
        jest.spyOn(adapter, 'isPaused').mockReturnValue(false)
        return { udid, adapter, capabilities: [IncyclistCapability.Power], isStarted: false, isControl }
    }
    const setState = (ai: AdapterRideInfo, state: { started?: boolean, paused?: boolean, stopped?: boolean }) => {
        jest.spyOn(ai.adapter, 'isStarted').mockReturnValue(state.started ?? false)
        jest.spyOn(ai.adapter, 'isPaused').mockReturnValue(state.paused ?? false)
        jest.spyOn(ai.adapter, 'isStopped').mockReturnValue(state.stopped ?? false)
    }

    beforeEach(() => {
        infos = [createInfo('1', '2606', true), createInfo('2', '2607')]
        config = {
            getEnabledInterfaces: jest.fn().mockReturnValue([]),
            getAllAdapters: jest.fn().mockReturnValue([]),
            getAdapters: jest.fn().mockImplementation(() => infos),
        }
        Inject('DeviceConfiguration', config)
        Inject('DeviceAccess', { getInterface: jest.fn() })
        service = new DeviceRideService()
    })

    afterEach(() => {
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        service.reset()
        jest.clearAllMocks()
    })

    describe('getDeviceSnapshot', () => {
        test('reports the control adapter and the sensors at adapter level', () => {
            setState(infos[0], { started: true })
            setState(infos[1], { started: true, paused: true })

            const snapshot = service.getDeviceSnapshot()

            expect(snapshot).toMatchObject({
                controlInterface: 'ant', isSimulator: false,
                controlAdapterStarted: true, controlAdapterPaused: false, controlAdapterStopped: false,
                cntSensors: 1, cntSensorsStarted: 1,
            })
            expect(snapshot.sensorStates).toMatch(/:paused$/)
        })

        test('a sensor that is neither started nor stopped is idle', () => {
            expect(service.getDeviceSnapshot().sensorStates).toMatch(/:idle$/)
        })
    })

    describe('getDisconnectedControl', () => {
        test('a started control adapter is connected', () => {
            setState(infos[0], { started: true })

            expect(service.getDisconnectedControl()).toBeUndefined()
        })

        test('a control adapter that is not started is disconnected', () => {
            expect(service.getDisconnectedControl()).toMatchObject({ started: false, stopped: false })
        })

        test('a stopped control adapter is disconnected', () => {
            setState(infos[0], { started: true, stopped: true })

            expect(service.getDisconnectedControl()).toMatchObject({ stopped: true })
        })

        test('a started control adapter whose data health has failed is disconnected', () => {
            setState(infos[0], { started: true })
            ;(service as any).rideAdapters = [{ ...infos[0], dataStatus: 'red' }]

            expect(service.getDisconnectedControl()).toBeDefined()
        })

        test('a sensor that is not started does not count', () => {
            setState(infos[0], { started: true })

            expect(service.getDisconnectedControl()).toBeUndefined()
        })

        test('nothing configured: nothing is disconnected', () => {
            infos = []

            expect(service.getDisconnectedControl()).toBeUndefined()
        })
    })

    describe('cancelStart', () => {
        test('does not clear a start that began while the devices were being stopped', async () => {
            let release!: () => void
            jest.spyOn(infos[0].adapter, 'stop').mockReturnValue(new Promise<boolean>(done => { release = () => done(true) }))
            ;(service as any).startPromises = [new Promise(() => { /* pending */ })]

            const cancelling = service.cancelStart()
            const newer = [Promise.resolve(true)]
            ;(service as any).startPromises = newer
            release()
            await cancelling

            expect((service as any).startPromises).toBe(newer)
        })

        test('clears the start it cancelled', async () => {
            jest.spyOn(infos[0].adapter, 'stop').mockResolvedValue(true)
            ;(service as any).startPromises = [new Promise(() => { /* pending */ })]

            await service.cancelStart()

            expect((service as any).startPromises).toBeNull()
        })
    })
})
