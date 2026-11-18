import { Inject } from '../../../base/decorators'
import { getSupportSettingsDialogService, DesktopSupportSettingsDialogService, MobileSupportSettingsDialogService } from '.'
import * as api from '../../../api'

describe('getSupportSettingsDialogService', () => {
    const mockChannel = (channel: string) => {
        (api.getBindings() as any).appInfo = { getChannel: () => channel }
    }

    afterEach(() => {
        (api.getBindings() as any).reset?.()
        Inject('Bindings', null)
    })

    test.each(['desktop', 'web'])('%s uses the desktop variant', (channel) => {
        mockChannel(channel)
        expect(getSupportSettingsDialogService().constructor.name).toBe("DesktopSupportSettingsDialogService")
    })

    test.each(['mobile', 'tv'])('%s uses the mobile variant', (channel) => {
        mockChannel(channel)
        expect(getSupportSettingsDialogService().constructor.name).toBe("MobileSupportSettingsDialogService")
    })

    test('copy labels differ', () => {
        Inject('Bindings', { appInfo: { getAppVersion: () => '1', getUIVersion: () => '2', getOS: () => ({ platform: 'linux' }) } })
        Inject('UserSettings', { get: () => 'u' })
        const label = (s: DesktopSupportSettingsDialogService | MobileSupportSettingsDialogService) => s.getDialogDisplayProps().helpLinks[2].email.copyLabel
        expect(label(new DesktopSupportSettingsDialogService())).toBe('Copy details')
        expect(label(new MobileSupportSettingsDialogService())).toBe('Share details')
        Inject('UserSettings', null)
    })
})
