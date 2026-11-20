import { getBindings } from '../../../../api'
import { Injectable } from '../../../../base/decorators'
import { SERVER_MESSAGES as MSG } from '../../messages'
import { RouteServersSettingsPageService } from '../base/service'

/**
 * Route servers settings on mobile.
 *
 * - Android blocks cleartext traffic, so home-network `http://` servers can not be used there (for now).
 *   iOS allows local networking. On any other platform, or if the OS is unknown, `http://` is refused.
 * - Phones and tablets often can not resolve names on the home network, which is why an unreachable
 *   home-network address gets a hint to use the IP address instead.
 */
export class MobileRouteServersSettingsPageService extends RouteServersSettingsPageService {

    protected get allowsLocalHttp(): boolean {
        // allowlist: only a platform that is positively iOS. Android, unknown and any other value are refused
        const platform = this.getBindings()?.appInfo?.getOS?.()?.platform
        return typeof platform === 'string' && platform.toLowerCase() === 'ios'
    }

    protected getUnreachableHint(isHomeNetwork: boolean): string | undefined {
        return isHomeNetwork ? MSG.probeLocalHint : undefined
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }
}
