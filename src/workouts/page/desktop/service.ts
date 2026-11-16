import { Singleton } from "../../../base/types";
import { WorkoutListPageService } from "../base/service";
import { DesktopWorkoutListDisplayProps } from "./types";

/**
 * Workout list page for desktop and web: card carousels per list, with the ride starting on the
 * desktop navigation targets.
 */
@Singleton
export class DesktopWorkoutListPageService extends WorkoutListPageService {

    protected getRideTarget(ready: boolean): string {
        return ready ? '/rideOK' : '/pairingStart'
    }

    protected getRideNavigationState(): unknown {
        return { source: '/workouts' }
    }

    getPageDisplayProps(): DesktopWorkoutListDisplayProps {
        return { loading: true, lists: [], detailWorkoutId: this.detailWorkoutId, createInfo: null }
    }
}
