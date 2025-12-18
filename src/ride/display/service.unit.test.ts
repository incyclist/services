
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