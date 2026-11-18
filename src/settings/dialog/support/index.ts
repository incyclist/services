import { getBindings } from '../../../api'
import { DesktopSupportSettingsDialogService } from './desktop/service'
import { MobileSupportSettingsDialogService } from './mobile/service'

export { SupportSettingsDialogService } from './base/service'
export { DesktopSupportSettingsDialogService } from './desktop/service'
export { MobileSupportSettingsDialogService } from './mobile/service'
export type * from './types'

/**
 * The Settings > Support dialog service for the current platform. Picks the subclass by channel
 * (`desktop`/`web` use the Desktop variant, everything else the Mobile variant).
 */
export const getSupportSettingsDialogService = (): DesktopSupportSettingsDialogService | MobileSupportSettingsDialogService => {
    const channel = getBindings().appInfo.getChannel()
    if (channel === 'desktop' || channel === 'web')
        return new DesktopSupportSettingsDialogService()
    return new MobileSupportSettingsDialogService()
}
