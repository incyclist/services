import { RouteServersSettingsPageService } from '../base/service'

/**
 * Route servers settings on desktop (and the browser build of the web-ui): home-network servers
 * can be used with plain `http://`.
 */
export class DesktopRouteServersSettingsPageService extends RouteServersSettingsPageService {

    protected get allowsLocalHttp(): boolean {
        return true
    }
}
