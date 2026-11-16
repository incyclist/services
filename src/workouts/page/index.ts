import { getBindings } from '../../api'
import { WorkoutListPageService } from './base/service'
import { MobileWorkoutListPageService } from './mobile/service'
import { DesktopWorkoutListPageService } from './desktop/service'

export { WorkoutListPageService } from './base/service'
export { MobileWorkoutListPageService } from './mobile/service'
export { DesktopWorkoutListPageService } from './desktop/service'

/**
 * The workout list page service for the current platform. Picks the subclass by channel
 * ('desktop' and 'web' get the desktop one). The declared return type defaults to the mobile
 * class, so existing mobile call sites compile unchanged; callers that know better can pass
 * the type argument explicitly.
 */
export const getWorkoutListPageService = <T extends WorkoutListPageService = MobileWorkoutListPageService>(): T => {
    const channel = getBindings().appInfo.getChannel()
    if (channel==='desktop' || channel==='web')
        return new DesktopWorkoutListPageService() as unknown as T
    return new MobileWorkoutListPageService() as unknown as T
}
