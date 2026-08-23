
import { Device } from 'tcx-builder'
import { Inject } from '../../base/decorators'
import { Workout } from '../../workouts'
import { RideDisplayService } from './service'
import { Observer } from '../../base/types'
import { RideType } from '../base'
import sydney from '../../../__tests__/data/routes/sydney.json'
import { Route } from '../../routes/base/model/route'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { waitNextTick } from '../../utils'

const OC = expect.objectContaining
describe('RideDisplayService', () => {

    describe('powerUp', () => {

        let service: RideDisplayService
        let activityValues = {}
        let limits = {}
        let devicePowerUp = jest.fn()


        const simulateData = (s, data: Device) => {
            s.onDeviceData(data, '123')
        }

        const setupMocks = (s, props?: { workout: Workout, activityObserver: Observer }) => {
            let unselected = false
            Inject('ActivityRide', {
                getActivity: jest.fn().mockReturnValue({}),
                init: jest.fn().mockReturnValue(props?.activityObserver ?? new Observer()),
                getCurrentValues: jest.fn().mockReturnValue(activityValues)
            })
            Inject('WorkoutList', {
                getSelected: jest.fn().mockReturnValue(props?.workout),
                getStartSettings: jest.fn().mockReturnValue({ ftp: 200, useErgMode: true })
            })
            Inject('RouteList', {
                getSelected: jest.fn().mockReturnValue(null),
                getStartSettings: jest.fn().mockReturnValue({})
            })
            Inject('DeviceRide', {
                sendUpdate: jest.fn(),
                getControlAdapter: jest.fn(),
                getCyclingMode: jest.fn()
            })
            Inject('UIBinding', {
                enableScreensaver: jest.fn(),
                disableScreensaver: jest.fn(),
            })

            s.startDevices = jest.fn(() => {
                s.onStartCompleted()
                props?.activityObserver.emit('started')
            })
            s.devicePowerUp = devicePowerUp

        }

        const cleanupMocks = (s) => {
            s.reset()
            jest.resetAllMocks()
            Inject('ActivityRide',null)
            Inject('WorkoutList',null)
            Inject('RouteList',null)
            Inject('DeviceRide',null)
            Inject('UIBinding',null)
        }

        beforeEach(() => {
            Inject('UserSettings', {
                get: jest.fn().mockReturnValue(process.env.DEBUG)
            })

            service = new RideDisplayService()
        })

        afterEach(() => {
            if (service)
                cleanupMocks(service)
        })

        test('arrow-up after workout was stopped by user', () => {
            const workout = new Workout({ type: 'workout', name: 'Test Workout' })
            workout.addSegment({
                type: 'segment', text: 'Test Segment', repeat: 10, steps: [
                    { type: 'step', steady: true, work: true, duration: 120, power: { min: 100, max: 100, type: 'pct of FTP' }, text: 'Test Work' },
                    { type: 'step', steady: true, work: false, duration: 60, power: { min: 50, max: 50, type: 'pct of FTP' }, text: 'Test Relax' }
                ]
            })

            const a = new Observer()
            setupMocks(service, { workout, activityObserver: a })

            service.init()
            service.start()
            service.stopWorkout()

            service.onArrowKey({ key: 'ArrowUp' })
            expect(devicePowerUp).toHaveBeenCalled()



        })
    })

    // Regression: RidePageService.adjustLoad() needed a plain (no-workout) power/gear adjustment
    // that returns a PowerAdjustmentResult (devicePowerUp() itself is void, fire-and-forget) -
    // adjustDevicePower() is the same branching devicePowerUp() already performed, factored out so
    // both a returning and a void caller can share it.
    describe('adjustDevicePower', () => {
        let service: any
        let sendUpdate: jest.Mock
        let gearChange: jest.Mock
        let simulatorPowerUp: jest.Mock
        let getControlAdapter: jest.Mock
        let getCyclingMode: jest.Mock

        const mockMode = (overrides: object) => ({
            getName: jest.fn().mockReturnValue('Trainer'),
            isERG: jest.fn().mockReturnValue(false),
            isSIM: jest.fn().mockReturnValue(false),
            isResistance: jest.fn().mockReturnValue(false),
            ...overrides
        })

        beforeEach(() => {
            service = new RideDisplayService()
            sendUpdate = jest.fn()
            gearChange = jest.fn()
            simulatorPowerUp = jest.fn()
            getControlAdapter = jest.fn().mockReturnValue({ udid: '123' })
            getCyclingMode = jest.fn()

            service.getDeviceRide = jest.fn().mockReturnValue({ getControlAdapter, getCyclingMode })
            service.getRideModeService = jest.fn().mockReturnValue({ sendUpdate })
            service.gearChange = gearChange
            service.simulatorPowerUp = simulatorPowerUp
        })

        // RideDisplayService is a @Singleton - without this, the instance stubs above would leak
        // into every later describe block's `new RideDisplayService()` in this file.
        afterEach(() => {
            service.reset()
        })

        test('no control adapter -> undefined, nothing called', () => {
            getControlAdapter.mockReturnValue(undefined)

            const result = service.adjustDevicePower(50)

            expect(result).toBeUndefined()
            expect(sendUpdate).not.toHaveBeenCalled()
            expect(gearChange).not.toHaveBeenCalled()
        })

        test('Simulator mode -> simulatorPowerUp(), reports targetPower with an unknown (NaN) value', () => {
            getCyclingMode.mockReturnValue(mockMode({ getName: jest.fn().mockReturnValue('Simulator') }))

            const result = service.adjustDevicePower(50)

            expect(simulatorPowerUp).toHaveBeenCalledWith(expect.anything(), 50)
            expect(result).toEqual({ type: 'targetPower', value: NaN })
        })

        test('ERG mode -> sends targetPowerDelta, reports targetPower with an unknown (NaN) value', () => {
            getCyclingMode.mockReturnValue(mockMode({ isERG: jest.fn().mockReturnValue(true) }))

            const result = service.adjustDevicePower(50)

            expect(sendUpdate).toHaveBeenCalledWith({ targetPowerDelta: 50 })
            expect(result).toEqual({ type: 'targetPower', value: NaN })
        })

        test('SIM mode -> gear shift, clamped to +/-5 and reported exactly',()=>{
            getCyclingMode.mockReturnValue(mockMode({ isSIM: jest.fn().mockReturnValue(true) }))

            const resultSmall = service.adjustDevicePower(5)
            expect(gearChange).toHaveBeenCalledWith(1)
            expect(resultSmall).toEqual({ type: 'gear', value: 1 })

            const resultLarge = service.adjustDevicePower(50)
            expect(gearChange).toHaveBeenCalledWith(5)
            expect(resultLarge).toEqual({ type: 'gear', value: 5 })
        })

        test('Resistance mode -> same gear-shift handling as SIM mode',()=>{
            getCyclingMode.mockReturnValue(mockMode({ isResistance: jest.fn().mockReturnValue(true) }))

            const result = service.adjustDevicePower(-50)

            expect(gearChange).toHaveBeenCalledWith(-5)
            expect(result).toEqual({ type: 'gear', value: -5 })
        })

        test('an unrecognised mode -> undefined, nothing called', () => {
            getCyclingMode.mockReturnValue(mockMode({}))

            const result = service.adjustDevicePower(50)

            expect(result).toBeUndefined()
            expect(sendUpdate).not.toHaveBeenCalled()
            expect(gearChange).not.toHaveBeenCalled()
            expect(simulatorPowerUp).not.toHaveBeenCalled()
        })

        test('devicePowerUp() delegates here and discards the result (existing void contract preserved)',()=>{
            getCyclingMode.mockReturnValue(mockMode({ isERG: jest.fn().mockReturnValue(true) }))

            const returned = service.devicePowerUp(50)

            expect(sendUpdate).toHaveBeenCalledWith({ targetPowerDelta: 50 })
            expect(returned).toBeUndefined()
        })
    })

    describe('toggleAllOverlays', () => {

        let service: RideDisplayService
        const emit = jest.fn()


        const setupMocks = (s:any, props?: { hidden?: boolean, sideViews?: object, rideType?:RideType, route?:Route, startSettings?:any, setFn? }) => {

            Inject('UserSettings', {
                get: jest.fn((k, d) => {
                    try {
                        const parts = k.split('.');
                        const overlay = parts[parts.length-1];
                        return props?.sideViews?.[overlay]??d
                    }
                    catch { return d}
                }),
                set: props?.setFn??jest.fn()
            })

            Inject('RouteList', {
                getStartSettings: jest.fn().mockReturnValue(props?.startSettings??{}),
                unselect: jest.fn(),
                getSelected: jest.fn().mockReturnValue(props?.route)
            })

            s.observer = new Observer()
            s.observer.emit = emit

            if (props?.rideType)
                s.getRideType = jest.fn().mockReturnValue(props?.rideType)

            s.hideAll = props?.hidden??false
            s.isVirtualShiftingEnabled = jest.fn().mockReturnValue(false)

        }

        const cleanupMocks = (s) => {
            jest.resetAllMocks()
            Inject('UserSettings', null)
            Inject('RouteList',null)
        }

        beforeEach(() => {
            service = new RideDisplayService()
        })

        afterEach(() => {
            service.reset()
            cleanupMocks(service)
            jest.resetAllMocks()
        })

        describe('GPX Route', () => {
            test('all overlays shown', async () => {
                const sideViews = {
                    map: true,
                    'sv-left': true,
                    'sv-right': true,
                    'slope': true,
                    'elevation': true,
                }
                const route = createFromJson( sydney as unknown as RouteApiDetail)
                const setFn = jest.fn()
                setupMocks(service, { hidden: false, sideViews, rideType:'GPX',route,setFn })

                service.toggleAllOverlays()
                await waitNextTick()


                expect(emit).toHaveBeenCalledWith('overlay-update', OC( {
                    hideAll: true,
                    map:OC({show: false}),
                    sideViews: OC({enabled:true, hide:true, left:true, right:true}),
                    upcomingElevation: OC({show:false}),
                    totalElevation: OC({show:false}),
                }))
                expect(setFn).not.toHaveBeenCalled()
                jest.clearAllMocks()

                service.toggleAllOverlays()
                await waitNextTick()

                expect(emit).toHaveBeenCalledWith('overlay-update', OC( {
                    hideAll: false,
                    map: {show:true, minimized:false},
                    sideViews: OC({enabled:true, hide:false, left:true, right:true}),
                    upcomingElevation: {show:true, minimized:false},
                    totalElevation: {show:true, minimized:false},
                }))
                expect(setFn).not.toHaveBeenCalled()


            })
            test('', () => { })
            test('', () => { })
            test('', () => { })

        })

    })

})   