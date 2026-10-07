import { getBindings } from '../../api'
import { MobilePairingPageService } from './mobile/service'
import { DesktopPairingPageService } from './desktop/service'

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
    if (channel==='desktop' || channel==='web')
        return new DesktopPairingPageService()
    return new MobilePairingPageService()
}
