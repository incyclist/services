import { EventLogger } from 'gd-eventlog'
import '../../../list'
import { Inject } from '../../../../base/decorators'
import { MobileRouteServersSettingsPageService } from './service'

describe('MobileRouteServersSettingsPageService', () => {
    let service: MobileRouteServersSettingsPageService

    const setPlatform = (platform: string | undefined, hasOs = true) => {
        Inject('Bindings', { appInfo: hasOs ? { getOS: jest.fn().mockReturnValue({ platform }) } : {} })
    }

    beforeEach(() => {
        jest.spyOn(EventLogger.prototype, 'logEvent').mockImplementation()
        service = new MobileRouteServersSettingsPageService()
    })

    afterEach(() => {
        service.reset()
        Inject('Bindings', null)
        jest.restoreAllMocks()
    })

    const allowsLocalHttp = () => (service as unknown as { allowsLocalHttp: boolean }).allowsLocalHttp
    const hint = (isHomeNetwork: boolean) => (service as unknown as { getUnreachableHint: (v: boolean) => string | undefined }).getUnreachableHint(isHomeNetwork)

    test.each(['android', 'Android'])('%s: home-network http is not allowed', (platform) => {
        setPlatform(platform)
        expect(allowsLocalHttp()).toBe(false)
    })

    test.each(['ios', 'iOS'])('%s: home-network http is allowed', (platform) => {
        setPlatform(platform)
        expect(allowsLocalHttp()).toBe(true)
    })

    test('platform unknown: allowed', () => {
        setPlatform(undefined)
        expect(allowsLocalHttp()).toBe(true)
        setPlatform(undefined, false)
        expect(allowsLocalHttp()).toBe(true)
    })

    test('hint for unreachable home-network addresses only', () => {
        expect(hint(true)).toBe("On phones and tablets, the server's IP address (for example 192.168.1.20) often works better than its name.")
        expect(hint(false)).toBeUndefined()
    })
})
