import { WorkoutDisplayService } from "./WorkoutDisplayService"
import { ActiveWorkoutLimit } from "../../workouts"

// FIXES_BACKLOG #37 investigation finding: WorkoutDisplayService.buildRequest() (invoked every
// activity/device-data tick via RideModeService.onActivityUpdate()) is the actual live mechanism
// that pushes a workout step's target to the device - not the 'request-update' event
// WorkoutRide.setCurrentLimits() emits, whose only listener is commented out in
// RideDisplayService.initWorkout(). This previously fired unconditionally regardless of cycling
// mode; these tests cover the new gate that stops it firing once the rider is in SIM/Resistance
// mode (gear or hidden load-button mode), where the workout target becomes purely informational.
describe('WorkoutDisplayService', () => {

    describe('buildRequest', () => {

        let service: WorkoutDisplayService
        let getCyclingMode: jest.Mock

        const mockMode = (props: { isERG?: boolean, isSIM?: boolean, isResistance?: boolean, virtshift?: string }) => ({
            isERG: jest.fn().mockReturnValue(!!props.isERG),
            isSIM: jest.fn().mockReturnValue(!!props.isSIM),
            isResistance: jest.fn().mockReturnValue(!!props.isResistance),
            getSetting: jest.fn().mockReturnValue(props.virtshift),
        })

        const setDeviceMode = (mode) => {
            getCyclingMode = jest.fn().mockReturnValue(mode)
            service.inject('DeviceRide', { getCyclingMode })
        }

        const limits: ActiveWorkoutLimit = { time: 10, duration: 120, remaining: 110, minPower: 100, maxPower: 300, targetPower: 200 }

        beforeEach(() => {
            service = new WorkoutDisplayService()
        })

        afterEach(() => {
            service.inject('DeviceRide', null)
            jest.resetAllMocks()
        })

        test('ERG mode: pushes the workout limits to the device, as before',()=>{
            setDeviceMode(mockMode({isERG:true}))

            const request = service['buildRequest']({limits})

            expect(request).toBe(limits)
        })

        test('no device/mode active yet: pushes the workout limits to the device (unaffected, defaults to ERG-like "power")',()=>{
            setDeviceMode(undefined)

            const request = service['buildRequest']({limits})

            expect(request).toBe(limits)
        })

        test('SIM mode with virtual shifting enabled (gear mode): does NOT push the workout limits - would fight the rider\'s manual gear position',()=>{
            setDeviceMode(mockMode({isSIM:true, virtshift:'Enabled'}))

            const request = service['buildRequest']({limits})

            expect(request).toEqual({})
        })

        test('SIM mode with virtual shifting disabled (hidden mode): does NOT push the workout limits',()=>{
            setDeviceMode(mockMode({isSIM:true, virtshift:'Disabled'}))

            const request = service['buildRequest']({limits})

            expect(request).toEqual({})
        })

        test('Resistance mode (gear mode, unconditional): does NOT push the workout limits',()=>{
            setDeviceMode(mockMode({isResistance:true}))

            const request = service['buildRequest']({limits})

            expect(request).toEqual({})
        })

        test('reset request ({slope:0}) is unaffected by cycling mode - not gated, no limits to fight the device with',()=>{
            setDeviceMode(mockMode({isSIM:true, virtshift:'Enabled'}))

            const request = service['buildRequest']({reset:true})

            expect(request).toEqual({slope:0})
        })

        test('no limits and no reset: falls back to the {slope:0} refresh request, unaffected by cycling mode',()=>{
            setDeviceMode(mockMode({isSIM:true, virtshift:'Disabled'}))

            const request = service['buildRequest']()

            expect(request).toEqual({slope:0})
        })
    })
})
