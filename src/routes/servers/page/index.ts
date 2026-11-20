import { getBindings } from '../../../api'
import { DesktopRouteServersSettingsPageService } from './desktop/service'
import { MobileRouteServersSettingsPageService } from './mobile/service'

export type * from './types'
export { RouteServersSettingsPageService } from './base/service'
export { DesktopRouteServersSettingsPageService } from './desktop/service'
export { MobileRouteServersSettingsPageService } from './mobile/service'
export { suggestServerName, formatSize } from './base/utils'

let desktopInstance: DesktopRouteServersSettingsPageService | undefined
let mobileInstance: MobileRouteServersSettingsPageService | undefined

/**
 * The route servers settings page service for the current platform: picks the subclass by channel
 * (`desktop` and `web` get the desktop variant, everything else the mobile variant).
 *
 * There is one instance per variant, so the state of an open page survives between calls.
 */
export const getRouteServersSettingsPageService = (): DesktopRouteServersSettingsPageService | MobileRouteServersSettingsPageService => {
    const channel = getBindings()?.appInfo?.getChannel()
    if (channel === 'desktop' || channel === 'web') {
        desktopInstance ??= new DesktopRouteServersSettingsPageService()
        return desktopInstance
    }
    mobileInstance ??= new MobileRouteServersSettingsPageService()
    return mobileInstance
}

export const useRouteServersSettingsPageService = getRouteServersSettingsPageService
