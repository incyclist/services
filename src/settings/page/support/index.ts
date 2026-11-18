import { getBindings } from '../../../api'
import { DesktopSupportSettingsPageService } from './desktop/service'
import { MobileSupportSettingsPageService } from './mobile/service'

export { SupportSettingsPageService } from './base/service'
export { DesktopSupportSettingsPageService } from './desktop/service'
export { MobileSupportSettingsPageService } from './mobile/service'
export type * from './types'

/**
 * The Settings > Support page service for the current platform. Picks the subclass by channel
 * (`desktop`/`web` use the Desktop variant, everything else the Mobile variant).
 */
export const getSupportSettingsPageService = (): DesktopSupportSettingsPageService | MobileSupportSettingsPageService => {
    const channel = getBindings().appInfo.getChannel()
    if (channel === 'desktop' || channel === 'web')
        return new DesktopSupportSettingsPageService()
    return new MobileSupportSettingsPageService()
}
