import { getBindings } from '../../api'
import { MobilePairingPageService } from './mobile/service'

export * from './mobile/service'
export { PairingVisitTracker } from './base/visit-log'
export { usePairingVisitTracker, initPairingVisitTracker } from './base/visit-log-factory'

/**
 * The pairing page service for the current platform - the one function the mobile UI already
 * imports (`PairingPage.tsx`), and what a future web-ui would call too. Picks the subclass by
 * channel; mobile keeps getting `MobilePairingPageService` (= `DevicesPageService`) exactly as
 * before.
 */
export const getDevicesPageService = ()=> {
    const channel = getBindings().appInfo.getChannel()
    if (channel==='desktop' || channel==='web') {
        // required lazily: DesktopPairingPageService's module graph (via the base class's
        // devices/ride import) transitively loops back into devices/page through a wider tangle
        // of whole-barrel imports across routes/workouts/activities/coaches - a pre-existing,
        // cross-domain issue, out of scope to untangle here. A plain top-level import confirmed
        // broken (resolves to a second, divergent copy of the class rather than throwing).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DesktopPairingPageService } = require('./desktop/service')
        return new DesktopPairingPageService()
    }
    return new MobilePairingPageService()
}
