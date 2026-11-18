import { Inject } from '../../../base/decorators'
import { IncyclistPageService } from '../../../base/pages/service'
import { SupportSettingsDisplayService } from './service'

describe('SupportSettingsDisplayService', () => {
    let service: SupportSettingsDisplayService
    let logEvent: jest.SpyInstance
    let platform: string
    let channel: string

    const bindings = () => ({
        appInfo: {
            getAppVersion: () => '1.2.3',
            getUIVersion: () => '26.10.1',
            getOS: () => ({ platform }),
            getChannel: () => channel,
        }
    })

    const ENV = ['SLACK_URL', 'STRAVA_URL', 'SPONSOR_URL', 'SUPPORT_PAGE_URL', 'PRIVACY_URL']

    beforeEach(() => {
        platform = 'linux'
        channel = 'desktop'
        Inject('Bindings', bindings())
        Inject('UserSettings', { get: jest.fn((k: string, d: unknown) => k === 'uuid' ? 'abc-123' : d) })
        service = new SupportSettingsDisplayService()
        logEvent = jest.spyOn(service as unknown as { logEvent: (e: unknown) => void }, 'logEvent').mockImplementation(() => undefined)
    })

    afterEach(() => {
        service.close()
        Inject('Bindings', null)
        Inject('UserSettings', null)
        ENV.forEach(k => delete process.env[k])
        jest.restoreAllMocks()
    })

    describe('getDisplayProps', () => {
        test('keeps the old prop shape', () => {
            const props = service.getDisplayProps()
            expect(props).toMatchObject({ appVersion: '1.2.3', uiVersion: '26.10.1', uuid: 'abc-123' })
            expect(Object.keys(props).sort()).toEqual([
                'appInfo', 'appVersion', 'donation', 'donationUrl', 'gitHubUrl', 'helpLinks', 'helpTitle',
                'privacyUrl', 'supportUrls', 'uiVersion', 'uuid'
            ])
            expect(props.supportUrls.map(s => s.label)).toEqual(['Slack', 'Strava', 'Email'])
        })

        test('Slack and Strava read their own env variables', () => {
            process.env.SLACK_URL = 'https://slack.test'
            process.env.STRAVA_URL = 'https://strava.test'
            process.env.PRIVACY_URL = 'https://privacy.test'
            const props = service.getDisplayProps()
            expect(props.supportUrls[0].url).toBe('https://slack.test')
            expect(props.supportUrls[1].url).toBe('https://strava.test')
            expect(props.privacyUrl).toBe('https://privacy.test')
        })

        test('direct mode', () => {
            const props = service.getDisplayProps()

            expect(props.appInfo).toMatchObject({
                title: 'App info', appVersion: '1.2.3', uiVersion: '26.10.1', uuid: 'abc-123',
                labels: { appVersion: 'App version', uiVersion: 'UI version', uuid: 'uuid', privacy: 'Privacy', privacyLink: 'Privacy Statement' },
                compactVersionText: 'Version: App 1.2.3 · UI 26.10.1',
                uuidActionLabel: 'Copy',
            })
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
            expect(d.otherHelpLinks.map(l => l.id)).toEqual(['strava', 'github'])
        })

        test('website mode', () => {
            platform = 'ios'
            const d = service.getDisplayProps().donation

            expect(d.mode).toBe('website')
            expect(d.channels).toEqual([])
            expect(d.fundsText).toBeUndefined()
            expect(d.websiteLink).toMatchObject({ url: 'https://incyclist.com/#support', host: 'incyclist.com' })
        })

        test('email link has prefilled details and desktop copy texts', () => {
            const email = service.getDisplayProps().helpLinks[2]
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

            let props = service.getDisplayProps()
            expect(props.helpLinks[0].url).toBe('https://strava.test')
            expect(props.helpLinks[1].url).toBe('https://slack.test')
            expect(props.donation.channels[1].url).toBe('https://sponsor.test')

            platform = 'ios'
            props = service.getDisplayProps()
            expect(props.donation.websiteLink).toMatchObject({ url: 'https://site.test/support', host: 'site.test' })
        })

        test('PRIVACY_URL does not leak into Slack and Strava', () => {
            process.env.PRIVACY_URL = 'https://privacy.test'
            const props = service.getDisplayProps()
            expect(props.appInfo.privacyUrl).toBe('https://privacy.test')
            expect(props.helpLinks[0].url).not.toBe('https://privacy.test')
            expect(props.helpLinks[1].url).not.toBe('https://privacy.test')
        })

        test.each(['desktop', 'web'])('%s channel copies', (c) => {
            channel = c
            const props = service.getDisplayProps()
            expect(props.helpLinks[2].email.copyLabel).toBe('Copy details')
            expect(props.appInfo.uuidActionLabel).toBe('Copy')
        })

        test.each(['mobile', 'tv'])('%s channel shares instead of copies', (c) => {
            channel = c
            const props = service.getDisplayProps()
            expect(props.helpLinks[2].email.copyLabel).toBe('Share details')
            expect(props.helpLinks[2].email.copiedMessage).toBeUndefined()
            expect(props.appInfo.uuidActionLabel).toBe('Share')
        })
    })

    describe('open / close', () => {
        test('does not touch the current page or the page app state', () => {
            const setState = jest.fn()
            const appState = { setState, getPersistedState: jest.fn() }
            ;(service as unknown as { getAppState: () => unknown }).getAppState = () => appState
            const other = { closePage: jest.fn() } as unknown as typeof IncyclistPageService.currentPage
            IncyclistPageService.currentPage = other

            const observer = service.open()
            expect(observer).toBeDefined()
            service.close()

            expect(IncyclistPageService.currentPage).toBe(other)
            expect(setState).not.toHaveBeenCalled()
            expect(setState).not.toHaveBeenCalledWith('currentPage', expect.anything())
            expect(setState).not.toHaveBeenCalledWith('prevPage', expect.anything())

            delete IncyclistPageService.currentPage
        })

        test('logs support settings opened with the mode', () => {
            service.open()
            expect(logEvent).toHaveBeenCalledWith({ message: 'support settings opened', mode: 'direct' })

            platform = 'ios'
            service.open()
            expect(logEvent).toHaveBeenLastCalledWith({ message: 'support settings opened', mode: 'website' })
        })

        test('reopening stops the previous observer', () => {
            const first = service.open()
            const stop = jest.spyOn(first, 'stop')
            const second = service.open()
            expect(stop).toHaveBeenCalled()
            expect(second).not.toBe(first)
        })

        test('close stops the observer and is safe without open', () => {
            const observer = service.open()
            const stop = jest.spyOn(observer, 'stop')
            service.close()
            expect(stop).toHaveBeenCalled()
            expect(() => service.close()).not.toThrow()
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
            expect(logEvent).toHaveBeenLastCalledWith({ message: 'support email opened', openResult: 'opened' })
            service.onEmailOpenResult('failed', 'no handler')
            expect(logEvent).toHaveBeenLastCalledWith({ message: 'support email opened', openResult: 'failed', error: 'no handler' })
        })

        test('onEmailOpenResult redacts mailto URLs and truncates the error', () => {
            service.onEmailOpenResult('failed', 'cannot open mailto:support@incyclist.com?body=secret%20uuid now')
            expect(logEvent).toHaveBeenLastCalledWith({ message: 'support email opened', openResult: 'failed', error: 'cannot open mailto:<redacted> now' })

            service.onEmailOpenResult('failed', 'x'.repeat(500))
            const event = logEvent.mock.calls.at(-1)[0] as { error: string }
            expect(event.error).toHaveLength(200)
        })

        test('onDetailsCopied', () => {
            service.onDetailsCopied('fallback', 'failed')
            expect(logEvent).toHaveBeenCalledWith({ message: 'support details copied', trigger: 'fallback', copyResult: 'failed' })
        })

        test('never throws when logging fails', () => {
            logEvent.mockImplementation(() => { throw new Error('boom') })
            expect(() => service.onLinkClicked('email')).not.toThrow()
        })
    })
})
