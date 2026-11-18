import { Inject } from '../../../base/decorators'
import { SupportSettingsDisplayService } from './service'

describe('SupportSettingsDisplayService', () => {
    let service: SupportSettingsDisplayService

    beforeEach(() => {
        Inject('Bindings', { appInfo: { getAppVersion: () => '1.2.3', getUIVersion: () => '26.10.1' } })
        Inject('UserSettings', { get: () => 'abc' })
        service = new SupportSettingsDisplayService()
    })

    afterEach(() => {
        Inject('Bindings', null)
        Inject('UserSettings', null)
        ;['SLACK_URL', 'STRAVA_URL', 'PRIVACY_URL'].forEach(k => delete process.env[k])
    })

    describe('getDisplayProps', () => {
        test('keeps the old prop shape', () => {
            const props = service.getDisplayProps()
            expect(Object.keys(props).sort()).toEqual(['appVersion', 'donationUrl', 'gitHubUrl', 'privacyUrl', 'supportUrls', 'uiVersion', 'uuid'])
            expect(props.supportUrls.map(s => s.label)).toEqual(['Slack', 'Strava', 'Email'])
            expect(props.uuid).toBe('abc')
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
    })
})
