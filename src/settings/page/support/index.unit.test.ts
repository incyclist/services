import { Inject } from '../../../base/decorators'
import { getSupportSettingsPageService, DesktopSupportSettingsPageService, MobileSupportSettingsPageService } from '.'
import * as api from '../../../api'

describe('getSupportSettingsPageService', () => {
    const mockChannel = (channel: string) => {
        (api.getBindings() as any).appInfo = { getChannel: () => channel }
    }

    afterEach(() => {
        (api.getBindings() as any).reset?.()
        Inject('Bindings', null)
    })

    test.each(['desktop', 'web'])('%s uses the desktop variant', (channel) => {
        mockChannel(channel)
        expect(getSupportSettingsPageService().constructor.name).toBe("DesktopSupportSettingsPageService")
    })

    test.each(['mobile', 'tv'])('%s uses the mobile variant', (channel) => {
        mockChannel(channel)
        expect(getSupportSettingsPageService().constructor.name).toBe("MobileSupportSettingsPageService")
    })

    test('copy labels differ', () => {
        Inject('Bindings', { appInfo: { getAppVersion: () => '1', getUIVersion: () => '2', getOS: () => ({ platform: 'linux' }) } })
        Inject('UserSettings', { get: () => 'u' })
        const label = (s: DesktopSupportSettingsPageService | MobileSupportSettingsPageService) => s.getPageDisplayProps().helpLinks[2].email.copyLabel
        expect(label(new DesktopSupportSettingsPageService())).toBe('Copy details')
        expect(label(new MobileSupportSettingsPageService())).toBe('Share details')
        Inject('UserSettings', null)
    })
})
