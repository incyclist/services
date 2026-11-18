import { IncyclistDialogService } from '../../../../base/dialogs/service'
import { Injectable } from '../../../../base/decorators'
import type { IObserver } from '../../../../base/typedefs'
import { getBindings } from '../../../../api'
import { useUserSettings } from '../../../service'
import { COPY, compactVersionText } from '../../../support/copy'
import { getDonationChannels, getDonationMode } from '../../../support/donation'
import { buildSupportEmail } from '../../../support/mailto'
import { getGitHubUrl, getPrivacyUrl, getSlackUrl, getStravaUrl, getSupportEmail, getSupportPageUrl } from '../../../support/urls'
import type {
    DonationClickId, SupportAppInfoDisplayProps, SupportDonationDisplayProps, SupportHelpLink,
    SupportLinkClickId, SupportSettingsDialogDisplayProps
} from './types'

/**
 * Shared logic of the Settings > Support dialog. Platform subclasses only provide the
 * copy label and the "copied" message. The action handlers only log, they never throw.
 */
export abstract class SupportSettingsDialogService extends IncyclistDialogService<SupportSettingsDialogDisplayProps> {

    constructor() {
        super('SupportSettingsDialog')
    }

    openDialog(): IObserver {
        const observer = super.openDialog()
        this.safeLog({ message: 'support settings opened', mode: getDonationMode(this.getBindings()) })
        return observer
    }

    protected abstract getCopyLabel(): string
    protected abstract getUuidActionLabel(): string
    protected abstract getCopiedMessage(address: string): string | undefined

    /** Builds the display props from scratch, so version changes after a hot update are always current */
    getDialogDisplayProps(): SupportSettingsDialogDisplayProps {
        return {
            appInfo: this.buildAppInfo(),
            helpTitle: COPY.helpTitle,
            helpLinks: this.buildHelpLinks(),
            donation: this.buildDonation(),
        }
    }

    /** Logs a click on a support link (Strava, Slack, email, privacy, GitHub) */
    onLinkClicked(id: SupportLinkClickId): void {
        this.safeLog({ message: 'support link clicked', link: id })
    }

    /** Logs a click on a donation channel (or on the website link in 'website' mode) */
    onDonationClicked(id: DonationClickId): void {
        this.safeLog({ message: 'donation link clicked', donationChannel: id, mode: getDonationMode(this.getBindings()), source: 'settings' })
    }

    /** Logs the outcome of opening the prefilled support email */
    onEmailOpenResult(result: 'opened' | 'failed', error?: string): void {
        const event: Record<string, unknown> = { message: 'support email opened', openResult: result }
        if (result === 'failed' && error !== undefined)
            event.error = String(error).replace(/mailto:\S*/gi, 'mailto:<redacted>').slice(0, 200)
        this.safeLog(event)
    }

    /** Logs that the support details were copied or shared */
    onDetailsCopied(trigger: 'button' | 'fallback', result: 'success' | 'failed'): void {
        this.safeLog({ message: 'support details copied', trigger, copyResult: result })
    }

    protected safeLog(event: Record<string, unknown>) {
        try {
            this.logEvent(event)
        }
        catch { /* logging must never break the UI */ }
    }

    protected buildAppInfo(): SupportAppInfoDisplayProps {
        const appInfo = this.getBindings().appInfo
        const appVersion = appInfo.getAppVersion()
        const uiVersion = appInfo.getUIVersion()
        return {
            title: COPY.appInfoTitle,
            appVersion,
            uiVersion,
            uuid: this.getUserSettings().get('uuid', null),
            privacyUrl: getPrivacyUrl(),
            labels: {
                appVersion: COPY.appVersionLabel,
                uiVersion: COPY.uiVersionLabel,
                uuid: COPY.uuidLabel,
                privacy: COPY.privacyLabel,
                privacyLink: COPY.privacyLinkLabel,
            },
            compactVersionText: compactVersionText(appVersion, uiVersion),
            uuidActionLabel: this.getUuidActionLabel(),
        }
    }

    protected buildHelpLinks(): SupportHelpLink[] {
        const appInfo = this.getBindings().appInfo
        const mail = buildSupportEmail({
            address: getSupportEmail(),
            uuid: this.getUserSettings().get('uuid', null),
            appVersion: appInfo.getAppVersion(),
            uiVersion: appInfo.getUIVersion(),
        })

        return [
            { id: 'strava', label: COPY.stravaLabel, shortLabel: COPY.stravaShortLabel, url: getStravaUrl() },
            { id: 'slack', label: COPY.slackLabel, shortLabel: COPY.slackShortLabel, url: getSlackUrl() },
            {
                id: 'email', label: mail.address, shortLabel: COPY.emailShortLabel, url: mail.url,
                email: {
                    address: mail.address,
                    subject: mail.subject,
                    body: mail.body,
                    copyText: mail.copyText,
                    copyLabel: this.getCopyLabel(),
                    copiedMessage: this.getCopiedMessage(mail.address),
                }
            },
        ]
    }

    protected buildDonation(): SupportDonationDisplayProps {
        const mode = getDonationMode(this.getBindings())
        const base = {
            title: COPY.donationTitle,
            promise: COPY.promise,
            mode,
            note: COPY.note,
            otherHelpLinks: [
                { id: 'strava' as const, label: COPY.stravaLabel, url: getStravaUrl() },
                { id: 'github' as const, label: COPY.gitHubLabel, url: getGitHubUrl() },
            ],
        }

        if (mode === 'website') {
            const url = getSupportPageUrl()
            return { ...base, channels: [], websiteLink: { label: COPY.websiteLabel, url, host: this.getHost(url) } }
        }
        return { ...base, fundsText: COPY.fundsText, channels: getDonationChannels() }
    }

    protected getHost(url: string): string {
        try {
            return new URL(url).host
        }
        catch {
            return url
        }
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }
}
