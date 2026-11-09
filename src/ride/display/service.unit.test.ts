
import { EventEmitter } from 'node:events'
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
            Inject('GoogleMaps', {
                hasPersonalApiKey: jest.fn().mockReturnValue(true),
                hasDevelopmentApiKey: jest.fn().mockReturnValue(false)

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
            Inject('GoogleMaps', null)
        }

        beforeEach(() => {
            Inject('UserSettings', {
                get: jest.fn().mockReturnValue(process.env.DEBUG),
                getValue: jest.fn().mockReturnValue(process.env.DEBUG)
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
                getValue: jest.fn((k, d) => {
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
                    sideViews: OC({enabled:false, hide:true, left:false, right:false}),
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
                    sideViews: OC({enabled:false, hide:false, left:false, right:false}),
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

    describe('overlay pin state', () => {

        let service: RideDisplayService

        const setupMocks = (getFn?, setFn?) => {
            Inject('UserSettings', {
                get: getFn ?? jest.fn().mockReturnValue(false),
                getValue: getFn ?? jest.fn().mockReturnValue(false),
                set: setFn ?? jest.fn()
            })
        }

        beforeEach(() => {
            service = new RideDisplayService()
        })

        afterEach(() => {
            Inject('UserSettings', null)
            jest.resetAllMocks()
        })

        test('isOverlayPinned reads the overlay-specific settings key, defaulting to false', () => {
            const getFn = jest.fn().mockReturnValue(true)
            setupMocks(getFn)

            const result = service.isOverlayPinned('shifting')

            expect(getFn).toHaveBeenCalledWith('preferences.rideOverlays.shifting.pinned', false)
            expect(result).toBe(true)
        })

        test('isOverlayPinned returns false and logs when settings access throws', () => {
            const getFn = jest.fn().mockImplementation(() => { throw new Error('boom') })
            setupMocks(getFn)

            expect(service.isOverlayPinned('shifting')).toBe(false)
        })

        test('setOverlayPinned writes the overlay-specific settings key', () => {
            const setFn = jest.fn()
            setupMocks(undefined, setFn)

            service.setOverlayPinned('workout-control', true)

            expect(setFn).toHaveBeenCalledWith('preferences.rideOverlays.workout-control.pinned', true)
        })

        test('setOverlayPinned does not throw when settings access throws', () => {
            const setFn = jest.fn().mockImplementation(() => { throw new Error('boom') })
            setupMocks(undefined, setFn)

            expect(() => service.setOverlayPinned('workout-control', false)).not.toThrow()
        })

        test('setOverlayPinned emits overlay-update with the refreshed display properties, so pinning components react without local state', () => {
            const getFn = jest.fn().mockReturnValue(true)
            setupMocks(getFn)
            const emit = jest.fn()
            const s = service as any
            s.observer = new Observer()
            s.observer.emit = emit

            service.setOverlayPinned('shifting', true)

            expect(emit).toHaveBeenCalledWith('overlay-update', expect.objectContaining({ shiftingPinned: true }))
        })

    })

    describe('createActivity — previous-rides refresh wiring', () => {
        let service: RideDisplayService

        afterEach(() => {
            Inject('ActivityRide', null)
        })

        test('re-emits on the service\'s own observer on every ActivityRideService "prevRides" tick', () => {
            const activityObserver = new Observer()
            Inject('ActivityRide', {
                init: jest.fn().mockReturnValue(activityObserver),
            })

            service = new RideDisplayService()
            ;(service as any).observer = new Observer()
            const emit = jest.spyOn((service as any).observer, 'emit')

            ;(service as any).createActivity()
            activityObserver.emit('prevRides', [{ title: 'someone' }])

            expect(emit).toHaveBeenCalledWith('prev-rides-update')
        })

        test('does not fire before the first tick', () => {
            const activityObserver = new Observer()
            Inject('ActivityRide', {
                init: jest.fn().mockReturnValue(activityObserver),
            })

            service = new RideDisplayService()
            ;(service as any).observer = new Observer()
            const emit = jest.spyOn((service as any).observer, 'emit')

            ;(service as any).createActivity()

            expect(emit).not.toHaveBeenCalledWith('prev-rides-update')
        })

        test('re-fires on every tick, not just the first (drives the mobile view\'s live row refresh)', () => {
            const activityObserver = new Observer()
            Inject('ActivityRide', {
                init: jest.fn().mockReturnValue(activityObserver),
            })

            service = new RideDisplayService()
            ;(service as any).observer = new Observer()
            const emit = jest.spyOn((service as any).observer, 'emit')

            ;(service as any).createActivity()
            activityObserver.emit('prevRides', [{ title: 'a' }])
            activityObserver.emit('prevRides', [{ title: 'b' }])
            activityObserver.emit('prevRides', [{ title: 'c' }])

            expect(emit.mock.calls.filter(([event]) => event === 'prev-rides-update')).toHaveLength(3)
        })
    })

    describe('stopRide', () => {
        let service: any

        const setupMocks = (s, props?: { activity?: any }) => {
            Inject('ActivityRide', {
                getActivity: jest.fn().mockReturnValue(props?.activity),
                stop: jest.fn(),
                cleanup: jest.fn(),
            })
            Inject('WorkoutRide', {
                stop: jest.fn(),
                pause: jest.fn(),
                resume: jest.fn(),
                inUse: jest.fn().mockReturnValue(false),
            })
            Inject('RouteList', {
                getSelected: jest.fn().mockReturnValue(null),
                getStartSettings: jest.fn().mockReturnValue({}),
                unselect: jest.fn(),
            })
            Inject('DeviceRide', {
                pause: jest.fn(),
                stop: jest.fn(),
                off: jest.fn(),
                enforceSimulator: jest.fn(),
            })
            Inject('UIBinding', {
                enableScreensaver: jest.fn(),
                disableScreensaver: jest.fn(),
            })

            s.displayService = { stop: jest.fn() }
            s.observer = new Observer()
        }

        const cleanupMocks = () => {
            service?.reset()
            Inject('ActivityRide', null)
            Inject('WorkoutRide', null)
            Inject('RouteList', null)
            Inject('DeviceRide', null)
            Inject('UIBinding', null)
        }

        afterEach(() => {
            cleanupMocks()
        })

        // Regression: the "activity stopped" log used the *current* state (checked before
        // prevState was captured) as its guard, while the redundancy short-circuit a few
        // lines later used prevState - two different checks over almost the same thing. A
        // ride aborted while still 'Starting' (e.g. cancelStart() mid-pairing) fell through
        // the old guard entirely and was never logged.
        test('logs "activity stopped" when a ride is aborted while still in Starting state', async () => {
            service = new RideDisplayService()
            setupMocks(service, { activity: { id: 'a1' } })
            service.state = 'Starting'

            const logEvent = jest.spyOn(service, 'logEvent')

            await service.stopRide({ noStateUpdates: true })

            expect(logEvent).toHaveBeenCalledWith(OC({ message: 'activity stopped', lastState: 'Starting' }))
        })

        test('does not log when cancelling before any activity was ever created', async () => {
            service = new RideDisplayService()
            setupMocks(service, { activity: undefined })
            service.state = 'Starting'

            const logEvent = jest.spyOn(service, 'logEvent')

            await service.stopRide({ noStateUpdates: true })

            expect(logEvent).not.toHaveBeenCalledWith(OC({ message: 'activity stopped' }))
        })

        test('logs once from Active state, and a redundant follow-up call does not log again', async () => {
            service = new RideDisplayService()
            setupMocks(service, { activity: { id: 'a1' } })
            service.state = 'Active'

            const logEvent = jest.spyOn(service, 'logEvent')

            await service.stopRide({ noStateUpdates: true })
            expect(logEvent).toHaveBeenCalledWith(OC({ message: 'activity stopped', lastState: 'Active' }))

            logEvent.mockClear()
            await service.stopRide({ noStateUpdates: true }) // redundant - state is now 'Finished'
            expect(logEvent).not.toHaveBeenCalledWith(OC({ message: 'activity stopped' }))
        })

        // Regression: previously, a stopRide() call made while state was still the internal
        // 'Closing' tick (left behind by an in-flight first call) passed the old log guard
        // (state!=='Starting' && state!=='Idle') and logged a fake "activity stopped
        // (Closing)" right before the redundancy guard returned without doing anything.
        // 'Closing' is never a real user-facing state - it must never be logged as a stop.
        test('does not log a fake stop for a call made while state is the internal "Closing" tick', async () => {
            service = new RideDisplayService()
            setupMocks(service, { activity: { id: 'a1' } })
            service.state = 'Closing'

            const logEvent = jest.spyOn(service, 'logEvent')

            await service.stopRide({ noStateUpdates: true })

            expect(logEvent).not.toHaveBeenCalledWith(OC({ message: 'activity stopped' }))
        })
    })

    describe('discardSimulatedRide', () => {
        let service: any
        let calls: string[]
        let routeList: any
        let workoutList: any
        let activityRide: any

        const route = { id: 'r1' }
        const startSettings = { type: 'Route', startPos: 1500, realityFactor: 80 }
        const workout = { id: 'w1', type: 'workout' }

        beforeEach(() => {
            calls = []
            activityRide = { delete: jest.fn(async () => { calls.push('delete') }) }
            routeList = {
                getSelected: jest.fn().mockReturnValue(route),
                getStartSettings: jest.fn().mockReturnValue(startSettings),
                select: jest.fn(() => { calls.push('select route') }),
                setStartSettings: jest.fn(() => { calls.push('set start settings') }),
            }
            workoutList = {
                getSelected: jest.fn().mockReturnValue(workout),
                select: jest.fn(() => { calls.push('select workout') }),
            }
            Inject('ActivityRide', activityRide)
            Inject('RouteList', routeList)
            Inject('WorkoutList', workoutList)

            service = new RideDisplayService()
            service.simulated = true
            service.stop = jest.fn(async () => {
                calls.push('stop')
                // stopping a ride unselects route and workout
                routeList.getSelected.mockReturnValue(null)
                routeList.getStartSettings.mockReturnValue(null)
                workoutList.getSelected.mockReturnValue(null)
            })
        })

        afterEach(() => {
            service?.reset()
            Inject('ActivityRide', null)
            Inject('RouteList', null)
            Inject('WorkoutList', null)
        })

        test('refuses to touch a ride on a real device', async () => {
            service.simulated = false

            const res = await service.discardSimulatedRide()

            expect(res).toBe(false)
            expect(activityRide.delete).not.toHaveBeenCalled()
            expect(service.stop).not.toHaveBeenCalled()
        })

        test('deletes the activity before stopping, then restores the selection', async () => {
            const res = await service.discardSimulatedRide()

            expect(res).toBe(true)
            expect(calls).toEqual(['delete', 'stop', 'select route', 'set start settings', 'select workout'])
            expect(routeList.select).toHaveBeenCalledWith(route)
            expect(routeList.setStartSettings).toHaveBeenCalledWith(startSettings)
            expect(workoutList.select).toHaveBeenCalledWith(workout)
        })

        test('free ride: has no selected route, only the start settings are restored', async () => {
            const freeRideSettings = { type: 'Free-Ride', position: { lat: 1, lng: 2 }, option: { id: 'o1' } }
            routeList.getSelected.mockReturnValue(null)
            routeList.getStartSettings.mockReturnValue(freeRideSettings)
            workoutList.getSelected.mockReturnValue(undefined)

            const res = await service.discardSimulatedRide()

            expect(res).toBe(true)
            expect(routeList.select).not.toHaveBeenCalled()
            expect(routeList.setStartSettings).toHaveBeenCalledWith(freeRideSettings)
            expect(workoutList.select).not.toHaveBeenCalled()
        })

        test('workout without a route: only the workout is restored', async () => {
            routeList.getSelected.mockReturnValue(null)
            routeList.getStartSettings.mockReturnValue(null)

            await service.discardSimulatedRide()

            expect(routeList.select).not.toHaveBeenCalled()
            expect(routeList.setStartSettings).not.toHaveBeenCalled()
            expect(workoutList.select).toHaveBeenCalledWith(workout)
        })

        test('still stops and restores if the activity could not be deleted', async () => {
            activityRide.delete.mockRejectedValue(new Error('disk error'))

            const res = await service.discardSimulatedRide()

            expect(res).toBe(true)
            expect(service.stop).toHaveBeenCalled()
            expect(routeList.select).toHaveBeenCalledWith(route)
        })

        test('returns false if the selection could not be restored', async () => {
            routeList.select.mockImplementation(() => { throw new Error('boom') })

            const res = await service.discardSimulatedRide()

            expect(res).toBe(false)
            expect(service.stop).toHaveBeenCalled()
        })

        test('logs the discard', async () => {
            const logEvent = jest.spyOn(service, 'logEvent')

            await service.discardSimulatedRide()

            expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ message: 'simulated ride discarded', restored: true }))
        })

        test('a second request while one is running is ignored (double click)', async () => {
            const [first, second] = await Promise.all([service.discardSimulatedRide(), service.discardSimulatedRide()])

            expect(first).toBe(true)
            expect(second).toBe(false)
            expect(activityRide.delete).toHaveBeenCalledTimes(1)
            expect(service.stop).toHaveBeenCalledTimes(1)
        })

        test('can be used again once finished', async () => {
            await service.discardSimulatedRide()
            service.simulated = true

            expect(await service.discardSimulatedRide()).toBe(true)
        })

        test('returns false if stopping fails', async () => {
            service.stop.mockRejectedValue(new Error('boom'))

            expect(await service.discardSimulatedRide()).toBe(false)
        })
    })

    describe('ride view restriction delegates', () => {
        let service: any
        let restriction: any

        beforeEach(() => {
            restriction = {
                onNoticeAction: jest.fn(),
                onNoticeClosed: jest.fn(),
                setReminderEnabled: jest.fn(),
                getDialogProps: jest.fn().mockReturnValue({ title: 'dialog' }),
            }
            Inject('RideViewRestriction', restriction)
            service = new RideDisplayService()
        })

        afterEach(() => {
            service?.reset()
            Inject('RideViewRestriction', null)
        })

        test('forwards notice actions and close', () => {
            service.onRideViewNoticeAction('how-to')
            service.onRideViewNoticeClosed()

            expect(restriction.onNoticeAction).toHaveBeenCalledWith('how-to')
            expect(restriction.onNoticeClosed).toHaveBeenCalled()
        })

        test('pushes the new display properties to the UI after a notice action or close', () => {
            const emit = jest.fn()
            service.observer = { emit }
            service.getDisplayProperties = jest.fn().mockReturnValue({ rideViewRestrictionNotice: undefined })

            service.onRideViewNoticeAction('dont-show-again')
            service.onRideViewNoticeClosed()

            expect(emit).toHaveBeenCalledTimes(2)
            expect(emit).toHaveBeenCalledWith('overlay-update', { rideViewRestrictionNotice: undefined })
        })

        test('forwards the reminder setting', () => {
            service.setRideViewReminder(false)

            expect(restriction.setReminderEnabled).toHaveBeenCalledWith(false)
        })

        test.each([
            ['Active', true, true],
            ['Paused', true, true],
            ['Started', true, true],
            ['Active', false, false],
            ['Finished', true, false],
        ])('dialog props in state %s (simulated=%s) -> inRide=%s', (state, simulated, inRide) => {
            service.state = state
            service.simulated = simulated

            const props = service.getRideViewRestrictionDialogProps()

            expect(props).toEqual({ title: 'dialog' })
            expect(restriction.getDialogProps).toHaveBeenCalledWith({ inRide })
        })

        test('does not throw if the restriction service fails', () => {
            restriction.onNoticeAction.mockImplementation(() => { throw new Error('boom') })

            expect(() => service.onRideViewNoticeAction('how-to')).not.toThrow()
        })
    })

    describe('start - pairing visit', () => {
        let service
        const tracker = { onRideStarted: jest.fn() }

        beforeEach(() => {
            Inject('PairingVisitTracker', tracker)
            service = new RideDisplayService()
            service.enforceSimulator = jest.fn()
            service.getRideModeService = jest.fn().mockReturnValue({ getLogProps: jest.fn().mockReturnValue({}) })
            service.getBike = jest.fn()
            service.getBikeInterface = jest.fn()
            service.getRideType = jest.fn().mockReturnValue('Free-Ride')
            service.startDevices = jest.fn()
            service.startRide = jest.fn()
            service.getCoaches = jest.fn().mockReturnValue({ startRide: jest.fn() })
            service.setState = jest.fn()
            service.logEvent = jest.fn()
        })

        afterEach(() => {
            Inject('PairingVisitTracker', null)
            jest.clearAllMocks()
        })

        test.each([
            [true, true],
            [false, false],
            [undefined, false],
        ])('start(%s) reports a ride with simulate:%s', (simulate, expected) => {
            service.start(simulate)
            expect(tracker.onRideStarted).toHaveBeenCalledWith({ simulate: expected })
        })

        test('a tracker failure does not stop the ride from starting', () => {
            tracker.onRideStarted.mockImplementationOnce(() => { throw new Error('X') })
            service.start(false)
            expect(service.startRide).toHaveBeenCalled()
        })
    })

    describe('device handler lifecycle across rides', () => {
        let service: any
        let devices: EventEmitter

        beforeEach(() => {
            devices = new EventEmitter()
            service = new RideDisplayService()
            service.getDeviceRide = jest.fn().mockReturnValue(devices)
        })

        const startAndStopRide = () => {
            service.initDeviceHandlers()
            service.resetDeviceHandlers()
        }

        test('a ride leaves no listeners on the device service after it was stopped', () => {
            startAndStopRide()

            for (const event of devices.eventNames())
                expect({ event, count: devices.listenerCount(event) }).toEqual({ event, count: 0 })
        })

        test('a controller key press is handled once, no matter how many rides were started before', () => {
            service.onDeviceKeyPressed = jest.fn()

            startAndStopRide()
            startAndStopRide()
            service.initDeviceHandlers()

            devices.emit('key-pressed', { key: 'ShiftUp' }, 'udid')

            expect(service.onDeviceKeyPressed).toHaveBeenCalledTimes(1)
        })
    })

})