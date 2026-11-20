import '../../list'
import { getBindings } from '../../../api'
import { IAppInfo } from '../../../api/appInfo'
import { DesktopRouteServersSettingsPageService, getRouteServersSettingsPageService, MobileRouteServersSettingsPageService, useRouteServersSettingsPageService } from './index'

describe('getRouteServersSettingsPageService', () => {
    const setChannel = (channel: string) => {
        getBindings().appInfo = { getChannel: jest.fn().mockReturnValue(channel) } as unknown as IAppInfo
    }

    afterEach(() => { getBindings().appInfo = undefined })

    test.each(['desktop', 'web'])('%s: desktop variant', (channel) => {
        setChannel(channel)
        const service = getRouteServersSettingsPageService()
        expect(service).toBeInstanceOf(DesktopRouteServersSettingsPageService)
    })

    test('mobile: mobile variant', () => {
        setChannel('mobile')
        const service = getRouteServersSettingsPageService()
        expect(service).toBeInstanceOf(MobileRouteServersSettingsPageService)
    })

    test('the service is a singleton, so state survives between calls', () => {
        setChannel('desktop')
        const a = getRouteServersSettingsPageService()
        expect(getRouteServersSettingsPageService()).toBe(a)
    })

    test('use... is the same hook', () => {
        expect(useRouteServersSettingsPageService).toBe(getRouteServersSettingsPageService)
    })
})
