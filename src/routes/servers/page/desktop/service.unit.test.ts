import '../../../list'
import { DesktopRouteServersSettingsPageService } from './service'

describe('DesktopRouteServersSettingsPageService', () => {
    test('home-network http is allowed, no extra hint for unreachable addresses', () => {
        const service = new DesktopRouteServersSettingsPageService()
        const s = service as unknown as { allowsLocalHttp: boolean, getUnreachableHint: (v: boolean) => string | undefined }
        expect(s.allowsLocalHttp).toBe(true)
        expect(s.getUnreachableHint(true)).toBeUndefined()
        service.reset()
    })
})
