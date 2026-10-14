import { Inject } from '../base/decorators'
import { Coach } from './coach'
import { CoachesService } from './service'

const createCoach = (): jest.Mocked<Coach> => ({
    settings: { lead: 0 },
    setRoute: jest.fn(),
    setProgress: jest.fn(),
    setRiderPosition: jest.fn(),
    initSimulator: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    getProgess: jest.fn().mockReturnValue(0),
    getPosition: jest.fn(),
    sendDeviceUpdate: jest.fn(),
}) as unknown as jest.Mocked<Coach>

describe('CoachesService', () => {

    let service: CoachesService
    let startSettings: unknown
    let coach: jest.Mocked<Coach>

    const route = { points: [{ routeDistance: 0 }] }

    beforeEach(() => {
        startSettings = null
        coach = createCoach()

        Inject('RouteList', { getStartSettings: jest.fn(() => startSettings) })
        Inject('DeviceRide', { getCyclingMode: jest.fn() })
        Inject('RideDisplay', { route: undefined })
        Inject('ActivityRide', { getObserver: jest.fn() })
        Inject('UserSettings', { get: jest.fn((_key: string, defValue: unknown) => defValue) })

        service = new CoachesService()
        service.saveCoach(coach)
    })

    afterEach(async () => {
        await service.stopRide()
        service.deleteCoach(coach)
        Inject('RouteList', null)
        Inject('DeviceRide', null)
        Inject('RideDisplay', null)
        Inject('ActivityRide', null)
        Inject('UserSettings', null)
        jest.clearAllMocks()
    })

    describe('startRide', () => {

        test('starts coach at position 0 when there are no start settings (workout without route)', async () => {
            const logError = jest.spyOn(service, 'logError')

            await service.startRide(route as never)

            expect(logError).not.toHaveBeenCalled()
            expect(coach.setRiderPosition).toHaveBeenCalledWith(0)
            expect(coach.setProgress).toHaveBeenCalledWith(0)
            expect(coach.start).toHaveBeenCalled()
        })

        test('starts coach at the configured start position for a route start', async () => {
            startSettings = { type: 'Route', startPos: 500 }

            await service.startRide(route as never)

            expect(coach.setRiderPosition).toHaveBeenCalledWith(500)
            expect(coach.setProgress).toHaveBeenCalledWith(500)
        })
    })

    describe('onCoachDataUpdate', () => {

        test('does not throw when there are no start settings', async () => {
            await service.startRide(route as never)
            const logError = jest.spyOn(service, 'logError')

            expect(() => {
                (service as never as { onCoachDataUpdate: (c: Coach, d: unknown) => void })
                    .onCoachDataUpdate(coach, { distance: 10 })
            }).not.toThrow()

            expect(logError).not.toHaveBeenCalled()
            expect(coach.setProgress).toHaveBeenLastCalledWith(10)
        })

        test('does not update coach for free-ride', async () => {
            await service.startRide(route as never)
            startSettings = { type: 'Free-Ride' }
            const setCoachPosition = jest.spyOn(service as never, 'setCoachPosition')

            ;(service as never as { onCoachDataUpdate: (c: Coach, d: unknown) => void })
                .onCoachDataUpdate(coach, { distance: 10 })

            expect(setCoachPosition).not.toHaveBeenCalled()
        })

        test('logs instead of throwing when handling fails', async () => {
            await service.startRide(route as never)
            coach.setProgress.mockImplementation(() => { throw new Error('fail') })
            const logError = jest.spyOn(service, 'logError')

            expect(() => {
                (service as never as { onCoachDataUpdate: (c: Coach, d: unknown) => void })
                    .onCoachDataUpdate(coach, { distance: 10 })
            }).not.toThrow()

            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onCoachDataUpdate')
        })

        test('ignores missing data', async () => {
            await service.startRide(route as never)
            const logError = jest.spyOn(service, 'logError')

            expect(() => {
                (service as never as { onCoachDataUpdate: (c: Coach, d: unknown) => void })
                    .onCoachDataUpdate(coach, undefined)
            }).not.toThrow()
            expect(logError).not.toHaveBeenCalled()
        })
    })

    describe('setCoachPosition', () => {

        test('does not throw when there are no start settings', async () => {
            await service.startRide(route as never)
            const logError = jest.spyOn(service, 'logError')

            expect(() => {
                (service as never as { setCoachPosition: (c: Coach, d: number) => void })
                    .setCoachPosition(coach, 10)
            }).not.toThrow()

            expect(logError).not.toHaveBeenCalled()
        })

        test('logs instead of throwing when the ride display fails', async () => {
            await service.startRide(route as never)
            Inject('RideDisplay', { get route(): never { throw new Error('fail') } })
            const logError = jest.spyOn(service, 'logError')

            expect(() => {
                (service as never as { setCoachPosition: (c: Coach, d: number) => void })
                    .setCoachPosition(coach, 10)
            }).not.toThrow()

            expect(logError).toHaveBeenCalledWith(expect.any(Error), 'setCoachPosition')
        })
    })
})
