// Dedicated test for the single getRidePageService() factory (FIXES_BACKLOG #24), which replaced
// the former getRidePageService()/getWorkoutRidePageService() pair. Uses jest.mock() for
// ride/display (rather than the Inject() container the sibling *.unit.test.ts files use) because
// the factory calls useRideDisplay() directly, not through an @Injectable class method.
import { RideType } from "../../types"

const mockGetRideType = jest.fn<RideType | undefined, []>()

jest.mock('../display', () => ({
    useRideDisplay: () => ({ getRideType: mockGetRideType })
}))

import { getRidePageService, RidePageService } from "./service"
import { WorkoutRidePageService } from "../../workouts/ride/page/service"

describe('getRidePageService', () => {

    // Both classes are @Singleton - reset via a fresh instance's reset() so state doesn't leak
    // between tests (mirrors the sibling *.unit.test.ts files' afterEach pattern). Note:
    // @Singleton wraps the class in an anonymous constructor, so `instanceof RidePageService`
    // does not reliably identify the resolved instance - compare by reference (.toBe()) against
    // a fresh `new <Class>()` call instead, which the singleton wrapper resolves to the same
    // cached instance.
    afterEach(() => {
        (new RidePageService() as any).reset();
        (new WorkoutRidePageService() as any).reset()
        mockGetRideType.mockReset()
    })

    test('resolves to WorkoutRidePageService when the selected ride type is Workout', () => {
        mockGetRideType.mockReturnValue('Workout')
        const service = getRidePageService()
        expect(service).toBe(new WorkoutRidePageService())
    })

    test.each(['Video', 'GPX', 'Free-Ride', undefined] as const)('resolves to RidePageService when the selected ride type is %s', (rideType) => {
        mockGetRideType.mockReturnValue(rideType)
        const service = getRidePageService()
        expect(service).toBe(new RidePageService())
        expect(service).not.toBe(new WorkoutRidePageService())
    })

    test('returns the same singleton instance across repeated calls for the same ride type', () => {
        mockGetRideType.mockReturnValue('Workout')
        const a = getRidePageService()
        const b = getRidePageService()
        expect(a).toBe(b)
    })
})
