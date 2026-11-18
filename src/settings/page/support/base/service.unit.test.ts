import { Inject } from '../../../../base/decorators'
import { DesktopSupportSettingsPageService } from '../desktop/service'
import { MobileSupportSettingsPageService } from '../mobile/service'

describe('SupportSettingsPageService', () => {
    let service: DesktopSupportSettingsPageService
    let logEvent: jest.SpyInstance
    let platform: string

    const bindings = () => ({
        appInfo: {
            getAppVersion: () => '1.2.3',
            getUIVersion: () => '26.10.1',
            getOS: () => ({ platform }),
            getChannel: () => 'desktop',
        }
    })

    const ENV = ['SLACK_URL', 'STRAVA_URL', 'SPONSOR_URL', 'SUPPORT_PAGE_URL', 'PRIVACY_URL']

    beforeEach(() => {
        platform = 'linux'
        Inject('Bindings', bindings())
        Inject('UserSettings', { get: jest.fn((k: string, d: unknown) => k === 'uuid' ? 'abc-123' : d) })
        service = new DesktopSupportSettingsPageService()
        logEvent = jest.spyOn(service as unknown as { logEvent: (e: unknown) => void }, 'logEvent').mockImplementation(() => undefined)
    })

    afterEach(() => {
        Inject('Bindings', null)
        Inject('UserSettings', null)
        ENV.forEach(k => delete process.env[k])
        jest.restoreAllMocks()
        ;(service as never as { reset: () => void }).reset?.()
    })

    describe('getPageDisplayProps', () => {
        test('direct mode', () => {
            const props = service.getPageDisplayProps()

            expect(props.appInfo).toMatchObject({ title: 'App info', appVersion: '1.2.3', uiVersion: '26.10.1', uuid: 'abc-123' })
            expect(props.helpTitle).toBe('Need help?')
            expect(props.helpLinks.map(l => l.id)).toEqual(['strava', 'slack', 'email'])

            const d = props.donation
            expect(d.mode).toBe('direct')
            expect(d.title).toBe('Support Incyclist')
            expect(d.fundsText).toBeDefined()
            expect(d.websiteLink).toBeUndefined()
            expect(d.channels).toHaveLength(2)
            expect(d.channels[0]).toMatchObject({ id: 'paypal', primary: true, subLabel: 'one-time' })
            expect(d.channels[1]).toMatchObject({ id: 'github-sponsors', primary: false, subLabel: 'one-time or monthly' })
            expect(d.otherHelpLinks.map(l => l.label)).toEqual(['Incyclist Strava Club', 'GitHub'])
        })

        test('website mode', () => {
            platform = 'ios'
            const d = service.getPageDisplayProps().donation

            expect(d.mode).toBe('website')
            expect(d.channels).toEqual([])
            expect(d.fundsText).toBeUndefined()
            expect(d.websiteLink).toMatchObject({ url: 'https://incyclist.com/#support', host: 'incyclist.com' })
        })

        test('email link has prefilled details and desktop copy texts', () => {
            const email = service.getPageDisplayProps().helpLinks[2]
            expect(email.url.startsWith('mailto:support@incyclist.com?subject=')).toBe(true)
            expect(email.email.body).toContain('uuid: abc-123')
            expect(email.email.copyLabel).toBe('Copy details')
            expect(email.email.copiedMessage).toBe('Copied. Paste it into an email to support@incyclist.com.')
        })

        test('env overrides', () => {
            process.env.SLACK_URL = 'https://slack.test'
            process.env.STRAVA_URL = 'https://strava.test'
            process.env.SPONSOR_URL = 'https://sponsor.test'
            process.env.SUPPORT_PAGE_URL = 'https://site.test/support'

            let props = service.getPageDisplayProps()
            expect(props.helpLinks[0].url).toBe('https://strava.test')
            expect(props.helpLinks[1].url).toBe('https://slack.test')
            expect(props.donation.channels[1].url).toBe('https://sponsor.test')

            platform = 'ios'
            props = service.getPageDisplayProps()
            expect(props.donation.websiteLink).toMatchObject({ url: 'https://site.test/support', host: 'site.test' })
        })

        test('PRIVACY_URL does not leak into Slack and Strava', () => {
            process.env.PRIVACY_URL = 'https://privacy.test'
            const props = service.getPageDisplayProps()
            expect(props.appInfo.privacyUrl).toBe('https://privacy.test')
            expect(props.helpLinks[0].url).not.toBe('https://privacy.test')
            expect(props.helpLinks[1].url).not.toBe('https://privacy.test')
        })

        test('mobile variant shares instead of copies', () => {
            const mobile = new MobileSupportSettingsPageService()
            const email = mobile.getPageDisplayProps().helpLinks[2].email
            expect(email.copyLabel).toBe('Share details')
            expect(email.copiedMessage).toBeUndefined()
            ;(mobile as never as { reset: () => void }).reset?.()
        })
    })

    describe('handlers', () => {
        test('onLinkClicked', () => {
            service.onLinkClicked('slack')
            expect(logEvent).toHaveBeenCalledWith({ message: 'support link clicked', link: 'slack' })
        })

        test('onDonationClicked', () => {
            service.onDonationClicked('paypal')
            expect(logEvent).toHaveBeenCalledWith({ message: 'donation link clicked', donationChannel: 'paypal', mode: 'direct', source: 'settings' })
        })

        test('onDonationClicked in website mode', () => {
            platform = 'ios'
            service.onDonationClicked('website')
            expect(logEvent).toHaveBeenCalledWith({ message: 'donation link clicked', donationChannel: 'website', mode: 'website', source: 'settings' })
        })

        test('onEmailOpenResult', () => {
            service.onEmailOpenResult('opened')
            expect(logEvent).toHaveBeenLastCalledWith({ message: 'support email opened', result: 'opened' })
            service.onEmailOpenResult('failed', 'no handler')
            expect(logEvent).toHaveBeenLastCalledWith({ message: 'support email opened', result: 'failed', error: 'no handler' })
        })

        test('onDetailsCopied', () => {
            service.onDetailsCopied('fallback', 'failed')
            expect(logEvent).toHaveBeenCalledWith({ message: 'support details copied', trigger: 'fallback', result: 'failed' })
        })

        test('never throws when logging fails', () => {
            logEvent.mockImplementation(() => { throw new Error('boom') })
            expect(() => service.onLinkClicked('email')).not.toThrow()
        })
    })
})
